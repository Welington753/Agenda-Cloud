// Conferência da migration `TeamManagerAccess1793145600000` no banco do
// piloto, ANTES e DEPOIS de aplicá-la (ver docs/plans/equipe-gerente-login-interno.md
// e docs/runbooks/publicacao-gerente-piloto.md).
//
// Só leitura: `BEGIN TRANSACTION READ ONLY` ... `ROLLBACK`. Lê metadados,
// contagens e identificadores (ids e slug), nunca nome, e-mail, login,
// telefone ou senha. As falhas saem como nomes fixos.
//
// ANTES: histórico com EXATAMENTE as dez migrations até AppointmentPayments,
// os objetos de StaffLogin de que a migration depende, nenhum objeto novo e
// nenhuma colisão cruzada entre e-mail e login (a migration pararia no
// começo, sem alterar nada, mas o procedimento recusa antes).
// DEPOIS: as onze migrations na ordem, cada objeto novo presente, o gatilho
// habilitado, o formato novo do login e nenhuma colisão.
//
// Os formatos e nomes abaixo vêm de src/migrations/1793145600000-TeamManagerAccess.ts.
// Ficam duplicados de propósito (os scripts compilam com `rootDir:
// ./scripts`); gerente-acessos-schema.spec.ts confere que são iguais.
import type { PgClientLike } from './pg-client.js';
import { parseNonNegativeInteger } from './pg-value-parsers.js';
import { MIGRATIONS_ATE_CONTAS, MIGRATION_EQUIPE } from './equipe-acessos-schema.js';

export const MIGRATIONS_ATE_PAGAMENTOS = [
  ...MIGRATIONS_ATE_CONTAS,
  MIGRATION_EQUIPE,
  'StaffLogin1792972800000',
  'AppointmentPayments1793059200000',
] as const;
export const MIGRATION_GERENTE = 'TeamManagerAccess1793145600000';

/** `ck_users_username_format` de StaffLogin e da migration nova. */
export const FORMATO_ANTERIOR_DO_LOGIN = '^[a-z0-9][a-z0-9._-]{2,39}$';
export const FORMATO_NOVO_DO_LOGIN = '^[a-z0-9][a-z0-9._+-]*(@[a-z0-9]([a-z0-9.-]*[a-z0-9])?)?$';
export const CONSTRAINT_DO_FORMATO = 'ck_users_username_format';

export const COLUNAS_GERENTE: readonly (readonly [string, string])[] = [['memberships', 'permissions_confirmed_at']];

/** Valores novos de `permission`, como `tipo.valor`. */
export const VALORES_GERENTE = [
  'permission.SOLICITACOES_VISUALIZAR',
  'permission.SOLICITACOES_TRATAR',
  'permission.RECEBIMENTOS_VISUALIZAR',
  'permission.RECEBIMENTOS_REGISTRAR',
  'permission.RECEBIMENTOS_ESTORNAR',
] as const;

export const FUNCAO_GERENTE = 'users_login_identifier_guard';
export const GATILHO_GERENTE = 'trg_users_login_identifier';

/** Objetos de StaffLogin e AppointmentPayments que precisam existir antes e
 * depois (a migration nova troca a constraint do formato e lê `username`). */
export const PRE_REQUISITOS_GERENTE = {
  colunas: [
    ['users', 'username'],
    ['users', 'must_change_password'],
  ] as readonly (readonly [string, string])[],
  indices: ['uq_users_username', 'uq_users_email'] as readonly string[],
  constraints: ['ck_users_login_identifier', CONSTRAINT_DO_FORMATO] as readonly string[],
  tabelas: ['staff_account_requests', 'appointment_payments'] as readonly string[],
};

export type FormatoDoLogin = 'anterior' | 'novo' | 'outro' | 'ausente';

export interface EstadoGerente {
  migrationNames: string[];
  colunas: string[];
  valores: string[];
  funcao: boolean;
  gatilho: { existe: boolean; habilitado: boolean; definicao: string };
  formatoDoLogin: FormatoDoLogin;
  preRequisitosAusentes: string[];
  colisoesCruzadas: number;
}

/** Login igual ao e-mail de OUTRA conta. A mesma consulta da migration. */
export const SQL_COLISOES_CRUZADAS = `SELECT a.id AS login_user_id, b.id AS email_user_id
   FROM users a JOIN users b ON b.id <> a.id AND b.email = a.username
  ORDER BY a.id, b.id`;

export function classificarFormato(definicao: string | undefined): FormatoDoLogin {
  if (definicao === undefined) return 'ausente';
  if (definicao.includes(FORMATO_NOVO_DO_LOGIN) && /\b80\b/.test(definicao)) return 'novo';
  if (definicao.includes(FORMATO_ANTERIOR_DO_LOGIN)) return 'anterior';
  return 'outro';
}

