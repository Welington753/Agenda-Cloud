// Conferência de ProfessionalCommissions no piloto, sem banco: os nomes
// duplicados batem com a migration, e as falhas dos dois estados saem dos
// estados certos. A leitura real roda contra PostgreSQL descartável em
// test/pilot-comissoes-profissionais-check.db-e2e-spec.ts.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COMMISSION_AUDIT_ACTIONS,
  COMMISSION_PERMISSIONS,
  COMMISSION_PLAN_FEATURE_ADDITIONS,
  ProfessionalCommissions1793491200000,
} from '../../src/migrations/1793491200000-ProfessionalCommissions.js';
import {
  COLUNAS_QUE_ACEITAM_NULO,
  COLUNA_ITEM,
  COLUNA_ITEM_ESPERADA,
  CONSTRAINTS_COMISSOES,
  INDICES_COMISSOES,
  LINHA_DO_CATALOGO,
  MIGRATIONS_ATE_COMISSOES,
  MIGRATIONS_ATE_NOMES_CONGELADOS,
  MIGRATION_COMISSOES,
  PLANOS_COM_COMISSOES,
  TABELAS_DO_CATALOGO,
  TOTAL_OBJETOS_COMISSOES,
  VALORES_COMISSOES,
  catalogoAlterado,
  falhasAntesDeComissoes,
  falhasDepoisDeComissoes,
  objetosComissoesPresentes,
  type EstadoComissoes,
} from './comissoes-profissionais-schema.js';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/migrations');
const indicesDe = (momento: 'antes' | 'depois') =>
  Object.fromEntries(
    Object.entries(INDICES_COMISSOES)
      .map(([nome, defs]) => [nome, defs[momento]] as const)
      .filter((par): par is readonly [string, string] => par[1] !== null),
  );

const antes: EstadoComissoes = {
  migrationNames: [...MIGRATIONS_ATE_NOMES_CONGELADOS],
  falhasDosNomesCongelados: [],
  valores: [],
  colunaItem: null,
  colunasAnulaveis: [],
  constraints: [],
  indices: indicesDe('antes'),
  linhaDoCatalogo: null,
  linhasProComComissoes: 0,
  planosComComissoes: [...PLANOS_COM_COMISSOES.antes],
  recursoExiste: true,
  planoProExiste: true,
};

const depois: EstadoComissoes = {
  ...antes,
  migrationNames: [...MIGRATIONS_ATE_COMISSOES],
  valores: [...VALORES_COMISSOES].reverse(),
  colunaItem: COLUNA_ITEM_ESPERADA,
  colunasAnulaveis: [...COLUNAS_QUE_ACEITAM_NULO],
  constraints: CONSTRAINTS_COMISSOES.map(([n, t]) => `${n}:${t}`),
  indices: indicesDe('depois'),
  linhaDoCatalogo: `${LINHA_DO_CATALOGO.id}:${LINHA_DO_CATALOGO.planId}:${LINHA_DO_CATALOGO.featureId}`,
  linhasProComComissoes: 1,
  planosComComissoes: [...PLANOS_COM_COMISSOES.depois],
};

