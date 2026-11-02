// Regras puras da publicação de CommercialAccess, sem banco nem rede.
// Endpoint IDs, commits e hashes são fictícios. As regras comuns (modo,
// destino, servidores, falhas, registros) são as de TeamAccess e estão
// cobertas em equipe-piloto.spec.ts; aqui, o que é desta operação. O fluxo
// completo foi ensaiado contra PostgreSQL descartável
// (docs/runbooks/publicacao-acesso-comercial-piloto.md).
import { describe, expect, it } from 'vitest';
import { Parada } from './entrada-oculta.mjs';
import * as equipe from './equipe-piloto.mjs';
import * as gerente from './gerente-piloto.mjs';
import {
  COLUNAS_ALTERADAS,
  ESPERADO_ANTES,
  ESPERADO_DEPOIS,
  FRASE,
  LINHAS_ACRESCENTADAS,
  MIGRATION,
  OPERACAO,
  PREFIXO_DAS_PASTAS,
  TABELA_NOVA,
  avaliarBackupConferido,
  classificarFalha,
  conferirExcecoes,
  execucaoPendente,
} from './comercial-piloto.mjs';
import {
  LEGACY_OVERRIDE_PREFIX,
  PLAN_FEATURE_ADDITIONS,
  CommercialAccess1793232000000,
} from '../src/migrations/1793232000000-CommercialAccess.js';

const PILOTO = 'ep-piloto-111111';

describe('identidade da operação', () => {
  it('migration, frase e estados são os desta publicação, diferentes dos anteriores', () => {
    expect(MIGRATION).toBe(new CommercialAccess1793232000000().name);
    expect(FRASE).toBe('APLICAR CommercialAccess1793232000000');
    expect(OPERACAO).toBe('migration_CommercialAccess1793232000000');
    expect([ESPERADO_ANTES, ESPERADO_DEPOIS]).toEqual(['before-commercial-access', 'after-commercial-access']);
    for (const outro of [equipe, gerente]) {
      expect(OPERACAO).not.toBe(outro.OPERACAO);
      expect(PREFIXO_DAS_PASTAS).not.toBe(outro.PREFIXO_DAS_PASTAS);
    }
  });

  it('o que muda de propósito vem da migration', () => {
    expect(Object.keys(COLUNAS_ALTERADAS).sort()).toEqual(['plans', 'tenants']);
    expect(LINHAS_ACRESCENTADAS.tenant_feature_overrides).toBe(LEGACY_OVERRIDE_PREFIX);
    expect(PLAN_FEATURE_ADDITIONS.every((l) => l.id.startsWith(LINHAS_ACRESCENTADAS.plan_features))).toBe(true);
    expect(TABELA_NOVA).toBe('tenant_access_periods');
  });

  it('reaproveita as regras comuns de TeamAccess, sem cópia', () => {
    expect(classificarFalha).toBe(equipe.classificarFalha);
  });
});

