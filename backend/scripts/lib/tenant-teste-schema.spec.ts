// Conferência de TenantTestFlag no piloto, sem banco: nomes duplicados batem
// com a migration; o "antes" é o baseline 16; o "depois" reaproveita o
// baseline 16 sem exigir dezesseis migrations e é permanente. A leitura real
// roda contra PostgreSQL descartável em test/tenant-test-flag.db-e2e-spec.ts.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  TENANT_TEST_FLAG_AUDIT_ACTION,
  TenantTestFlag1793664000000,
} from '../../src/migrations/1793664000000-TenantTestFlag.js';
import {
  COLUNAS_QUE_ACEITAM_NULO,
  COLUNA_ITEM_ESPERADA,
  CONSTRAINTS_COMISSOES,
  INDICES_COMISSOES,
  LINHA_DO_CATALOGO,
  MIGRATIONS_ATE_COMISSOES,
  PLANOS_COM_COMISSOES,
  VALORES_COMISSOES,
  type EstadoComissoes,
} from './comissoes-profissionais-schema.js';
import {
  COLUNAS_DA_TABELA,
  COLUNA_ESCOPO_ESPERADA,
  CONSTRAINTS_REGRA_GERAL,
  INDICES_DA_TABELA,
  type EstadoRegraGeral,
} from './regra-geral-comissoes-schema.js';
import {
  COLUNA_IS_TEST,
  COLUNA_IS_TEST_ESPERADA,
  MIGRATIONS_ATE_REGRA_GERAL,
  MIGRATIONS_ATE_TENANT_TESTE,
  MIGRATION_TENANT_TESTE,
  TOTAL_OBJETOS_TENANT_TESTE,
  VALOR_AUDITORIA,
  descreverMarcados,
  falhasAntesDoTenantTeste,
  falhasDepoisDoTenantTeste,
  objetosTenantTestePresentes,
  type EstadoTenantTeste,
} from './tenant-teste-schema.js';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/migrations');

/** O estado 15 válido, como a conferência da 15 o lê (o mesmo do spec da 16). */
const baseline15: EstadoComissoes = {
  migrationNames: [...MIGRATIONS_ATE_COMISSOES],
  falhasDosNomesCongelados: [],
  valores: [...VALORES_COMISSOES],
  colunaItem: COLUNA_ITEM_ESPERADA,
  colunasAnulaveis: [...COLUNAS_QUE_ACEITAM_NULO],
  constraints: CONSTRAINTS_COMISSOES.map(([n, t]) => `${n}:${t}`),
  indices: Object.fromEntries(Object.entries(INDICES_COMISSOES).map(([n, d]) => [n, d.depois])),
  linhaDoCatalogo: `${LINHA_DO_CATALOGO.id}:${LINHA_DO_CATALOGO.planId}:${LINHA_DO_CATALOGO.featureId}`,
  linhasProComComissoes: 1,
  planosComComissoes: [...PLANOS_COM_COMISSOES.depois],
  recursoExiste: true,
  planoProExiste: true,
};

/** Estado 16 válido, com o histórico informado (a conferência da 15 e a da
 * 16 leem o histórico inteiro do banco). */
function baseline16(migrationNames: readonly string[]): EstadoRegraGeral {
  return {
    migrationNames: [...migrationNames],
    comissoes: { ...baseline15, migrationNames: [...migrationNames] },
    tabelaExiste: true,
    colunasDaTabela: [...COLUNAS_DA_TABELA],
    colunaEscopo: COLUNA_ESCOPO_ESPERADA,
    constraints: Object.fromEntries(
      Object.entries(CONSTRAINTS_REGRA_GERAL).map(([n, { tipo, definicao }]) => [n, `${tipo}|${definicao}`]),
    ),
    indicesDaTabela: [...INDICES_DA_TABELA],
    gatilhosDaTabela: 0,
  };
}


const antes: EstadoTenantTeste = {
  migrationNames: [...MIGRATIONS_ATE_REGRA_GERAL],
  regraGeral: baseline16(MIGRATIONS_ATE_REGRA_GERAL),
  colunaIsTest: null,
  valorDeAuditoria: false,
  marcadosComoTeste: null,
  estabelecimentos: 4,
};

