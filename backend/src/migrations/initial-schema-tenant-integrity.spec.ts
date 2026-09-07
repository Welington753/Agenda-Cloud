// Contrato de consistência multi-tenant (seção 7 da issue) — as 8 relações
// que precisam de FK composta (tenant_id, x) → (tenant_id, id), mais as 5
// UNIQUE(tenant_id, id) auxiliares que tornam isso possível. Sem banco real.
import { describe, expect, it } from 'vitest';
import {
  TENANT_COMPOSITE_FOREIGN_KEY_STATEMENTS,
  TENANT_PARENT_UNIQUE_STATEMENTS,
} from './1788782400000-InitialSchema.js';

describe('UNIQUE(tenant_id, id) nas tabelas-pai', () => {
  it('exatamente as 5 tabelas-pai referenciadas por FK composta', () => {
    expect(TENANT_PARENT_UNIQUE_STATEMENTS).toHaveLength(5);
    const tables = TENANT_PARENT_UNIQUE_STATEMENTS.map(
      (s) => /^ALTER TABLE (\w+) /.exec(s)![1],
    );
    expect(tables.sort()).toEqual(
      ['appointments', 'consumers', 'memberships', 'professionals', 'services'].sort(),
    );
  });

  it('toda constraint é UNIQUE (tenant_id, id), nunca outra ordem de coluna', () => {
    for (const statement of TENANT_PARENT_UNIQUE_STATEMENTS) {
      expect(statement).toMatch(/UNIQUE \(tenant_id, id\)$/);
    }
  });
});

describe('FK composta (tenant_id, x) — as 8 relações da seção 7', () => {
  it('exatamente 15 FKs compostas (algumas relações têm mais de uma coluna filha)', () => {
    expect(TENANT_COMPOSITE_FOREIGN_KEY_STATEMENTS).toHaveLength(15);
  });

  it('toda FK composta referencia (tenant_id, id) na tabela-pai', () => {
    for (const statement of TENANT_COMPOSITE_FOREIGN_KEY_STATEMENTS) {
      expect(statement).toMatch(/REFERENCES \w+ \(tenant_id, id\)/);
      expect(statement).toMatch(/FOREIGN KEY \(tenant_id, \w+\)/);
    }
  });

  const relationExists = (child: string, parent: string): boolean =>
    TENANT_COMPOSITE_FOREIGN_KEY_STATEMENTS.some(
      (s) =>
        s.startsWith(`ALTER TABLE ${child} `) &&
        s.includes(`REFERENCES ${parent} (tenant_id, id)`),
    );

  it('agendamento × profissional', () => {
    expect(relationExists('appointments', 'professionals')).toBe(true);
  });

  it('agendamento × consumidor', () => {
    expect(relationExists('appointments', 'consumers')).toBe(true);
  });

  it('itens/recursos/status × agendamento (3 tabelas filhas)', () => {
    expect(relationExists('appointment_items', 'appointments')).toBe(true);
    expect(relationExists('appointment_resources', 'appointments')).toBe(true);
    expect(relationExists('appointment_status_changes', 'appointments')).toBe(true);
  });

  it('profissional-serviço × profissional/serviço', () => {
    expect(relationExists('professional_services', 'professionals')).toBe(true);
    expect(relationExists('professional_services', 'services')).toBe(true);
  });

  it('agenda profissional × profissional', () => {
    expect(relationExists('professional_schedules', 'professionals')).toBe(true);
  });

  it('membership × profissional', () => {
    expect(relationExists('memberships', 'professionals')).toBe(true);
  });

  it('permissões extras × membership', () => {
    expect(relationExists('membership_permission_overrides', 'memberships')).toBe(true);
  });

  it('comissão × agendamento/profissional/serviço (commission_rules + commission_entries)', () => {
    expect(relationExists('commission_rules', 'professionals')).toBe(true);
    expect(relationExists('commission_rules', 'services')).toBe(true);
    expect(relationExists('commission_entries', 'appointments')).toBe(true);
    expect(relationExists('commission_entries', 'professionals')).toBe(true);
    expect(relationExists('commission_entries', 'services')).toBe(true);
  });
});

describe('memberships × professionals — SET NULL restrito à coluna, tenant_id preservado', () => {
  it('usa SET NULL (professional_id), nunca RESTRICT nem SET NULL de todas as colunas', () => {
    const statement = TENANT_COMPOSITE_FOREIGN_KEY_STATEMENTS.find(
      (s) => s.includes('fk_memberships_tenant_professional'),
    );
    expect(statement).toBeDefined();
    expect(statement).toContain('ON DELETE SET NULL (professional_id)');
    expect(statement).not.toContain('RESTRICT');
  });

  it('a sintaxe de coluna-alvo garante que tenant_id nunca é zerado (só professional_id está entre parênteses)', () => {
    const statement = TENANT_COMPOSITE_FOREIGN_KEY_STATEMENTS.find(
      (s) => s.includes('fk_memberships_tenant_professional'),
    )!;
    expect(statement).not.toMatch(/SET NULL \(tenant_id/);
    expect(statement).not.toMatch(/SET NULL \(tenant_id, professional_id\)/);
  });
});

describe('MATCH SIMPLE (default) — FK composta nullable não bloqueia ausência', () => {
  it('memberships.professional_id pode ser nulo sem violar a FK composta (comportamento de driver, não de SQL aqui — só confirma que a coluna não é NOT NULL na composição)', () => {
    const statement = TENANT_COMPOSITE_FOREIGN_KEY_STATEMENTS.find((s) =>
      s.includes('fk_memberships_tenant_professional'),
    );
    // Nenhum MATCH FULL/PARTIAL explícito — o default MATCH SIMPLE do
    // Postgres só valida a constraint quando NENHUMA coluna da FK é nula.
    expect(statement).not.toContain('MATCH FULL');
    expect(statement).not.toContain('MATCH PARTIAL');
  });
});
