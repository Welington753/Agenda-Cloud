// Conferência de PlatformPortal e AppointmentServiceSnapshots no piloto, sem
// banco: os nomes duplicados batem com as migrations, e as falhas dos três
// estados saem dos estados certos. A leitura real roda contra PostgreSQL
// descartável em test/pilot-portal-multisservicos-check.db-e2e-spec.ts.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PORTAL_AUDIT_ACTIONS, PlatformPortal1793318400000 } from '../../src/migrations/1793318400000-PlatformPortal.js';
import { AppointmentServiceSnapshots1793404800000 } from '../../src/migrations/1793404800000-AppointmentServiceSnapshots.js';
import {
  COLUNA_NOME_CONGELADO,
  COLUNA_ORIGEM_DO_VALOR,
  CONSTRAINTS_PORTAL,
  INDICES_PORTAL,
  MIGRATIONS_ATE_COMERCIAL,
  MIGRATIONS_ATE_NOMES_CONGELADOS,
  MIGRATIONS_ATE_PORTAL,
  MIGRATION_NOMES_CONGELADOS,
  MIGRATION_PORTAL,
  TABELAS_PORTAL,
  TOTAL_OBJETOS_PORTAL_MULTISSERVICOS,
  VALORES_PORTAL,
  falhasAntesDoPortal,
  falhasDepoisDoPortal,
  falhasDepoisDosNomesCongelados,
  objetosPortalMultisservicosPresentes,
  type EstadoPortalMultisservicos,
} from './portal-multisservicos-schema.js';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/migrations');
const COLUNA_NOVA = 'character varying:YES:sem_padrao';

const antes: EstadoPortalMultisservicos = {
  migrationNames: [...MIGRATIONS_ATE_COMERCIAL],
  falhasDoComercial: [],
  valores: [],
  tabelas: {},
  constraints: [],
  indices: [],
  colunaOrigem: null,
  colunaNomeCongelado: null,
};

const intermediario: EstadoPortalMultisservicos = {
  ...antes,
  migrationNames: [...MIGRATIONS_ATE_PORTAL],
  valores: [...VALORES_PORTAL],
  tabelas: Object.fromEntries(Object.entries(TABELAS_PORTAL).map(([t, c]) => [t, [...c].reverse()])),
  constraints: CONSTRAINTS_PORTAL.map(([n, t]) => `${n}:${t}`),
  indices: [...INDICES_PORTAL],
  colunaOrigem: COLUNA_NOVA,
};

const final: EstadoPortalMultisservicos = {
  ...intermediario,
  migrationNames: [...MIGRATIONS_ATE_NOMES_CONGELADOS],
  colunaNomeCongelado: COLUNA_NOVA,
};

describe('nomes derivados das migrations', () => {
  it('migrations e valores de auditoria', () => {
    expect(MIGRATION_PORTAL).toBe(new PlatformPortal1793318400000().name);
    expect(MIGRATION_NOMES_CONGELADOS).toBe(new AppointmentServiceSnapshots1793404800000().name);
    expect(VALORES_PORTAL).toEqual(PORTAL_AUDIT_ACTIONS.map((a) => `audit_action.${a}`));
  });

  it('tabelas, colunas, constraints e índices aparecem no texto da migration do portal', () => {
    // Só o `up()`: o `down()` repete nomes ao apagar.
    const inteiro = readFileSync(path.join(MIGRATIONS, '1793318400000-PlatformPortal.ts'), 'utf8');
    const texto = inteiro.slice(0, inteiro.indexOf('public async down'));
    for (const [tabela, colunas] of Object.entries(TABELAS_PORTAL)) {
      expect(texto).toContain(`CREATE TABLE ${tabela} (`);
      const bloco = texto.slice(texto.indexOf(`CREATE TABLE ${tabela} (`));
      for (const coluna of colunas) expect(bloco).toMatch(new RegExp(`\\n\\s+${coluna} `));
    }
    // Nenhuma tabela nova além das três.
    expect(texto.match(/CREATE TABLE \w+/g)).toHaveLength(Object.keys(TABELAS_PORTAL).length);
    for (const [nome] of CONSTRAINTS_PORTAL) expect(texto).toContain(nome);
    expect(texto.match(/CONSTRAINT \w+/g)).toHaveLength(CONSTRAINTS_PORTAL.length);
    for (const nome of INDICES_PORTAL) expect(texto).toContain(nome);
    expect(texto.match(/CREATE (UNIQUE )?INDEX \w+/g)).toHaveLength(INDICES_PORTAL.length);
    expect(texto).toContain(`ALTER TABLE ${COLUNA_ORIGEM_DO_VALOR[0]} ADD COLUMN ${COLUNA_ORIGEM_DO_VALOR[1]} varchar(10) NULL`);
  });

  it('a coluna nova dos itens aparece no texto da migration dos nomes congelados, anulável e sem padrão', () => {
    const texto = readFileSync(path.join(MIGRATIONS, '1793404800000-AppointmentServiceSnapshots.ts'), 'utf8');
    expect(texto).toContain(`ALTER TABLE ${COLUNA_NOME_CONGELADO[0]} ADD COLUMN ${COLUNA_NOME_CONGELADO[1]} varchar NULL`);
    expect(texto.match(/queryRunner\.query/g)).toHaveLength(2);
  });

  it('o histórico até a 14ª é exatamente o das migrations do repositório, na ordem: 12, 13 e 14', () => {
    const nomes = readdirSync(MIGRATIONS)
      .filter((n) => /^\d+-[A-Za-z]+\.ts$/.test(n))
      .sort()
      .map((n) => {
        const [, carimbo, nome] = /^(\d+)-([A-Za-z]+)\.ts$/.exec(n)!;
        return `${nome}${carimbo}`;
      });
    // Migrations posteriores (ProfessionalCommissions em diante) não entram na
    // conferência deste lote.
    expect(nomes.slice(0, nomes.indexOf(MIGRATION_NOMES_CONGELADOS) + 1)).toEqual([...MIGRATIONS_ATE_NOMES_CONGELADOS]);
    expect(MIGRATIONS_ATE_COMERCIAL).toHaveLength(12);
    expect(MIGRATIONS_ATE_PORTAL).toHaveLength(13);
    expect(MIGRATIONS_ATE_NOMES_CONGELADOS).toHaveLength(14);
    expect(MIGRATIONS_ATE_COMERCIAL.at(-1)).toBe('CommercialAccess1793232000000');
  });
});

