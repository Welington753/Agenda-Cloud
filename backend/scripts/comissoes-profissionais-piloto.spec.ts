// Regras puras da publicação de ProfessionalCommissions, sem banco nem rede.
// Endpoint IDs, commits e hashes são fictícios. As regras comuns (modo,
// destino, servidores, falhas, registros) são as de TeamAccess e estão
// cobertas em equipe-piloto.spec.ts; aqui, o que é desta operação. O fluxo
// completo foi ensaiado contra PostgreSQL descartável
// (docs/runbooks/publicacao-comissoes-profissionais-piloto.md).
import { describe, expect, it } from 'vitest';
import * as equipe from './equipe-piloto.mjs';
import * as gerente from './gerente-piloto.mjs';
import * as comercial from './comercial-piloto.mjs';
import { ETAPAS as ETAPAS_DO_PORTAL, OPERACAO_CONFERIR as CONFERIR_DO_PORTAL } from './portal-multisservicos-piloto.mjs';
import {
  APLICACAO_DA_MIGRATION,
  CODIGOS_DE_DESFECHO,
  COLUNAS_NOVAS,
  ESPERADO_ANTES,
  ESPERADO_DEPOIS,
  ESTADOS,
  FRASE,
  LINHAS_NOVAS,
  MIGRATION,
  OPERACAO,
  PREFIXO_DAS_PASTAS,
  avaliarBackupConferido,
  classificarFalha,
  contagensEsperadasDepois,
  decidirAplicacao,
  desfechoDoErro,
  execucaoPendente,
  identificarEstado,
} from './comissoes-profissionais-piloto.mjs';
import {
  COMMISSION_PLAN_FEATURE_ADDITIONS,
  ProfessionalCommissions1793491200000,
} from '../src/migrations/1793491200000-ProfessionalCommissions.js';

const PILOTO = 'ep-piloto-111111';

