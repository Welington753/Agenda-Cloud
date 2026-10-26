// Leituras da gestão de contas. Cada uma numa transação READ ONLY /
// REPEATABLE READ, com a autorização relida no banco ANTES da consulta, como
// em platform.service.ts. Nenhuma devolve hash, token, link ou dado de sessão
// além de contagens.
//
// Os contadores vêm do mesmo conjunto filtrado da lista (sem o filtro de
// situação, que é o que eles detalham), nunca da página carregada.
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { PlatformRole } from '../entities/enums/platform-role.enum.js';
import type { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import type { Permission } from '../entities/enums/permission.enum.js';
import { PermissionMode } from '../entities/enums/permission-mode.enum.js';
import { EFFECTIVE_PLATFORM_PERMISSIONS, platformCapabilities } from '../platform/platform-access.js';
import type { AuditQuery, InvitesQuery, UsersQuery } from './accounts.dto.js';
import { canManageAccount, loadActor, type Actor } from './actor.js';
import { INVITE_COLUMNS, INVITE_FROM, INVITE_STATUS_SQL, type InviteView } from './invite-views.js';
import { PASSWORD_RESET_COLUMNS, type PasswordResetView } from './password-resets.service.js';
import {
  EFFECTIVE_TENANT_PERMISSIONS,
  EFFECTIVE_TENANT_ROLES,
  TENANT_AREAS,
  tenantEffectiveAccess,
} from './tenant-effective-access.js';
import { MAX_INVITE_SENDS } from './account-token.js';
import { STAFF_PERMISSIONS } from '../team/staff-access.js';

const escaparLike = (texto: string) => `%${texto.replace(/[\\%_]/g, '\\$&')}%`;

interface Filtro {
  sql: string;
  values: unknown[];
}

function juntar(clausulas: string[]): string {
  return clausulas.length ? `WHERE ${clausulas.join(' AND ')}` : '';
}

const TENANT_NAME = `(SELECT COALESCE(un.name, t.slug::text) FROM units un
  WHERE un.tenant_id = t.id AND un.is_primary = true ORDER BY un.created_at, un.id LIMIT 1)`;

interface MembershipRow {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: string;
  role: EstablishmentRole;
  status: string;
  professional: { id: string; name: string; active: boolean } | null;
  createdAt: string;
  overrides: { permission: Permission; mode: PermissionMode }[];
}

function vinculoParaTela(row: MembershipRow) {
  const denied = row.overrides.filter((o) => o.mode === PermissionMode.DENIED).map((o) => o.permission);
  return {
    id: row.id,
    tenant: { id: row.tenantId, name: row.tenantName, slug: row.tenantSlug, status: row.tenantStatus },
    role: row.role,
    /** `SUSPENDED`: o dono suspendeu este acesso; o vínculo não opera. */
    status: row.status,
    professional: row.professional,
    roleHasAccess: EFFECTIVE_TENANT_ROLES.includes(row.role),
    createdAt: row.createdAt,
    deniedPermissions: denied.filter((p) => EFFECTIVE_TENANT_PERMISSIONS.includes(p)).sort(),
    /** Ajustes antigos sem efeito em nenhuma rota (ex.: `GRANTED`): só
     * mostrados, nunca editados aqui. */
    ineffectiveOverrides: row.overrides
      .filter((o) => o.mode !== PermissionMode.DENIED || !EFFECTIVE_TENANT_PERMISSIONS.includes(o.permission))
      .filter((o) => !(o.mode === PermissionMode.GRANTED && (STAFF_PERMISSIONS as readonly string[]).includes(o.permission)))
      .map((o) => `${o.mode}:${o.permission}`)
      .sort(),
    effectiveAccess: tenantEffectiveAccess(row.role, row.overrides),
  };
}

const MEMBERSHIP_COLUMNS = `m.id, m.tenant_id AS "tenantId", ${TENANT_NAME} AS "tenantName",
    t.slug AS "tenantSlug", t.status AS "tenantStatus", m.role, m.status, m.created_at AS "createdAt",
    (SELECT json_build_object('id', p.id, 'name', p.name, 'active', p.active) FROM professionals p
      WHERE p.tenant_id = m.tenant_id AND p.id = m.professional_id) AS professional,
    COALESCE((SELECT json_agg(json_build_object('permission', o.permission, 'mode', o.mode) ORDER BY o.permission)
      FROM membership_permission_overrides o WHERE o.membership_id = m.id AND o.tenant_id = m.tenant_id), '[]'::json)
      AS overrides`;
const MEMBERSHIP_FROM = `FROM memberships m JOIN tenants t ON t.id = m.tenant_id`;
const MEMBERSHIP_SELECT = `SELECT ${MEMBERSHIP_COLUMNS} ${MEMBERSHIP_FROM}`;

@Injectable()
export class AccountsDirectoryService {
  constructor(private readonly dataSource: DataSource) {}

  private read<T>(actorId: string, operation: (manager: EntityManager, actor: Actor) => Promise<T>): Promise<T> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const actor = await loadActor(manager, actorId);
      if (!actor.caps.viewDirectory) throw new ForbiddenException('Sem acesso à administração da plataforma.');
      return operation(manager, actor);
    });
  }

  async access(actorId: string) {
    const actor = await loadActor(this.dataSource.manager, actorId);
    return {
      canViewEstablishments: actor.caps.viewDirectory,
      capabilities: actor.caps,
      platformRole: actor.caps.viewDirectory ? actor.platformRole : null,
    };
  }

  /** O que cada papel e permissão faz DE FATO nesta versão (gerado das
   * mesmas funções usadas pelas rotas). */
  roles(actorId: string) {
    return this.read(actorId, async () => ({
      platformRoles: Object.values(PlatformRole).map((role) => ({
        role,
        withoutPermissions: platformCapabilities({ status: 'ACTIVE' as never, platformRole: role, platformPermissions: [] }),
        withEffectivePermissions: platformCapabilities({
          status: 'ACTIVE' as never,
          platformRole: role,
          platformPermissions: [...EFFECTIVE_PLATFORM_PERMISSIONS],
        }),
      })),
      effectivePlatformPermissions: EFFECTIVE_PLATFORM_PERMISSIONS,
      tenantAreas: TENANT_AREAS.map((area) => ({ key: area.key, label: area.label })),
      effectiveTenantRoles: EFFECTIVE_TENANT_ROLES,
      effectiveTenantPermissions: EFFECTIVE_TENANT_PERMISSIONS,
      tenantRoleAccess: (['DONO', 'GERENTE', 'RECEPCIONISTA', 'PROFISSIONAL'] as EstablishmentRole[]).map((role) => ({
        role,
        areas: tenantEffectiveAccess(role, []).filter((a) => a.allowed).map((a) => a.key),
      })),
      maxInviteSends: MAX_INVITE_SENDS,
    }));
  }

  plans(actorId: string) {
    return this.read(actorId, (manager) =>
      manager.query(
        `SELECT id, code, name, price_cents AS "catalogPriceCents", max_professionals AS "maxProfessionals",
                max_units AS "maxUnits" FROM plans ORDER BY name, id`,
      ),
    );
  }

  establishmentOptions(actorId: string) {
    return this.read(actorId, async (manager) => {
      const items = await manager.query<{ id: string; name: string }[]>(
        `SELECT t.id, ${TENANT_NAME} AS name FROM tenants t ORDER BY 2, t.id LIMIT 501`,
      );
      return { items: items.slice(0, 500), truncated: items.length > 500 };
    });
  }

  listUsers(actorId: string, query: UsersQuery) {
    return this.read(actorId, async (manager) => {
      const base: string[] = [];
      const values: unknown[] = [];
      if (query.q) {
        values.push(escaparLike(query.q));
        base.push(`(u.name ILIKE $${values.length} OR u.email::text ILIKE $${values.length})`);
      }
      if (query.tenantId) {
        values.push(query.tenantId);
        base.push(`EXISTS (SELECT 1 FROM memberships fm WHERE fm.user_id = u.id AND fm.tenant_id = $${values.length})`);
      }
      if (query.platformRole === 'NONE') base.push('u.platform_role IS NULL');
      else if (query.platformRole) {
        values.push(query.platformRole);
        base.push(`u.platform_role = $${values.length}::platform_role`);
      }
      const comSituacao = [...base];
      const valoresComSituacao = [...values];
      if (query.status) {
        valoresComSituacao.push(query.status);
        comSituacao.push(`u.status = $${valoresComSituacao.length}::user_status`);
      }
      const filtro: Filtro = { sql: juntar(comSituacao), values: valoresComSituacao };
      const [count] = await manager.query<{ total: number }[]>(
        `SELECT count(*)::int AS total FROM users u ${filtro.sql}`,
        filtro.values,
      );
      const items = await manager.query(
        `SELECT u.id, u.name, u.email, u.phone, u.status, u.email_verified AS "emailVerified",
                u.platform_role AS "platformRole", COALESCE(to_json(u.platform_permissions), '[]'::json) AS "platformPermissions",
                u.created_at AS "createdAt", u.updated_at AS "updatedAt",
                EXISTS (SELECT 1 FROM credentials c WHERE c.user_id = u.id) AS "hasPassword",
                COALESCE((SELECT json_agg(json_build_object('tenantId', t.id, 'tenantName', ${TENANT_NAME},
                    'role', m.role, 'status', m.status, 'tenantStatus', t.status) ORDER BY m.created_at, m.id)
                  FROM memberships m JOIN tenants t ON t.id = m.tenant_id WHERE m.user_id = u.id), '[]'::json)
                  AS memberships
           FROM users u ${filtro.sql}
          ORDER BY u.created_at DESC, u.id DESC
          LIMIT $${filtro.values.length + 1} OFFSET $${filtro.values.length + 2}`,
        [...filtro.values, query.pageSize, (query.page - 1) * query.pageSize],
      );
      const [summary] = await manager.query<Record<string, number>[]>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE u.status = 'ACTIVE')::int AS active,
                count(*) FILTER (WHERE u.status = 'INVITED')::int AS invited,
                count(*) FILTER (WHERE u.status = 'SUSPENDED')::int AS suspended,
                count(*) FILTER (WHERE u.platform_role IS NOT NULL)::int AS "platformAccounts",
                count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM memberships sm WHERE sm.user_id = u.id))::int
                  AS "withoutEstablishment"
           FROM users u ${juntar(base)}`,
        values,
      );
      return { items, total: count.total, page: query.page, pageSize: query.pageSize, summary };
    });
  }

  userDetail(actorId: string, userId: string) {
    return this.read(actorId, async (manager, actor) => {
      const [user] = await manager.query<
        {
          id: string;
          name: string;
          email: string;
          phone: string | null;
          status: string;
          emailVerified: boolean;
          platformRole: PlatformRole | null;
          platformPermissions: string[];
          createdAt: string;
          updatedAt: string;
          lastSeenAt: string | null;
          hasPassword: boolean;
          activeSessions: number;
        }[]
      >(
        `SELECT u.id, u.name, u.email, u.phone, u.status, u.email_verified AS "emailVerified",
                u.platform_role AS "platformRole", COALESCE(u.platform_permissions::text[], '{}') AS "platformPermissions",
                u.created_at AS "createdAt", u.updated_at AS "updatedAt", u.last_seen_at AS "lastSeenAt",
                EXISTS (SELECT 1 FROM credentials c WHERE c.user_id = u.id) AS "hasPassword",
                (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL
                  AND s.expires_at > now()) AS "activeSessions"
           FROM users u WHERE u.id = $1`,
        [userId],
      );
      if (!user) throw new NotFoundException('Conta não encontrada.');
      const memberships = await manager.query<MembershipRow[]>(
        `${MEMBERSHIP_SELECT} WHERE m.user_id = $1 ORDER BY m.created_at, m.id`,
        [userId],
      );
      const invites = await manager.query<{ invite: InviteView }[]>(
        `SELECT ${INVITE_COLUMNS} ${INVITE_FROM} WHERE i.target_user_id = $1 ORDER BY i.created_at DESC, i.id DESC LIMIT 20`,
        [userId],
      );
      const [reset] = await manager.query<{ reset: PasswordResetView }[]>(
        `SELECT ${PASSWORD_RESET_COLUMNS} FROM password_resets r JOIN users req ON req.id = r.requested_by_user_id
          WHERE r.user_id = $1 ORDER BY r.created_at DESC, r.id DESC LIMIT 1`,
        [userId],
      );
      const pode = canManageAccount(actor, { id: user.id, platformRole: user.platformRole });
      return {
        ...user,
        platformCapabilities: platformCapabilities({
          status: user.status as never,
          platformRole: user.platformRole ?? undefined,
          platformPermissions: user.platformPermissions as never,
        }),
        ineffectivePlatformPermissions: user.platformPermissions.filter(
          (p) => !EFFECTIVE_PLATFORM_PERMISSIONS.includes(p as never),
        ),
        memberships: memberships.map(vinculoParaTela),
        invites: invites.map((linha) => linha.invite),
        latestPasswordReset: reset?.reset ?? null,
        /** O que a conta que está olhando pode fazer aqui (o servidor confere
         * de novo em cada operação). */
        allowedActions: {
          edit: pode,
          block: pode && user.status !== 'SUSPENDED',
          reactivate: pode && user.status === 'SUSPENDED',
          resetPassword: pode && user.status === 'ACTIVE' && user.hasPassword,
          changePlatformAccess: actor.caps.managePlatformAccess && user.id !== actor.id,
          manageMemberships: pode,
        },
      };
    });
  }

  establishmentMembers(actorId: string, tenantId: string) {
    return this.read(actorId, async (manager, actor) => {
      const [tenant] = await manager.query<{ id: string }[]>('SELECT id FROM tenants WHERE id = $1', [tenantId]);
      if (!tenant) throw new NotFoundException('Estabelecimento não encontrado.');
      const rows = await manager.query<
        (MembershipRow & { userId: string; userName: string; userEmail: string; userStatus: string; platformRole: PlatformRole | null })[]
      >(
        `SELECT ${MEMBERSHIP_COLUMNS}, u.id AS "userId", u.name AS "userName", u.email AS "userEmail",
                u.status AS "userStatus", u.platform_role AS "platformRole"
           ${MEMBERSHIP_FROM} JOIN users u ON u.id = m.user_id
          WHERE m.tenant_id = $1 ORDER BY m.created_at, m.id`,
        [tenantId],
      );
      const invites = await manager.query<{ invite: InviteView }[]>(
        `SELECT ${INVITE_COLUMNS} ${INVITE_FROM} WHERE i.tenant_id = $1 AND ${INVITE_STATUS_SQL} = 'PENDING'
          ORDER BY i.created_at DESC, i.id DESC`,
        [tenantId],
      );
      return {
        members: rows.map((row) => ({
          ...vinculoParaTela(row),
          user: { id: row.userId, name: row.userName, email: row.userEmail, status: row.userStatus },
          canManage: canManageAccount(actor, { id: row.userId, platformRole: row.platformRole }),
        })),
        pendingInvites: invites.map((linha) => linha.invite),
        canInvite: actor.caps.manageEstablishments,
      };
    });
  }

  listInvites(actorId: string, query: InvitesQuery) {
    return this.read(actorId, async (manager) => {
      const base: string[] = [];
      const values: unknown[] = [];
      if (query.q) {
        values.push(escaparLike(query.q));
        base.push(`(i.target_name ILIKE $${values.length} OR i.target_email::text ILIKE $${values.length})`);
      }
      if (query.tenantId) {
        values.push(query.tenantId);
        base.push(`i.tenant_id = $${values.length}`);
      }
      const comSituacao = [...base];
      const valoresComSituacao = [...values];
      if (query.status) {
        valoresComSituacao.push(query.status);
        comSituacao.push(`${INVITE_STATUS_SQL} = $${valoresComSituacao.length}`);
      }
      const [count] = await manager.query<{ total: number }[]>(
        `SELECT count(*)::int AS total ${INVITE_FROM} ${juntar(comSituacao)}`,
        valoresComSituacao,
      );
      const items = await manager.query<{ invite: InviteView }[]>(
        `SELECT ${INVITE_COLUMNS} ${INVITE_FROM} ${juntar(comSituacao)}
          ORDER BY i.created_at DESC, i.id DESC
          LIMIT $${valoresComSituacao.length + 1} OFFSET $${valoresComSituacao.length + 2}`,
        [...valoresComSituacao, query.pageSize, (query.page - 1) * query.pageSize],
      );
      const [summary] = await manager.query<Record<string, number>[]>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE ${INVITE_STATUS_SQL} = 'PENDING')::int AS pending,
                count(*) FILTER (WHERE ${INVITE_STATUS_SQL} = 'ACCEPTED')::int AS accepted,
                count(*) FILTER (WHERE ${INVITE_STATUS_SQL} = 'EXPIRED')::int AS expired,
                count(*) FILTER (WHERE ${INVITE_STATUS_SQL} = 'REVOKED')::int AS revoked,
                count(*) FILTER (WHERE ${INVITE_STATUS_SQL} = 'PENDING'
                  AND i.delivery_status IN ('FAILED', 'NOT_CONFIGURED'))::int AS "deliveryProblems"
           ${INVITE_FROM} ${juntar(base)}`,
        values,
      );
      return {
        items: items.map((linha) => linha.invite),
        total: count.total,
        page: query.page,
        pageSize: query.pageSize,
        summary,
      };
    });
  }

  listAudit(actorId: string, query: AuditQuery) {
    return this.read(actorId, async (manager) => {
      const clausulas: string[] = [];
      const values: unknown[] = [];
      if (query.action) {
        values.push(query.action);
        clausulas.push(`a.action::text = $${values.length}`);
      }
      if (query.tenantId) {
        values.push(query.tenantId);
        clausulas.push(`a.tenant_id = $${values.length}`);
      }
      if (query.targetUserId) {
        values.push(query.targetUserId);
        clausulas.push(`(a.target_user_id = $${values.length} OR a.actor_user_id = $${values.length})`);
      }
      const where = juntar(clausulas);
      const [count] = await manager.query<{ total: number }[]>(
        `SELECT count(*)::int AS total FROM audit_logs a ${where}`,
        values,
      );
      const items = await manager.query(
        `SELECT a.id, a.occurred_at AS "occurredAt", a.action, a.summary,
                json_build_object('id', a.actor_user_id, 'name', a.actor_name) AS actor,
                CASE WHEN tu.id IS NULL THEN NULL ELSE json_build_object('id', tu.id, 'name', tu.name, 'email', tu.email) END
                  AS target,
                CASE WHEN t.id IS NULL THEN NULL ELSE json_build_object('id', t.id, 'name', ${TENANT_NAME}) END AS tenant,
                a.previous_data AS "previousData", a.new_data AS "newData"
           FROM audit_logs a
           LEFT JOIN users tu ON tu.id = a.target_user_id
           LEFT JOIN tenants t ON t.id = a.tenant_id
           ${where}
          ORDER BY a.occurred_at DESC, a.id DESC
          LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, query.pageSize, (query.page - 1) * query.pageSize],
      );
      return { items, total: count.total, page: query.page, pageSize: query.pageSize };
    });
  }
}
