// Caminho completo do backup agendado (lote O1) com dados FICTÍCIOS, num
// PostgreSQL descartável com TLS. Nada aqui alcança Neon, B2 ou Sentry:
//
// - origem: banco `backup_origem_e2e`, lido por um papel só de leitura;
// - restauração: bancos criados e apagados pelo próprio backup no mesmo
//   servidor descartável;
// - armazenamento: simulador S3 local que confere a assinatura SigV4, o
//   Content-MD5 e o sha256 do corpo, guarda a retenção pedida, versiona cada
//   chave (como um bucket com Object Lock) e lista por prefixo;
// - cron: simulador local que registra os check-ins.
//
// O simulador S3 prova o que o script pede e confere, não o comportamento do
// B2 real (Object Lock, permissões da chave, arredondamento de datas). Isso
// fica para a primeira execução no repositório de operação.
//
// Requer DB_E2E_DIRECT_URL (superusuário do descartável, como no CI),
// NODE_EXTRA_CA_CERTS ou BACKUP_E2E_CA (certificado do descartável), PG_BIN e
// AGE_BIN. Com BACKUP_E2E_EXIGIR_FERRAMENTAS=true (o workflow), falta de
// qualquer um falha em vez de pular. Sem age instalado, BACKUP_E2E_AGE_SIMULADO
// troca o age por uma cifra de brinquedo e pula a recuperação, que precisa
// do age de verdade.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { compararFotografias, fotografar } from '../scripts/operacao-piloto.mjs';
import {
  ARQUIVOS,
  assinarS3,
  clienteS3,
  executar,
  executarBackup,
  lerConfiguracao,
  type Configuracao,
  type Executar,
} from '../scripts/backup-agendado-lib.mjs';

const URL_ADMIN = process.env.DB_E2E_DIRECT_URL ?? '';
const CA = process.env.BACKUP_E2E_CA ?? process.env.NODE_EXTRA_CA_CERTS ?? '';
const PG_BIN = process.env.PG_BIN ?? '';
const AGE_BIN = process.env.AGE_BIN ?? '';
const AGE_SIMULADO = process.env.BACKUP_E2E_AGE_SIMULADO === 'true';
const EXE = process.platform === 'win32' ? '.exe' : '';
const ferramentas =
  URL_ADMIN !== '' &&
  existsSync(CA) &&
  existsSync(path.join(PG_BIN, `pg_dump${EXE}`)) &&
  (AGE_SIMULADO || existsSync(AGE_BIN));
if (process.env.BACKUP_E2E_EXIGIR_FERRAMENTAS === 'true' && (!ferramentas || AGE_SIMULADO)) {
  throw new Error('backup-e2e: faltam DB_E2E_DIRECT_URL, o certificado, PG_BIN ou AGE_BIN (age real)');
}

const ORIGEM = 'backup_origem_e2e';
const ESCRITOR = 'backup_escritor_e2e';
const RECUPERADO = 'backup_recuperado_e2e';
const LEITOR = 'backup_leitor_e2e';
const SENHA_LEITOR = `leitor-${randomBytes(9).toString('hex')}`;
const EMAIL_FICTICIO = 'cliente.ficticio.e2e@exemplo.invalid';
const SHA = 'f'.repeat(40);

const admin = ferramentas ? new URL(URL_ADMIN) : new URL('postgresql://x:y@127.0.0.1/z');
const urlDo = (usuario: string, senha: string, banco: string) =>
  `postgresql://${encodeURIComponent(usuario)}:${encodeURIComponent(senha)}@127.0.0.1:${admin.port || 5432}/${banco}?sslmode=verify-full`;

async function cliente(banco: string, usuario = decodeURIComponent(admin.username), senha = decodeURIComponent(admin.password)) {
  const c = new pg.Client({
    host: '127.0.0.1',
    port: Number(admin.port || 5432),
    user: usuario,
    password: senha,
    database: banco,
    ssl: { ca: readFileSync(CA, 'utf8'), servername: 'localhost', rejectUnauthorized: true },
  });
  await c.connect();
  return c;
}

// ---------- simuladores ----------

interface Objeto {
  corpo: Buffer;
  cabecalhos: Record<string, string>;
}
// `objetos`: a versão atual de cada chave; `versoes`: todas, por
// `<chave>#<versão>`.
const s3 = {
  objetos: new Map<string, Objeto>(),
  versoes: new Map<string, Objeto>(),
  contador: 0,
  falhaNoPut: 0,
  semRetencao: false,
  corromperDownload: false,
  assinaturasInvalidas: 0,
  // Grava e derruba a conexão sem responder (timeout depois de receber).
  perderRespostaDoPut: '',
  // Com a perda acima, os HEADs seguintes também ficam sem resposta.
  perderTambemOsHeads: false,
  headSemResposta: false,
};
const cron = { status: [] as string[], recusarOk: false };
let servidorS3: Server;
let servidorCron: Server;
let portaS3 = 0;
let portaCron = 0;

