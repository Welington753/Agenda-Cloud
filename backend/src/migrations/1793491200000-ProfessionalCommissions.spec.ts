// O que a migration de comissões muda no catálogo de planos, com um
// QueryRunner falso (nunca conecta a banco nenhum). O comportamento contra
// PostgreSQL real fica em test/commissions-postgres.db-e2e-spec.ts.
import { describe, expect, it, vi } from 'vitest';
import type { QueryRunner } from 'typeorm';
import { COMMERCIAL_PLANS } from '../commercial/plan-catalog.js';
import { FeatureKey } from '../entities/enums/feature-key.enum.js';
import { FEATURE_ROWS, PLAN_FEATURE_ROWS, PLAN_ROWS } from './1788782460000-InitialPlanCatalog.js';
import { PLAN_FEATURE_ADDITIONS } from './1793232000000-CommercialAccess.js';
import {
  COMMISSION_PLAN_FEATURE_ADDITIONS,
  ProfessionalCommissions1793491200000,
} from './1793491200000-ProfessionalCommissions.js';

function criarQueryRunnerFalso(total = 0) {
  return {
    query: vi.fn().mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('count(*)') ? [{ total }] : undefined),
    ),
  } as unknown as QueryRunner & { query: ReturnType<typeof vi.fn> };
}

const comissoes = FEATURE_ROWS.find((f) => f.key === FeatureKey.COMISSOES)!;
const planoPorNome = (nome: string) => COMMERCIAL_PLANS.find((p) => p.name === nome)!;

describe('ProfessionalCommissions — catálogo de planos', () => {
  it('acrescenta comissões só ao plano Pro (código equipe), com os ids do catálogo', () => {
    const pro = planoPorNome('Pro');
    expect(COMMISSION_PLAN_FEATURE_ADDITIONS).toEqual([
      { id: 'pf_pc_equipe_comissoes', planId: pro.id, planCode: pro.code, featureId: comissoes.id },
    ]);
    expect(PLAN_ROWS.some((p) => p.id === pro.id && p.code === pro.code)).toBe(true);
  });

  it('Max (código pro) já tinha comissões; Básico (código essencial) continua sem', () => {
    const vinculos = [
      ...PLAN_FEATURE_ROWS,
      ...PLAN_FEATURE_ADDITIONS,
      ...COMMISSION_PLAN_FEATURE_ADDITIONS,
    ].filter((l) => l.featureId === comissoes.id);
    expect(vinculos.map((l) => l.planId).sort()).toEqual([planoPorNome('Pro').id, planoPorNome('Max').id].sort());
    expect(vinculos.some((l) => l.planId === planoPorNome('Básico').id)).toBe(false);
  });

  it('up() só insere em plan_features, sem tocar em planos, preços, limites ou exceções', async () => {
    const qr = criarQueryRunnerFalso();
    await new ProfessionalCommissions1793491200000().up(qr);
    const sqls = qr.query.mock.calls.map((c) => String(c[0]));
    expect(sqls.filter((s) => /plan_features/.test(s))).toHaveLength(1);
    expect(sqls.find((s) => /plan_features/.test(s))).toMatch(/ON CONFLICT \(plan_id, feature_id\) DO NOTHING/);
    expect(sqls.some((s) => /UPDATE plans|INTO plans|tenant_feature_overrides|price_cents\b|max_professionals/.test(s))).toBe(
      false,
    );
  });

  it('down() remove só a linha que a migration gravou, pelo id', async () => {
    const qr = criarQueryRunnerFalso();
    await new ProfessionalCommissions1793491200000().down(qr);
    const remocao = qr.query.mock.calls.find((c) => /DELETE FROM plan_features/.test(String(c[0])));
    expect(remocao?.[1]).toEqual([['pf_pc_equipe_comissoes']]);
  });
});
