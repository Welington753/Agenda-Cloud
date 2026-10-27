// Conferência da migration `TeamAccess1792886400000` no banco do piloto,
// ANTES e DEPOIS de aplicá-la (ver docs/plans/equipe-acessos-e-plano.md,
// "Publicação").
//
// Só leitura: `BEGIN TRANSACTION READ ONLY` ... `ROLLBACK`. Lê metadados e
// uma contagem em `invites` (a tabela que ganha a constraint nova), nunca
// linhas de pessoas. As falhas saem como nomes fixos.
//
// ANTES: histórico com EXATAMENTE as sete migrations até AccountsAdministration,
// nenhum objeto novo presente e nenhum convite que a constraint nova recusaria
// (convite de PROFISSIONAL sem profissional: a migration falharia no meio).
// DEPOIS: as oito migrations na ordem e cada objeto novo presente.
import type { PgClientLike } from './pg-client.js';
import { parseNonNegativeInteger } from './pg-value-parsers.js';
import { MIGRATIONS_ATE_WEB_PUSH, MIGRATION_CONTAS } from './contas-administracao-schema.js';
import { somenteLeitura, type PublicacaoDoLote } from './publicacao-lote.js';

export const MIGRATIONS_ATE_CONTAS = [...MIGRATIONS_ATE_WEB_PUSH, MIGRATION_CONTAS] as const;
export const MIGRATION_EQUIPE = 'TeamAccess1792886400000';

export const COLUNAS_EQUIPE: readonly (readonly [string, string])[] = [
  ['tenants', 'restore_status'],
  ['memberships', 'status'],
  ['memberships', 'status_changed_at'],
  ['memberships', 'status_changed_by_user_id'],
  ['invites', 'professional_id'],
];

export const CONSTRAINTS_EQUIPE = [
  'ck_tenants_restore_status',
  'ck_memberships_status',
  'fk_memberships_status_changed_by_user',
  'fk_invites_tenant_professional',
  'ck_invites_professional_scope',
] as const;

export const INDICES_EQUIPE = ['uq_invites_pending_professional'] as const;

/** Valores novos de enum, como `tipo.valor`. */
export const VALORES_EQUIPE = [
  'tenant_status.ARCHIVED',
  'permission.ATENDIMENTO_PROPRIO_INICIAR',
  'permission.ATENDIMENTO_PROPRIO_CONCLUIR',
  'permission.ATENDIMENTO_PROPRIO_FALTA',
  'audit_action.TENANT_UPDATED',
  'audit_action.TENANT_ARCHIVED',
  'audit_action.MEMBERSHIP_SUSPENDED',
  'audit_action.MEMBERSHIP_REACTIVATED',
] as const;

export interface EstadoEquipe {
  migrationNames: string[];
  colunas: string[];
  constraints: string[];
  indices: string[];
  valores: string[];
  convitesDeProfissionalSemProfissional: number;
}

export async function lerEstadoEquipe(client: PgClientLike): Promise<EstadoEquipe> {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    const migrations = await client.query<{ name: string }>('SELECT name FROM typeorm_migrations ORDER BY id');
    const colunas = await client.query<{ nome: string }>(
      `SELECT table_name || '.' || column_name AS nome FROM information_schema.columns
        WHERE table_schema = 'public' AND (table_name, column_name) IN (${COLUNAS_EQUIPE.map(
          (_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`,
        ).join(', ')})`,
      COLUNAS_EQUIPE.flat(),
    );
    const constraints = await client.query<{ conname: string }>(
      `SELECT c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'public' AND c.conname = ANY($1)`,
      [[...CONSTRAINTS_EQUIPE]],
    );
    const indices = await client.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1)",
      [[...INDICES_EQUIPE]],
    );
    const valores = await client.query<{ valor: string }>(
      `SELECT t.typname || '.' || e.enumlabel AS valor FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname || '.' || e.enumlabel = ANY($1)`,
      [[...VALORES_EQUIPE]],
    );
    const semProfissional = await client.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM invites WHERE establishment_role = 'PROFISSIONAL'
         AND ${colunas.rows.some((r) => r.nome === 'invites.professional_id') ? 'professional_id IS NULL' : 'true'}`,
    );
    await client.query('ROLLBACK');
    return {
      migrationNames: migrations.rows.map((r) => r.name),
      colunas: colunas.rows.map((r) => r.nome),
      constraints: constraints.rows.map((r) => r.conname),
      indices: indices.rows.map((r) => r.indexname),
      valores: valores.rows.map((r) => r.valor),
      convitesDeProfissionalSemProfissional: parseNonNegativeInteger(
        semProfissional.rows[0]?.total,
        'invites_professional_without_professional',
      ),
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // O erro original é o que importa.
    }
    throw error;
  }
}

