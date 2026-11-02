// Conferência de CommercialAccess no piloto, sem banco: os nomes duplicados
// batem com a migration, e as falhas antes/depois saem dos estados certos. A
// leitura real roda contra PostgreSQL descartável em
// test/pilot-commercial-access-check.db-e2e-spec.ts.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_AUDIT_ACTIONS,
  IMPLEMENTED_FEATURE_IDS,
  LEGACY_OVERRIDE_PREFIX,
  PLAN_FEATURE_ADDITIONS,
  PLAN_RENAMES,
  CommercialAccess1793232000000,
} from '../../src/migrations/1793232000000-CommercialAccess.js';
import {
  COLUNAS_PERIODOS,
  CONSTRAINTS_PERIODOS,
  INDICES_PERIODOS,
  LINHAS_DO_CATALOGO,
  MIGRATIONS_ATE_GERENTE,
  MIGRATION_COMERCIAL,
  PLANOS_COMERCIAL,
  PREFIXO_DAS_EXCECOES,
  RECURSOS_EXISTENTES,
  TIPOS_COMERCIAL,
  TOTAL_OBJETOS_COMERCIAL,
  VALORES_COMERCIAL,
  falhasAntesDeComercial,
  falhasDepoisDeComercial,
  objetosComercialPresentes,
  type EstadoComercial,
} from './acesso-comercial-schema.js';

const MIGRATION_TS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/migrations/1793232000000-CommercialAccess.ts',
);

const antes: EstadoComercial = {
  migrationNames: [...MIGRATIONS_ATE_GERENTE],
  falhasDoGerente: [],
  preRequisitosAusentes: [],
  valores: [],
  tipos: [],
  tabela: false,
  colunasDaTabela: [],
  constraints: [],
  indices: [],
  colunaLegado: false,
  planos: PLANOS_COMERCIAL.map((p) => `${p.id}:${p.code}:${p.antes}`),
  linhasDoCatalogo: [],
  linhasDoCatalogoErradas: 0,
  recursosAusentes: [],
  excecoesDaMigration: 0,
  excecoesDesligadas: 0,
  recursosFaltandoNosPlanos: 4,
};

const depois: EstadoComercial = {
  ...antes,
  migrationNames: [...MIGRATIONS_ATE_GERENTE, MIGRATION_COMERCIAL],
  valores: [...VALORES_COMERCIAL],
  tipos: Object.entries(TIPOS_COMERCIAL).flatMap(([t, rotulos]) => rotulos.map((r) => `${t}.${r}`)),
  tabela: true,
  colunasDaTabela: [...COLUNAS_PERIODOS].reverse(),
  constraints: CONSTRAINTS_PERIODOS.map(([n, t]) => `${n}:${t}`),
  indices: [...INDICES_PERIODOS],
  colunaLegado: true,
  planos: PLANOS_COMERCIAL.map((p) => `${p.id}:${p.code}:${p.depois}`),
  linhasDoCatalogo: LINHAS_DO_CATALOGO.map((l) => l.id),
  recursosFaltandoNosPlanos: 0,
};

describe('nomes derivados da migration', () => {
  it('migration, valores de auditoria, planos, catálogo, recursos e prefixo', () => {
    expect(MIGRATION_COMERCIAL).toBe(new CommercialAccess1793232000000().name);
    expect(VALORES_COMERCIAL).toEqual(ACCESS_AUDIT_ACTIONS.map((a) => `audit_action.${a}`));
    expect(PLANOS_COMERCIAL.map((p) => [p.id, p.code, p.antes, p.depois])).toEqual(
      PLAN_RENAMES.map((p) => [p.id, p.code, p.from.name, p.to.name]),
    );
    expect(LINHAS_DO_CATALOGO).toEqual(PLAN_FEATURE_ADDITIONS.map((l) => ({ ...l })));
    expect(RECURSOS_EXISTENTES).toEqual([...IMPLEMENTED_FEATURE_IDS]);
    expect(PREFIXO_DAS_EXCECOES).toBe(LEGACY_OVERRIDE_PREFIX);
  });

  it('tabela, colunas, constraints, índices e tipos aparecem no texto da migration', async () => {
    const { readFileSync } = await import('node:fs');
    const texto = readFileSync(MIGRATION_TS, 'utf8');
    for (const coluna of COLUNAS_PERIODOS) expect(texto).toMatch(new RegExp(`\\n\\s+${coluna} `));
    for (const [nome] of CONSTRAINTS_PERIODOS) expect(texto).toContain(nome);
    for (const nome of INDICES_PERIODOS) expect(texto).toContain(nome);
    for (const [tipo, rotulos] of Object.entries(TIPOS_COMERCIAL)) {
      expect(texto).toContain(`CREATE TYPE ${tipo} AS ENUM (${rotulos.map((r) => `'${r}'`).join(', ')})`);
    }
    expect(texto).toContain('ADD COLUMN access_legacy_since');
  });

  it('o histórico anterior é exatamente o das migrations que existem antes da nova, na ordem', () => {
    const pasta = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/migrations');
    const nomes = readdirSync(pasta)
      .filter((n) => /^\d+-[A-Za-z]+\.ts$/.test(n))
      .sort()
      .map((n) => {
        const [, carimbo, nome] = /^(\d+)-([A-Za-z]+)\.ts$/.exec(n)!;
        return `${nome}${carimbo}`;
      });
    const ate = nomes.slice(0, nomes.indexOf(MIGRATION_COMERCIAL) + 1);
    expect(ate.at(-1)).toBe(MIGRATION_COMERCIAL);
    expect(ate.slice(0, -1)).toEqual([...MIGRATIONS_ATE_GERENTE]);
    expect(MIGRATIONS_ATE_GERENTE).toHaveLength(11);
  });
});

