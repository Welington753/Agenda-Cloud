// A conferência só-leitura do piloto (scripts/lib/contas-administracao-schema.ts,
// scripts/lib/equipe-acessos-schema.ts e scripts/lib/acesso-recebimentos-schema.ts)
// rodada contra o PostgreSQL
// DESCARTÁVEL já migrado: prova que as consultas são válidas e que o banco
// migrado passa no estado "depois" de cada uma. O levantamento do limite do
// plano grava antes um estabelecimento próprio, com nomes únicos.
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { falhasDepoisDeContas, lerEstadoContas, objetosPresentes, TOTAL_OBJETOS_CONTAS } from '../scripts/lib/contas-administracao-schema.js';
import {
  MIGRATIONS_ATE_CONTAS,
  MIGRATION_EQUIPE,
  descreverExcessoDePlano,
  falhasAntesDeEquipe,
  lerExcessoDePlano,
  falhasDepoisDeEquipe,
  lerEstadoEquipe,
  objetosEquipePresentes,
  TOTAL_OBJETOS_EQUIPE,
} from '../scripts/lib/equipe-acessos-schema.js';
import {
  MIGRATIONS_ACESSO_RECEBIMENTOS,
  PUBLICACAO_ACESSO_RECEBIMENTOS,
  TOTAL_OBJETOS_ACESSO_RECEBIMENTOS,
  falhasAntesDeAcessoRecebimentos,
  falhasDepoisDeAcessoRecebimentos,
  lerDadosNovos,
  lerEstadoAcessoRecebimentos,
  objetosAcessoRecebimentosPresentes,
} from '../scripts/lib/acesso-recebimentos-schema.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}