const mesmaLista = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((valor, i) => valor === b[i]);

export function falhasAntesDeEquipe(estado: EstadoEquipe): string[] {
  const falhas: string[] = [];
  if (!mesmaLista(estado.migrationNames, MIGRATIONS_ATE_CONTAS)) falhas.push('migration_history');
  if (estado.colunas.length) falhas.push('new_columns_already_exist');
  if (estado.constraints.length) falhas.push('new_constraints_already_exist');
  if (estado.indices.length) falhas.push('new_indexes_already_exist');
  if (estado.convitesDeProfissionalSemProfissional > 0) falhas.push('invites_professional_role_rows');
  return falhas;
}

export function falhasDepoisDeEquipe(estado: EstadoEquipe): string[] {
  const falhas: string[] = [];
  if (!mesmaLista(estado.migrationNames, [...MIGRATIONS_ATE_CONTAS, MIGRATION_EQUIPE])) falhas.push('migration_history');
  for (const [tabela, coluna] of COLUNAS_EQUIPE) {
    if (!estado.colunas.includes(`${tabela}.${coluna}`)) falhas.push(`column_${tabela}_${coluna}`);
  }
  for (const nome of CONSTRAINTS_EQUIPE) if (!estado.constraints.includes(nome)) falhas.push(nome);
  for (const nome of INDICES_EQUIPE) if (!estado.indices.includes(nome)) falhas.push(nome);
  for (const valor of VALORES_EQUIPE) if (!estado.valores.includes(valor)) falhas.push(`enum_${valor}`);
  if (estado.convitesDeProfissionalSemProfissional > 0) falhas.push('invites_professional_role_rows');
  return falhas;
}

export const TOTAL_OBJETOS_EQUIPE =
  COLUNAS_EQUIPE.length + CONSTRAINTS_EQUIPE.length + INDICES_EQUIPE.length + VALORES_EQUIPE.length;

export function objetosEquipePresentes(estado: EstadoEquipe): number {
  return estado.colunas.length + estado.constraints.length + estado.indices.length + estado.valores.length;
}

/** Um estabelecimento acima do limite do plano: só identificadores e
 * contagens, nunca nomes de pessoas, clientes ou contatos. */
export interface EstabelecimentoAcimaDoLimite {
  tenantId: string;
  slug: string;
  situacao: string;
  plano: string;
  limite: number;
  profissionaisAtivos: number;
  vagasUsadas: number;
}

export interface ExcessoDePlano {
  estabelecimentos: number;
  /** `profissionais ativos > max_professionals`: continuam operando, mas não
   * criam nem reativam profissional (LIMITE_DE_PROFISSIONAIS). */
  acimaDoLimite: number;
  /** `profissionais ativos = max_professionals`: o próximo é recusado. */
  noLimite: number;
  /** Acessos de funcionário ativos + convites de funcionário pendentes acima
   * do limite: novos convites recusados (LIMITE_DO_PLANO). */
  vagasAcimaDoLimite: number;
  vinculosPorPapel: Record<string, number>;
  /** Vínculos PROFISSIONAL sem profissional ligado: a API nova não lhes dá
   * agenda (my-agenda.service.ts). */
  funcionariosSemProfissional: number;
  /** Estabelecimentos com qualquer um dos dois excessos. */
  emExcesso: number;
  detalhes: EstabelecimentoAcimaDoLimite[];
}

export const MAXIMO_DE_DETALHES = 50;

/**
 * Levantamento SÓ DE LEITURA do limite de profissionais, com a mesma regra da
 * aplicação: `plans.max_professionals` (NOT NULL, sem plano "sem limite")
 * contra `professionals.active = true` (professionals.service.ts) e, para as
 * vagas de funcionário, vínculos PROFISSIONAL ativos + convites de
 * PROFISSIONAL pendentes e no prazo (team/seats.ts). Antes da migration, todo
 * vínculo conta como ativo (é o que ela grava) e não há convite de
 * funcionário (a conferência `before` recusa). Não altera nada.
 */