describe('falhas dos três estados', () => {
  it('antes: doze migrations exatas, comercial íntegro, nada novo', () => {
    expect(falhasAntesDoPortal(antes)).toEqual([]);
    expect(objetosPortalMultisservicosPresentes(antes)).toBe(0);
    expect(falhasAntesDoPortal({ ...antes, migrationNames: antes.migrationNames.slice(0, -1) })).toEqual(['migration_history']);
    // Mesmo número de migrations, ordem ou nome diferente: recusa.
    const trocado = [...antes.migrationNames];
    [trocado[10], trocado[11]] = [trocado[11]!, trocado[10]!];
    expect(falhasAntesDoPortal({ ...antes, migrationNames: trocado })).toEqual(['migration_history']);
    expect(falhasAntesDoPortal({ ...antes, falhasDoComercial: ['table_tenant_access_periods'] })).toEqual([
      'commercial_table_tenant_access_periods',
    ]);
    expect(falhasAntesDoPortal({ ...antes, colunaNomeCongelado: COLUNA_NOVA })).toEqual(['service_name_snapshot_column_already_exists']);
    expect(falhasAntesDoPortal(intermediario)).toEqual([
      'migration_history',
      'portal_enum_values_already_exist',
      'portal_tables_already_exist',
      'portal_objects_already_exist',
      'amount_source_column_already_exists',
    ]);
  });

  it('intermediário: treze migrations, portal completo, nome congelado ainda ausente', () => {
    expect(falhasDepoisDoPortal(intermediario)).toEqual([]);
    expect(objetosPortalMultisservicosPresentes(intermediario)).toBe(TOTAL_OBJETOS_PORTAL_MULTISSERVICOS - 1);
    expect(falhasDepoisDoPortal(final)).toEqual(['migration_history', 'service_name_snapshot_column_already_exists']);
    expect(falhasDepoisDoPortal(antes)).toEqual(
      expect.arrayContaining(['migration_history', 'table_plan_prices', 'uq_tenant_no_expiry_grants_active', 'column_tenant_access_periods_amount_source']),
    );
    const semColuna = { ...intermediario, tabelas: { ...intermediario.tabelas, plan_prices: TABELAS_PORTAL.plan_prices!.slice(1) } };
    expect(falhasDepoisDoPortal(semColuna)).toEqual(['plan_prices_columns']);
    expect(falhasDepoisDoPortal({ ...intermediario, colunaOrigem: 'character varying:NO:sem_padrao' })).toEqual([
      'column_tenant_access_periods_amount_source_definition',
    ]);
    expect(falhasDepoisDoPortal({ ...intermediario, valores: VALORES_PORTAL.slice(1) })).toEqual(['enum_audit_action.PLAN_PRICE_CHANGED']);
  });

  it('final: catorze migrations e tudo presente', () => {
    expect(falhasDepoisDosNomesCongelados(final)).toEqual([]);
    expect(objetosPortalMultisservicosPresentes(final)).toBe(TOTAL_OBJETOS_PORTAL_MULTISSERVICOS);
    expect(falhasDepoisDosNomesCongelados(intermediario)).toEqual(['migration_history', 'column_appointment_items_service_name_snapshot']);
    expect(falhasDepoisDosNomesCongelados({ ...final, colunaNomeCongelado: "character varying:YES:'x'::character varying" })).toEqual([
      'column_appointment_items_service_name_snapshot_definition',
    ]);
  });

  it('um estado passa em exatamente uma conferência', () => {
    const conferencias = [falhasAntesDoPortal, falhasDepoisDoPortal, falhasDepoisDosNomesCongelados];
    for (const [i, estado] of [antes, intermediario, final].entries()) {
      expect(conferencias.map((f) => f(estado).length === 0)).toEqual([0, 1, 2].map((j) => j === i));
    }
  });
});