const depois: EstadoTenantTeste = {
  migrationNames: [...MIGRATIONS_ATE_TENANT_TESTE],
  regraGeral: baseline16(MIGRATIONS_ATE_TENANT_TESTE),
  colunaIsTest: COLUNA_IS_TEST_ESPERADA,
  valorDeAuditoria: true,
  marcadosComoTeste: 0,
  estabelecimentos: 4,
};

describe('nomes derivados da migration', () => {
  const inteiro = readFileSync(path.join(MIGRATIONS, '1793664000000-TenantTestFlag.ts'), 'utf8').replace(/\r\n/g, '\n');
  const up = inteiro.slice(inteiro.indexOf('public async up'), inteiro.indexOf('public async down'));

  it('migration, coluna e valor de auditoria', () => {
    expect(MIGRATION_TENANT_TESTE).toBe(new TenantTestFlag1793664000000().name);
    expect(VALOR_AUDITORIA).toBe(TENANT_TEST_FLAG_AUDIT_ACTION);
    expect(up).toContain(`ALTER TABLE ${COLUNA_IS_TEST[0]} ADD COLUMN ${COLUNA_IS_TEST[1]} boolean NOT NULL DEFAULT false`);
    expect(up.match(/ADD COLUMN/g)).toHaveLength(1);
    expect(up).not.toMatch(/\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b|\bDROP\b/);
  });

  it('o histórico até a 17ª é exatamente o das migrations do repositório, na ordem', () => {
    const nomes = readdirSync(MIGRATIONS)
      .filter((n) => /^\d+-[A-Za-z]+\.ts$/.test(n))
      .sort()
      .map((n) => {
        const m = /^(\d+)-([A-Za-z]+)\.ts$/.exec(n);
        return m ? `${m[2]}${m[1]}` : n;
      });
    expect(nomes.slice(0, nomes.indexOf(MIGRATION_TENANT_TESTE) + 1)).toEqual([...MIGRATIONS_ATE_TENANT_TESTE]);
    expect(MIGRATIONS_ATE_TENANT_TESTE).toHaveLength(17);
  });
});

describe('falhas dos dois estados', () => {
  it('antes: dezesseis migrations exatas e nada da 17', () => {
    expect(falhasAntesDoTenantTeste(antes)).toEqual([]);
    expect(objetosTenantTestePresentes(antes)).toBe(0);
    expect(falhasAntesDoTenantTeste({ ...antes, colunaIsTest: COLUNA_IS_TEST_ESPERADA })).toEqual([
      'is_test_column_already_exists',
    ]);
    expect(falhasAntesDoTenantTeste(depois)).toEqual(['migration_history', 'is_test_column_already_exists']);
  });

  it('depois: dezessete migrations, coluna com a definição exata e valor de auditoria', () => {
    expect(falhasDepoisDoTenantTeste(depois)).toEqual([]);
    expect(objetosTenantTestePresentes(depois)).toBe(TOTAL_OBJETOS_TENANT_TESTE);
    expect(falhasDepoisDoTenantTeste(antes)).toEqual([
      'migration_history',
      'column_tenants_is_test',
      'audit_action_TENANT_TEST_FLAG_CHANGED',
    ]);
    expect(falhasDepoisDoTenantTeste({ ...depois, colunaIsTest: 'boolean:f:false' })).toEqual([
      'column_tenants_is_test_definition',
    ]);
  });

  it('depois é permanente: estabelecimentos marcados como teste não são falha', () => {
    expect(falhasDepoisDoTenantTeste({ ...depois, marcadosComoTeste: 3 })).toEqual([]);
  });

  it('um objeto da 16 fora do lugar é falha do baseline, com o nome da conferência da 16', () => {
    const quebrado = { ...depois, regraGeral: { ...depois.regraGeral, tabelaExiste: false } };
    expect(falhasDepoisDoTenantTeste(quebrado)).toContain('baseline16_table_professional_commission_settings');
  });

  it('a saída lembra que o padrão não classifica testes antigos', () => {
    expect(descreverMarcados(antes)).toContain('MARCADOS_COMO_TESTE: coluna ainda não existe');
    expect(descreverMarcados(depois).join('\n')).toMatch(/default false não identifica testes antigos/);
  });
});