describe.skipIf(!url)('conferências das migrations do piloto contra PostgreSQL descartável', () => {
  async function comCliente<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  }

  it('contas: as sete primeiras migrations e cada objeto de AccountsAdministration, sem escrever nada', async () => {
    const estado = await comCliente(lerEstadoContas);
    // O banco descartável já tem também as migrations seguintes (TeamAccess
    // e as do lote de operação diária): a conferência de contas vale para o
    // histórico até ela.
    expect(estado.migrationNames.slice(0, 8)).toEqual([...MIGRATIONS_ATE_CONTAS, MIGRATION_EQUIPE]);
    expect(falhasDepoisDeContas({ ...estado, migrationNames: [...MIGRATIONS_ATE_CONTAS] })).toEqual([]);
    expect(objetosPresentes(estado)).toBe(TOTAL_OBJETOS_CONTAS);
  });

  it('equipe: banco com as oito migrations passa no "depois" e é recusado no "antes"', async () => {
    const lido = await comCliente(lerEstadoEquipe);
    // As migrations posteriores (lote de operação diária) ficam fora desta
    // conferência, que é a do procedimento de TeamAccess.
    const estado = { ...lido, migrationNames: lido.migrationNames.slice(0, 8) };
    expect(falhasDepoisDeEquipe(estado)).toEqual([]);
    expect(objetosEquipePresentes(estado)).toBe(TOTAL_OBJETOS_EQUIPE);
    expect(falhasAntesDeEquipe(estado)).toEqual([
      'migration_history',
      'new_columns_already_exist',
      'new_constraints_already_exist',
      'new_indexes_already_exist',
    ]);
  });

  it('equipe: levantamento do limite do plano com a regra da aplicação, só leitura', async () => {
    // Estabelecimento próprio no plano essencial (2 profissionais): 3 ativos
    // e 1 inativo (não conta), 3 vínculos PROFISSIONAL, 1 deles suspenso (não
    // ocupa vaga), e um convite de funcionário pendente e outro vencido.
    const id = () => randomUUID().replaceAll('-', '').slice(0, 25);
    const tenant = id();
    const profissionais = [id(), id(), id(), id()];
    const pessoas = [id(), id(), id(), id()];
    const antes = await comCliente(lerExcessoDePlano);
    await comCliente(async (client) => {
      await client.query(
        `INSERT INTO tenants (id, slug, category, timezone, plan_id, status)
         VALUES ($1, $2, 'OTHER', 'America/Sao_Paulo', 'plan_essencial', 'ACTIVE')`,
        [tenant, `limite-${tenant}`],
      );
      for (const [i, p] of profissionais.entries()) {
        await client.query(
          `INSERT INTO professionals (id, tenant_id, name, avatar_initials, avatar_color, active)
           VALUES ($1, $2, $3, 'PL', '#000000', $4)`,
          [p, tenant, `Profissional ${i}`, i < 3],
        );
      }
      for (const [i, u] of pessoas.entries()) {
        await client.query('INSERT INTO users (id, name, email) VALUES ($1, $2, $3)', [u, `Pessoa ${i}`, `${u}@example.test`]);
      }
      await client.query(
        `INSERT INTO memberships (id, user_id, tenant_id, role, professional_id, status) VALUES
         ($1, $4, $7, 'DONO', NULL, 'ACTIVE'),
         ($2, $5, $7, 'PROFISSIONAL', $8, 'ACTIVE'),
         ($3, $6, $7, 'PROFISSIONAL', $9, 'SUSPENDED')`,
        [id(), id(), id(), pessoas[0], pessoas[1], pessoas[2], tenant, profissionais[0], profissionais[1]],
      );
      for (const [expira, status] of [
        ["now() + interval '1 day'", 'PENDING'],
        ["now() - interval '1 day'", 'PENDING'],
      ]) {
        await client.query(
          `INSERT INTO invites (id, type, target_name, target_email, tenant_id, establishment_role, status, token_hash,
                                created_by_user_id, created_at, expires_at, professional_id)
           VALUES ($1, 'ESTABLISHMENT', 'Convidado', $2, $3, 'PROFISSIONAL', $4, $5, $6, now() - interval '2 days', ${expira}, $7)`,
          [id(), `${id()}@example.test`, tenant, status, id(), pessoas[0], profissionais[2]],
        );
        // Um pendente por profissional: o segundo vai para outro.
        profissionais[2] = profissionais[3];
      }
    });
    const depois = await comCliente(lerExcessoDePlano);

    expect(depois.estabelecimentos).toBe(antes.estabelecimentos + 1);
    expect(depois.acimaDoLimite).toBe(antes.acimaDoLimite + 1);
    expect(depois.emExcesso).toBe(antes.emExcesso + 1);
    // 1 acesso ativo + 1 convite no prazo = 2 vagas: no limite, não acima.
    expect(depois.vagasAcimaDoLimite).toBe(antes.vagasAcimaDoLimite);
    expect(depois.vinculosPorPapel.PROFISSIONAL).toBe((antes.vinculosPorPapel.PROFISSIONAL ?? 0) + 2);
    const linha = depois.detalhes.find((d) => d.tenantId === tenant);
    if (linha) {
      expect(linha).toEqual({
        tenantId: tenant,
        slug: `limite-${tenant}`,
        situacao: 'ACTIVE',
        plano: 'essencial',
        limite: 2,
        profissionaisAtivos: 3,
        vagasUsadas: 2,
      });
    }
    expect(descreverExcessoDePlano(depois).join('\n')).not.toMatch(/Pessoa|Profissional|example\.test/);
  });

  it('acesso e recebimentos: banco com as dez migrations passa no "depois" e é recusado no "antes"', async () => {
    const estado = await comCliente(lerEstadoAcessoRecebimentos);
    expect(estado.migrationNames.slice(8)).toEqual([...MIGRATIONS_ACESSO_RECEBIMENTOS]);
    expect(falhasDepoisDeAcessoRecebimentos(estado)).toEqual([]);
    expect(objetosAcessoRecebimentosPresentes(estado)).toBe(TOTAL_OBJETOS_ACESSO_RECEBIMENTOS);
    expect(falhasAntesDeAcessoRecebimentos(estado)).toEqual([
      'migration_history',
      'new_columns_already_exist',
      'new_tables_already_exist',
      'new_constraints_already_exist',
      'new_indexes_already_exist',
      'users_email_already_optional',
    ]);
  });

  it('acesso e recebimentos: dados novos, levantamento e reversão leem o banco real, só leitura', async () => {
    const id = () => randomUUID().replaceAll('-', '').slice(0, 25);
    const conta = id();
    const antes = await comCliente(lerDadosNovos);
    await comCliente((client) =>
      client.query(
        `INSERT INTO users (id, name, email, username, must_change_password) VALUES ($1, 'Conta sem e-mail', NULL, $2, true)`,
        [conta, `func.${conta.slice(0, 12)}`],
      ),
    );
    const depois = await comCliente(lerDadosNovos);
    expect(depois.contasSemEmail).toBe(antes.contasSemEmail + 1);
    expect(depois.contasComUsuario).toBe(antes.contasComUsuario + 1);
    expect(depois.trocaDeSenhaPendente).toBe(antes.trocaDeSenhaPendente + 1);
    const levantamento = await comCliente((client) => PUBLICACAO_ACESSO_RECEBIMENTOS.levantamento(client));
    expect(levantamento.linhas.join('\n')).not.toMatch(/Conta sem e-mail|func\./);
    const reversao = await comCliente((client) => PUBLICACAO_ACESSO_RECEBIMENTOS.reversao(client));
    expect(reversao).toContain(`REVERSAO_AFETARIA_contasSemEmail: ${depois.contasSemEmail}`);
  });
});
