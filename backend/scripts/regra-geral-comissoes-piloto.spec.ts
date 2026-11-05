// Regras puras da publicação de ProfessionalCommissionSettings, sem banco nem
// rede. Endpoint IDs, commits e hashes são fictícios. As regras comuns (modo,
// destino, servidores, falhas, registros) são as de TeamAccess e estão
// cobertas em equipe-piloto.spec.ts; aqui, o que é desta operação. O fluxo
// completo foi ensaiado contra PostgreSQL descartável
// (docs/runbooks/publicacao-regra-geral-comissoes-piloto.md).
import { describe, expect, it } from 'vitest';
import * as equipe from './equipe-piloto.mjs';
import * as gerente from './gerente-piloto.mjs';
import * as comercial from './comercial-piloto.mjs';
import * as comissoes from './comissoes-profissionais-piloto.mjs';
import { ETAPAS as ETAPAS_DO_PORTAL, OPERACAO_CONFERIR as CONFERIR_DO_PORTAL } from './portal-multisservicos-piloto.mjs';
import {
  APLICACAO_DA_MIGRATION,
  CODIGOS_DE_DESFECHO,
  COLUNAS_NOVAS,
  ESPERADO_ANTES,
  ESPERADO_DEPOIS,
  ESTADOS,
  FRASE,
  MIGRATION,
  OPERACAO,
  PREFIXO_DAS_PASTAS,
  TABELAS_NOVAS,
  avaliarBackupConferido,
  classificarFalha,
  decidirAplicacao,
  desfechoDoErro,
  execucaoPendente,
  identificarEstado,
  inicioDaJanela,
} from './regra-geral-comissoes-piloto.mjs';
import {
  COMMISSION_SETTINGS_TABLE,
  ProfessionalCommissionSettings1793577600000,
} from '../src/migrations/1793577600000-ProfessionalCommissionSettings.js';

const PILOTO = 'ep-piloto-111111';

describe('identidade da operação', () => {
  it('migration, frase e estados', () => {
    expect(MIGRATION).toBe(new ProfessionalCommissionSettings1793577600000().name);
    expect(FRASE).toBe('APLICAR ProfessionalCommissionSettings1793577600000');
    expect(ESTADOS).toEqual(['before-commission-settings', 'after-commission-settings']);
    expect([ESPERADO_ANTES, ESPERADO_DEPOIS]).toEqual(ESTADOS);
  });

  it('operação, pasta e sessão próprias, diferentes das publicações anteriores (inclusive a da 15)', () => {
    const anteriores = [
      ...[equipe, gerente, comercial, comissoes].map((m) => ({ operacao: m.OPERACAO, pasta: m.PREFIXO_DAS_PASTAS, aplicacao: m.APLICACAO_DA_MIGRATION })),
      ...Object.values(ETAPAS_DO_PORTAL).map((e) => ({ operacao: e.operacao, pasta: e.prefixoDasPastas, aplicacao: e.aplicacao })),
    ];
    for (const outra of anteriores) {
      expect(OPERACAO).not.toBe(outra.operacao);
      expect(PREFIXO_DAS_PASTAS).not.toBe(outra.pasta);
      expect(APLICACAO_DA_MIGRATION).not.toBe(outra.aplicacao);
    }
    expect(OPERACAO).not.toBe(CONFERIR_DO_PORTAL);
    // Nenhum prefixo é começo de outro: a busca do backup não mistura pastas.
    for (const outra of anteriores) expect(outra.pasta.startsWith(PREFIXO_DAS_PASTAS) || PREFIXO_DAS_PASTAS.startsWith(outra.pasta)).toBe(false);
    // Os estados da 15 não se confundem com os desta.
    expect(ESTADOS.some((e) => comissoes.ESTADOS.includes(e))).toBe(false);
  });

  it('o que muda de propósito vem da migration: uma tabela e uma coluna', () => {
    expect(TABELAS_NOVAS).toEqual([COMMISSION_SETTINGS_TABLE]);
    expect(COLUNAS_NOVAS).toEqual({ commission_entries: ['applied_rule_scope'] });
  });

  it('reaproveita as regras comuns de TeamAccess, sem cópia', () => {
    expect(classificarFalha).toBe(equipe.classificarFalha);
  });
});

