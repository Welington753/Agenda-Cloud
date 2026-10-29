// Partes do backup agendado que não precisam de banco nem de binários. URLs,
// chaves e endpoints são fictícios. O caminho completo (pg_dump, restauração,
// age e envio a um simulador S3) está em test/backup-agendado.backup-e2e-spec.ts.
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Parada } from './entrada-oculta.mjs';
import {
  HASH_VAZIO,
  assinarS3,
  avaliarPapelSomenteLeitura,
  clienteS3,
  conferirObjetoEnviado,
  conferirRepositorioPrivado,
  destinoDaRecuperacao,
  lerConfiguracao,
  limparDetalhe,
  planoDoObjeto,
  prefixoMensal,
  segredosDa,
  sinalizarCron,
  versaoMaior,
  type Buscar,
} from './backup-agendado-lib.mjs';

const pasta = mkdtempSync(path.join(tmpdir(), 'backup-agendado-spec-'));
const ca = path.join(pasta, 'ca.pem');
writeFileSync(ca, '-----BEGIN CERTIFICATE-----\nficticio\n-----END CERTIFICATE-----\n');

const HOST = 'ep-piloto-111111.c-2.us-east-1.aws.neon.tech';
const DESTINATARIO = 'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p';
const PILOTO = {
  BACKUP_MODO: 'piloto',
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'Welington753/agenda-cloud-operacao',
  GITHUB_TOKEN: 'ghs_ficticio',
  PILOT_ENDPOINT_ID: 'ep-piloto-111111',
  PRODUCTION_ENDPOINT_ID: 'ep-proibido-222222',
  PILOTO_BACKUP_URL: `postgresql://agenda_backup:senha-ficticia-1@${HOST}/neondb?sslmode=verify-full`,
  RESTAURACAO_URL: 'postgresql://postgres:descartavel@127.0.0.1:55433/postgres?sslmode=verify-full',
  RESTAURACAO_CA: ca,
  AGE_RECIPIENT: DESTINATARIO,
  AGE_BIN: '/usr/bin/age',
  PG_BIN: '/usr/lib/postgresql/17/bin',
  B2_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com',
  B2_BUCKET: 'agenda-cloud-backup-piloto',
  B2_KEY_ID: '004ficticio0000000000001',
  B2_APP_KEY: 'K004chaveficticiadeaplicacao',
  SENTRY_CRON_URL: 'https://o1.ingest.us.sentry.io/api/2/cron/backup-piloto/0123abcd/',
  BACKUP_CODIGO_SHA: 'a'.repeat(40),
  BACKUP_PASTA_TEMP: pasta,
};
const ENSAIO = {
  ...PILOTO,
  BACKUP_MODO: 'ensaio',
  GITHUB_REPOSITORY: 'Welington753/Agenda-Cloud',
  PILOTO_BACKUP_URL: 'postgresql://leitor:ficticia@127.0.0.1:55433/origem?sslmode=verify-full',
  BACKUP_ORIGEM_CA: ca,
  B2_ENDPOINT: 'http://127.0.0.1:9000',
  SENTRY_CRON_URL: 'http://127.0.0.1:9001/api/1/cron/backup/abc/',
};

function codigo(fn: () => unknown): string {
  try {
    fn();
  } catch (erro) {
    if (erro instanceof Parada) return erro.message;
    throw erro;
  }
  return 'sem erro';
}