describe('falhas antes e depois', () => {
  it('antes: onze migrations exatas, nomes anteriores, nada novo e nenhuma exceção desligada', () => {
    expect(falhasAntesDeComercial(antes)).toEqual([]);
    expect(objetosComercialPresentes(antes)).toBe(0);
    expect(falhasAntesDeComercial({ ...antes, excecoesDesligadas: 1 })).toEqual(['disabled_feature_overrides']);
    expect(falhasAntesDeComercial({ ...antes, migrationNames: antes.migrationNames.slice(0, -1) })).toEqual(['migration_history']);
    // Mesmo número de migrations, ordem ou nome diferente: recusa.
    const trocado = [...antes.migrationNames];
    [trocado[9], trocado[10]] = [trocado[10]!, trocado[9]!];
    expect(falhasAntesDeComercial({ ...antes, migrationNames: trocado })).toEqual(['migration_history']);
    expect(falhasAntesDeComercial({ ...antes, falhasDoGerente: ['trg_users_login_identifier'] })).toEqual([
      'team_manager_trg_users_login_identifier',
    ]);
    expect(falhasAntesDeComercial({ ...antes, preRequisitosAusentes: ['extension_btree_gist'] })).toEqual(['extension_btree_gist']);
    expect(falhasAntesDeComercial({ ...antes, recursosAusentes: ['feat_equipe'] })).toEqual(['feature_row_feat_equipe']);
    expect(
      falhasAntesDeComercial({ ...antes, planos: [...antes.planos.slice(0, 2), 'plan_pro:pro:Rede Plus'] }),
    ).toEqual(['plan_names_or_codes_unexpected']);
    expect(falhasAntesDeComercial({ ...antes, excecoesDaMigration: 1 })).toEqual(['migration_overrides_already_exist']);
    expect(falhasAntesDeComercial(depois)).toEqual(
      expect.arrayContaining([
        'migration_history',
        'new_enum_values_already_exist',
        'new_types_already_exist',
        'access_periods_table_already_exists',
        'access_periods_objects_already_exist',
        'legacy_column_already_exists',
        'plan_names_or_codes_unexpected',
        'catalog_rows_already_exist',
      ]),
    );
  });

  it('depois: doze migrations, tudo presente, nomes novos e catálogo completo', () => {
    expect(falhasDepoisDeComercial(depois)).toEqual([]);
    expect(objetosComercialPresentes(depois)).toBe(TOTAL_OBJETOS_COMERCIAL);
    expect(falhasDepoisDeComercial({ ...depois, colunasDaTabela: COLUNAS_PERIODOS.slice(1) })).toEqual(['access_periods_columns']);
    expect(
      falhasDepoisDeComercial({ ...depois, constraints: depois.constraints.filter((c) => !c.startsWith('ex_tenant_access_periods_paid')) }),
    ).toEqual(['ex_tenant_access_periods_paid_overlap']);
    expect(falhasDepoisDeComercial({ ...depois, linhasDoCatalogoErradas: 1 })).toEqual(['catalog_rows_unexpected']);
    expect(falhasDepoisDeComercial({ ...depois, recursosFaltandoNosPlanos: 1 })).toEqual(['known_plans_missing_existing_features']);
    // Exceção desligada depois da migration não muda o estado do schema: é
    // informada pelo levantamento.
    expect(falhasDepoisDeComercial({ ...depois, excecoesDesligadas: 1 })).toEqual([]);
    expect(falhasDepoisDeComercial(antes)).toEqual(
      expect.arrayContaining([
        'migration_history',
        'table_tenant_access_periods',
        'column_tenants_access_legacy_since',
        'plan_names_or_codes_unexpected',
        'catalog_pf_ca_essencial_consumidores',
      ]),
    );
  });
});