describe('identificarEstado e decidirAplicacao', () => {
  const resultados = (passa: string[]) => Object.fromEntries(ESTADOS.map((e) => [e, passa.includes(e)]));
  const falha = 'ERR_POST_MIGRATION_BASELINE_MISMATCH';

  it('exatamente uma conferência passa: é o estado; nenhuma ou as duas: divergente', () => {
    for (const e of ESTADOS) expect(identificarEstado({ resultados: resultados([e]), codigos: [falha] })).toBe(e);
    expect(identificarEstado({ resultados: resultados([]), codigos: [falha, falha] })).toBe('divergente');
    expect(identificarEstado({ resultados: resultados(ESTADOS) })).toBe('divergente');
  });

  it('conferência sem leitura (conexão, TLS) não identifica estado', () => {
    expect(identificarEstado({ resultados: resultados([ESPERADO_ANTES]), codigos: [undefined, 'ERR_CONNECTION_FAILED'] })).toBe(
      'nao_identificado',
    );
  });

  it('só aplica no "antes"; nada é repetido', () => {
    expect(decidirAplicacao(ESPERADO_ANTES)).toBe('aplicar');
    expect(decidirAplicacao(ESPERADO_DEPOIS)).toBe('ERR_MIGRATION_JA_APLICADA');
    expect(decidirAplicacao('divergente')).toBe('ERR_ESTADO_ANTES_DIVERGENTE');
    expect(decidirAplicacao('nao_identificado')).toBe('ERR_CONFERENCIA_SEM_LEITURA');
  });
});