async function somenteLeitura<T>(client: PgClientLike, ler: () => Promise<T>): Promise<T> {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    return await ler();
  } finally {
    try {
      await client.query('ROLLBACK');
    } catch {
      // O erro original é o que importa.
    }
  }
}

const pares = (lista: readonly (readonly [string, string])[]) =>
  lista.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');

export async function lerEstadoGerente(client: PgClientLike): Promise<EstadoGerente> {
  return somenteLeitura(client, async () => {
    const migrations = await client.query<{ name: string }>('SELECT name FROM typeorm_migrations ORDER BY id');
    const todasAsColunas = [...COLUNAS_GERENTE, ...PRE_REQUISITOS_GERENTE.colunas];
    const colunas = await client.query<{ nome: string }>(
      `SELECT table_name || '.' || column_name AS nome FROM information_schema.columns
        WHERE table_schema = 'public' AND (table_name, column_name) IN (${pares(todasAsColunas)})`,
      todasAsColunas.flat(),
    );
    const valores = await client.query<{ valor: string }>(
      `SELECT t.typname || '.' || e.enumlabel AS valor FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname || '.' || e.enumlabel = ANY($1)`,
      [[...VALORES_GERENTE]],
    );
    const funcao = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = $1`,
      [FUNCAO_GERENTE],
    );
    const gatilho = await client.query<{ habilitado: boolean; definicao: string }>(
      `SELECT t.tgenabled <> 'D' AS habilitado, pg_get_triggerdef(t.oid) AS definicao
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'users' AND t.tgname = $1 AND NOT t.tgisinternal`,
      [GATILHO_GERENTE],
    );
    const constraints = await client.query<{ conname: string; definicao: string }>(
      `SELECT c.conname, pg_get_constraintdef(c.oid) AS definicao FROM pg_constraint c
         JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'public' AND c.conname = ANY($1)`,
      [[...PRE_REQUISITOS_GERENTE.constraints]],
    );
    const indices = await client.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1)",
      [[...PRE_REQUISITOS_GERENTE.indices]],
    );
    const tabelas = await client.query<{ tabela: string }>(
      `SELECT c.relname AS tabela FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname = ANY($1)`,
      [[...PRE_REQUISITOS_GERENTE.tabelas]],
    );
    const nomesDasColunas = colunas.rows.map((r) => r.nome);
    const temUsername = nomesDasColunas.includes('users.username');
    const colisoes = temUsername
      ? await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM (${SQL_COLISOES_CRUZADAS}) x`)
      : { rows: [{ n: '0' }] };

    const ausentes: string[] = [];
    for (const [tabela, coluna] of PRE_REQUISITOS_GERENTE.colunas) {
      if (!nomesDasColunas.includes(`${tabela}.${coluna}`)) ausentes.push(`column_${tabela}_${coluna}`);
    }
    for (const nome of PRE_REQUISITOS_GERENTE.indices) {
      if (!indices.rows.some((r) => r.indexname === nome)) ausentes.push(nome);
    }
    for (const nome of PRE_REQUISITOS_GERENTE.constraints) {
      if (!constraints.rows.some((r) => r.conname === nome)) ausentes.push(nome);
    }
    for (const nome of PRE_REQUISITOS_GERENTE.tabelas) {
      if (!tabelas.rows.some((r) => r.tabela === nome)) ausentes.push(`table_${nome}`);
    }
    const [g] = gatilho.rows;
    return {
      migrationNames: migrations.rows.map((r) => r.name),
      colunas: nomesDasColunas.filter((n) => COLUNAS_GERENTE.some(([t, c]) => `${t}.${c}` === n)),
      valores: valores.rows.map((r) => r.valor),
      funcao: parseNonNegativeInteger(funcao.rows[0]?.n, 'login_guard_function') > 0,
      gatilho: { existe: !!g, habilitado: g?.habilitado === true, definicao: g?.definicao ?? '' },
      formatoDoLogin: classificarFormato(constraints.rows.find((r) => r.conname === CONSTRAINT_DO_FORMATO)?.definicao),
      preRequisitosAusentes: ausentes,
      colisoesCruzadas: parseNonNegativeInteger(colisoes.rows[0]?.n, 'login_identifier_collisions'),
    };
  });
}

const mesmaLista = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((valor, i) => valor === b[i]);

/** O gatilho confere toda gravação que muda e-mail ou login, antes dela. */
function gatilhoConfere(definicao: string): boolean {
  return /BEFORE INSERT OR UPDATE OF email, username ON public\.users FOR EACH ROW/.test(definicao);
}