const ler = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve) => {
    const partes: Buffer[] = [];
    req.on('data', (p: Buffer) => partes.push(p));
    req.on('end', () => resolve(Buffer.concat(partes)));
  });

function assinaturaConfere(req: IncomingMessage, corpo: Buffer) {
  const autorizacao = String(req.headers.authorization ?? '');
  const assinados = /SignedHeaders=([^,]+)/.exec(autorizacao)?.[1].split(';') ?? [];
  const cabecalhos: Record<string, string> = {};
  for (const nome of assinados) if (nome !== 'host' && nome !== 'x-amz-date') cabecalhos[nome] = String(req.headers[nome] ?? '');
  const amz = String(req.headers['x-amz-date'] ?? '');
  const agora = new Date(`${amz.slice(0, 4)}-${amz.slice(4, 6)}-${amz.slice(6, 8)}T${amz.slice(9, 11)}:${amz.slice(11, 13)}:${amz.slice(13, 15)}Z`);
  const hash = createHash('sha256').update(corpo).digest('hex');
  if (req.headers['x-amz-content-sha256'] !== hash) return false;
  const esperado = assinarS3({
    metodo: req.method ?? '',
    url: `http://127.0.0.1:${portaS3}${req.url}`,
    cabecalhos,
    hashDoCorpo: hash,
    chaveId: 'chave-ficticia',
    chaveSecreta: 'segredo-ficticio-do-simulador',
    regiao: 'us-west-004',
    agora,
  });
  return esperado.authorization === autorizacao;
}

async function iniciarSimuladores() {
  servidorS3 = createServer(async (req, res) => {
    const corpo = await ler(req);
    if (!assinaturaConfere(req, corpo)) {
      s3.assinaturasInvalidas++;
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://simulador');
    const chave = decodeURIComponent(url.pathname);
    const versao = url.searchParams.get('versionId');
    if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const raiz = `${chave}/`;
      const prefixo = url.searchParams.get('prefix') ?? '';
      const chaves = [...s3.objetos.keys()].filter((k) => k.startsWith(raiz + prefixo)).map((k) => k.slice(raiz.length));
      res.writeHead(200, { 'content-type': 'application/xml' }).end(`<ListBucketResult>${chaves.map((k) => `<Contents><Key>${k}</Key></Contents>`).join('')}</ListBucketResult>`);
      return;
    }
    if (req.method === 'PUT') {
      if (s3.falhaNoPut) {
        res.writeHead(s3.falhaNoPut).end();
        return;
      }
      const md5 = createHash('md5').update(corpo).digest('base64');
      if (req.headers['content-md5'] !== md5) {
        res.writeHead(400).end();
        return;
      }
      const nova = `v${++s3.contador}`;
      const objeto = {
        corpo,
        cabecalhos: {
          'x-amz-version-id': nova,
          'x-amz-meta-sha256': String(req.headers['x-amz-meta-sha256']),
          ...(s3.semRetencao
            ? {}
            : {
                'x-amz-object-lock-mode': String(req.headers['x-amz-object-lock-mode']),
                'x-amz-object-lock-retain-until-date': String(req.headers['x-amz-object-lock-retain-until-date']),
              }),
        },
      };
      s3.objetos.set(chave, objeto);
      s3.versoes.set(`${chave}#${nova}`, objeto);
      if (s3.perderRespostaDoPut && chave.endsWith(s3.perderRespostaDoPut)) {
        s3.headSemResposta = s3.perderTambemOsHeads;
        req.socket.destroy();
        return;
      }
      res.writeHead(200, { 'x-amz-version-id': nova }).end();
      return;
    }
    if (req.method === 'HEAD' && s3.headSemResposta) {
      req.socket.destroy();
      return;
    }
    const objeto = versao ? s3.versoes.get(`${chave}#${versao}`) : s3.objetos.get(chave);
    if (!objeto) {
      res.writeHead(404).end();
      return;
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, { ...objeto.cabecalhos, 'content-length': String(objeto.corpo.length) }).end();
      return;
    }
    const enviado = s3.corromperDownload ? Buffer.concat([objeto.corpo.subarray(1), Buffer.from('x')]) : objeto.corpo;
    res.writeHead(200, { 'content-length': String(enviado.length) }).end(enviado);
  });
  servidorCron = createServer((req, res) => {
    const status = new URL(req.url ?? '/', 'http://x').searchParams.get('status') ?? '';
    cron.status.push(status);
    res.writeHead(status === 'ok' && cron.recusarOk ? 500 : 202).end();
  });
  const ouvir = (s: Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as { port: number }).port)));
  portaS3 = await ouvir(servidorS3);
  portaCron = await ouvir(servidorCron);
}

