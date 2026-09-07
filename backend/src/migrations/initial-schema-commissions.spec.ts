// Contrato de comissões (seção 9 da issue) — unicidade, CHECKs de faixa de
// valor, RESTRICT nas FKs de commission_entries (registro financeiro
// histórico). Sem banco real — só inspeção de string dos arrays exportados.
import { describe, expect, it } from 'vitest';
import {
  BUSINESS_UNIQUE_STATEMENTS,
  CHECK_STATEMENTS,
  FOREIGN_KEY_STATEMENTS,
  UNIQUE_INDEX_STATEMENTS,
} from './1788782400000-InitialSchema.js';

describe('commission_rules — unicidade por tenant+profissional+serviço', () => {
  it('UNIQUE (tenant_id, professional_id, service_id)', () => {
    expect(BUSINESS_UNIQUE_STATEMENTS).toContain(
      'ALTER TABLE commission_rules ADD CONSTRAINT uq_commission_rules_tenant_professional_service UNIQUE (tenant_id, professional_id, service_id)',
    );
  });
});

describe('commission_entries — unicidade por agendamento', () => {
  it('appointment_id é único (no máximo um lançamento por agendamento, para sempre)', () => {
    expect(UNIQUE_INDEX_STATEMENTS).toContain(
      'CREATE UNIQUE INDEX uq_commission_entries_appointment_id ON commission_entries (appointment_id)',
    );
  });
});

describe('CHECK — regra percentual 0-10000 pontos-base, fixo não-negativo', () => {
  it('commission_rules.value: PERCENTAGE entre 0 e 10000, FIXED >= 0', () => {
    const check = CHECK_STATEMENTS.find((s) => s.includes('ck_commission_rules_value_range'));
    expect(check).toBeDefined();
    expect(check).toContain(`type = 'PERCENTAGE' AND value BETWEEN 0 AND 10000`);
    expect(check).toContain(`type = 'FIXED' AND value >= 0`);
  });

  it('commission_entries.applied_value: mesma faixa (snapshot imutável da regra)', () => {
    const check = CHECK_STATEMENTS.find((s) =>
      s.includes('ck_commission_entries_applied_value_range'),
    );
    expect(check).toBeDefined();
    expect(check).toContain(`applied_type = 'PERCENTAGE' AND applied_value BETWEEN 0 AND 10000`);
    expect(check).toContain(`applied_type = 'FIXED' AND applied_value >= 0`);
  });

  it('nunca 0-100 (faixa humana do frontend) — sempre pontos-base 0-10000', () => {
    for (const check of CHECK_STATEMENTS) {
      if (check.includes('value')) {
        expect(check).not.toContain('BETWEEN 0 AND 100)');
      }
    }
  });
});

describe('CHECK — valores do profissional e do estabelecimento nunca negativos', () => {
  it('professional_cents >= 0', () => {
    expect(CHECK_STATEMENTS).toContain(
      'ALTER TABLE commission_entries ADD CONSTRAINT ck_commission_entries_professional_cents_non_negative CHECK (professional_cents >= 0)',
    );
  });

  it('establishment_cents >= 0', () => {
    expect(CHECK_STATEMENTS).toContain(
      'ALTER TABLE commission_entries ADD CONSTRAINT ck_commission_entries_establishment_cents_non_negative CHECK (establishment_cents >= 0)',
    );
  });
});

describe('commission_entries — FKs sempre RESTRICT (registro financeiro histórico)', () => {
  const commissionEntryForeignKeys = FOREIGN_KEY_STATEMENTS.filter((s) =>
    s.startsWith('ALTER TABLE commission_entries '),
  );

  it('existem as 4 FKs esperadas (tenant, appointment, professional, service)', () => {
    expect(commissionEntryForeignKeys).toHaveLength(4);
  });

  it('nenhuma usa CASCADE ou SET NULL — sempre RESTRICT', () => {
    for (const statement of commissionEntryForeignKeys) {
      expect(statement).toContain('ON DELETE RESTRICT');
      expect(statement).not.toContain('CASCADE');
      expect(statement).not.toContain('SET NULL');
    }
  });
});

describe('commission_rules — FKs (tenant RESTRICT, profissional/serviço CASCADE)', () => {
  const commissionRuleForeignKeys = FOREIGN_KEY_STATEMENTS.filter((s) =>
    s.startsWith('ALTER TABLE commission_rules '),
  );

  it('existem as 3 FKs esperadas (tenant, professional, service)', () => {
    expect(commissionRuleForeignKeys).toHaveLength(3);
  });

  it('tenant é RESTRICT (nunca apagar tenant com dado operacional)', () => {
    const tenantFk = commissionRuleForeignKeys.find((s) => s.includes('fk_commission_rules_tenant '));
    expect(tenantFk).toContain('ON DELETE RESTRICT');
  });

  it('professional e service são CASCADE — regra órfã não faz sentido (ver commission-rule.entity.ts)', () => {
    const professionalFk = commissionRuleForeignKeys.find((s) =>
      s.includes('fk_commission_rules_tenant_professional'),
    );
    const serviceFk = commissionRuleForeignKeys.find((s) =>
      s.includes('fk_commission_rules_tenant_service'),
    );
    expect(professionalFk).toContain('ON DELETE CASCADE');
    expect(serviceFk).toContain('ON DELETE CASCADE');
  });
});
