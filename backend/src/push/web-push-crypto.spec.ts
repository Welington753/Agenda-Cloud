import { createDecipheriv, createECDH, createHmac, createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  cabecalhoVapid,
  chavesDoAparelhoValidas,
  cifrarConteudo,
  problemaNasChavesVapid,
  type ChavesVapid,
} from './web-push-crypto.js';

const b64 = (b: Buffer) => b.toString('base64url');
const hmac = (k: Buffer, d: Buffer) => createHmac('sha256', k).update(d).digest();

/** O lado do NAVEGADOR (RFC 8291), escrito à parte para provar a cifra. */
function decifrarComoOAparelho(corpo: Buffer, privadaDoAparelho: ReturnType<typeof createECDH>, segredo: Buffer): Buffer {
  const sal = corpo.subarray(0, 16);
  const tamanhoDaChave = corpo.readUInt8(20);
  const publicaDoServidor = corpo.subarray(21, 21 + tamanhoDaChave);
  const cifrado = corpo.subarray(21 + tamanhoDaChave);
  const compartilhado = privadaDoAparelho.computeSecret(publicaDoServidor);
  const publicaDoAparelho = privadaDoAparelho.getPublicKey();
  const prkDaChave = hmac(segredo, compartilhado);
  const ikm = hmac(prkDaChave, Buffer.concat([Buffer.from('WebPush: info\0'), publicaDoAparelho, publicaDoServidor, Buffer.from([1])]));
  const prk = hmac(sal, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const decifra = createDecipheriv('aes-128-gcm', cek, nonce);
  decifra.setAuthTag(cifrado.subarray(cifrado.length - 16));
  const claro = Buffer.concat([decifra.update(cifrado.subarray(0, cifrado.length - 16)), decifra.final()]);
  expect(claro[claro.length - 1]).toBe(2);
  return claro.subarray(0, claro.length - 1);
}

function aparelho() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const segredo = Buffer.alloc(16, 7);
  return { ecdh, segredo, chaves: { p256dh: b64(ecdh.getPublicKey()), auth: b64(segredo) } };
}

function parVapid(): ChavesVapid {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64(ecdh.getPublicKey()), privateKey: b64(ecdh.getPrivateKey()), subject: 'mailto:suporte@example.test' };
}

describe('cifra do conteúdo (RFC 8291, aes128gcm)', () => {
  it('só o aparelho inscrito decifra, e o conteúdo volta igual', () => {
    const a = aparelho();
    const conteudo = Buffer.from(JSON.stringify({ v: 1, tipo: 'nova-solicitacao', solicitacao: 'abc' }));
    const corpo = cifrarConteudo(conteudo, a.chaves);
    expect(corpo.readUInt32BE(16)).toBe(4096);
    expect(corpo.includes(conteudo)).toBe(false);
    expect(decifrarComoOAparelho(corpo, a.ecdh, a.segredo).equals(conteudo)).toBe(true);
  });

  it('outro aparelho não decifra', () => {
    const a = aparelho();
    const outro = aparelho();
    const corpo = cifrarConteudo(Buffer.from('oi'), a.chaves);
    expect(() => decifrarComoOAparelho(corpo, outro.ecdh, outro.segredo)).toThrow();
  });

  it('recusa chaves de aparelho inválidas', () => {
    expect(chavesDoAparelhoValidas({ p256dh: b64(Buffer.alloc(65, 4)), auth: b64(Buffer.alloc(16)) })).toBeNull();
    expect(chavesDoAparelhoValidas({ p256dh: aparelho().chaves.p256dh, auth: b64(Buffer.alloc(8)) })).toBeNull();
    expect(() => cifrarConteudo(Buffer.from('x'), { p256dh: 'abc', auth: 'abc' })).toThrow();
  });
});

describe('VAPID (RFC 8292)', () => {
  it('JWT ES256 verificável com a chave pública, aud = origem do serviço, validade de 12 h', () => {
    const chaves = parVapid();
    const agora = new Date('2027-03-01T12:00:00.000Z');
    const cabecalho = cabecalhoVapid(new URL('https://fcm.googleapis.com/fcm/send/xyz'), chaves, agora);
    const [, t, k] = /^vapid t=([^,]+), k=(.+)$/.exec(cabecalho) ?? [];
    expect(k).toBe(chaves.publicKey);
    const [h, c, s] = t.split('.');
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString()) as Record<string, unknown>;
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: agora.getTime() / 1000 + 43200, sub: chaves.subject });
    const pub = Buffer.from(chaves.publicKey, 'base64url');
    const chavePublica = createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: b64(pub.subarray(1, 33)), y: b64(pub.subarray(33)) },
      format: 'jwk',
    });
    expect(
      verify('sha256', Buffer.from(`${h}.${c}`), { key: chavePublica, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')),
    ).toBe(true);
    expect(cabecalho).not.toContain(chaves.privateKey);
  });

  it('confere o par de chaves e o contato sem ecoar valores', () => {
    const chaves = parVapid();
    expect(problemaNasChavesVapid(chaves)).toBeNull();
    expect(problemaNasChavesVapid({ ...chaves, publicKey: parVapid().publicKey })).toBe('WEB_PUSH_VAPID_PUBLIC_KEY');
    expect(problemaNasChavesVapid({ ...chaves, privateKey: 'curta' })).toBe('WEB_PUSH_VAPID_PRIVATE_KEY');
    expect(problemaNasChavesVapid({ ...chaves, subject: 'http://inseguro' })).toBe('WEB_PUSH_SUBJECT');
  });
});