// ---------- age (real, ou simulado sem o binário) ----------

const CABECALHO_AGE = Buffer.from('age-encryption.org/v1\n');
const ageSimulado: Executar = async (exe, args) => {
  if (args[0] === '--version') return { codigo: 0, stdout: 'v0.0.0-simulado', stderr: '' };
  const [entrada, saida] = [args.at(-1)!, args[args.indexOf('-o') + 1]];
  const claro = readFileSync(entrada);
  if (args[0] === '-r') writeFileSync(saida, Buffer.concat([CABECALHO_AGE, Buffer.from(claro.map((b) => b ^ 0x5a))]));
  else writeFileSync(saida, Buffer.from(claro.subarray(CABECALHO_AGE.length).map((b) => b ^ 0x5a)));
  return { codigo: 0, stdout: '', stderr: '' };
};
const processoPadrao: Executar = (exe, args, env) => (AGE_SIMULADO && exe === 'age-simulado' ? ageSimulado(exe, args) : executar(exe, args, env));

// ---------- ambiente do ensaio ----------

let pasta: string;
let temporaria: string;
let identidade: string;
let destinatario: string;

function ambiente(ajuste: Record<string, string | undefined> = {}) {
  return {
    BACKUP_MODO: 'ensaio',
    PILOTO_BACKUP_URL: urlDo(LEITOR, SENHA_LEITOR, ORIGEM),
    BACKUP_ORIGEM_CA: CA,
    RESTAURACAO_URL: urlDo(decodeURIComponent(admin.username), decodeURIComponent(admin.password), admin.pathname.slice(1) || 'postgres'),
    RESTAURACAO_CA: CA,
    AGE_RECIPIENT: destinatario,
    AGE_BIN: AGE_SIMULADO ? 'age-simulado' : AGE_BIN,
    PG_BIN,
    B2_ENDPOINT: `http://127.0.0.1:${portaS3}`,
    B2_BUCKET: 'balde-ficticio-e2e',
    B2_KEY_ID: 'chave-ficticia',
    B2_APP_KEY: 'segredo-ficticio-do-simulador',
    SENTRY_CRON_URL: `http://127.0.0.1:${portaCron}/api/1/cron/backup-piloto/abc123/`,
    BACKUP_CODIGO_SHA: SHA,
    BACKUP_PASTA_TEMP: temporaria,
    ...ajuste,
  };
}

const config = (ajuste?: Record<string, string | undefined>): Configuracao => lerConfiguracao(ambiente(ajuste));

async function rodarBackup(deps: Parameters<typeof executarBackup>[1] = {}, ajuste?: Record<string, string | undefined>) {
  const linhas: string[] = [];
  try {
    const resumo = await executarBackup(config(ajuste), { executarProcesso: processoPadrao, log: (l) => linhas.push(l), esperar: async () => {}, ...deps });
    return { resumo, linhas, erro: null as string | null };
  } catch (erro) {
    return { resumo: null, linhas, erro: (erro as Error).message };
  }
}

const sobrasNaTemporaria = () => readdirSync(temporaria).filter((n) => n.startsWith('agenda-cloud-backup-'));
async function bancosDeConferencia() {
  const c = await cliente(admin.pathname.slice(1) || 'postgres');
  try {
    return (await c.query("SELECT count(*)::int AS n FROM pg_database WHERE datname LIKE 'conferencia_%'")).rows[0].n as number;
  } finally {
    await c.end();
  }
}

function semNadaSensivel(texto: string) {
  for (const proibido of [SENHA_LEITOR, decodeURIComponent(admin.password), 'segredo-ficticio-do-simulador', EMAIL_FICTICIO, 'clientes', 'agendamentos', 'postgresql://']) {
    expect(texto).not.toContain(proibido);
  }
}

