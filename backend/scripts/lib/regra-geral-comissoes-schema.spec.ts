// Conferência de ProfessionalCommissionSettings no piloto, sem banco: os nomes
// duplicados batem com a migration; o "antes" é o baseline 15 inteiro; o
// "depois" reaproveita o baseline 15 sem exigir quinze migrations e é
// permanente; as invariantes da transição ficam à parte. A leitura real roda
// contra PostgreSQL descartável em
// test/pilot-regra-geral-comissoes-check.db-e2e-spec.ts.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COMMISSION_SETTINGS_TABLE,
  ProfessionalCommissionSettings1793577600000,
} from '../../src/migrations/1793577600000-ProfessionalCommissionSettings.js';
import {
  COLUNAS_QUE_ACEITAM_NULO,
  COLUNA_ITEM_ESPERADA,
  CONSTRAINTS_COMISSOES,
  INDICES_COMISSOES,
  LINHA_DO_CATALOGO,
  PLANOS_COM_COMISSOES,
  VALORES_COMISSOES,
  falhasDepoisDeComissoes,
  type EstadoComissoes,
} from './comissoes-profissionais-schema.js';
import {
  COLUNAS_DA_TABELA,
  COLUNA_ESCOPO,
  COLUNA_ESCOPO_ESPERADA,
  CONSTRAINTS_REGRA_GERAL,
  INDICES_DA_TABELA,
  MIGRATIONS_ATE_COMISSOES,
  MIGRATIONS_ATE_REGRA_GERAL,
  MIGRATION_REGRA_GERAL,
  TABELA_CONFIGURACOES,
  TOTAL_OBJETOS_REGRA_GERAL,
  descreverJanela,
  falhasAntesDaRegraGeral,
  falhasDaTransicao,
  falhasDepoisDaRegraGeral,
  janelaViolada,
  objetosRegraGeralPresentes,
  type EstadoRegraGeral,
} from './regra-geral-comissoes-schema.js';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/migrations');

/** O estado 15 válido, como a conferência da 15 o lê. */
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

const antes: EstadoRegraGeral = {
  migrationNames: [...MIGRATIONS_ATE_COMISSOES],
  comissoes: baseline15,
  tabelaExiste: false,
  colunasDaTabela: [],
  colunaEscopo: null,
  constraints: {},
  indicesDaTabela: [],
  gatilhosDaTabela: 0,
};

const depois: EstadoRegraGeral = {
  migrationNames: [...MIGRATIONS_ATE_REGRA_GERAL],
  comissoes: { ...baseline15, migrationNames: [...MIGRATIONS_ATE_REGRA_GERAL] },
  tabelaExiste: true,
  colunasDaTabela: [...COLUNAS_DA_TABELA],
  colunaEscopo: COLUNA_ESCOPO_ESPERADA,
  constraints: Object.fromEntries(Object.entries(CONSTRAINTS_REGRA_GERAL).map(([n, { tipo, definicao }]) => [n, `${tipo}|${definicao}`])),
  indicesDaTabela: [...INDICES_DA_TABELA],
  gatilhosDaTabela: 0,
};