describe('avaliarBackupConferido', () => {
  const agora = Date.parse('2026-11-02T12:00:00Z');
  const manifesto = {
    operacao: OPERACAO,
    esperado: 'before-commercial-access',
    modo: 'piloto',
    endpoint: PILOTO,
    commit: 'c'.repeat(40),
    pontoDeRecuperacao: '2026-11-02T10:00:00Z',
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
    ['backup de TeamManagerAccess', { operacao: gerente.OPERACAO, esperado: 'before-team-manager' }, {}, {}, 'outra operação'],
    ['restauração conferida de TeamManagerAccess', {}, { operacao: gerente.OPERACAO }, {}, 'conferência de outra operação'],
    ['backup depois da migration', { esperado: 'after-commercial-access' }, {}, {}, 'backup fora do estado before'],
    ['backup do ensaio no piloto', { modo: 'ensaio' }, {}, {}, 'backup do modo ensaio'],
    ['outro endpoint', { endpoint: 'ep-outro-333333' }, {}, {}, 'outro endpoint'],
    ['outro commit no backup', { commit: 'd'.repeat(40) }, {}, {}, 'backup de outro commit'],
    ['dump alterado', {}, {}, { sha256DoDump: 'b'.repeat(64) }, 'dump alterado'],
    ['manifesto editado', {}, {}, { sha256DoManifesto: 'e'.repeat(64) }, 'manifesto alterado depois da conferência'],
    ['restauração sem sucesso', {}, { resultado: 'falhou' }, {}, 'conferência sem sucesso'],
    ['sem ensaio da migration', {}, { ensaioMigration: 'nao_se_aplica' }, {}, 'migration não ensaiada na cópia'],
    ['conferência de outro dump', {}, { sha256: 'b'.repeat(64) }, {}, 'conferência de outro dump'],
    ['restauração com outro commit', {}, { commit: 'd'.repeat(40) }, {}, 'restauração conferida com outro commit'],
    ['mais de 24 h', { pontoDeRecuperacao: '2026-11-01T11:00:00Z' }, {}, {}, 'mais de 24 h'],
    ['ponto de recuperação no futuro', { pontoDeRecuperacao: '2026-11-02T13:00:00Z' }, {}, {}, 'mais de 24 h'],
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
  const filtro = { endpoint: PILOTO, modo: 'piloto' };

  it('execução incerta bloqueia até uma conferir posterior identificar o estado', () => {
    const incerta = [r('aplicar', 'migration_iniciada'), r('aplicar', 'resultado_incerto')];
    expect(execucaoPendente(incerta, filtro)).toEqual({ execucao: 'e1', iniciadaEm: 't1' });
    const conferir = (estado: string, sessoesDaMigration: number) =>
      r('conferir', undefined, { execucao: 'e2', estado, sessoesDaMigration });
    expect(execucaoPendente([...incerta, conferir('after', 1)], filtro)).not.toBeNull();
    expect(execucaoPendente([...incerta, conferir('divergente', 0)], filtro)).not.toBeNull();
    expect(execucaoPendente([...incerta, conferir('before', 0)], filtro)).toBeNull();
  });

  it('janela fechada depois de migration_iniciada (sem registro final) também bloqueia', () => {
    expect(execucaoPendente([r('aplicar', 'migration_iniciada')], filtro)).not.toBeNull();
    expect(execucaoPendente([r('aplicar', 'migration_iniciada'), r('aplicar', 'aplicada_e_conferida')], filtro)).toBeNull();
  });

  it('uma execução incerta de TeamManagerAccess não bloqueia esta, nem o contrário', () => {
    const doGerente = [r('aplicar', 'migration_iniciada', { operacao: gerente.OPERACAO })];
    expect(execucaoPendente(doGerente, filtro)).toBeNull();
    expect(gerente.execucaoPendente([r('aplicar', 'migration_iniciada')], filtro)).toBeNull();
  });
});

describe('conferirExcecoes', () => {
  const codigo = (impacto: { excecoesDesligadas: number; recursosNegados: number }) => {
    try {
      conferirExcecoes(impacto);
      return null;
    } catch (e) {
      expect(e).toBeInstanceOf(Parada);
      return (e as Parada).message;
    }
  };

  it('segue sem exceção desligada e sem recurso negado', () => {
    expect(codigo({ excecoesDesligadas: 0, recursosNegados: 0 })).toBeNull();
  });

  it('para com exceção desligada, sem decidir nada', () => {
    expect(codigo({ excecoesDesligadas: 1, recursosNegados: 1 })).toBe('ERR_EXCECOES_DE_RECURSO_DESLIGADAS');
  });

  it('para se algum recurso existente ficaria negado por outro motivo', () => {
    expect(codigo({ excecoesDesligadas: 0, recursosNegados: 2 })).toBe('ERR_RECURSO_EXISTENTE_SERIA_NEGADO');
  });
});
