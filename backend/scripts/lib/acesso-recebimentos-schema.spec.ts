// Regras puras da conferência de StaffLogin + AppointmentPayments. O schema
// real é conferido contra o PostgreSQL descartável no ensaio do runbook
// (docs/runbooks/publicacao-acesso-recebimentos-piloto.md).
import { describe, expect, it } from 'vitest';
import {
  COLUNAS_ACESSO_RECEBIMENTOS,
  CONSTRAINTS_ACESSO_RECEBIMENTOS,
  INDICES_ACESSO_RECEBIMENTOS,
  MIGRATIONS_ACESSO_RECEBIMENTOS,
  MIGRATIONS_ATE_EQUIPE,
  PUBLICACAO_ACESSO_RECEBIMENTOS,
  TABELAS_ACESSO_RECEBIMENTOS,
  TOTAL_OBJETOS_ACESSO_RECEBIMENTOS,
  VALORES_ACESSO_RECEBIMENTOS,
  falhasAntesDeAcessoRecebimentos,
  falhasDepoisDeAcessoRecebimentos,
  lerDadosNovos,
  objetosAcessoRecebimentosPresentes,
  type EstadoAcessoRecebimentos,
} from './acesso-recebimentos-schema.js';
import type { PgClientLike } from './pg-client.js';

const antes: EstadoAcessoRecebimentos = {
  migrationNames: [...MIGRATIONS_ATE_EQUIPE],
  colunas: [],
  tabelas: [],
  constraints: [],
  indices: [],
  valores: [],
  emailObrigatorio: true,
};

const depois: EstadoAcessoRecebimentos = {
  migrationNames: [...MIGRATIONS_ATE_EQUIPE, ...MIGRATIONS_ACESSO_RECEBIMENTOS],
  colunas: COLUNAS_ACESSO_RECEBIMENTOS.map(([t, c]) => `${t}.${c}`),
  tabelas: [...TABELAS_ACESSO_RECEBIMENTOS],
  constraints: [...CONSTRAINTS_ACESSO_RECEBIMENTOS],
  indices: [...INDICES_ACESSO_RECEBIMENTOS],
  valores: [...VALORES_ACESSO_RECEBIMENTOS],
  emailObrigatorio: false,
};

describe('falhasAntesDeAcessoRecebimentos', () => {
  it('aceita as oito migrations até TeamAccess sem nenhum objeto novo', () => {
    expect(MIGRATIONS_ATE_EQUIPE).toHaveLength(8);
    expect(MIGRATIONS_ATE_EQUIPE.at(-1)).toBe('TeamAccess1792886400000');
    expect(falhasAntesDeAcessoRecebimentos(antes)).toEqual([]);
  });

  it('valores de enum já presentes não são falha (ADD VALUE IF NOT EXISTS)', () => {
    expect(falhasAntesDeAcessoRecebimentos({ ...antes, valores: [...VALORES_ACESSO_RECEBIMENTOS] })).toEqual([]);
  });

  it.each([
    ['só sete migrations (TeamAccess ausente)', { migrationNames: MIGRATIONS_ATE_EQUIPE.slice(0, 7) }, 'migration_history'],
    ['StaffLogin já aplicada', { migrationNames: [...MIGRATIONS_ATE_EQUIPE, MIGRATIONS_ACESSO_RECEBIMENTOS[0]] }, 'migration_history'],
    ['coluna nova presente', { colunas: ['users.username'] }, 'new_columns_already_exist'],
    ['tabela nova presente', { tabelas: ['appointment_payments'] }, 'new_tables_already_exist'],
    ['constraint nova presente', { constraints: ['ck_users_login_identifier'] }, 'new_constraints_already_exist'],
    ['índice novo presente', { indices: ['uq_users_username'] }, 'new_indexes_already_exist'],
    ['e-mail já opcional', { emailObrigatorio: false }, 'users_email_already_optional'],
  ])('recusa %s', (_caso, mudanca, falha) => {
    expect(falhasAntesDeAcessoRecebimentos({ ...antes, ...mudanca })).toContain(falha);
  });
});

