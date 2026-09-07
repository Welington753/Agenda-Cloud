// Contrato da proteção de agenda (seção 8 da issue) — CHECK de duração
// positiva e EXCLUDE anti-sobreposição, comparados literalmente contra o
// texto de prisma/migrations/20260901155542_init/migration.sql (adaptado
// para snake_case). Sem banco real — só inspeção de string.
import { describe, expect, it } from 'vitest';
import {
  CHECK_STATEMENTS,
  EXCLUSION_STATEMENTS,
  INDEX_STATEMENTS,
} from './1788782400000-InitialSchema.js';

describe('appointments — CHECK de duração positiva', () => {
  const checkStatement = CHECK_STATEMENTS.find((s) =>
    s.includes('ck_appointments_end_after_start'),
  );

  it('existe exatamente uma CHECK de duração em appointments', () => {
    expect(checkStatement).toBeDefined();
  });

  it('a condição é end_at > start_at (snake_case, nunca endAt/startAt)', () => {
    expect(checkStatement).toContain('CHECK (end_at > start_at)');
    expect(checkStatement).not.toMatch(/endAt|startAt/);
  });
});

describe('appointments — EXCLUDE anti-sobreposição', () => {
  const exclusionStatement = EXCLUSION_STATEMENTS.find((s) =>
    s.includes('appointments_no_overlap_excl'),
  );

  it('existe exatamente uma EXCLUDE em appointments, usando gist', () => {
    expect(EXCLUSION_STATEMENTS).toHaveLength(1);
    expect(exclusionStatement).toBeDefined();
    expect(exclusionStatement).toContain('EXCLUDE USING gist');
  });

  it('a chave de exclusão é tenant_id + professional_id + intervalo temporal, bounds [) explícitos', () => {
    expect(exclusionStatement).toContain('tenant_id WITH =');
    expect(exclusionStatement).toContain('professional_id WITH =');
    expect(exclusionStatement).toContain(`tstzrange(start_at, end_at, '[)') WITH &&`);
  });

  it('só status CANCELED libera a exclusão — NO_SHOW continua ocupando (mesma regra do Prisma)', () => {
    expect(exclusionStatement).toContain(`WHERE (status <> 'CANCELED')`);
    expect(exclusionStatement).not.toContain('NO_SHOW');
  });

  it('usa colunas snake_case, nunca professionalId/startAt/endAt', () => {
    expect(exclusionStatement).not.toMatch(/professionalId|startAt|endAt/);
  });
});

describe('appointments — índices necessários para disponibilidade', () => {
  it('índice composto tenant + profissional + período', () => {
    expect(INDEX_STATEMENTS).toContain(
      'CREATE INDEX idx_appointments_tenant_id_professional_id_start_at_end_at ON appointments (tenant_id, professional_id, start_at, end_at)',
    );
  });

  it('índice composto tenant + status + início', () => {
    expect(INDEX_STATEMENTS).toContain(
      'CREATE INDEX idx_appointments_tenant_id_status_start_at ON appointments (tenant_id, status, start_at)',
    );
  });

  it('nenhum índice avulso e redundante em tenant_id/status/start_at sozinhos em appointments', () => {
    const soloIndexes = INDEX_STATEMENTS.filter(
      (s) =>
        /ON appointments \(\w+\)$/.test(s) &&
        (s.includes('tenant_id') || s.includes('status') || s.includes('start_at')),
    );
    expect(soloIndexes).toHaveLength(0);
  });

  it('índice de bloqueios cobre profissional + período (bloqueiosParaOcupados)', () => {
    expect(INDEX_STATEMENTS).toContain(
      'CREATE INDEX idx_time_blocks_professional_id_start_at_end_at ON time_blocks (professional_id, start_at, end_at)',
    );
  });

  it('nenhum CREATE INDEX CONCURRENTLY na migration inicial transacional', () => {
    for (const statement of INDEX_STATEMENTS) {
      expect(statement).not.toContain('CONCURRENTLY');
    }
  });
});