describe('lerConfiguracao (travas antes de qualquer rede)', () => {
  it('aceita o piloto no repositório privado de operação, com o papel agenda_backup', () => {
    const c = lerConfiguracao(PILOTO);
    expect(c.modo).toBe('piloto');
    expect(c.origem).toMatchObject({ host: HOST, user: 'agenda_backup', database: 'neondb' });
    expect(c.restauracao).toMatchObject({ host: '127.0.0.1', servidorTls: 'localhost', port: 55433 });
    expect(c.armazenamento).toMatchObject({ regiao: 'us-west-004', bucket: 'agenda-cloud-backup-piloto' });
  });

  it('aceita o ensaio só com tudo em 127.0.0.1', () => {
    expect(lerConfiguracao(ENSAIO).modo).toBe('ensaio');
  });

  it('a execução inclui a tentativa: re-run do mesmo run não reaproveita a pasta', () => {
    expect(lerConfiguracao({ ...PILOTO, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2' }).execucao).toBe('123-2');
    expect(lerConfiguracao({ ...PILOTO, GITHUB_RUN_ID: '123' }).execucao).toBe('123-1');
  });

  it.each([
    ['fora do GitHub Actions', { GITHUB_ACTIONS: undefined }, 'ERR_PILOTO_FORA_DO_GITHUB_ACTIONS'],
    ['no repositório público', { GITHUB_REPOSITORY: 'Welington753/Agenda-Cloud' }, 'ERR_REPOSITORIO_PUBLICO'],
    ['num fork ou outro repositório', { GITHUB_REPOSITORY: 'outra/agenda-cloud-operacao' }, 'ERR_REPOSITORIO_INESPERADO'],
    ['sem token para conferir a visibilidade', { GITHUB_TOKEN: '' }, 'ERR_VARIAVEL_AUSENTE_GITHUB_TOKEN'],
    ['com o papel dono do banco', { PILOTO_BACKUP_URL: `postgresql://neondb_owner:x-senha@${HOST}/neondb` }, 'ERR_PAPEL_DIFERENTE_DE_AGENDA_BACKUP'],
    ['com o pooler', { PILOTO_BACKUP_URL: `postgresql://agenda_backup:x-senha@ep-piloto-111111-pooler.c-2.us-east-1.aws.neon.tech/neondb` }, 'ERR_POOLER'],
    ['em outro endpoint', { PILOTO_BACKUP_URL: `postgresql://agenda_backup:x-senha@ep-outro-333333.c-2.us-east-1.aws.neon.tech/neondb` }, 'ERR_ENDPOINT_DIFERENTE_DO_PILOTO'],
    ['com TLS afrouxado', { PILOTO_BACKUP_URL: `postgresql://agenda_backup:x-senha@${HOST}/neondb?sslmode=disable` }, 'ERR_TLS_AFROUXADO'],
    ['endpoints iguais', { PRODUCTION_ENDPOINT_ID: 'ep-piloto-111111' }, 'ERR_ENDPOINT_ID_INVALIDO'],
    ['armazenamento fora do B2', { B2_ENDPOINT: 'https://s3.amazonaws.com' }, 'ERR_ENDPOINT_B2_INESPERADO'],
    ['B2 sem TLS', { B2_ENDPOINT: 'http://s3.us-west-004.backblazeb2.com' }, 'ERR_ENDPOINT_B2_INESPERADO'],
    ['cron fora do Sentry', { SENTRY_CRON_URL: 'https://exemplo.invalid/api/2/cron/x/0a/' }, 'ERR_CRON_URL_INESPERADA'],
    ['cron com status embutido', { SENTRY_CRON_URL: 'https://o1.ingest.us.sentry.io/api/2/cron/x/0a/?status=ok' }, 'ERR_CRON_URL_INVALIDA'],
    ['restauração fora do loopback', { RESTAURACAO_URL: `postgresql://p:x@${HOST}/neondb?sslmode=verify-full` }, 'ERR_RESTAURACAO_FORA_DO_LOOPBACK'],
    ['restauração sem verify-full', { RESTAURACAO_URL: 'postgresql://p:x@127.0.0.1/postgres?sslmode=require' }, 'ERR_RESTAURACAO_SEM_VERIFY_FULL'],
    ['restauração sem CA', { RESTAURACAO_CA: path.join(pasta, 'nao-existe.pem') }, 'ERR_RESTAURACAO_SEM_CA'],
    ['destinatário age inválido', { AGE_RECIPIENT: 'age1curto' }, 'ERR_DESTINATARIO_AGE_INVALIDO'],
    ['chave privada no ambiente', { QUALQUER: 'AGE-SECRET-KEY-1QQQQ' }, 'ERR_CHAVE_PRIVADA_NO_AMBIENTE'],
    ['SHA do código abreviado', { BACKUP_CODIGO_SHA: 'abc1234' }, 'ERR_SHA_DO_CODIGO_INVALIDO'],
    ['pasta temporária dentro do repositório', { BACKUP_PASTA_TEMP: path.resolve('.') }, 'ERR_PASTA_TEMPORARIA_DENTRO_DO_REPOSITORIO'],
    ['modo desconhecido', { BACKUP_MODO: 'producao' }, 'ERR_MODO_INVALIDO'],
  ])('recusa o piloto %s', (_caso, ajuste, esperado) => {
    expect(codigo(() => lerConfiguracao({ ...PILOTO, ...ajuste }))).toBe(esperado);
  });

  it.each([
    ['origem no Neon', { PILOTO_BACKUP_URL: PILOTO.PILOTO_BACKUP_URL }, 'ERR_ENSAIO_ORIGEM_FORA_DO_LOOPBACK'],
    ['B2 real', { B2_ENDPOINT: PILOTO.B2_ENDPOINT }, 'ERR_ENSAIO_ARMAZENAMENTO_FORA_DO_LOOPBACK'],
    ['Sentry real', { SENTRY_CRON_URL: PILOTO.SENTRY_CRON_URL }, 'ERR_ENSAIO_CRON_FORA_DO_LOOPBACK'],
  ])('recusa o ensaio com %s', (_caso, ajuste, esperado) => {
    expect(codigo(() => lerConfiguracao({ ...ENSAIO, ...ajuste }))).toBe(esperado);
  });

  it('lista os segredos para tirar dos detalhes de erro', () => {
    const segredos = segredosDa(lerConfiguracao(PILOTO));
    expect(segredos).toEqual(expect.arrayContaining(['senha-ficticia-1', 'K004chaveficticiadeaplicacao', HOST, 'ghs_ficticio', PILOTO.SENTRY_CRON_URL]));
  });
});

describe('conferirRepositorioPrivado', () => {
  const config = lerConfiguracao(PILOTO);
  const resposta = (corpo: object, status = 200) => (async () => new Response(JSON.stringify(corpo), { status })) as unknown as Buscar;

  it('aceita o repositório de operação privado', async () => {
    await expect(
      conferirRepositorioPrivado(config, resposta({ full_name: 'Welington753/agenda-cloud-operacao', private: true, visibility: 'private' })),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['público', { full_name: 'Welington753/agenda-cloud-operacao', private: false, visibility: 'public' }, 200, 'ERR_REPOSITORIO_NAO_PRIVADO'],
    ['interno', { full_name: 'Welington753/agenda-cloud-operacao', private: true, visibility: 'internal' }, 200, 'ERR_REPOSITORIO_NAO_PRIVADO'],
    ['outro nome', { full_name: 'Welington753/Agenda-Cloud', private: true, visibility: 'private' }, 200, 'ERR_REPOSITORIO_INESPERADO'],
    ['sem resposta', {}, 404, 'ERR_VISIBILIDADE_NAO_CONFERIDA'],
  ])('recusa repositório %s', async (_caso, corpo, status, esperado) => {
    await expect(conferirRepositorioPrivado(config, resposta(corpo, status))).rejects.toThrow(esperado);
  });
});

describe('avaliarPapelSomenteLeitura', () => {
  const leitor = {
    superusuario: false,
    criaPapel: false,
    criaBanco: false,
    replicacao: false,
    ignoraRls: false,
    criaNoBanco: false,
    schemasComCriacao: 0,
    donoDeObjetos: 0,
    membroDePapeis: 0,
    tabelasComEscrita: 0,
    sequenciasComEscrita: 0,
    funcoesSecurityDefiner: 0,
    tabelasSemLeitura: 0,
    sequenciasSemLeitura: 0,
  };
  it('aceita só leitura em tudo', () => {
    expect(avaliarPapelSomenteLeitura(leitor)).toEqual([]);
  });
  it.each([
    [{ superusuario: true }, 'ERR_PAPEL_SUPERUSUARIO'],
    [{ criaPapel: true }, 'ERR_PAPEL_COM_ATRIBUTO_DE_ADMINISTRACAO'],
    [{ ignoraRls: true }, 'ERR_PAPEL_COM_ATRIBUTO_DE_ADMINISTRACAO'],
    [{ criaNoBanco: true }, 'ERR_PAPEL_PODE_CRIAR_OBJETOS'],
    [{ schemasComCriacao: 1 }, 'ERR_PAPEL_PODE_CRIAR_OBJETOS'],
    [{ donoDeObjetos: 3 }, 'ERR_PAPEL_DONO_DE_OBJETOS'],
    [{ membroDePapeis: 1 }, 'ERR_PAPEL_MEMBRO_DE_OUTRO_PAPEL'],
    [{ tabelasComEscrita: 1 }, 'ERR_PAPEL_PODE_ESCREVER'],
    [{ sequenciasComEscrita: 1 }, 'ERR_PAPEL_PODE_ESCREVER'],
    [{ funcoesSecurityDefiner: 1 }, 'ERR_PAPEL_EXECUTA_FUNCAO_SECURITY_DEFINER'],
    [{ tabelasSemLeitura: 1 }, 'ERR_PAPEL_NAO_LE_TUDO'],
    [{ sequenciasSemLeitura: 1 }, 'ERR_PAPEL_NAO_LE_TUDO'],
  ])('recusa %o', (ajuste, esperado) => {
    expect(avaliarPapelSomenteLeitura({ ...leitor, ...ajuste })).toEqual([esperado]);
  });
  it('recusa papel não encontrado', () => {
    expect(avaliarPapelSomenteLeitura(undefined)).toEqual(['ERR_PAPEL_NAO_ENCONTRADO']);
  });
});

describe('planoDoObjeto', () => {
  const comMensal = { mensalDoMesExiste: true };
  it('diário: 35 dias de retenção, pasta por data e execução', () => {
    const plano = planoDoObjeto(new Date('2026-10-29T03:17:45.123Z'), '987-1', comMensal);
    expect(plano.tipo).toBe('diario');
    expect(plano.prefixo).toBe('piloto/diario/2026/10/29/031745Z-987-1/');
    expect(plano.retencaoAte.toISOString()).toBe('2026-12-03T03:17:45.123Z');
  });
  it('diário na virada do mês e do ano: 35 dias corridos', () => {
    expect(planoDoObjeto(new Date('2026-12-31T06:17:00Z'), '1', comMensal).retencaoAte.toISOString()).toBe('2027-02-04T06:17:00.000Z');
  });
  it('primeiro backup completo do mês é o mensal: 13 meses e 1 dia', () => {
    const plano = planoDoObjeto(new Date('2026-11-01T03:00:00Z'), '1');
    expect(plano.tipo).toBe('mensal');
    expect(plano.prefixo).toBe('piloto/mensal/2026/11/01/030000Z-1/');
    expect(plano.retencaoAte.toISOString()).toBe('2027-12-02T03:00:00.000Z');
  });
  it('dia 1 que falhou: o mensal é o do primeiro dia que der certo', () => {
    const plano = planoDoObjeto(new Date('2026-11-02T06:17:30Z'), '2');
    expect(plano.tipo).toBe('mensal');
    expect(plano.retencaoAte.toISOString()).toBe('2027-12-03T06:17:30.000Z');
  });
  it('reexecução no dia 1 depois de um mensal completo: diário, em pasta própria', () => {
    const primeira = planoDoObjeto(new Date('2026-11-01T06:17:00Z'), '55-1');
    const reexecucao = planoDoObjeto(new Date('2026-11-01T06:40:00Z'), '55-2', comMensal);
    expect(reexecucao.tipo).toBe('diario');
    expect(reexecucao.prefixo).not.toBe(primeira.prefixo);
  });
  it('mensal tardio no fim do mês: o estouro do dia empurra para frente, nunca para trás', () => {
    // 31/01/2027 + 13 meses = 31/02/2028, normalizado para 02/03; mais 1 dia.
    expect(planoDoObjeto(new Date('2027-01-31T06:17:00Z'), '1').retencaoAte.toISOString()).toBe('2028-03-03T06:17:00.000Z');
    expect(planoDoObjeto(new Date('2026-12-01T06:17:00Z'), '1').retencaoAte.toISOString()).toBe('2028-01-02T06:17:00.000Z');
  });
  it('prefixoMensal: o mês UTC do ponto de recuperação', () => {
    expect(prefixoMensal(new Date('2026-11-30T23:59:59Z'))).toBe('piloto/mensal/2026/11/');
    expect(prefixoMensal(new Date('2026-12-01T00:00:00Z'))).toBe('piloto/mensal/2026/12/');
  });
});

describe('assinarS3 (AWS SigV4)', () => {
  // Vetores públicos da AWS: suíte aws-sig-v4-test-suite (get-vanilla) e os
  // exemplos da documentação do S3 ("Signature Calculations for the
  // Authorization Header").
  it('get-vanilla da suíte oficial', () => {
    const h = assinarS3({
      metodo: 'GET',
      url: 'https://example.amazonaws.com/',
      hashDoCorpo: HASH_VAZIO,
      chaveId: 'AKIDEXAMPLE',
      chaveSecreta: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      regiao: 'us-east-1',
      servico: 'service',
      agora: new Date('2015-08-30T12:36:00Z'),
    });
    expect(h.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });

  const S3 = { chaveId: 'AKIAIOSFODNN7EXAMPLE', chaveSecreta: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', regiao: 'us-east-1', agora: new Date('2013-05-24T00:00:00Z') };

  it('GET Object do exemplo do S3', () => {
    const h = assinarS3({
      ...S3,
      metodo: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      cabecalhos: { Range: 'bytes=0-9', 'x-amz-content-sha256': HASH_VAZIO },
      hashDoCorpo: HASH_VAZIO,
    });
    expect(h.authorization).toContain('SignedHeaders=host;range;x-amz-content-sha256;x-amz-date');
    expect(h.authorization).toContain('Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });

  it('PUT Object do exemplo do S3 (chave com caractere codificado)', () => {
    const corpo = 'Welcome to Amazon S3.';
    const hash = createHash('sha256').update(corpo).digest('hex');
    const h = assinarS3({
      ...S3,
      metodo: 'PUT',
      url: 'https://examplebucket.s3.amazonaws.com/test%24file.text',
      cabecalhos: { Date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY', 'x-amz-content-sha256': hash },
      hashDoCorpo: hash,
    });
    expect(h.authorization).toContain('Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  });
});

describe('clienteS3', () => {
  it('PUT com retenção COMPLIANCE, Content-MD5 e sha256 em metadado; caminho no estilo path', async () => {
    const pedidos: { url: string; method?: string; headers?: Record<string, string> }[] = [];
    const buscar = (async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
      pedidos.push({ url, ...init });
      return new Response(null, { status: 200 });
    }) as unknown as Buscar;
    const s3 = clienteS3(
      { endpoint: 'https://s3.us-west-004.backblazeb2.com', regiao: 'us-west-004', bucket: 'balde-ficticio', chaveId: 'id', chaveSecreta: 'segredo' },
      { buscar, agora: () => new Date('2026-10-29T03:00:00Z') },
    );
    const corpo = Buffer.from('conteudo cifrado ficticio');
    const ate = new Date('2026-12-03T03:00:00Z');
    expect(await s3.enviar('piloto/diario/2026/10/29/x/a b.age', corpo, { retencaoAte: ate })).toEqual({ status: 200, ok: true, versao: null });
    const [put] = pedidos;
    expect(put.url).toBe('https://s3.us-west-004.backblazeb2.com/balde-ficticio/piloto/diario/2026/10/29/x/a%20b.age');
    expect(put.method).toBe('PUT');
    expect(put.headers).toMatchObject({
      'x-amz-object-lock-mode': 'COMPLIANCE',
      'x-amz-object-lock-retain-until-date': '2026-12-03T03:00:00.000Z',
      'content-md5': createHash('md5').update(corpo).digest('base64'),
      'x-amz-meta-sha256': createHash('sha256').update(corpo).digest('hex'),
      'x-amz-content-sha256': createHash('sha256').update(corpo).digest('hex'),
    });
    expect(put.headers?.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=id\/20261029\/us-west-004\/s3\/aws4_request, SignedHeaders=content-md5;content-type;host;x-amz-content-sha256;x-amz-date;x-amz-meta-sha256;x-amz-object-lock-mode;x-amz-object-lock-retain-until-date, Signature=[0-9a-f]{64}$/);
    expect(put.headers).not.toHaveProperty('host');
  });

  it('HEAD e GET da versão gravada; listagem dos mensais', async () => {
    const pedidos: { url: string; method?: string; headers?: Record<string, string> }[] = [];
    const buscar = (async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
      pedidos.push({ url, ...init });
      if (url.includes('list-type=2')) {
        return new Response('<ListBucketResult><Contents><Key>piloto/mensal/2026/11/01/x/resumo.json</Key></Contents></ListBucketResult>', { status: 200 });
      }
      return new Response(init?.method === 'HEAD' ? null : 'x', { status: 200, headers: { 'x-amz-version-id': '4_zversao' } });
    }) as unknown as Buscar;
    const s3 = clienteS3(
      { endpoint: 'https://s3.us-west-004.backblazeb2.com', regiao: 'us-west-004', bucket: 'balde-ficticio', chaveId: 'id', chaveSecreta: 'segredo' },
      { buscar, agora: () => new Date('2026-10-29T03:00:00Z') },
    );
    expect(await s3.enviar('a.age', Buffer.from('c'), { retencaoAte: new Date() })).toMatchObject({ versao: '4_zversao' });
    await s3.conferir('a.age', '4_z+v/1');
    await s3.baixar('a.age', '4_z+v/1');
    expect(await s3.listar('piloto/mensal/2026/11/')).toEqual({ status: 200, chaves: ['piloto/mensal/2026/11/01/x/resumo.json'] });
    expect(pedidos[1]).toMatchObject({ method: 'HEAD', url: 'https://s3.us-west-004.backblazeb2.com/balde-ficticio/a.age?versionId=4_z%2Bv%2F1' });
    expect(pedidos[2]).toMatchObject({ method: 'GET', url: 'https://s3.us-west-004.backblazeb2.com/balde-ficticio/a.age?versionId=4_z%2Bv%2F1' });
    expect(pedidos[3].url).toBe('https://s3.us-west-004.backblazeb2.com/balde-ficticio?list-type=2&prefix=piloto%2Fmensal%2F2026%2F11%2F');
    // A consulta entra na assinatura: a mesma requisição assinada de novo dá o mesmo valor.
    const refeita = assinarS3({
      metodo: 'HEAD',
      url: pedidos[1].url,
      cabecalhos: { 'x-amz-content-sha256': HASH_VAZIO },
      hashDoCorpo: HASH_VAZIO,
      chaveId: 'id',
      chaveSecreta: 'segredo',
      regiao: 'us-west-004',
      agora: new Date('2026-10-29T03:00:00Z'),
    });
    expect(pedidos[1].headers?.authorization).toBe(refeita.authorization);
  });
});

describe('conferirObjetoEnviado', () => {
  const esperado = { bytes: 10, sha256: 'ab', retencaoAte: new Date('2026-12-03T03:00:00Z') };
  const ok = {
    'content-length': '10',
    'x-amz-meta-sha256': 'ab',
    'x-amz-object-lock-mode': 'COMPLIANCE',
    'x-amz-object-lock-retain-until-date': '2026-12-03T03:00:00Z',
  };
  it('aceita o objeto igual, com a retenção pedida', () => {
    expect(conferirObjetoEnviado({ status: 200, cabecalhos: ok }, esperado)).toEqual([]);
  });
  it.each([
    [{ 'content-length': '9' }, 'ERR_OBJETO_TAMANHO_DIFERENTE'],
    [{ 'x-amz-meta-sha256': 'cd' }, 'ERR_OBJETO_SHA256_DIFERENTE'],
    [{ 'x-amz-object-lock-mode': 'GOVERNANCE' }, 'ERR_OBJETO_SEM_RETENCAO_COMPLIANCE'],
    [{ 'x-amz-object-lock-mode': undefined }, 'ERR_OBJETO_SEM_RETENCAO_COMPLIANCE'],
    [{ 'x-amz-object-lock-retain-until-date': '2026-12-02T03:00:00Z' }, 'ERR_OBJETO_RETENCAO_MENOR_QUE_A_PEDIDA'],
  ])('aponta %o', (ajuste, falha) => {
    expect(conferirObjetoEnviado({ status: 200, cabecalhos: { ...ok, ...ajuste } as Record<string, string> }, esperado)).toEqual([falha]);
  });
  it('HEAD de outra versão da mesma chave', () => {
    expect(conferirObjetoEnviado({ status: 200, cabecalhos: { ...ok, 'x-amz-version-id': 'outra' } }, { ...esperado, versao: 'gravada' })).toEqual(['ERR_OBJETO_VERSAO_DIFERENTE']);
    expect(conferirObjetoEnviado({ status: 200, cabecalhos: { ...ok, 'x-amz-version-id': 'gravada' } }, { ...esperado, versao: 'gravada' })).toEqual([]);
  });
  it('objeto ausente', () => {
    expect(conferirObjetoEnviado({ status: 404, cabecalhos: {} }, esperado)).toEqual(['ERR_OBJETO_NAO_ENCONTRADO_APOS_ENVIO']);
  });
});

describe('detalhes, versões, cron e destino da recuperação', () => {
  it('limparDetalhe tira segredos, inteiros e codificados, e URLs de banco', () => {
    const texto = 'falhou para ep-x.neon.tech com senha s3nh@!x e postgresql://u:p@h/db; s3nh%40!x';
    expect(limparDetalhe(texto, ['ep-x.neon.tech', 's3nh@!x'])).toBe('falhou para [omitido] com senha [omitido] e [url omitida] [omitido]');
  });

  it('versaoMaior lê a saída de --version', () => {
    expect(versaoMaior('pg_dump (PostgreSQL) 17.6 (Ubuntu 17.6-1.pgdg24.04+1)')).toBe(17);
    expect(versaoMaior('pg_restore (PostgreSQL) 18.0')).toBe(18);
    expect(versaoMaior('')).toBeNull();
  });

  it('sinalizarCron manda o status (e a duração) e nunca lança', async () => {
    const urls: string[] = [];
    const buscar = (async (url: string) => {
      urls.push(url);
      return new Response(null, { status: 202 });
    }) as unknown as Buscar;
    expect(await sinalizarCron('https://o1.ingest.us.sentry.io/api/2/cron/b/0a/', 'ok', { buscar, duracaoMs: 1234.4 })).toBe(true);
    expect(urls).toEqual(['https://o1.ingest.us.sentry.io/api/2/cron/b/0a/?status=ok&duration=1234']);
    const falha = (async () => {
      throw new Error('rede');
    }) as unknown as Buscar;
    expect(await sinalizarCron('https://o1.ingest.us.sentry.io/api/2/cron/b/0a/', 'error', { buscar: falha })).toBe(false);
  });

  it('destinoDaRecuperacao aceita outro provedor com TLS e recusa pooler', () => {
    expect(destinoDaRecuperacao('postgresql://u:p@db.exemplo.invalid:6543/novo?sslmode=require')).toMatchObject({
      host: 'db.exemplo.invalid',
      servidorTls: 'db.exemplo.invalid',
      port: 6543,
      database: 'novo',
    });
    expect(codigo(() => destinoDaRecuperacao(`postgresql://u:p@ep-x-pooler.c-2.us-east-1.aws.neon.tech/neondb`))).toBe('ERR_POOLER');
    expect(codigo(() => destinoDaRecuperacao('postgresql://u:p@127.0.0.1/novo?sslmode=verify-full'))).toBe('ERR_RECUPERACAO_SEM_CA');
  });
});