describe('nomes derivados da migration', () => {
  const inteiro = readFileSync(path.join(MIGRATIONS, '1793577600000-ProfessionalCommissionSettings.ts'), 'utf8').replace(/\r\n/g, '\n');
  const up = inteiro.slice(inteiro.indexOf('public async up'), inteiro.indexOf('public async down'));

  it('migration e tabela', () => {
    expect(MIGRATION_REGRA_GERAL).toBe(new ProfessionalCommissionSettings1793577600000().name);
    expect(TABELA_CONFIGURACOES).toBe(COMMISSION_SETTINGS_TABLE);
  });

  it('colunas, constraints e coluna nova aparecem no up(), e nenhuma outra', () => {
    expect(up).toContain(`CREATE TABLE ${TABELA_CONFIGURACOES} (`);
    expect(up.match(/CREATE TABLE \w+/g)).toEqual([`CREATE TABLE ${TABELA_CONFIGURACOES}`]);
    for (const coluna of COLUNAS_DA_TABELA) expect(up).toMatch(new RegExp(`\\n\\s+${coluna.split(':')[0]} `));
    for (const nome of Object.keys(CONSTRAINTS_REGRA_GERAL)) expect(up).toMatch(new RegExp(`CONSTRAINT ${nome}\\s`));
    expect(up.match(/CONSTRAINT \w+/g)).toHaveLength(Object.keys(CONSTRAINTS_REGRA_GERAL).length);
    expect(up).toContain(`ALTER TABLE ${COLUNA_ESCOPO[0]} ADD COLUMN ${COLUNA_ESCOPO[1]} varchar(10) NULL`);
    expect(up.match(/ADD COLUMN/g)).toHaveLength(1);
    // Só estrutura: nenhum dado, nenhum índice extra, nada removido.
    expect(up).not.toMatch(/\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b|\bCREATE (UNIQUE )?INDEX\b|\bDROP\b/);
  });

  it('o histórico até a 16ª é exatamente o das migrations do repositório, na ordem', () => {
    const nomes = readdirSync(MIGRATIONS)
      .filter((n) => /^\d+-[A-Za-z]+\.ts$/.test(n))
      .sort()
      .map((n) => {
        const [, carimbo, nome] = /^(\d+)-([A-Za-z]+)\.ts$/.exec(n)!;
        return `${nome}${carimbo}`;
      });
    expect(nomes.slice(0, nomes.indexOf(MIGRATION_REGRA_GERAL) + 1)).toEqual([...MIGRATIONS_ATE_REGRA_GERAL]);
    expect(MIGRATIONS_ATE_REGRA_GERAL).toHaveLength(16);
  });
});

