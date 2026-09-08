// Testa o catálogo de dados e o comportamento de up()/down() com um
// QueryRunner falso (registra as chamadas, nunca conecta a banco nenhum) —
// mesma filosofia dos specs de InitialSchema (`initial-schema-*.spec.ts`):
// importar este módulo, ou instanciar a migration, nunca abre conexão.
import { describe, expect, it, vi } from 'vitest';
import type { QueryRunner } from 'typeorm';
import {
  FEATURE_ROWS,
  InitialPlanCatalog1788782460000,
  PLAN_FEATURE_ROWS,
  PLAN_ROWS,
} from './1788782460000-InitialPlanCatalog.js';

function criarQueryRunnerFalso() {
  return { query: vi.fn().mockResolvedValue(undefined) } as unknown as QueryRunner & {
    query: ReturnType<typeof vi.fn>;
  };
}

describe('catálogo de planos/features — dados', () => {
  it('todo código de plano é único', () => {
    const codigos = PLAN_ROWS.map((plan) => plan.code);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it('todo id de plano é único', () => {
    const ids = PLAN_ROWS.map((plan) => plan.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('toda key de feature é única', () => {
    const keys = FEATURE_ROWS.map((feature) => feature.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('todo id de feature é único', () => {
    const ids = FEATURE_ROWS.map((feature) => feature.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('todo id de plan_feature é único', () => {
    const ids = PLAN_FEATURE_ROWS.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cobre as 13 features existentes no domínio (FeatureKey), nenhuma inventada', () => {
    expect(FEATURE_ROWS).toHaveLength(13);
  });

  it('cobre exatamente os 3 planos existentes no domínio (essencial/equipe/pro)', () => {
    expect(PLAN_ROWS.map((plan) => plan.code).sort()).toEqual([
      'equipe',
      'essencial',
      'pro',
    ]);
  });

  it('nenhum preço é zero nem inventado — usa os mesmos valores já publicados em src/lib/planos.ts', () => {
    const precosAprovados: Record<string, number> = {
      essencial: 7900,
      equipe: 14900,
      pro: 24900,
    };
    for (const plan of PLAN_ROWS) {
      expect(plan.priceCents).toBeGreaterThan(0);
      expect(plan.priceCents).toBe(precosAprovados[plan.code]);
    }
  });

  it('todo plan_feature referencia um plano e uma feature que de fato existem no catálogo', () => {
    const idsDePlano = new Set(PLAN_ROWS.map((plan) => plan.id));
    const idsDeFeature = new Set(FEATURE_ROWS.map((feature) => feature.id));
    for (const row of PLAN_FEATURE_ROWS) {
      expect(idsDePlano.has(row.planId)).toBe(true);
      expect(idsDeFeature.has(row.featureId)).toBe(true);
    }
  });
});

describe('InitialPlanCatalog1788782460000.up', () => {
  it('insere features, planos e vínculos plano-feature, todos com ON CONFLICT DO NOTHING (idempotente)', async () => {
    const queryRunner = criarQueryRunnerFalso();
    const migration = new InitialPlanCatalog1788782460000();

    await migration.up(queryRunner);

    const chamadas = queryRunner.query.mock.calls as [string, unknown[]][];
    const totalEsperado =
      FEATURE_ROWS.length + PLAN_ROWS.length + PLAN_FEATURE_ROWS.length;
    expect(chamadas).toHaveLength(totalEsperado);
    for (const [sql] of chamadas) {
      expect(sql).toMatch(/ON CONFLICT/i);
      expect(sql).toMatch(/DO NOTHING/i);
    }
  });

  it('rodar up() duas vezes gera exatamente as mesmas instruções (idempotência de verdade, não só sintática)', async () => {
    const primeiraExecucao = criarQueryRunnerFalso();
    const segundaExecucao = criarQueryRunnerFalso();
    const migration = new InitialPlanCatalog1788782460000();

    await migration.up(primeiraExecucao);
    await migration.up(segundaExecucao);

    expect(segundaExecucao.query.mock.calls).toEqual(
      primeiraExecucao.query.mock.calls,
    );
  });

  it('nunca inclui segredo/URL/senha em nenhum parâmetro (só dados de catálogo público)', async () => {
    const queryRunner = criarQueryRunnerFalso();
    await new InitialPlanCatalog1788782460000().up(queryRunner);

    for (const [, parametros] of queryRunner.query.mock.calls as [string, unknown[]][]) {
      for (const parametro of parametros) {
        expect(String(parametro)).not.toMatch(/postgres(ql)?:\/\//i);
      }
    }
  });
});

describe('InitialPlanCatalog1788782460000.down', () => {
  it('remove só as linhas criadas pela migration, na ordem inversa (plan_features -> features -> plans)', async () => {
    const queryRunner = criarQueryRunnerFalso();
    await new InitialPlanCatalog1788782460000().down(queryRunner);

    const chamadas = queryRunner.query.mock.calls as [string, unknown[]][];
    expect(chamadas[0][0]).toMatch(/DELETE FROM plan_features/i);
    expect(chamadas[1][0]).toMatch(/DELETE FROM features/i);
    expect(chamadas[2][0]).toMatch(/DELETE FROM plans/i);

    expect(chamadas[0][1]).toEqual([PLAN_FEATURE_ROWS.map((r) => r.id)]);
    expect(chamadas[1][1]).toEqual([FEATURE_ROWS.map((r) => r.id)]);
    expect(chamadas[2][1]).toEqual([PLAN_ROWS.map((r) => r.id)]);
  });

  it('nunca usa CASCADE em nenhuma instrução (falha em segurança via FK RESTRICT já existente, não força remoção)', async () => {
    const queryRunner = criarQueryRunnerFalso();
    await new InitialPlanCatalog1788782460000().down(queryRunner);

    for (const [sql] of queryRunner.query.mock.calls as [string, unknown[]][]) {
      expect(sql).not.toMatch(/CASCADE/i);
    }
  });
});

describe('nome/timestamp da migration', () => {
  it('o nome da classe é consistente com o timestamp do arquivo (convenção do TypeORM CLI)', () => {
    const migration = new InitialPlanCatalog1788782460000();
    expect(migration.name).toBe('InitialPlanCatalog1788782460000');
  });
});
