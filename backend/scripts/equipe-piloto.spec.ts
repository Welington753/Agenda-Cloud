// Regras puras da publicação de TeamAccess, sem banco nem rede. Endpoint IDs,
// commits e hashes são fictícios. O fluxo completo foi ensaiado contra um
// PostgreSQL descartável (docs/runbooks/publicacao-equipe-piloto.md).
import { describe, expect, it } from 'vitest';
import { Parada } from './entrada-oculta.mjs';
import {
  FRASE,
  OPERACAO,
  avaliarBackupConferido,
  classificarFalha,
  compararServidores,
  conferirModo,
  destinoDoModo,
  execucaoPendente,
  identificarEstado,
  lerRegistros,
} from './equipe-piloto.mjs';
import { conferirDestino } from './operacao-piloto.mjs';

function codigo(fn: () => unknown): string {
  try {
    fn();
  } catch (erro) {
    if (erro instanceof Parada) return erro.message;
    throw erro;
  }
  return 'sem erro';
}

const PILOTO = 'ep-piloto-111111';
const ENSAIO = 'ep-ensaio-piloto-111';

describe('frase', () => {
  it('é a combinada no runbook', () => {
    expect(FRASE).toBe('APLICAR TeamAccess1792886400000');
  });
});

describe('conferirModo', () => {
  const piloto = (env: Record<string, string> = {}, execArgv: string[] = []) =>
    codigo(() => conferirModo({ modo: 'piloto', env, execArgv, endpointPiloto: PILOTO }));

  it('piloto limpo: sem ajuste', () => {
    expect(conferirModo({ modo: 'piloto', env: {}, execArgv: [], endpointPiloto: PILOTO })).toBeNull();
  });

  it.each([
    ['CA do ensaio', { AGENDA_ENSAIO_CA: 'C:/ca.crt' }, 'ERR_AJUSTE_DE_ENSAIO_NO_PILOTO'],
    ['endereço do ensaio', { AGENDA_ENSAIO_ENDERECO: '127.0.0.1' }, 'ERR_AJUSTE_DE_ENSAIO_NO_PILOTO'],
    ['NODE_EXTRA_CA_CERTS', { NODE_EXTRA_CA_CERTS: 'C:/ca.crt' }, 'ERR_CA_EXTRA_NO_PILOTO'],
    ['NODE_USE_SYSTEM_CA', { NODE_USE_SYSTEM_CA: '1' }, 'ERR_CA_EXTRA_NO_PILOTO'],
    ['NODE_OPTIONS', { NODE_OPTIONS: '--import=./x.mjs' }, 'ERR_OPCOES_DO_NODE_NO_PILOTO'],
    ['NODE_TLS_REJECT_UNAUTHORIZED=0', { NODE_TLS_REJECT_UNAUTHORIZED: '0' }, 'ERR_TLS_AFROUXADO'],
  ])('piloto recusa %s', (_caso, env, esperado) => {
    expect(piloto(env)).toBe(esperado);
  });

  it('piloto recusa opções na linha do node e endpoint de ensaio', () => {
    expect(piloto({}, ['--import', 'x.mjs'])).toBe('ERR_OPCOES_DO_NODE_NO_PILOTO');
    expect(codigo(() => conferirModo({ modo: 'piloto', env: {}, execArgv: [], endpointPiloto: ENSAIO }))).toBe(
      'ERR_ENDPOINT_DE_ENSAIO_NO_PILOTO',
    );
  });

  it('ensaio exige endpoint ep-ensaio-, loopback e CA', () => {
    const env = { AGENDA_ENSAIO_CA: 'C:/ca.crt', AGENDA_ENSAIO_ENDERECO: '127.0.0.1' };
    expect(conferirModo({ modo: 'ensaio', env, execArgv: [], endpointPiloto: ENSAIO })).toEqual({
      endereco: '127.0.0.1',
      caArquivo: 'C:/ca.crt',
    });
    const ensaio = (e: Record<string, string>, ep = ENSAIO) =>
      codigo(() => conferirModo({ modo: 'ensaio', env: e, execArgv: [], endpointPiloto: ep }));
    expect(ensaio(env, PILOTO)).toBe('ERR_ENSAIO_SEM_ENDPOINT_DE_ENSAIO');
    expect(ensaio({ ...env, AGENDA_ENSAIO_ENDERECO: '10.0.0.5' })).toBe('ERR_ENSAIO_FORA_DO_LOOPBACK');
    expect(ensaio({ AGENDA_ENSAIO_ENDERECO: '127.0.0.1' })).toBe('ERR_ENSAIO_SEM_CA');
    expect(ensaio({ ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0' })).toBe('ERR_TLS_AFROUXADO');
  });

  it('modo ausente ou desconhecido é recusado', () => {
    expect(codigo(() => conferirModo({ modo: '', env: {}, execArgv: [], endpointPiloto: PILOTO }))).toBe('ERR_MODO_INVALIDO');
    expect(codigo(() => conferirModo({ modo: 'producao', env: {}, execArgv: [], endpointPiloto: PILOTO }))).toBe(
      'ERR_MODO_INVALIDO',
    );
  });
});

describe('destinoDoModo', () => {
  const ids = { endpointPiloto: ENSAIO, endpointProibido: 'ep-ensaio-proibido-222' };
  const host = `${ENSAIO}.c-2.us-east-1.aws.neon.tech`;
  const destino = conferirDestino(`postgresql://neondb_owner:segredo@${host}:56000/neondb?sslmode=verify-full`, ids);

  it('piloto: destino intacto', () => {
    expect(destinoDoModo(destino, null)).toBe(destino);
  });

  it('ensaio: conecta no loopback, confere o certificado pelo host da URL e confia só na CA dada', () => {
    const d = destinoDoModo(destino, { endereco: '127.0.0.1', caArquivo: 'x' }, 'PEM');
    expect(d).toMatchObject({ host: '127.0.0.1', servidorTls: host, port: 56000, ca: 'PEM' });
  });
});

describe('avaliarBackupConferido', () => {
  const agora = Date.parse('2026-10-27T12:00:00Z');
  const manifesto = {
    operacao: OPERACAO,
    esperado: 'before-team-access',
    modo: 'piloto',
    endpoint: PILOTO,
    commit: 'c'.repeat(40),
    pontoDeRecuperacao: '2026-10-27T10:00:00Z',
    backup: { arquivo: 'piloto-neondb.dump', sha256: 'a'.repeat(64) },
  };
  const conferencia = {
    resultado: 'restauracao_e_ensaio_ok',
    ensaioMigration: 'ok',
    sha256: 'a'.repeat(64),
    manifestoSha256: 'f'.repeat(64),
    commit: 'c'.repeat(40),
  };
  const avaliar = (m = {}, c = {}, extra = {}) =>
    avaliarBackupConferido({
      manifesto: { ...manifesto, ...m },
      conferencia: { ...conferencia, ...c },
      sha256DoDump: 'a'.repeat(64),
      sha256DoManifesto: 'f'.repeat(64),
      commit: 'c'.repeat(40),
      endpoint: PILOTO,
      modo: 'piloto',
      agora,
      ...extra,
    });

  it('aceita backup e ensaio do mesmo destino, modo e commit, de até 24 h', () => {
    expect(avaliar()).toEqual([]);
  });

  it.each([
    ['backup do ensaio no piloto', { modo: 'ensaio' }, {}, {}, 'backup do modo ensaio'],
    ['backup de outra migration', { operacao: 'migration_AccountsAdministration1792800000000' }, {}, {}, 'outra operação'],
    ['backup depois da migration', { esperado: 'after-team-access' }, {}, {}, 'backup fora do estado before'],
    ['outro endpoint', { endpoint: 'ep-outro-333333' }, {}, {}, 'outro endpoint'],
    ['outro commit no backup', { commit: 'd'.repeat(40) }, {}, {}, 'backup de outro commit'],
    ['dump alterado', {}, {}, { sha256DoDump: 'b'.repeat(64) }, 'dump alterado'],
    ['manifesto editado (ex.: modo trocado à mão)', {}, {}, { sha256DoManifesto: 'e'.repeat(64) }, 'manifesto alterado depois da conferência'],
    ['restauração sem sucesso', {}, { resultado: 'falhou' }, {}, 'conferência sem sucesso'],
    ['sem ensaio da migration', {}, { ensaioMigration: 'nao_se_aplica' }, {}, 'migration não ensaiada na cópia'],
    ['conferência de outro dump', {}, { sha256: 'b'.repeat(64) }, {}, 'conferência de outro dump'],
    ['restauração com outro commit', {}, { commit: 'd'.repeat(40) }, {}, 'restauração conferida com outro commit'],
    ['mais de 24 h', { pontoDeRecuperacao: '2026-10-26T11:00:00Z' }, {}, {}, 'mais de 24 h'],
    ['data no futuro', { pontoDeRecuperacao: '2026-10-28T11:00:00Z' }, {}, {}, 'mais de 24 h'],
  ])('recusa %s', (_caso, m, c, extra, motivo) => {
    expect(avaliar(m, c, extra)).toContain(motivo);
  });
});

describe('compararServidores', () => {
  const neon = { tls: { cadeia: ['ep-piloto-111111.c-2.us-east-1.aws.neon.tech', 'R11', 'ISRG Root X1'] }, servidor: '17.5', migrations: ['a', 'b'] };

  it('mesmo servidor: raiz TLS, versão e histórico iguais (intermediária pode mudar)', () => {
    expect(compararServidores(neon, { ...neon, tls: { cadeia: ['x', 'R10', 'ISRG Root X1'] } })).toEqual([]);
  });

  it('comprovante de ensaio contra o piloto: outra cadeia', () => {
    const ensaio = { ...neon, tls: { cadeia: ['ep-piloto-111111.c-2.us-east-1.aws.neon.tech', 'Agenda Cloud Ensaio CA'] } };
    expect(compararServidores(ensaio, neon)).toContain('certificado de outra cadeia');
  });

  it('outra versão ou outro histórico', () => {
    expect(compararServidores(neon, { ...neon, servidor: '18.1' })).toEqual(['outra versão do servidor']);
    expect(compararServidores(neon, { ...neon, migrations: ['a', 'b', 'c'] })).toEqual(['outro histórico de migrations']);
  });
});

describe('classificarFalha', () => {
  const erroPg = (code: string) => Object.assign(new Error('x'), { code });

  it('antes de iniciar, nada foi enviado', () => {
    expect(classificarFalha(erroPg('ECONNRESET'), { iniciou: false })).toBe('nada_aplicado');
    expect(classificarFalha(new Parada('ERR_HISTORICO_DE_MIGRATIONS_INESPERADO'), { iniciou: false })).toBe('nada_aplicado');
  });

  it('erro do servidor numa sessão viva: recusada (lock_timeout, statement_timeout, constraint)', () => {
    for (const code of ['55P03', '57014', '23514', '42P07']) {
      expect(classificarFalha(erroPg(code), { iniciou: true })).toBe('recusada_pelo_banco');
    }
  });

  it('conexão perdida depois do início é incerta, nunca "nada aplicado"', () => {
    for (const code of ['ECONNRESET', 'ETIMEDOUT', '57P01', '57P02', '08006', '08003', '']) {
      expect(classificarFalha(erroPg(code), { iniciou: true })).toBe('incerto');
    }
    expect(classificarFalha(new Error('Connection terminated unexpectedly'), { iniciou: true })).toBe('incerto');
    expect(classificarFalha(new Parada('ERR_APLICADAS_DIFERENTES_DA_PENDENTE'), { iniciou: true })).toBe('incerto');
  });
});

describe('execucaoPendente', () => {
  const r = (fase: string, resultado: string | undefined, extra: Record<string, unknown> = {}) => ({
    operacao: OPERACAO,
    endpoint: PILOTO,
    modo: 'piloto',
    fase,
    resultado,
    execucao: 'e1',
    iniciadaEm: 't1',
    ...extra,
  });
  const filtro = { endpoint: PILOTO, modo: 'piloto' };

  it('sem registros ou com desfecho conhecido: nada pendente', () => {
    expect(execucaoPendente([], filtro)).toBeNull();
    expect(execucaoPendente([r('aplicar', 'migration_iniciada'), r('aplicar', 'aplicada'), r('aplicar', 'aplicada_e_conferida')], filtro)).toBeNull();
    expect(execucaoPendente([r('aplicar', 'migration_iniciada'), r('aplicar', 'nao_aplicada')], filtro)).toBeNull();
  });

  it('iniciada sem desfecho (janela fechada) ou incerta: pendente', () => {
    expect(execucaoPendente([r('aplicar', 'migration_iniciada')], filtro)).toEqual({ execucao: 'e1', iniciadaEm: 't1' });
    expect(
      execucaoPendente([r('aplicar', 'migration_iniciada'), r('aplicar', 'resultado_incerto'), r('aplicar', 'falhou')], filtro),
    ).not.toBeNull();
  });

  it('só uma fase conferir posterior, com estado identificado e sem sessão ativa, libera', () => {
    const incerta = [r('aplicar', 'migration_iniciada'), r('aplicar', 'resultado_incerto')];
    const conferir = (estado: string, sessoesDaMigration: number) =>
      r('conferir', undefined, { execucao: 'e2', estado, sessoesDaMigration });
    expect(execucaoPendente([...incerta, conferir('divergente', 0)], filtro)).not.toBeNull();
    expect(execucaoPendente([...incerta, conferir('before', 1)], filtro)).not.toBeNull();
    expect(execucaoPendente([...incerta, conferir('before', 0)], filtro)).toBeNull();
    expect(execucaoPendente([...incerta, conferir('after', 0)], filtro)).toBeNull();
    // Conferir ANTES da execução incerta não vale.
    expect(execucaoPendente([conferir('before', 0), ...incerta], filtro)).not.toBeNull();
  });

  it('registros de outro endpoint, modo ou operação não contam', () => {
    const outro = [r('aplicar', 'migration_iniciada', { endpoint: 'ep-outro-333333' }), r('aplicar', 'migration_iniciada', { modo: 'ensaio' })];
    expect(execucaoPendente(outro, filtro)).toBeNull();
    expect(execucaoPendente([r('aplicar', 'migration_iniciada', { operacao: 'migration_X' })], filtro)).toBeNull();
  });
});

describe('lerRegistros', () => {
  it('ignora linha quebrada por gravação interrompida', () => {
    expect(lerRegistros('{"a":1}\n{"b":\n\n{"c":3}\n')).toEqual([{ a: 1 }, { c: 3 }]);
  });
});

describe('identificarEstado', () => {
  it('exatamente um dos dois passa; senão divergente', () => {
    expect(identificarEstado({ before: true, after: false })).toBe('before');
    expect(identificarEstado({ before: false, after: true })).toBe('after');
    expect(identificarEstado({ before: false, after: false })).toBe('divergente');
    expect(identificarEstado({ before: true, after: true })).toBe('divergente');
  });
});