describe('falhas dos dois estados', () => {
  it('antes: quinze migrations exatas, o baseline 15 inteiro e nada da 16', () => {
    expect(falhasAntesDaRegraGeral(antes)).toEqual([]);
    expect(objetosRegraGeralPresentes(antes)).toBe(0);
    expect(falhasAntesDaRegraGeral({ ...antes, migrationNames: antes.migrationNames.slice(0, -1) })).toEqual(['migration_history']);
    // Um objeto da 15 fora do lugar é falha do baseline, com o nome da conferência da 15.
    expect(falhasAntesDaRegraGeral({ ...antes, comissoes: { ...baseline15, valores: VALORES_COMISSOES.slice(1) } })).toEqual([
      'baseline15_enum_audit_action.COMMISSION_RULE_CHANGED',
    ]);
    // Objeto parcial da 16: não é "antes".
    expect(falhasAntesDaRegraGeral({ ...antes, colunaEscopo: COLUNA_ESCOPO_ESPERADA })).toEqual(['rule_scope_column_already_exists']);
    expect(falhasAntesDaRegraGeral({ ...antes, tabelaExiste: true })).toEqual(['settings_table_already_exists']);
    expect(falhasAntesDaRegraGeral(depois)).toEqual([
      'migration_history',
      'settings_table_already_exists',
      'rule_scope_column_already_exists',
      'settings_constraints_already_exist',
    ]);
  });

  it('depois: dezesseis migrations, o baseline 15 sem exigir o histórico de quinze, cada objeto com a definição exata', () => {
    expect(falhasDepoisDaRegraGeral(depois)).toEqual([]);
    expect(objetosRegraGeralPresentes(depois)).toBe(TOTAL_OBJETOS_REGRA_GERAL);
    expect(TOTAL_OBJETOS_REGRA_GERAL).toBe(7);
    // A conferência da 15, sozinha, recusaria este histórico; aqui ela é reaproveitada.
    expect(falhasDepoisDeComissoes(depois.comissoes)).toEqual(['migration_history']);
    expect(falhasDepoisDaRegraGeral({ ...depois, comissoes: { ...depois.comissoes, colunaItem: null } })).toEqual([
      'baseline15_column_commission_entries_appointment_item_id',
    ]);
    expect(falhasDepoisDaRegraGeral({ ...depois, migrationNames: [...MIGRATIONS_ATE_COMISSOES] })).toEqual(['migration_history']);
    expect(falhasDepoisDaRegraGeral({ ...depois, migrationNames: [...MIGRATIONS_ATE_REGRA_GERAL, 'Outra1799999999999'] })).toEqual([
      'migration_history',
    ]);
    expect(falhasDepoisDaRegraGeral({ ...depois, colunaEscopo: 'character varying(10):t:sem_padrao' })).toEqual([
      'column_commission_entries_applied_rule_scope_definition',
    ]);
    expect(falhasDepoisDaRegraGeral({ ...depois, colunasDaTabela: COLUNAS_DA_TABELA.slice(0, -1) })).toEqual([
      `table_${TABELA_CONFIGURACOES}_columns`,
    ]);
    expect(falhasDepoisDaRegraGeral({ ...depois, indicesDaTabela: [...INDICES_DA_TABELA, 'idx_extra'] })).toEqual([
      `table_${TABELA_CONFIGURACOES}_indexes`,
    ]);
    expect(falhasDepoisDaRegraGeral({ ...depois, gatilhosDaTabela: 1 })).toEqual([`table_${TABELA_CONFIGURACOES}_triggers`]);
    // A definição conta, não só o nome: uma faixa diferente na check é falha.
    const faixa = 'ck_professional_commission_settings_default_range';
    expect(
      falhasDepoisDaRegraGeral({ ...depois, constraints: { ...depois.constraints, [faixa]: 'c|CHECK ((default_value >= 0))' } }),
    ).toEqual([`${faixa}_definition`]);
    const { pk_professional_commission_settings: _semPk, ...semPk } = depois.constraints;
    expect(falhasDepoisDaRegraGeral({ ...depois, constraints: semPk })).toEqual(['pk_professional_commission_settings']);
  });

  it('um estado passa em exatamente uma conferência', () => {
    expect([falhasAntesDaRegraGeral(antes), falhasDepoisDaRegraGeral(antes)].map((f) => f.length === 0)).toEqual([true, false]);
    expect([falhasAntesDaRegraGeral(depois), falhasDepoisDaRegraGeral(depois)].map((f) => f.length === 0)).toEqual([false, true]);
  });
});

describe('transição e janela', () => {
  it('as invariantes da transição são conferidas à parte: dados novos não mudam o estado "depois"', () => {
    expect(falhasDaTransicao({ configuracoes: 0, apuracoesComEscopo: 0 })).toEqual([]);
    expect(falhasDaTransicao({ configuracoes: 3, apuracoesComEscopo: 1 })).toEqual([
      'settings_rows_right_after_migration',
      'scoped_entries_right_after_migration',
    ]);
    // O estado "depois" não tem campo de dados: um banco em uso continua "depois".
    expect(Object.keys(depois)).not.toContain('configuracoes');
  });

  it('janela violada só pelo que a API anterior criou ou apurou; desligados da API nova são esperados', () => {
    const limpo = { profissionaisCriados: 2, profissionaisSemConfiguracao: 0, profissionaisDesligados: 2, apuracoes: 5, apuracoesDaApiAnterior: 0 };
    expect(janelaViolada(limpo)).toBe(false);
    expect(descreverJanela(limpo).at(-1)).toMatch(/^JANELA_DE_TRANSICAO: ok/);
    expect(janelaViolada({ ...limpo, profissionaisSemConfiguracao: 1 })).toBe(true);
    expect(janelaViolada({ ...limpo, apuracoesDaApiAnterior: 1 })).toBe(true);
    expect(descreverJanela({ ...limpo, apuracoesDaApiAnterior: 1 }).at(-1)).toMatch(/^JANELA_DE_TRANSICAO: VIOLADA/);
  });
});
