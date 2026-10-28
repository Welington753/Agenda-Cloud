// Regras puras da publicação de TeamManagerAccess, sem banco nem rede.
// Endpoint IDs, commits e hashes são fictícios. As regras comuns (modo,
// destino, servidores, falhas, registros) são as de TeamAccess e estão
// cobertas em equipe-piloto.spec.ts; aqui, o que é desta operação. O fluxo
// completo foi ensaiado contra PostgreSQL descartável
// (docs/runbooks/publicacao-gerente-piloto.md).
import { describe, expect, it } from 'vitest';
import { Parada } from './entrada-oculta.mjs';
import * as equipe from './equipe-piloto.mjs';
import {
  ESPERADO_ANTES,
  ESPERADO_DEPOIS,
  FRASE,
  MIGRATION,
  OPERACAO,
  PREFIXO_DAS_PASTAS,
  TABELAS_ALTERADAS,
  avaliarBackupConferido,
  classificarFalha,
  conferirColisoes,
  execucaoPendente,
} from './gerente-piloto.mjs';
import { TeamManagerAccess1793145600000 } from '../src/migrations/1793145600000-TeamManagerAccess.js';

const PILOTO = 'ep-piloto-111111';

describe('identidade da operação', () => {
  it('migration, frase e estados são os desta publicação, diferentes dos de TeamAccess', () => {
    expect(MIGRATION).toBe(new TeamManagerAccess1793145600000().name);
    expect(FRASE).toBe('APLICAR TeamManagerAccess1793145600000');
    expect(OPERACAO).toBe('migration_TeamManagerAccess1793145600000');
    expect([ESPERADO_ANTES, ESPERADO_DEPOIS]).toEqual(['before-team-manager', 'after-team-manager']);
    expect(OPERACAO).not.toBe(equipe.OPERACAO);
    expect(PREFIXO_DAS_PASTAS).not.toBe(equipe.PREFIXO_DAS_PASTAS);
    expect(TABELAS_ALTERADAS).toEqual(['memberships']);
  });

  it('reaproveita as regras comuns de TeamAccess, sem cópia', () => {
    expect(classificarFalha).toBe(equipe.classificarFalha);
  });
});

describe('avaliarBackupConferido', () => {
  const agora = Date.parse('2026-10-28T12:00:00Z');
  const manifesto = {
    operacao: OPERACAO,
    esperado: 'before-team-manager',
    modo: 'piloto',
    endpoint: PILOTO,
    commit: 'c'.repeat(40),
    pontoDeRecuperacao: '2026-10-28T10:00:00Z',
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
    ['backup de TeamAccess', { operacao: equipe.OPERACAO, esperado: 'before-team-access' }, {}, {}, 'outra operação'],
    ['restauração conferida de TeamAccess', {}, { operacao: equipe.OPERACAO }, {}, 'conferência de outra operação'],
    ['backup depois da migration', { esperado: 'after-team-manager' }, {}, {}, 'backup fora do estado before'],
    ['backup do ensaio no piloto', { modo: 'ensaio' }, {}, {}, 'backup do modo ensaio'],
    ['outro endpoint', { endpoint: 'ep-outro-333333' }, {}, {}, 'outro endpoint'],
    ['outro commit no backup', { commit: 'd'.repeat(40) }, {}, {}, 'backup de outro commit'],
    ['dump alterado', {}, {}, { sha256DoDump: 'b'.repeat(64) }, 'dump alterado'],
    ['manifesto editado', {}, {}, { sha256DoManifesto: 'e'.repeat(64) }, 'manifesto alterado depois da conferência'],
    ['sem ensaio da migration', {}, { ensaioMigration: 'nao_se_aplica' }, {}, 'migration não ensaiada na cópia'],
    ['restauração com outro commit', {}, { commit: 'd'.repeat(40) }, {}, 'restauração conferida com outro commit'],
    ['mais de 24 h', { pontoDeRecuperacao: '2026-10-27T11:00:00Z' }, {}, {}, 'mais de 24 h'],
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
    expect(execucaoPendente([...incerta, conferir('after', 0)], filtro)).toBeNull();
  });

  it('uma execução incerta de TeamAccess não bloqueia esta, nem o contrário', () => {
    const daEquipe = [r('aplicar', 'migration_iniciada', { operacao: equipe.OPERACAO })];
    expect(execucaoPendente(daEquipe, filtro)).toBeNull();
    expect(equipe.execucaoPendente([r('aplicar', 'migration_iniciada')], filtro)).toBeNull();
  });
});

describe('conferirColisoes', () => {
  it('para com colisão de login; sem colisão segue', () => {
    expect(() => conferirColisoes({ colisoesCruzadas: 0 })).not.toThrow();
    let erro: unknown;
    try {
      conferirColisoes({ colisoesCruzadas: 2 });
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(Parada);
    expect((erro as Parada).message).toBe('ERR_COLISAO_DE_LOGIN');
  });
});