describe.skipIf(!ferramentas)('backup agendado: caminho completo com dados fictícios', () => {
  beforeAll(async () => {
    pasta = mkdtempSync(path.join(tmpdir(), 'backup-e2e-'));
    temporaria = path.join(pasta, 'runner-temp');
    mkdirSync(temporaria);
    if (AGE_SIMULADO) {
      destinatario = 'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p';
    } else {
      identidade = path.join(pasta, 'identidade-de-teste.txt');
      const gerar = spawnSync(path.join(path.dirname(AGE_BIN), `age-keygen${EXE}`), ['-o', identidade]);
      expect(gerar.status).toBe(0);
      destinatario = /# public key: (age1[0-9a-z]+)/.exec(readFileSync(identidade, 'utf8'))![1];
    }
    await iniciarSimuladores();

    const a = await cliente(admin.pathname.slice(1) || 'postgres');
    try {
      await a.query(`DROP DATABASE IF EXISTS ${ORIGEM} WITH (FORCE)`);
      await a.query(`DROP DATABASE IF EXISTS ${RECUPERADO} WITH (FORCE)`);
      await a.query(`DROP ROLE IF EXISTS ${LEITOR}`);
      await a.query(`DROP ROLE IF EXISTS ${ESCRITOR}`);
      await a.query(`CREATE DATABASE ${ORIGEM}`);
      await a.query(`CREATE DATABASE ${RECUPERADO}`);
      await a.query(`CREATE ROLE ${LEITOR} LOGIN PASSWORD '${SENHA_LEITOR}'`);
    } finally {
      await a.end();
    }
    const o = await cliente(ORIGEM);
    try {
      await o.query(`
        CREATE TABLE typeorm_migrations (id serial PRIMARY KEY, "timestamp" bigint NOT NULL, name varchar NOT NULL);
        INSERT INTO typeorm_migrations ("timestamp", name) SELECT 1700000000000 + g, 'MigrationFicticia' || g FROM generate_series(1, 11) g;
        CREATE TABLE clientes (id serial PRIMARY KEY, nome text NOT NULL, email text, criado_em timestamptz NOT NULL DEFAULT '2026-01-01T00:00:00Z');
        INSERT INTO clientes (nome, email) SELECT 'Cliente fictício ' || g, 'c' || g || '@exemplo.invalid' FROM generate_series(1, 500) g;
        INSERT INTO clientes (nome, email) VALUES ('Cliente marcador', '${EMAIL_FICTICIO}');
        CREATE TABLE agendamentos (id serial PRIMARY KEY, cliente_id int NOT NULL REFERENCES clientes(id), inicio timestamptz NOT NULL, valor_centavos bigint NOT NULL, observacao text);
        INSERT INTO agendamentos (cliente_id, inicio, valor_centavos, observacao)
          SELECT 1 + (g % 500), '2026-10-01T12:00:00Z'::timestamptz + g * interval '30 min', 4500 + g, 'Observação fictícia ' || g FROM generate_series(1, 2000) g;
        REVOKE CREATE ON SCHEMA public FROM PUBLIC;
        GRANT USAGE ON SCHEMA public TO ${LEITOR};
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${LEITOR};
        GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ${LEITOR};
      `);
    } finally {
      await o.end();
    }
  });

  afterAll(async () => {
    servidorS3?.close();
    servidorCron?.close();
    if (!ferramentas) return;
    const a = await cliente(admin.pathname.slice(1) || 'postgres');
    try {
      await a.query(`DROP DATABASE IF EXISTS ${ORIGEM} WITH (FORCE)`);
      await a.query(`DROP DATABASE IF EXISTS ${RECUPERADO} WITH (FORCE)`);
      await a.query(`DROP ROLE IF EXISTS ${LEITOR}`);
      await a.query(`DROP ROLE IF EXISTS ${ESCRITOR}`);
    } finally {
      await a.end();
    }
    rmSync(pasta, { recursive: true, force: true });
  });

  beforeEach(() => {
    s3.objetos.clear();
    s3.versoes.clear();
    Object.assign(s3, { falhaNoPut: 0, semRetencao: false, corromperDownload: false, assinaturasInvalidas: 0, perderRespostaDoPut: '', perderTambemOsHeads: false, headSemResposta: false });
    Object.assign(cron, { status: [], recusarOk: false });
  });

  async function esperarFalha(resultado: Awaited<ReturnType<typeof rodarBackup>>, codigo: string) {
    expect(resultado.erro).toBe(codigo);
    expect(resultado.linhas).not.toContain('RESULTADO: backup_ok');
    expect(cron.status).toContain('error');
    expect(cron.status).not.toContain('ok');
    expect([...s3.objetos.keys()].some((k) => k.endsWith(ARQUIVOS.resumo))).toBe(false);
    expect(sobrasNaTemporaria()).toEqual([]);
    expect(await bancosDeConferencia()).toBe(0);
    semNadaSensivel(resultado.linhas.join('\n'));
  }

  it('faz o backup, restaura, cifra, envia e confere; o check-in ok é o último passo', async () => {
    const inicio = performance.now();
    const { resumo, linhas, erro } = await rodarBackup();
    const duracao = Math.round(performance.now() - inicio);
    expect(erro).toBeNull();
    expect(linhas.at(-1)).toBe('RESULTADO: backup_ok');
    expect(linhas).toContain('PAPEL: somente leitura');
    expect(linhas).toContain('RESTAURACAO_IGUAL: true');
    expect(cron.status).toEqual(['in_progress', 'ok']);
    expect(s3.assinaturasInvalidas).toBe(0);

    const chaves = [...s3.objetos.keys()].sort();
    expect(chaves).toHaveLength(3);
    expect(chaves.every((k) => k.startsWith(`/balde-ficticio-e2e/${resumo!.objetos.dump.chave.split('/').slice(0, -1).join('/')}/`))).toBe(true);
    for (const o of s3.objetos.values()) expect(o.cabecalhos['x-amz-object-lock-mode']).toBe('COMPLIANCE');
    // O resumo aponta a versão exata de cada arquivo gravado.
    for (const nome of ['dump', 'manifesto'] as const) {
      expect(resumo!.objetos[nome].versao).toBe(s3.objetos.get(`/balde-ficticio-e2e/${resumo!.objetos[nome].chave}`)!.cabecalhos['x-amz-version-id']);
    }

    // Nada claro no armazenamento: nem dado de cliente nem nome de tabela.
    for (const o of s3.objetos.values()) {
      expect(o.corpo.includes(Buffer.from(EMAIL_FICTICIO))).toBe(false);
      expect(o.corpo.includes(Buffer.from('agendamentos'))).toBe(false);
    }
    const resumoGuardado = s3.objetos.get(`/balde-ficticio-e2e/${resumo!.objetos.dump.chave.replace(ARQUIVOS.dump, ARQUIVOS.resumo)}`)!;
    expect(JSON.parse(resumoGuardado.corpo.toString())).toMatchObject({ completo: true, tipo: resumo!.tipo, tabelas: 3, commit: SHA });
    semNadaSensivel(linhas.join('\n'));
    expect(sobrasNaTemporaria()).toEqual([]);
    expect(await bancosDeConferencia()).toBe(0);

    // Fora do console do Vitest, para aparecer no log do job.
    process.stdout.write(
      `MEDIDA_BACKUP_E2E: total=${duracao}ms etapas=${JSON.stringify(resumo!.duracoesMs)} dumpClaro=${resumo!.dumpClaroBytes}B dumpCifrado=${resumo!.objetos.dump.bytes}B manifestoCifrado=${resumo!.objetos.manifesto.bytes}B resumo=${resumoGuardado.corpo.length}B ageSimulado=${AGE_SIMULADO}\n`,
    );
  });

  it.skipIf(AGE_SIMULADO)('recupera com a chave offline num banco vazio, sem GitHub nem Neon (script de recuperação)', async () => {
    const { resumo } = await rodarBackup();
    const baixados = path.join(pasta, 'baixados-do-b2');
    mkdirSync(baixados, { recursive: true });
    // Como na emergência: o resumo da pasta diz a versão de cada arquivo, e
    // os arquivos vêm do armazenamento (GET assinado), não da memória do teste.
    const armazenamento = clienteS3({
      endpoint: `http://127.0.0.1:${portaS3}`,
      regiao: 'us-west-004',
      bucket: 'balde-ficticio-e2e',
      chaveId: 'chave-ficticia',
      chaveSecreta: 'segredo-ficticio-do-simulador',
    });
    const resumoGuardado = await armazenamento.baixar(resumo!.objetos.dump.chave.replace(ARQUIVOS.dump, ARQUIVOS.resumo));
    expect(resumoGuardado.status).toBe(200);
    writeFileSync(path.join(baixados, ARQUIVOS.resumo), resumoGuardado.corpo!);
    const doResumo = JSON.parse(resumoGuardado.corpo!.toString());
    for (const [nome, objeto] of [
      [ARQUIVOS.dump, doResumo.objetos.dump],
      [ARQUIVOS.manifesto, doResumo.objetos.manifesto],
    ] as const) {
      const baixado = await armazenamento.baixar(objeto.chave, objeto.versao);
      expect(baixado.status).toBe(200);
      writeFileSync(path.join(baixados, nome), baixado.corpo!);
    }
    const saida = await new Promise<{ codigo: number | null; texto: string }>((resolve) => {
      const filho = spawn(process.execPath, ['scripts/recuperar-backup-piloto.mjs'], {
        env: {
          SystemRoot: process.env.SystemRoot,
          RECUPERACAO_DUMP: path.join(baixados, ARQUIVOS.dump),
          RECUPERACAO_MANIFESTO: path.join(baixados, ARQUIVOS.manifesto),
          RECUPERACAO_RESUMO: path.join(baixados, ARQUIVOS.resumo),
          RECUPERACAO_IDENTIDADE: identidade,
          RECUPERACAO_URL: urlDo(decodeURIComponent(admin.username), decodeURIComponent(admin.password), RECUPERADO),
          RECUPERACAO_CA: CA,
          RECUPERACAO_PASTA: pasta,
          AGE_BIN,
          PG_BIN,
        },
      });
      let texto = '';
      filho.stdout.on('data', (d) => (texto += d));
      filho.stderr.on('data', (d) => (texto += d));
      filho.on('close', (codigo) => resolve({ codigo, texto }));
    });
    expect(saida.texto).toContain('CIFRADOS_CONFEREM_COM_RESUMO: true');
    expect(saida.texto).toContain('SHA256_CONFERE: true');
    expect(saida.texto).toContain('RESULTADO: recuperacao_conferida (3 tabelas, 11 migrations no histórico)');
    expect(saida.texto).toContain('DECIFRADOS_APAGADOS: true');
    expect(saida.codigo).toBe(0);
    semNadaSensivel(saida.texto);
    expect(readFileSync(identidade, 'utf8').split('\n').some((l) => l.startsWith('AGE-SECRET-KEY-') && saida.texto.includes(l))).toBe(false);

    // Prova independente do manifesto: o banco recuperado é igual à origem
    // (sem escrita desde o backup), tabela por tabela.
    const [o, r] = [await cliente(ORIGEM), await cliente(RECUPERADO)];
    try {
      await o.query('BEGIN TRANSACTION READ ONLY');
      await r.query('BEGIN TRANSACTION READ ONLY');
      const [daOrigem, doRecuperado] = [await fotografar(o), await fotografar(r)];
      expect(compararFotografias(daOrigem, doRecuperado).iguais).toBe(true);
      expect(doRecuperado.contagens).toEqual({ agendamentos: 2000, clientes: 501, typeorm_migrations: 11 });
    } finally {
      await o.end();
      await r.end();
    }

    // Destino não vazio (como o piloto em uso): recusado antes de restaurar.
    const segunda = spawnSync(process.execPath, ['scripts/recuperar-backup-piloto.mjs'], {
      env: {
        SystemRoot: process.env.SystemRoot,
        RECUPERACAO_DUMP: path.join(baixados, ARQUIVOS.dump),
        RECUPERACAO_MANIFESTO: path.join(baixados, ARQUIVOS.manifesto),
        RECUPERACAO_IDENTIDADE: identidade,
        RECUPERACAO_URL: urlDo(decodeURIComponent(admin.username), decodeURIComponent(admin.password), RECUPERADO),
        RECUPERACAO_CA: CA,
        RECUPERACAO_PASTA: pasta,
        AGE_BIN,
        PG_BIN,
      },
      encoding: 'utf8',
    });
    expect(segunda.status).toBe(1);
    expect(segunda.stdout).toContain('ERRO: ERR_BANCO_DE_DESTINO_NAO_ESTA_VAZIO');
  });

  it('escrita depois do snapshot não entra no backup nem quebra a conferência', async () => {
    const contar = async (banco: string) => {
      const c = await cliente(banco);
      try {
        return (await c.query('SELECT count(*)::int AS n FROM clientes')).rows[0].n as number;
      } finally {
        await c.end();
      }
    };
    const antes = await contar(ORIGEM);
    let restaurados = -1;
    const { resumo, erro } = await rodarBackup({
      aoExportarSnapshot: async () => {
        const o = await cliente(ORIGEM);
        await o.query("INSERT INTO clientes (nome) VALUES ('Escrita concorrente fictícia')");
        await o.end();
      },
      aposRestaurar: async (destino) => {
        restaurados = await contar(destino.database);
      },
    });
    expect(erro).toBeNull();
    expect(resumo!.tabelas).toBe(3);
    // O dump é do snapshot exportado (o mesmo da fotografia), não do momento
    // em que o pg_dump rodou.
    expect(restaurados).toBe(antes);
    expect(await contar(ORIGEM)).toBe(antes + 1);
    expect(cron.status).toEqual(['in_progress', 'ok']);
  });

  it('recusa papel que pode escrever, antes do dump', async () => {
    const r = await rodarBackup({}, { PILOTO_BACKUP_URL: urlDo(decodeURIComponent(admin.username), decodeURIComponent(admin.password), ORIGEM) });
    await esperarFalha(r, 'ERR_PAPEL_NAO_E_SOMENTE_LEITURA');
    expect(r.linhas.find((l) => l.startsWith('PAPEL:'))).toContain('ERR_PAPEL_SUPERUSUARIO');
  });

  it('recusa escrita efetiva que o nome do papel e o modo da transação não mostram: por coluna e por SET ROLE', async () => {
    const o = await cliente(ORIGEM);
    try {
      await o.query(`GRANT UPDATE (observacao) ON agendamentos TO ${LEITOR}`);
      const porColuna = await rodarBackup();
      await esperarFalha(porColuna, 'ERR_PAPEL_NAO_E_SOMENTE_LEITURA');
      expect(porColuna.linhas).toContain('PAPEL: ERR_PAPEL_PODE_ESCREVER');
      await o.query(`REVOKE UPDATE (observacao) ON agendamentos FROM ${LEITOR}`);

      cron.status = [];
      await o.query(`CREATE ROLE ${ESCRITOR} NOLOGIN`);
      await o.query(`GRANT INSERT ON clientes TO ${ESCRITOR}`);
      // Sem herança: has_table_privilege do leitor continua falso, mas ele
      // pode fazer SET ROLE e escrever.
      await o.query(`GRANT ${ESCRITOR} TO ${LEITOR} WITH INHERIT FALSE`);
      const porMembro = await rodarBackup();
      await esperarFalha(porMembro, 'ERR_PAPEL_NAO_E_SOMENTE_LEITURA');
      expect(porMembro.linhas).toContain('PAPEL: ERR_PAPEL_MEMBRO_DE_OUTRO_PAPEL');
    } finally {
      await o.query(`REVOKE UPDATE (observacao) ON agendamentos FROM ${LEITOR}`);
      await o.query(
        `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ESCRITOR}') THEN REVOKE ALL ON clientes FROM ${ESCRITOR}; REVOKE ${ESCRITOR} FROM ${LEITOR}; DROP ROLE ${ESCRITOR}; END IF; END $$`,
      );
      await o.end();
    }
  });

  it('falha do pg_dump: nada é enviado e o detalhe sai sem a senha', async () => {
    const falhar: Executar = async (exe, args, env) =>
      args[0] === '-Fc' ? { codigo: 1, stdout: '', stderr: `pg_dump: erro de conexão para ${LEITOR} senha ${SENHA_LEITOR}` } : processoPadrao(exe, args, env);
    const r = await rodarBackup({ executarProcesso: falhar });
    await esperarFalha(r, 'ERR_PG_DUMP');
    expect(s3.objetos.size).toBe(0);
  });

  it('falha do pg_restore: nada é enviado e o banco de conferência é apagado', async () => {
    const falhar: Executar = async (exe, args, env) => (args[0] === '-d' ? { codigo: 1, stdout: '', stderr: 'pg_restore: erro simulado' } : processoPadrao(exe, args, env));
    const r = await rodarBackup({ executarProcesso: falhar });
    await esperarFalha(r, 'ERR_PG_RESTORE');
    expect(s3.objetos.size).toBe(0);
  });

  it('restauração diferente do snapshot: nada é enviado', async () => {
    const r = await rodarBackup({
      aposRestaurar: async (destino) => {
        const c = await cliente(destino.database);
        await c.query('DELETE FROM agendamentos WHERE id = 1');
        await c.end();
      },
    });
    await esperarFalha(r, 'ERR_RESTAURACAO_DIFERENTE_DO_SNAPSHOT');
    expect(r.linhas).toContain('DIVERGENCIAS: contagem=1 md5=0 ausentes=0 sobrando=0');
    expect(s3.objetos.size).toBe(0);
  });

  it('falha do age, ou age que não cifrou: nada é enviado', async () => {
    const falhar: Executar = async (exe, args, env) => (args[0] === '-r' ? { codigo: 1, stdout: '', stderr: 'age: erro simulado' } : processoPadrao(exe, args, env));
    await esperarFalha(await rodarBackup({ executarProcesso: falhar }), 'ERR_CRIPTOGRAFIA');
    const copiar: Executar = async (exe, args, env) => {
      if (args[0] !== '-r') return processoPadrao(exe, args, env);
      writeFileSync(args[args.indexOf('-o') + 1], Buffer.concat([CABECALHO_AGE, readFileSync(args.at(-1)!)]));
      return { codigo: 0, stdout: '', stderr: '' };
    };
    await esperarFalha(await rodarBackup({ executarProcesso: copiar }), 'ERR_CRIPTOGRAFIA_FORMATO_INESPERADO');
    expect(s3.objetos.size).toBe(0);
  });

  it('armazenamento recusa o envio', async () => {
    s3.falhaNoPut = 503;
    await esperarFalha(await rodarBackup(), 'ERR_ENVIO');
  });

  it('objeto gravado sem retenção: falha e o resumo não é enviado', async () => {
    s3.semRetencao = true;
    const r = await rodarBackup();
    await esperarFalha(r, 'ERR_OBJETO_ENVIADO_NAO_CONFERE');
    expect(r.linhas.find((l) => l.startsWith('OBJETO piloto-neondb.dump.age:'))).toContain('ERR_OBJETO_SEM_RETENCAO_COMPLIANCE');
  });

  it('download diferente do enviado: falha e o resumo não é enviado', async () => {
    s3.corromperDownload = true;
    await esperarFalha(await rodarBackup(), 'ERR_DOWNLOAD_DIFERENTE_DO_ENVIADO');
  });

  it('check-in ok não aceito: o backup continua concluído; é falha de monitoramento, sem error', async () => {
    cron.recusarOk = true;
    const r = await rodarBackup();
    expect(r.erro).toBeNull();
    expect(r.resumo!.monitoramento).toBe('falhou');
    expect(r.linhas).toContain('MONITORAMENTO: ERR_CHECKIN_OK_NAO_CONFIRMADO');
    expect(r.linhas.at(-1)).toBe('RESULTADO: backup_concluido_monitoramento_falhou');
    // Uma nova tentativa do ok e nenhum error, que marcaria um backup bom
    // como falho.
    expect(cron.status).toEqual(['in_progress', 'ok', 'ok']);
    const guardado = s3.objetos.get(`/balde-ficticio-e2e/${r.resumo!.objetos.dump.chave.replace(ARQUIVOS.dump, ARQUIVOS.resumo)}`)!;
    expect(JSON.parse(guardado.corpo.toString())).toMatchObject({ completo: true });
    expect(sobrasNaTemporaria()).toEqual([]);
  });

  it('resposta do envio do resumo perdida depois de gravado: confere pela versão e conclui, sem reenviar', async () => {
    s3.perderRespostaDoPut = ARQUIVOS.resumo;
    const r = await rodarBackup();
    expect(r.erro).toBeNull();
    expect(r.linhas).toContain(`OBJETO ${ARQUIVOS.resumo}: gravado apesar do envio sem resposta`);
    expect(r.linhas.at(-1)).toBe('RESULTADO: backup_ok');
    expect(cron.status).toEqual(['in_progress', 'ok']);
    expect(s3.versoes.size).toBe(3);
  });

  it('resposta perdida e conferência sem resposta: incerto, nunca ok nem "não gravado"', async () => {
    s3.perderRespostaDoPut = ARQUIVOS.resumo;
    s3.perderTambemOsHeads = true;
    const r = await rodarBackup();
    expect(r.erro).toBe('ERR_RESUMO_INCERTO');
    expect(r.linhas).not.toContain('RESULTADO: backup_ok');
    expect(cron.status).toEqual(['in_progress', 'error']);
    // O resumo pode estar lá (aqui está): por isso "incerto", e nada tenta
    // apagá-lo.
    expect([...s3.objetos.keys()].some((k) => k.endsWith(ARQUIVOS.resumo))).toBe(true);
    expect(sobrasNaTemporaria()).toEqual([]);
    semNadaSensivel(r.linhas.join('\n'));
  });

  it('o primeiro backup completo do mês é o mensal; uma pasta incompleta não conta; o seguinte é diário', async () => {
    s3.semRetencao = true;
    expect((await rodarBackup()).erro).toBe('ERR_OBJETO_ENVIADO_NAO_CONFERE');
    expect([...s3.objetos.keys()].some((k) => k.includes('/piloto/mensal/'))).toBe(true);
    s3.semRetencao = false;
    const primeiro = await rodarBackup();
    const segundo = await rodarBackup();
    expect([primeiro.resumo!.tipo, segundo.resumo!.tipo]).toEqual(['mensal', 'diario']);
    expect(primeiro.resumo!.objetos.dump.chave).not.toBe(segundo.resumo!.objetos.dump.chave);
    const dias = (r: typeof segundo) => (Date.parse(r.resumo!.retencaoAte) - Date.parse(r.resumo!.pontoDeRecuperacao)) / 86_400_000;
    expect(dias(segundo)).toBe(35);
    expect(dias(primeiro)).toBeGreaterThanOrEqual(365 + 28 + 1);
  });

  it.skipIf(AGE_SIMULADO)('pela linha de comando: sai com 0 só no backup completo; recusa o modo piloto no repositório público', async () => {
    // Assíncrono: os simuladores rodam neste processo e precisam do event loop.
    const rodarCli = (env: Record<string, string | undefined>) =>
      new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
        const filho = spawn(process.execPath, ['scripts/backup-agendado.mjs'], { env: { SystemRoot: process.env.SystemRoot, ...env } });
        let stdout = '';
        let stderr = '';
        filho.stdout.on('data', (d) => (stdout += d));
        filho.stderr.on('data', (d) => (stderr += d));
        filho.on('close', (status) => resolve({ status, stdout, stderr }));
      });
    const ok = await rodarCli(ambiente());
    expect(ok.stdout.trim().split('\n').at(-1)).toBe('RESULTADO: backup_ok');
    expect(ok.status).toBe(0);
    semNadaSensivel(ok.stdout + ok.stderr);

    cron.recusarOk = true;
    const semMonitor = await rodarCli(ambiente());
    expect(semMonitor.stdout.trim().split('\n').at(-1)).toBe('RESULTADO: backup_concluido_monitoramento_falhou');
    expect(semMonitor.status).toBe(1);
    cron.recusarOk = false;

    s3.objetos.clear();
    cron.status = [];
    const publico = await rodarCli({ ...ambiente(), BACKUP_MODO: 'piloto', GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'Welington753/Agenda-Cloud' });
    expect(publico.status).toBe(1);
    expect(publico.stdout).toContain('ERRO: ERR_REPOSITORIO_PUBLICO');
    expect(publico.stdout).toContain('RESULTADO: backup_falhou');
    expect(s3.objetos.size).toBe(0);
    expect(cron.status).toEqual([]);
  });
});
