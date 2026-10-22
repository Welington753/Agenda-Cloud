// Web Push padrão, sem biblioteca nem plataforma paga: só `node:crypto`.
//
// - Conteúdo cifrado para o aparelho (RFC 8291, `aes128gcm`, RFC 8188): o
//   serviço de push (Google, Apple, Mozilla, Microsoft) transporta bytes que
//   só o navegador inscrito consegue abrir.
// - Identificação do servidor por VAPID (RFC 8292): um JWT ES256 assinado
//   com a chave PRIVADA, que existe só no servidor (variável de ambiente,
//   ver push-config.ts). O serviço de push só aceita mensagens para uma
//   inscrição criada com a chave PÚBLICA correspondente.
//
// Funções puras (salvo a aleatoriedade, injetável nos testes).
import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign,
  type ECDH,
} from 'node:crypto';

export interface ChavesDoAparelho {
  /** Chave pública P-256 do navegador, base64url, 65 bytes (não comprimida). */
  p256dh: string;
  /** Segredo de autenticação do navegador, base64url, 16 bytes. */
  auth: string;
}

export interface ChavesVapid {
  /** base64url, 65 bytes (ponto P-256 não comprimido). */
  publicKey: string;
  /** base64url, 32 bytes (escalar privado P-256). */
  privateKey: string;
  /** `mailto:` ou `https:` de contato, exigido pelos serviços de push. */
  subject: string;
}

/** Tamanho de registro anunciado; o conteúdo cabe sempre num registro só. */
const TAMANHO_DO_REGISTRO = 4096;
/** Folga para cabeçalho, delimitador e etiqueta do AES-GCM. */
export const TAMANHO_MAXIMO_DO_CONTEUDO = 3000;

const decodificar = (valor: string) => Buffer.from(valor, 'base64url');
const codificar = (valor: Buffer | string) => Buffer.from(valor).toString('base64url');
const hmac = (chave: Buffer, dados: Buffer) => createHmac('sha256', chave).update(dados).digest();
const UM = Buffer.from([1]);

/** Valida e decodifica as chaves que o navegador entregou na inscrição. */
export function chavesDoAparelhoValidas(chaves: ChavesDoAparelho): { publica: Buffer; segredo: Buffer } | null {
  const publica = decodificar(chaves.p256dh);
  const segredo = decodificar(chaves.auth);
  if (publica.length !== 65 || publica[0] !== 0x04) return null;
  if (segredo.length !== 16) return null;
  try {
    // Ponto fora da curva é recusado aqui, não na hora do envio.
    const teste = createECDH('prime256v1');
    teste.generateKeys();
    teste.computeSecret(publica);
  } catch {
    return null;
  }
  return { publica, segredo };
}

/**
 * Cifra `conteudo` para o aparelho (RFC 8291). O corpo devolvido já é o
 * que vai no POST, com `Content-Encoding: aes128gcm`.
 */
export function cifrarConteudo(
  conteudo: Buffer,
  aparelho: ChavesDoAparelho,
  aleatorio: { sal?: Buffer; efemera?: ECDH } = {},
): Buffer {
  if (conteudo.length > TAMANHO_MAXIMO_DO_CONTEUDO) throw new Error('conteúdo grande demais para o push');
  const chaves = chavesDoAparelhoValidas(aparelho);
  if (!chaves) throw new Error('chaves do aparelho inválidas');

  const efemera = aleatorio.efemera ?? createECDH('prime256v1');
  if (!aleatorio.efemera) efemera.generateKeys();
  const publicaDoServidor = efemera.getPublicKey();
  const segredoCompartilhado = efemera.computeSecret(chaves.publica);

  // IKM = HKDF(auth, ecdh, "WebPush: info" || 0 || ua_public || as_public, 32)
  const prkDaChave = hmac(chaves.segredo, segredoCompartilhado);
  const informacao = Buffer.concat([Buffer.from('WebPush: info\0'), chaves.publica, publicaDoServidor]);
  const ikm = hmac(prkDaChave, Buffer.concat([informacao, UM]));

  const sal = aleatorio.sal ?? randomBytes(16);
  const prk = hmac(sal, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), UM])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), UM])).subarray(0, 12);

  const cifra = createCipheriv('aes-128-gcm', cek, nonce);
  // 0x02: delimitador do ÚLTIMO (e único) registro.
  const cifrado = Buffer.concat([
    cifra.update(Buffer.concat([conteudo, Buffer.from([2])])),
    cifra.final(),
    cifra.getAuthTag(),
  ]);

  const cabecalho = Buffer.alloc(16 + 4 + 1);
  sal.copy(cabecalho, 0);
  cabecalho.writeUInt32BE(TAMANHO_DO_REGISTRO, 16);
  cabecalho.writeUInt8(publicaDoServidor.length, 20);
  return Buffer.concat([cabecalho, publicaDoServidor, cifrado]);
}

/** Erro de configuração sem eco do valor (a chave privada nunca aparece). */
export function problemaNasChavesVapid(chaves: ChavesVapid): string | null {
  const publica = decodificar(chaves.publicKey);
  const privada = decodificar(chaves.privateKey);
  if (publica.length !== 65 || publica[0] !== 0x04) return 'WEB_PUSH_VAPID_PUBLIC_KEY';
  if (privada.length !== 32) return 'WEB_PUSH_VAPID_PRIVATE_KEY';
  try {
    const par = createECDH('prime256v1');
    par.setPrivateKey(privada);
    if (!par.getPublicKey().equals(publica)) return 'WEB_PUSH_VAPID_PUBLIC_KEY';
  } catch {
    return 'WEB_PUSH_VAPID_PRIVATE_KEY';
  }
  if (!/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(chaves.subject)) return 'WEB_PUSH_SUBJECT';
  return null;
}

/**
 * Cabeçalho `Authorization` do VAPID para um endpoint: JWT ES256 com `aud`
 * = origem do serviço de push e validade de 12 h.
 */
export function cabecalhoVapid(endpoint: URL, chaves: ChavesVapid, agora: Date): string {
  const publica = decodificar(chaves.publicKey);
  const chavePrivada = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: chaves.privateKey,
      x: codificar(publica.subarray(1, 33)),
      y: codificar(publica.subarray(33, 65)),
    },
    format: 'jwk',
  });
  const segundos = Math.floor(agora.getTime() / 1000);
  const entrada = `${codificar(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))}.${codificar(
    JSON.stringify({ aud: endpoint.origin, exp: segundos + 12 * 3600, sub: chaves.subject }),
  )}`;
  const assinatura = sign('sha256', Buffer.from(entrada), { key: chavePrivada, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${entrada}.${codificar(assinatura)}, k=${chaves.publicKey}`;
}