export function falhasAntesDeGerente(estado: EstadoGerente): string[] {
  const falhas: string[] = [];
  if (!mesmaLista(estado.migrationNames, MIGRATIONS_ATE_PAGAMENTOS)) falhas.push('migration_history');
  falhas.push(...estado.preRequisitosAusentes);
  if (estado.colunas.length) falhas.push('new_columns_already_exist');
  if (estado.valores.length) falhas.push('new_enum_values_already_exist');
  if (estado.funcao) falhas.push('login_guard_function_already_exists');
  if (estado.gatilho.existe) falhas.push('login_guard_trigger_already_exists');
  if (estado.formatoDoLogin !== 'anterior') falhas.push(`username_format_${estado.formatoDoLogin}`);
  if (estado.colisoesCruzadas > 0) falhas.push('login_identifier_collisions');
  return falhas;
}

export function falhasDepoisDeGerente(estado: EstadoGerente): string[] {
  const falhas: string[] = [];
  if (!mesmaLista(estado.migrationNames, [...MIGRATIONS_ATE_PAGAMENTOS, MIGRATION_GERENTE])) falhas.push('migration_history');
  falhas.push(...estado.preRequisitosAusentes);
  for (const [tabela, coluna] of COLUNAS_GERENTE) {
    if (!estado.colunas.includes(`${tabela}.${coluna}`)) falhas.push(`column_${tabela}_${coluna}`);
  }
  for (const valor of VALORES_GERENTE) if (!estado.valores.includes(valor)) falhas.push(`enum_${valor}`);
  if (!estado.funcao) falhas.push(FUNCAO_GERENTE);
  if (!estado.gatilho.existe) falhas.push(GATILHO_GERENTE);
  else if (!estado.gatilho.habilitado) falhas.push('login_guard_trigger_disabled');
  else if (!gatilhoConfere(estado.gatilho.definicao)) falhas.push('login_guard_trigger_definition');
  if (estado.formatoDoLogin !== 'novo') falhas.push(`username_format_${estado.formatoDoLogin}`);
  if (estado.colisoesCruzadas > 0) falhas.push('login_identifier_collisions');
  return falhas;
}

export const TOTAL_OBJETOS_GERENTE = COLUNAS_GERENTE.length + VALORES_GERENTE.length + 3;

export function objetosGerentePresentes(estado: EstadoGerente): number {
  return (
    estado.colunas.length +
    estado.valores.length +
    (estado.funcao ? 1 : 0) +
    (estado.gatilho.existe ? 1 : 0) +
    (estado.formatoDoLogin === 'novo' ? 1 : 0)
  );
}

// ------------------------------------------------------------ impacto

/** Um estabelecimento afetado pela regra nova das vagas: só identificadores
 * e contagens. */
export interface ImpactoNoEstabelecimento {
  tenantId: string;
  slug: string;
  situacao: string;
  plano: string;
  limite: number;
  acessosDeProfissional: number;
  gerentesAtivos: number;
  convitesPendentes: number;
  /** Regra anterior: vínculos PROFISSIONAL ativos + convites pendentes. */
  vagasAntes: number;
  /** Regra nova: PROFISSIONAL e GERENTE ativos + convites pendentes. */
  vagasDepois: number;
}

export interface ImpactoDoGerente {
  estabelecimentos: number;
  gerentesAtivos: number;
  gerentesSuspensos: number;
  gerentesComProfissional: number;
  /** Gerentes com `GRANTED` gravado: continua sem valer até o dono confirmar. */
  gerentesComAjustesConcedidos: number;
  /** Acima do limite já pela regra anterior. */
  acimaAntes: number;
  /** Acima do limite só por causa da regra nova (gerentes contando). */
  passamAcima: number;
  /** Ficam exatamente no limite pela regra nova, sem estar antes: o próximo
   * acesso ou convite é recusado. */
  passamAoLimite: number;
  /** Acima do limite pela regra nova (qualquer motivo). */
  acimaDepois: number;
  /** Login igual ao e-mail de outra conta: a migration recusa. */
  colisoesCruzadas: number;
  detalhes: ImpactoNoEstabelecimento[];
  /** Pares de ids (nunca e-mail ou login) das colisões, até o máximo. */
  colisoes: { loginUserId: string; emailUserId: string }[];
}

export const MAXIMO_DE_DETALHES_GERENTE = 50;