describe('nomes derivados da migration', () => {
  const inteiro = readFileSync(path.join(MIGRATIONS, '1793491200000-ProfessionalCommissions.ts'), 'utf8');
  // Só o `up()`: o `down()` repete nomes ao desfazer.
  const up = inteiro.slice(inteiro.indexOf('public async up'), inteiro.indexOf('public async down'));

  it('migration, valores de enum e linha do catálogo', () => {
    expect(MIGRATION_COMISSOES).toBe(new ProfessionalCommissions1793491200000().name);
    expect(VALORES_COMISSOES).toEqual([
      ...COMMISSION_AUDIT_ACTIONS.map((a) => `audit_action.${a}`),
      ...COMMISSION_PERMISSIONS.map((p) => `permission.${p}`),
    ]);
    expect(COMMISSION_PLAN_FEATURE_ADDITIONS).toEqual([LINHA_DO_CATALOGO]);
    expect(PLANOS_COM_COMISSOES.depois).toEqual([...PLANOS_COM_COMISSOES.antes, LINHA_DO_CATALOGO.planId].sort());
  });

  it('constraints, índices e colunas aparecem no up(), e nenhum outro', () => {
    for (const [nome, tipo] of CONSTRAINTS_COMISSOES) {
      const palavra = { u: 'UNIQUE', f: 'FOREIGN KEY', c: 'CHECK' }[tipo];
      expect(up).toMatch(new RegExp(`ADD CONSTRAINT ${nome}\\s+${palavra}`));
    }
    expect(up.match(/ADD CONSTRAINT \w+/g)).toHaveLength(CONSTRAINTS_COMISSOES.length);
    for (const nome of Object.keys(INDICES_COMISSOES)) expect(up).toMatch(new RegExp(`CREATE (UNIQUE )?INDEX ${nome} `));
    expect(up.match(/CREATE (UNIQUE )?INDEX \w+/g)).toHaveLength(Object.keys(INDICES_COMISSOES).length);
    // O único índice que já existia é o que é recriado como parcial.
    expect(up.match(/DROP INDEX \w+/g)).toEqual(['DROP INDEX uq_commission_entries_appointment_id']);
    expect(up).toContain(`ALTER TABLE ${COLUNA_ITEM[0]} ADD COLUMN ${COLUNA_ITEM[1]} varchar(30) NULL`);
    expect(up.match(/ADD COLUMN/g)).toHaveLength(1);
    for (const coluna of COLUNAS_QUE_ACEITAM_NULO) expect(up).toContain(`'${coluna}'`);
    expect(up).toContain('ALTER COLUMN ${coluna} DROP NOT NULL');
    // Dados: só o INSERT do catálogo; nenhum UPDATE ou DELETE.
    expect(up.match(/INSERT INTO \w+/g)).toEqual(['INSERT INTO plan_features']);
    expect(up).not.toMatch(/\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b/);
  });

  it('o histórico até a 15ª é exatamente o das migrations do repositório, na ordem', () => {
    const nomes = readdirSync(MIGRATIONS)
      .filter((n) => /^\d+-[A-Za-z]+\.ts$/.test(n))
      .sort()
      .map((n) => {
        const [, carimbo, nome] = /^(\d+)-([A-Za-z]+)\.ts$/.exec(n)!;
        return `${nome}${carimbo}`;
      });
    // Migrations posteriores não entram na conferência desta publicação.
    expect(nomes.slice(0, nomes.indexOf(MIGRATION_COMISSOES) + 1)).toEqual([...MIGRATIONS_ATE_COMISSOES]);
    expect(MIGRATIONS_ATE_NOMES_CONGELADOS).toHaveLength(14);
    expect(MIGRATIONS_ATE_COMISSOES).toHaveLength(15);
  });
});