describe('identidade da operação', () => {
  it('migration, frase e estados', () => {
    expect(MIGRATION).toBe(new ProfessionalCommissions1793491200000().name);
    expect(FRASE).toBe('APLICAR ProfessionalCommissions1793491200000');
    expect(ESTADOS).toEqual(['before-professional-commissions', 'after-professional-commissions']);
    expect([ESPERADO_ANTES, ESPERADO_DEPOIS]).toEqual(ESTADOS);
  });

  it('operação, pasta e sessão próprias, diferentes das publicações anteriores', () => {
    const anteriores = [
      ...[equipe, gerente, comercial].map((m) => ({ operacao: m.OPERACAO, pasta: m.PREFIXO_DAS_PASTAS, aplicacao: m.APLICACAO_DA_MIGRATION })),
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
  });

  it('o que muda de propósito vem da migration: uma coluna e uma linha do catálogo', () => {
    expect(COLUNAS_NOVAS).toEqual({ commission_entries: ['appointment_item_id'] });
    expect(LINHAS_NOVAS).toEqual({ plan_features: COMMISSION_PLAN_FEATURE_ADDITIONS.map((l) => l.id) });
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
  const agora = Date.parse('2026-11-04T12:00:00Z');
  const manifesto = {
    operacao: OPERACAO,
    esperado: ESPERADO_ANTES,
    modo: 'piloto',
    endpoint: PILOTO,
    commit: 'c'.repeat(40),
    pontoDeRecuperacao: '2026-11-04T10:00:00Z',
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
    ['backup da etapa final do portal', { operacao: ETAPAS_DO_PORTAL.multisservicos.operacao }, {}, {}, 'outra operação'],
    ['restauração conferida do portal', {}, { operacao: ETAPAS_DO_PORTAL.multisservicos.operacao }, {}, 'conferência de outra operação'],
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
    ['mais de 24 h', { pontoDeRecuperacao: '2026-11-03T11:00:00Z' }, {}, {}, 'mais de 24 h'],
    ['ponto de recuperação no futuro', { pontoDeRecuperacao: '2026-11-04T13:00:00Z' }, {}, {}, 'mais de 24 h'],
  ])('recusa %s', (_caso, m, c, extra, motivo) => {
    expect(avaliar(m, c, extra)).toContain(motivo);
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
  const conferir = (estado: string, sessoesDaMigration: number) => r('conferir', undefined, { execucao: 'e2', estado, sessoesDaMigration });
  const filtro = { endpoint: PILOTO, modo: 'piloto' };

  it('execução incerta bloqueia até uma conferir identificar um dos dois estados, sem sessão ativa', () => {
    const incerta = [r('aplicar', 'migration_iniciada'), r('aplicar', 'resultado_incerto')];
    expect(execucaoPendente(incerta, filtro)).toEqual({ execucao: 'e1', iniciadaEm: 't1' });
    expect(execucaoPendente([...incerta, conferir(ESPERADO_DEPOIS, 1)], filtro)).not.toBeNull();
    expect(execucaoPendente([...incerta, conferir('divergente', 0)], filtro)).not.toBeNull();
    for (const estado of ESTADOS) expect(execucaoPendente([...incerta, conferir(estado, 0)], filtro)).toBeNull();
  });

  it('janela fechada depois de migration_iniciada (sem registro final) também bloqueia', () => {
    const iniciada = r('aplicar', 'migration_iniciada');
    expect(execucaoPendente([iniciada], filtro)).not.toBeNull();
    expect(execucaoPendente([iniciada, r('aplicar', 'aplicada_e_conferida')], filtro)).toBeNull();
    expect(execucaoPendente([iniciada, r('aplicar', 'aplicada_e_conferida', { execucao: 'outra' })], filtro)).not.toBeNull();
  });

  it('execução incerta do portal não bloqueia esta; outro modo ou endpoint também não', () => {
    const doPortal = { operacao: ETAPAS_DO_PORTAL.multisservicos.operacao };
    expect(execucaoPendente([r('aplicar', 'migration_iniciada', doPortal)], filtro)).toBeNull();
    expect(execucaoPendente([r('aplicar', 'migration_iniciada', { modo: 'ensaio' })], filtro)).toBeNull();
    expect(execucaoPendente([r('aplicar', 'migration_iniciada', { endpoint: 'ep-outro-1' })], filtro)).toBeNull();
    // A conferir do portal não libera uma execução desta.
    const deOutra = r('conferir', undefined, { operacao: CONFERIR_DO_PORTAL, estado: ESPERADO_ANTES, sessoesDaMigration: 0 });
    expect(execucaoPendente([r('aplicar', 'migration_iniciada'), deOutra], filtro)).not.toBeNull();
  });
});

describe('contagensEsperadasDepois', () => {
  it('só plan_features ganha linhas (as da migration); nenhuma outra tabela muda', () => {
    const antes = { plan_features: 26, commission_entries: 3, plans: 3 };
    expect(contagensEsperadasDepois(antes)).toEqual({ plan_features: 27, commission_entries: 3, plans: 3 });
    expect(antes.plan_features).toBe(26);
  });
});

describe('desfecho', () => {
  it('sucesso, parada sem gravação, aplicada sem conferência e incerto têm códigos de saída distintos', () => {
    expect(CODIGOS_DE_DESFECHO).toEqual({
      preparado_sem_gravacao: 0,
      aplicada_e_conferida: 0,
      estado_identificado: 0,
      abortado_sem_gravacao: 1,
      parado_sem_gravacao: 1,
      conferencia_sem_estado_valido: 1,
      aplicada_conferencia_falhou: 2,
      resultado_incerto: 3,
    });
  });

  it.each([
    ['ERR_SEM_BACKUP_COM_RESTAURACAO_CONFERIDA', null, 'parado_sem_gravacao'],
    ['ERR_MIGRATION_JA_APLICADA', null, 'parado_sem_gravacao'],
    ['ERR_ESTADO_ANTES_DIVERGENTE', null, 'parado_sem_gravacao'],
    ['ERR_MIGRATION_NAO_INICIADA', null, 'parado_sem_gravacao'],
    ['ERR_MIGRATION_FALHOU', null, 'parado_sem_gravacao'],
    ['ERR_RESULTADO_INCERTO', 'iniciada', 'resultado_incerto'],
    ['ERR_RESULTADO_INCERTO', null, 'resultado_incerto'],
    // Erro inesperado depois do início (disco cheio ao registrar, por exemplo).
    ['ERR_INESPERADO', 'iniciada', 'resultado_incerto'],
    ['ENOSPC', 'aplicada', 'aplicada_conferencia_falhou'],
  ] as const)('%s com a execução em %s: %s', (codigo, execucao, esperado) => {
    expect(desfechoDoErro(codigo, execucao)).toBe(esperado);
  });
});