/**
 * Levantamento SÓ DE LEITURA do efeito da regra nova das vagas (team/seats.ts:
 * PROFISSIONAL e GERENTE ativos + convites de funcionário pendentes e no
 * prazo, contra `plans.max_professionals`; o DONO fica fora) e das colisões
 * que impedem a migration. Funciona antes e depois dela: não lê a coluna
 * nova. Mesma lógica de docs/runbooks/consultas/impacto-gerente-somente-leitura.sql.
 * Os detalhes listam só estabelecimentos com gerente ou acima do limite.
 */
export async function lerImpactoDoGerente(client: PgClientLike): Promise<ImpactoDoGerente> {
  return somenteLeitura(client, async () => {
    const linhas = await client.query<{
      tenant_id: string;
      slug: string;
      situacao: string;
      plano: string;
      limite: string;
      profissionais: string;
      gerentes: string;
      convites: string;
    }>(
      `SELECT t.id AS tenant_id, t.slug::text AS slug, t.status::text AS situacao, p.code AS plano,
              p.max_professionals::text AS limite,
              (SELECT count(*) FROM memberships m WHERE m.tenant_id = t.id AND m.role = 'PROFISSIONAL' AND m.status = 'ACTIVE')::text AS profissionais,
              (SELECT count(*) FROM memberships m WHERE m.tenant_id = t.id AND m.role = 'GERENTE' AND m.status = 'ACTIVE')::text AS gerentes,
              (SELECT count(*) FROM invites i WHERE i.tenant_id = t.id AND i.establishment_role = 'PROFISSIONAL'
                  AND i.status = 'PENDING' AND i.expires_at > now())::text AS convites
         FROM tenants t JOIN plans p ON p.id = t.plan_id
        ORDER BY t.created_at, t.id`,
    );
    const [gerentes] = (
      await client.query<{ suspensos: string; com_profissional: string; com_ajustes: string }>(
        `SELECT count(*) FILTER (WHERE m.status <> 'ACTIVE')::text AS suspensos,
                count(*) FILTER (WHERE m.professional_id IS NOT NULL)::text AS com_profissional,
                count(*) FILTER (WHERE EXISTS (SELECT 1 FROM membership_permission_overrides o
                                                WHERE o.membership_id = m.id AND o.mode = 'GRANTED'))::text AS com_ajustes
           FROM memberships m WHERE m.role = 'GERENTE'`,
      )
    ).rows;
    const colisoes = await client.query<{ login_user_id: string; email_user_id: string }>(
      `${SQL_COLISOES_CRUZADAS} LIMIT ${MAXIMO_DE_DETALHES_GERENTE}`,
    );
    const [{ n: totalColisoes }] = (
      await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM (${SQL_COLISOES_CRUZADAS}) x`)
    ).rows;

    const numero = (valor: string | undefined, campo: string) => parseNonNegativeInteger(valor, campo);
    const impacto: ImpactoDoGerente = {
      estabelecimentos: linhas.rows.length,
      gerentesAtivos: 0,
      gerentesSuspensos: numero(gerentes?.suspensos, 'managers_suspended'),
      gerentesComProfissional: numero(gerentes?.com_profissional, 'managers_with_professional'),
      gerentesComAjustesConcedidos: numero(gerentes?.com_ajustes, 'managers_with_granted'),
      acimaAntes: 0,
      passamAcima: 0,
      passamAoLimite: 0,
      acimaDepois: 0,
      colisoesCruzadas: numero(totalColisoes, 'login_identifier_collisions'),
      detalhes: [],
      colisoes: colisoes.rows.map((c) => ({ loginUserId: c.login_user_id, emailUserId: c.email_user_id })),
    };
    for (const linha of linhas.rows) {
      const limite = numero(linha.limite, 'plan_max_professionals');
      const acessosDeProfissional = numero(linha.profissionais, 'staff_accesses');
      const gerentesAtivos = numero(linha.gerentes, 'managers_active');
      const convitesPendentes = numero(linha.convites, 'staff_invites_pending');
      const vagasAntes = acessosDeProfissional + convitesPendentes;
      const vagasDepois = vagasAntes + gerentesAtivos;
      impacto.gerentesAtivos += gerentesAtivos;
      if (vagasAntes > limite) impacto.acimaAntes += 1;
      if (vagasDepois > limite) impacto.acimaDepois += 1;
      if (vagasDepois > limite && vagasAntes <= limite) impacto.passamAcima += 1;
      if (vagasDepois === limite && vagasAntes < limite) impacto.passamAoLimite += 1;
      if ((gerentesAtivos > 0 || vagasDepois > limite) && impacto.detalhes.length < MAXIMO_DE_DETALHES_GERENTE) {
        impacto.detalhes.push({
          tenantId: linha.tenant_id,
          slug: linha.slug,
          situacao: linha.situacao,
          plano: linha.plano,
          limite,
          acessosDeProfissional,
          gerentesAtivos,
          convitesPendentes,
          vagasAntes,
          vagasDepois,
        });
      }
    }
    return impacto;
  });
}

/** Linhas fixas `NOME: valor` para a saída dos procedimentos. */
export function descreverImpactoDoGerente(impacto: ImpactoDoGerente): string[] {
  const linhas = [
    `ESTABELECIMENTOS: ${impacto.estabelecimentos}`,
    `GERENTES_ATIVOS: ${impacto.gerentesAtivos}`,
    `GERENTES_SUSPENSOS: ${impacto.gerentesSuspensos}`,
    `GERENTES_COM_PROFISSIONAL: ${impacto.gerentesComProfissional}`,
    `GERENTES_COM_AJUSTES_CONCEDIDOS: ${impacto.gerentesComAjustesConcedidos} (continuam sem valer até o dono confirmar)`,
    `VAGAS_ACIMA_DO_LIMITE_ANTES: ${impacto.acimaAntes}`,
    `VAGAS_ACIMA_DO_LIMITE_DEPOIS: ${impacto.acimaDepois}`,
    `PASSAM_ACIMA_DO_LIMITE: ${impacto.passamAcima} (acessos preservados; novas criações e reativações recusadas)`,
    `PASSAM_AO_LIMITE: ${impacto.passamAoLimite} (o próximo acesso ou convite é recusado)`,
    `COLISOES_DE_LOGIN: ${impacto.colisoesCruzadas}`,
  ];
  for (const d of impacto.detalhes) {
    linhas.push(
      `VAGAS: tenant=${d.tenantId} slug=${d.slug} situacao=${d.situacao} plano=${d.plano} limite=${d.limite} profissionais=${d.acessosDeProfissional} gerentes=${d.gerentesAtivos} convites=${d.convitesPendentes} antes=${d.vagasAntes} depois=${d.vagasDepois}`,
    );
  }
  for (const c of impacto.colisoes) linhas.push(`COLISAO: login_user=${c.loginUserId} email_user=${c.emailUserId}`);
  if (impacto.colisoes.length < impacto.colisoesCruzadas) {
    linhas.push(`COLISOES_NAO_LISTADAS: ${impacto.colisoesCruzadas - impacto.colisoes.length}`);
  }
  return linhas;
}

// ------------------------------------------------------- cópia e reversão

export interface NovosDadosDoGerente {
  vinculosConfirmados: number;
  ajustesComValoresNovos: number;
}

/** Logo depois da migration numa cópia: nada nasceu confirmado nem concedido. */
export async function lerNovosDadosDoGerente(client: PgClientLike): Promise<NovosDadosDoGerente> {
  return somenteLeitura(client, async () => {
    const [r] = (
      await client.query<{ confirmados: string; ajustes: string }>(
        `SELECT (SELECT count(*) FROM memberships WHERE permissions_confirmed_at IS NOT NULL)::text AS confirmados,
                (SELECT count(*) FROM membership_permission_overrides
                  WHERE permission::text = ANY($1))::text AS ajustes`,
        [VALORES_GERENTE.map((v) => v.slice('permission.'.length))],
      )
    ).rows;
    return {
      vinculosConfirmados: parseNonNegativeInteger(r?.confirmados, 'memberships_confirmed'),
      ajustesComValoresNovos: parseNonNegativeInteger(r?.ajustes, 'overrides_new_values'),
    };
  });
}

/** Em `after`: o que um `migration:revert` recusaria, apagaria ou deixaria de
 * valer. */
export async function lerEfeitoDaReversao(client: PgClientLike): Promise<Record<string, number>> {
  return somenteLeitura(client, async () => {
    const [r] = (
      await client.query<Record<string, string>>(
        `SELECT
          (SELECT count(*) FROM users WHERE username IS NOT NULL AND NOT (username::text ~ $1))::text AS "loginsForaDoFormatoAnterior",
          (SELECT count(*) FROM memberships WHERE permissions_confirmed_at IS NOT NULL)::text AS "vinculosConfirmados",
          (SELECT count(*) FROM memberships WHERE role = 'GERENTE' AND status = 'ACTIVE')::text AS "gerentesAtivos",
          (SELECT count(*) FROM membership_permission_overrides WHERE permission::text = ANY($2))::text AS "ajustesComValoresNovos"`,
        [FORMATO_ANTERIOR_DO_LOGIN, VALORES_GERENTE.map((v) => v.slice('permission.'.length))],
      )
    ).rows;
    return Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, parseNonNegativeInteger(v, k)]));
  });
}