describe('avaliarBackupConferido', () => {
  const agora = Date.parse('2026-11-05T12:00:00Z');
  const manifesto = {
    operacao: OPERACAO,
    esperado: ESPERADO_ANTES,
    modo: 'piloto',
    endpoint: PILOTO,
    commit: 'c'.repeat(40),
    pontoDeRecuperacao: '2026-11-05T10:00:00Z',
    backup: { arquivo: 'piloto-neondb.dump', sha256: 'a'.repeat(64) },
  };
  const conferencia = {
    operacao: OPERACAO,
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

  it('aceita backup e ensaio desta operação, do mesmo destino, modo e commit, de até 24 h', () => {
    expect(avaliar()).toEqual([]);
  });

  it.each([
    ['backup do kit da 15', { operacao: comissoes.OPERACAO, esperado: comissoes.ESPERADO_DEPOIS }, {}, {}, 'outra operação'],
    ['restauração conferida pelo kit da 15', {}, { operacao: comissoes.OPERACAO }, {}, 'conferência de outra operação'],
    ['backup do estado depois', { esperado: ESPERADO_DEPOIS }, {}, {}, `backup fora do estado ${ESPERADO_ANTES}`],
    ['backup do ensaio no piloto', { modo: 'ensaio' }, {}, {}, 'backup do modo ensaio'],
    ['outro endpoint', { endpoint: 'ep-outro-333333' }, {}, {}, 'outro endpoint'],
    ['outro commit no backup', { commit: 'd'.repeat(40) }, {}, {}, 'backup de outro commit'],
    ['dump alterado', {}, {}, { sha256DoDump: 'b'.repeat(64) }, 'dump alterado'],
    ['manifesto editado', {}, {}, { sha256DoManifesto: 'e'.repeat(64) }, 'manifesto alterado depois da conferência'],
    ['restauração sem sucesso', {}, { resultado: 'falhou' }, {}, 'conferência sem sucesso'],
    ['sem ensaio da migration', {}, { ensaioMigration: 'nao_se_aplica' }, {}, 'migration não ensaiada na cópia'],
    ['conferência de outro dump', {}, { sha256: 'b'.repeat(64) }, {}, 'conferência de outro dump'],
    ['restauração com outro commit', {}, { commit: 'd'.repeat(40) }, {}, 'restauração conferida com outro commit'],
    ['mais de 24 h', { pontoDeRecuperacao: '2026-11-04T11:00:00Z' }, {}, {}, 'mais de 24 h'],
    ['ponto de recuperação no futuro', { pontoDeRecuperacao: '2026-11-05T13:00:00Z' }, {}, {}, 'mais de 24 h'],
  ])('recusa %s', (_caso, m, c, extra, motivo) => {
    expect(avaliar(m, c, extra)).toContain(motivo);
  });
});

describe('execucaoPendente e inicioDaJanela', () => {
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
  const conferir = (estado: string, sessoesDaMigration: number) => r('conferir', undefined, { execucao: 'e2', estado, sessoesDaMigration });
  const filtro = { endpoint: PILOTO, modo: 'piloto' };

  it('execução incerta bloqueia até uma conferir identificar um dos dois estados, sem sessão ativa', () => {
    const incerta = [r('aplicar', 'migration_iniciada'), r('aplicar', 'resultado_incerto')];
    expect(execucaoPendente(incerta, filtro)).toEqual({ execucao: 'e1', iniciadaEm: 't1' });
    expect(execucaoPendente([...incerta, conferir(ESPERADO_DEPOIS, 1)], filtro)).not.toBeNull();
    expect(execucaoPendente([...incerta, conferir('divergente', 0)], filtro)).not.toBeNull();
    for (const estado of ESTADOS) expect(execucaoPendente([...incerta, conferir(estado, 0)], filtro)).toBeNull();
  });

  it('execução incerta do kit da 15 não bloqueia esta, e a conferir dele não libera uma desta', () => {
    const daQuinze = { operacao: comissoes.OPERACAO };
    expect(execucaoPendente([r('aplicar', 'migration_iniciada', daQuinze)], filtro)).toBeNull();
    const conferirDaQuinze = r('conferir', undefined, { ...daQuinze, estado: ESPERADO_ANTES, sessoesDaMigration: 0 });
    expect(execucaoPendente([r('aplicar', 'migration_iniciada'), conferirDaQuinze], filtro)).not.toBeNull();
    expect(execucaoPendente([r('aplicar', 'migration_iniciada', { modo: 'ensaio' })], filtro)).toBeNull();
  });

  it('a janela começa no instante do banco gravado pela última aplicar desta operação, destino e modo', () => {
    expect(inicioDaJanela([], filtro)).toBeNull();
    const primeira = r('aplicar', 'migration_iniciada', { janelaDesde: '2026-11-05T10:00:00.000000Z' });
    const segunda = r('aplicar', 'migration_iniciada', { execucao: 'e3', janelaDesde: '2026-11-05T11:00:00.000000Z' });
    expect(inicioDaJanela([primeira], filtro)).toBe('2026-11-05T10:00:00.000000Z');
    expect(inicioDaJanela([primeira, r('aplicar', 'nao_aplicada'), segunda], filtro)).toBe('2026-11-05T11:00:00.000000Z');
    // Outra operação, modo ou destino não contam; registro sem o instante também não.
    expect(inicioDaJanela([r('aplicar', 'migration_iniciada', { operacao: comissoes.OPERACAO, janelaDesde: 'x' })], filtro)).toBeNull();
    expect(inicioDaJanela([r('aplicar', 'migration_iniciada', { modo: 'ensaio', janelaDesde: 'x' })], filtro)).toBeNull();
    expect(inicioDaJanela([r('aplicar', 'migration_iniciada')], filtro)).toBeNull();
  });
});

describe('desfecho', () => {
  it('sucesso, parada, janela violada, aplicada sem conferência e incerto têm códigos de saída próprios', () => {
    expect(CODIGOS_DE_DESFECHO).toEqual({
      preparado_sem_gravacao: 0,
      aplicada_e_conferida: 0,
      estado_identificado: 0,
      abortado_sem_gravacao: 1,
      parado_sem_gravacao: 1,
      conferencia_sem_estado_valido: 1,
      janela_de_transicao_violada: 1,
      aplicada_conferencia_falhou: 2,
      resultado_incerto: 3,
    });
  });

  it.each([
    ['ERR_SEM_BACKUP_COM_RESTAURACAO_CONFERIDA', null, 'parado_sem_gravacao'],
    ['ERR_MIGRATION_JA_APLICADA', null, 'parado_sem_gravacao'],
    ['ERR_MIGRATION_FALHOU', null, 'parado_sem_gravacao'],
    ['ERR_RESULTADO_INCERTO', 'iniciada', 'resultado_incerto'],
    ['ERR_INESPERADO', 'iniciada', 'resultado_incerto'],
    ['ENOSPC', 'aplicada', 'aplicada_conferencia_falhou'],
  ] as const)('%s com a execução em %s: %s', (codigo, execucao, esperado) => {
    expect(desfechoDoErro(codigo, execucao)).toBe(esperado);
  });
});