describe('falhas dos dois estados', () => {
  it('antes: catorze migrations exatas, anteriores íntegras, nada novo, comissões só no Max', () => {
    expect(falhasAntesDeComissoes(antes)).toEqual([]);
    expect(objetosComissoesPresentes(antes)).toBe(0);
    expect(falhasAntesDeComissoes({ ...antes, migrationNames: antes.migrationNames.slice(0, -1) })).toEqual(['migration_history']);
    const trocado = [...antes.migrationNames];
    [trocado[12], trocado[13]] = [trocado[13]!, trocado[12]!];
    expect(falhasAntesDeComissoes({ ...antes, migrationNames: trocado })).toEqual(['migration_history']);
    expect(falhasAntesDeComissoes({ ...antes, falhasDosNomesCongelados: ['column_appointment_items_service_name_snapshot'] })).toEqual([
      'snapshots_column_appointment_items_service_name_snapshot',
    ]);
    // Um Pro que já tem o recurso (com outro id) mudaria o efeito previsto.
    expect(falhasAntesDeComissoes({ ...antes, linhasProComComissoes: 1, planosComComissoes: [...PLANOS_COM_COMISSOES.depois] })).toEqual([
      'pro_plan_already_has_commissions',
      'plans_with_commissions_unexpected',
    ]);
    expect(falhasAntesDeComissoes({ ...antes, planosComComissoes: [] })).toEqual(['plans_with_commissions_unexpected']);
    expect(falhasAntesDeComissoes({ ...antes, recursoExiste: false, planoProExiste: false })).toEqual([
      'feature_row_feat_comissoes',
      'plan_row_plan_equipe',
    ]);
    // Um `down` executado deixa os valores de enum: não volta a ser "antes".
    expect(falhasAntesDeComissoes({ ...antes, valores: [...VALORES_COMISSOES] })).toEqual(['commission_enum_values_already_exist']);
    expect(falhasAntesDeComissoes({ ...antes, indices: {} })).toEqual(['uq_commission_entries_appointment_id_definition']);
    expect(falhasAntesDeComissoes(depois)).toEqual([
      'migration_history',
      'commission_enum_values_already_exist',
      'appointment_item_column_already_exists',
      'commission_columns_already_nullable',
      'commission_constraints_already_exist',
      'uq_commission_entries_appointment_id_definition',
      'uq_commission_entries_appointment_item_id_already_exists',
      'idx_commission_entries_tenant_id_appointment_id_already_exists',
      'pro_plan_already_has_commissions',
      'plans_with_commissions_unexpected',
    ]);
  });

  it('depois: quinze migrations, cada objeto com a definição exata e só a linha nova do catálogo', () => {
    expect(falhasDepoisDeComissoes(depois)).toEqual([]);
    expect(objetosComissoesPresentes(depois)).toBe(TOTAL_OBJETOS_COMISSOES);
    expect(TOTAL_OBJETOS_COMISSOES).toBe(15);
    expect(falhasDepoisDeComissoes({ ...depois, colunaItem: 'character varying(30):NO:sem_padrao' })).toEqual([
      'column_commission_entries_appointment_item_id_definition',
    ]);
    expect(falhasDepoisDeComissoes({ ...depois, colunasAnulaveis: COLUNAS_QUE_ACEITAM_NULO.slice(1) })).toEqual([
      'column_price_cents_snapshot_not_nullable',
    ]);
    // Índice único sem o WHERE: linhas novas por item colidiriam por reserva.
    expect(
      falhasDepoisDeComissoes({ ...depois, indices: { ...depois.indices, uq_commission_entries_appointment_id: INDICES_COMISSOES.uq_commission_entries_appointment_id!.antes! } }),
    ).toEqual(['uq_commission_entries_appointment_id_definition']);
    expect(falhasDepoisDeComissoes({ ...depois, constraints: depois.constraints.slice(1) })).toEqual(['uq_appointment_items_tenant_id']);
    expect(falhasDepoisDeComissoes({ ...depois, linhaDoCatalogo: 'pf_pc_equipe_comissoes:plan_essencial:feat_comissoes' })).toEqual([
      'catalog_pf_pc_equipe_comissoes',
    ]);
    expect(falhasDepoisDeComissoes({ ...depois, planosComComissoes: ['plan_equipe', 'plan_essencial', 'plan_pro'] })).toEqual([
      'plans_with_commissions_unexpected',
    ]);
    expect(falhasDepoisDeComissoes({ ...depois, linhasProComComissoes: 2 })).toEqual(['pro_plan_commission_rows']);
    expect(falhasDepoisDeComissoes({ ...depois, valores: VALORES_COMISSOES.slice(1) })).toEqual(['enum_audit_action.COMMISSION_RULE_CHANGED']);
  });

  it('um estado passa em exatamente uma conferência', () => {
    expect([falhasAntesDeComissoes(antes), falhasDepoisDeComissoes(antes)].map((f) => f.length === 0)).toEqual([true, false]);
    expect([falhasAntesDeComissoes(depois), falhasDepoisDeComissoes(depois)].map((f) => f.length === 0)).toEqual([false, true]);
  });
});

describe('catalogoAlterado', () => {
  const somas = Object.fromEntries(TABELAS_DO_CATALOGO.map((t) => [t, `md5-${t}`]));
  it('lista só as tabelas do catálogo que mudaram; tabela ausente na referência conta como mudança', () => {
    expect(catalogoAlterado(somas, { ...somas })).toEqual([]);
    expect(catalogoAlterado(somas, { ...somas, plans: 'outro', tenant_feature_overrides: 'outro' })).toEqual(['plans', 'tenant_feature_overrides']);
    const { plan_prices: _semPrecos, ...semUma } = somas;
    expect(catalogoAlterado(semUma, somas)).toEqual(['plan_prices']);
    expect(TABELAS_DO_CATALOGO).toEqual(expect.arrayContaining(['plans', 'plan_features', 'tenant_feature_overrides', 'plan_prices', 'tenant_contract_prices']));
  });
});