export async function lerExcessoDePlano(client: PgClientLike): Promise<ExcessoDePlano> {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    const colunas = await client.query<{ nome: string }>(
      `SELECT table_name || '.' || column_name AS nome FROM information_schema.columns
        WHERE table_schema = 'public' AND (table_name, column_name) IN (('memberships', 'status'), ('invites', 'professional_id'))`,
    );
    const temStatus = colunas.rows.some((r) => r.nome === 'memberships.status');
    const temConviteDeFuncionario = colunas.rows.some((r) => r.nome === 'invites.professional_id');
    const linhas = await client.query<{
      tenant_id: string;
      slug: string;
      situacao: string;
      plano: string;
      limite: string;
      ativos: string;
      vagas: string;
    }>(
      `SELECT t.id AS tenant_id, t.slug::text AS slug, t.status::text AS situacao, p.code AS plano,
              p.max_professionals::text AS limite,
              (SELECT count(*) FROM professionals pr WHERE pr.tenant_id = t.id AND pr.active = true)::text AS ativos,
              ((SELECT count(*) FROM memberships m WHERE m.tenant_id = t.id AND m.role = 'PROFISSIONAL'
                  ${temStatus ? "AND m.status = 'ACTIVE'" : ''})
               + ${
                 temConviteDeFuncionario
                   ? `(SELECT count(*) FROM invites i WHERE i.tenant_id = t.id AND i.establishment_role = 'PROFISSIONAL'
                        AND i.status = 'PENDING' AND i.expires_at > now())`
                   : '0'
               })::text AS vagas
         FROM tenants t JOIN plans p ON p.id = t.plan_id
        ORDER BY t.created_at, t.id`,
    );
    const papeis = await client.query<{ papel: string; total: string }>(
      'SELECT role::text AS papel, count(*)::text AS total FROM memberships GROUP BY role ORDER BY role',
    );
    const semProfissional = await client.query<{ total: string }>(
      "SELECT count(*)::text AS total FROM memberships WHERE role = 'PROFISSIONAL' AND professional_id IS NULL",
    );
    await client.query('ROLLBACK');

    const numero = (valor: string | undefined, campo: string) => parseNonNegativeInteger(valor, campo);
    let acimaDoLimite = 0;
    let noLimite = 0;
    let vagasAcimaDoLimite = 0;
    let emExcesso = 0;
    const detalhes: EstabelecimentoAcimaDoLimite[] = [];
    for (const linha of linhas.rows) {
      const limite = numero(linha.limite, 'plan_max_professionals');
      const profissionaisAtivos = numero(linha.ativos, 'active_professionals');
      const vagasUsadas = numero(linha.vagas, 'staff_seats');
      if (profissionaisAtivos > limite) acimaDoLimite += 1;
      else if (profissionaisAtivos === limite) noLimite += 1;
      if (vagasUsadas > limite) vagasAcimaDoLimite += 1;
      if (profissionaisAtivos <= limite && vagasUsadas <= limite) continue;
      emExcesso += 1;
      if (detalhes.length < MAXIMO_DE_DETALHES) {
        detalhes.push({
          tenantId: linha.tenant_id,
          slug: linha.slug,
          situacao: linha.situacao,
          plano: linha.plano,
          limite,
          profissionaisAtivos,
          vagasUsadas,
        });
      }
    }
    return {
      estabelecimentos: linhas.rows.length,
      acimaDoLimite,
      noLimite,
      vagasAcimaDoLimite,
      vinculosPorPapel: Object.fromEntries(papeis.rows.map((r) => [r.papel, numero(r.total, 'memberships_by_role')])),
      funcionariosSemProfissional: numero(semProfissional.rows[0]?.total, 'staff_without_professional'),
      emExcesso,
      detalhes,
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // O erro original é o que importa.
    }
    throw error;
  }
}