describe('falhasDepoisDeAcessoRecebimentos', () => {
  it('aceita as dez migrations com todos os objetos', () => {
    expect(falhasDepoisDeAcessoRecebimentos(depois)).toEqual([]);
    expect(objetosAcessoRecebimentosPresentes(depois)).toBe(TOTAL_OBJETOS_ACESSO_RECEBIMENTOS);
  });

  it.each([
    ['só StaffLogin (estado intermediário)', { migrationNames: [...MIGRATIONS_ATE_EQUIPE, MIGRATIONS_ACESSO_RECEBIMENTOS[0]], tabelas: ['staff_account_requests'] }, ['migration_history', 'table_appointment_payments']],
    ['ordem trocada', { migrationNames: [...MIGRATIONS_ATE_EQUIPE, ...[...MIGRATIONS_ACESSO_RECEBIMENTOS].reverse()] }, ['migration_history']],
    ['coluna ausente', { colunas: ['users.username'] }, ['column_users_must_change_password']],
    ['índice parcial ausente', { indices: INDICES_ACESSO_RECEBIMENTOS.filter((i) => i !== 'uq_appointment_payments_active') }, ['uq_appointment_payments_active']],
    ['valor de enum ausente', { valores: VALORES_ACESSO_RECEBIMENTOS.slice(1) }, ['enum_audit_action.STAFF_ACCESS_CREATED']],
    ['e-mail ainda obrigatório', { emailObrigatorio: true }, ['users_email_still_required']],
  ])('recusa %s', (_caso, mudanca, falhas) => {
    expect(falhasDepoisDeAcessoRecebimentos({ ...depois, ...mudanca })).toEqual(expect.arrayContaining(falhas));
  });
});

/** Cliente falso: responde às consultas de metadados com `estado` e guarda o
 * SQL das contagens para conferir que nada lê tabela ausente. */
function clienteFalso(estado: EstadoAcessoRecebimentos) {
  const consultas: string[] = [];
  const client: PgClientLike = {
    connect: async () => {},
    end: async () => {},
    async query<T>(sql: string) {
      consultas.push(sql);
      const linhas = (rows: unknown[]) => ({ rows: rows as T[] });
      if (/^(BEGIN|ROLLBACK)/.test(sql)) return linhas([]);
      if (sql.includes('typeorm_migrations')) return linhas(estado.migrationNames.map((name) => ({ name })));
      if (sql.includes('column_name AS nome')) return linhas(estado.colunas.map((nome) => ({ nome })));
      if (sql.includes('information_schema.tables')) return linhas(estado.tabelas.map((nome) => ({ nome })));
      if (sql.includes('pg_constraint')) return linhas(estado.constraints.map((conname) => ({ conname })));
      if (sql.includes('pg_indexes')) return linhas(estado.indices.map((indexname) => ({ indexname })));
      if (sql.includes('pg_enum')) return linhas(estado.valores.map((valor) => ({ valor })));
      if (sql.includes('is_nullable')) return linhas([{ nulo: estado.emailObrigatorio ? 'NO' : 'YES' }]);
      return linhas([
        {
          contasSemEmail: '0',
          contasComUsuario: '0',
          trocaDeSenhaPendente: '0',
          pedidosDeAcesso: '0',
          recebimentosAtivos: '0',
          recebimentosEstornados: '0',
        },
      ]);
    },
  };
  return { client, consultas };
}

describe('lerDadosNovos', () => {
  it('antes da migration não consulta coluna nem tabela que ainda não existe', async () => {
    const { client, consultas } = clienteFalso(antes);
    expect(await lerDadosNovos(client)).toEqual({
      contasSemEmail: 0,
      contasComUsuario: 0,
      trocaDeSenhaPendente: 0,
      pedidosDeAcesso: 0,
      recebimentosAtivos: 0,
      recebimentosEstornados: 0,
    });
    const contagem = consultas.find((sql) => sql.includes('contasSemEmail'))!;
    expect(contagem).not.toMatch(/username|must_change_password|staff_account_requests|appointment_payments/);
  });

  it('depois da migration conta cada dado novo', async () => {
    const { client, consultas } = clienteFalso(depois);
    await lerDadosNovos(client);
    const contagem = consultas.find((sql) => sql.includes('contasSemEmail'))!;
    for (const trecho of ['username IS NOT NULL', 'must_change_password', 'staff_account_requests', 'appointment_payments']) {
      expect(contagem).toContain(trecho);
    }
  });

  it('toda leitura abre e fecha uma transação só-leitura', async () => {
    const { client, consultas } = clienteFalso(depois);
    await PUBLICACAO_ACESSO_RECEBIMENTOS.reversao(client);
    expect(consultas.filter((sql) => sql === 'BEGIN TRANSACTION READ ONLY').length).toBe(
      consultas.filter((sql) => sql === 'ROLLBACK').length,
    );
    expect(consultas.some((sql) => /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i.test(sql))).toBe(false);
  });
});