/** Linhas fixas `NOME: valor` para a saída dos procedimentos. */
export function descreverExcessoDePlano(excesso: ExcessoDePlano): string[] {
  const linhas = [
    `ESTABELECIMENTOS: ${excesso.estabelecimentos}`,
    `ACIMA_DO_LIMITE_DE_PROFISSIONAIS: ${excesso.acimaDoLimite}`,
    `NO_LIMITE_DE_PROFISSIONAIS: ${excesso.noLimite}`,
    `VAGAS_DE_FUNCIONARIO_ACIMA_DO_LIMITE: ${excesso.vagasAcimaDoLimite}`,
    `VINCULOS_POR_PAPEL: ${Object.entries(excesso.vinculosPorPapel).map(([papel, n]) => `${papel}=${n}`).join(' ') || 'nenhum'}`,
    `FUNCIONARIOS_SEM_PROFISSIONAL: ${excesso.funcionariosSemProfissional}`,
  ];
  for (const d of excesso.detalhes) {
    linhas.push(
      `ACIMA_DO_LIMITE: tenant=${d.tenantId} slug=${d.slug} situacao=${d.situacao} plano=${d.plano} limite=${d.limite} profissionaisAtivos=${d.profissionaisAtivos} vagasUsadas=${d.vagasUsadas}`,
    );
  }
  if (excesso.detalhes.length < excesso.emExcesso) {
    linhas.push(`ACIMA_DO_LIMITE_NAO_LISTADOS: ${excesso.emExcesso - excesso.detalhes.length}`);
  }
  return linhas;
}

/** TeamAccess no contrato comum dos scripts de publicação (`--lote=equipe`).
 * Mesmas conferências de antes; as consultas de "colunas novas vazias" e de
 * reversão saíram dos scripts para cá sem mudar. */
export const PUBLICACAO_EQUIPE: PublicacaoDoLote = {
  migrationsAntes: MIGRATIONS_ATE_CONTAS,
  pendentes: [MIGRATION_EQUIPE],
  falhasAntes: async (client) => falhasAntesDeEquipe(await lerEstadoEquipe(client)),
  falhasDepois: async (client) => falhasDepoisDeEquipe(await lerEstadoEquipe(client)),
  async levantamento(client) {
    const excesso = await lerExcessoDePlano(client);
    return { linhas: descreverExcessoDePlano(excesso), comparavel: excesso };
  },
  async novosVazios(client) {
    const [n] = await somenteLeitura(client, async () =>
      (
        await client.query<Record<string, number>>(`SELECT
          (SELECT count(*)::int FROM memberships) AS vinculos,
          (SELECT count(*)::int FROM memberships WHERE status = 'ACTIVE' AND status_changed_at IS NULL AND status_changed_by_user_id IS NULL) AS "vinculosAtivosSemMudanca",
          (SELECT count(*)::int FROM tenants WHERE restore_status IS NOT NULL) AS "tenantsComRestore",
          (SELECT count(*)::int FROM invites WHERE professional_id IS NOT NULL) AS "convitesComProfissional"`)
      ).rows,
    );
    return {
      linhas: [
        `VINCULOS_ATIVOS: ${n.vinculosAtivosSemMudanca}/${n.vinculos}`,
        `COLUNAS_NOVAS_VAZIAS: ${n.tenantsComRestore === 0 && n.convitesComProfissional === 0}`,
      ],
      ok: n.vinculosAtivosSemMudanca === n.vinculos && n.tenantsComRestore === 0 && n.convitesComProfissional === 0,
    };
  },
  async reversao(client) {
    const [r] = await somenteLeitura(client, async () =>
      (
        await client.query<Record<string, number>>(`SELECT
          (SELECT count(*)::int FROM memberships WHERE status <> 'ACTIVE') AS "vinculosSuspensos",
          (SELECT count(*)::int FROM tenants WHERE status::text = 'ARCHIVED') AS "estabelecimentosArquivados",
          (SELECT count(*)::int FROM tenants WHERE restore_status IS NOT NULL) AS "estabelecimentosComSituacaoAnterior",
          (SELECT count(*)::int FROM invites WHERE professional_id IS NOT NULL) AS "convitesDeFuncionario",
          (SELECT count(*)::int FROM membership_permission_overrides WHERE permission::text LIKE 'ATENDIMENTO_PROPRIO_%') AS "liberacoesDeFuncionario"`)
      ).rows,
    );
    return Object.entries(r ?? {}).map(([k, v]) => `REVERSAO_AFETARIA_${k}: ${v}`);
  },
};
