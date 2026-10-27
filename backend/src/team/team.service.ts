// "Equipe e acessos": o dono vê os profissionais do estabelecimento com a
// situação do acesso de cada um e administra os acessos de FUNCIONÁRIO.
//
// O que cada ação faz (e o que NÃO faz):
//
// - Suspender: o vínculo fica `SUSPENDED`. A pessoa deixa de operar ESTE
//   estabelecimento já na próxima requisição; a conta, a senha, as sessões e
//   os acessos a outros estabelecimentos continuam. Libera a vaga do plano.
// - Reativar: volta a `ACTIVE` se houver vaga, se o profissional estiver
//   ativo e se a CONTA não estiver bloqueada pela administração da plataforma
//   (só ela reativa uma conta bloqueada).
// - Remover acesso: apaga só este vínculo (e os ajustes dele). A conta e os
//   outros vínculos ficam; agenda, reservas e o cadastro do profissional ficam.
// - Permissões: as três ações sobre os próprios atendimentos, uma a uma, só
//   as que o próprio dono pode fazer.
//
// Só vínculos `PROFISSIONAL` passam por aqui: o dono não altera outro dono
// nem a si mesmo, e nada aqui concede papel de plataforma.
//
// Mudanças de acesso exigem senha confirmada há pouco NESTA sessão (a mesma
// reautenticação da administração), e o histórico entra na mesma transação.
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { generateId } from '../entities/common/generate-id.js';
import { loadActor } from '../accounts/actor.js';
import { recordAudit } from '../accounts/audit.js';
import { requireRecentReauth } from '../accounts/reauth.js';
import { linhasDe } from '../notifications/notification-jobs.repository.js';
import { MAX_INVITE_SENDS } from '../accounts/account-token.js';
import {
  activeProfessionals,
  isOperational,
  lockTenantForSeats,
  seatLimitMessage,
  staffSeatUsage,
} from './seats.js';
import {
  STAFF_PERMISSIONS,
  STAFF_PERMISSION_LABELS,
  staffGrantedPermissions,
  type OverrideRow,
  type StaffPermission,
} from './staff-access.js';
import { resolveTeamManager } from './team-authorization.js';
import type { StaffPermissionsChangeDto } from './team.dto.js';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';

const conflito = (code: string, message: string) => new ConflictException({ code, message });
const ACCESS_NOT_FOUND_MESSAGE = 'Acesso não encontrado. Ele pode já ter sido removido.';

interface StaffMembershipRow {
  id: string;
  user_id: string;
  status: 'ACTIVE' | 'SUSPENDED';
  professional_id: string | null;
  email: string;
  name: string;
  user_status: string;
  professional_active: boolean | null;
  overrides: OverrideRow[];
}

@Injectable()
export class TeamService {
  constructor(private readonly dataSource: DataSource) {}

  /** Profissionais, acessos, convites e vagas, numa leitura consistente. */
  overview(userId: string, tenantId: string, now = new Date()) {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const gestor = await resolveTeamManager(manager, userId, tenantId);
      const [tenant] = await manager.query<{ name: string; plan_name: string; max_professionals: number }[]>(
        `SELECT COALESCE((SELECT name FROM units WHERE tenant_id = t.id AND is_primary = true ORDER BY created_at, id LIMIT 1),
                  t.slug::text) AS name, p.name AS plan_name, p.max_professionals
           FROM tenants t JOIN plans p ON p.id = t.plan_id WHERE t.id = $1`,
        [gestor.tenantId],
      );
      const vagas = await staffSeatUsage(manager, gestor.tenantId, tenant.max_professionals, now);
      const ativos = await activeProfessionals(manager, gestor.tenantId);
      const profissionais = await manager.query<
        { id: string; name: string; active: boolean; future_appointments: number }[]
      >(
        `SELECT p.id, p.name, p.active,
                (SELECT count(*)::int FROM appointments a WHERE a.tenant_id = p.tenant_id AND a.professional_id = p.id
                   AND a.status IN ('PENDING', 'CONFIRMED') AND a.start_at > $2) AS future_appointments
           FROM professionals p WHERE p.tenant_id = $1 ORDER BY p.active DESC, p.name, p.id`,
        [gestor.tenantId, now],
      );
      const vinculos = await manager.query<
        {
          id: string;
          role: string;
          status: string;
          professional_id: string;
          user_id: string;
          name: string;
          email: string;
          sem_email: boolean;
          username: string | null;
          papel_plataforma: boolean;
          vinculos: number;
          user_status: string;
          status_changed_at: string | null;
          overrides: OverrideRow[];
        }[]
      >(
        `SELECT m.id, m.role, m.status, m.professional_id, m.status_changed_at, u.id AS user_id, u.name, COALESCE(u.email::text, u.username::text) AS email, u.email IS NULL AS sem_email,
                u.username::text AS username, u.platform_role IS NOT NULL AS papel_plataforma,
                (SELECT count(*)::int FROM memberships o WHERE o.user_id = u.id) AS vinculos,
                u.status AS user_status,
                COALESCE((SELECT json_agg(json_build_object('permission', o.permission, 'mode', o.mode))
                  FROM membership_permission_overrides o WHERE o.tenant_id = m.tenant_id AND o.membership_id = m.id),
                  '[]'::json) AS overrides
           FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.tenant_id = $1 AND m.professional_id IS NOT NULL`,
        [gestor.tenantId],
      );
      const convites = await manager.query<
        {
          id: string;
          professional_id: string;
          target_name: string;
          target_email: string;
          expires_at: string;
          send_count: number;
          delivery_status: string;
          delivery_failure: string | null;
          account_exists: boolean;
        }[]
      >(
        `SELECT i.id, i.professional_id, i.target_name, i.target_email, i.expires_at, i.send_count,
                i.delivery_status, i.delivery_failure,
                EXISTS (SELECT 1 FROM credentials c WHERE c.user_id = i.target_user_id) AS account_exists
           FROM invites i
          WHERE i.tenant_id = $1 AND i.professional_id IS NOT NULL AND i.status = 'PENDING' AND i.expires_at > $2`,
        [gestor.tenantId, now],
      );
      const vinculoPor = new Map(vinculos.map((v) => [v.professional_id, v]));
      const convitePor = new Map(convites.map((c) => [c.professional_id, c]));
      return {
        tenant: { id: gestor.tenantId, name: tenant.name },
        plan: { name: tenant.plan_name, maxProfessionals: tenant.max_professionals },
        seats: vagas,
        professionals: { active: ativos, limit: tenant.max_professionals },
        grantablePermissions: gestor.grantable.map((p) => ({ permission: p, label: STAFF_PERMISSION_LABELS[p] })),
        permissionLabels: STAFF_PERMISSIONS.map((p) => ({ permission: p, label: STAFF_PERMISSION_LABELS[p] })),
        maxInviteSends: MAX_INVITE_SENDS,
        members: profissionais.map((p) => {
          const v = vinculoPor.get(p.id);
          const c = convitePor.get(p.id);
          const ehDono = v?.role === EstablishmentRole.DONO;
          return {
            professional: { id: p.id, name: p.name, active: p.active, futureAppointments: p.future_appointments },
            access: v
              ? {
                  membershipId: v.id,
                  role: v.role,
                  isOwner: ehDono,
                  status: v.status,
                  statusChangedAt: v.status_changed_at,
                  user: {
                    id: v.user_id,
                    name: v.name,
                    // E-mail ou, na conta sem e-mail, o nome de usuário.
                    email: v.email,
                    username: v.username,
                    hasEmail: !v.sem_email,
                    status: v.user_status,
                  },
                  // Só a conta criada pelo dono (usuário e senha, sem e-mail,
                  // sem papel na plataforma e só com este vínculo) recebe nova
                  // senha temporária por aqui.
                  canResetTemporaryPassword:
                    !ehDono && v.sem_email && !!v.username && !v.papel_plataforma && v.vinculos === 1,
                  grantedPermissions: ehDono ? [] : staffGrantedPermissions(v.role as EstablishmentRole, v.overrides),
                }
              : null,
            invite: c
              ? {
                  id: c.id,
                  name: c.target_name,
                  email: c.target_email,
                  expiresAt: c.expires_at,
                  sendCount: c.send_count,
                  delivery: { status: c.delivery_status, failure: c.delivery_failure },
                  accountExists: c.account_exists,
                }
              : null,
            /** Situação resumida para a tela. */
            situation: ehDono
              ? 'OWNER'
              : v
                ? v.status === 'ACTIVE'
                  ? p.active
                    ? 'ACTIVE'
                    : 'PROFESSIONAL_INACTIVE'
                  : 'SUSPENDED'
                : c
                  ? 'INVITED'
                  : 'NO_ACCESS',
          };
        }),
      };
    });
  }

  async suspend(actorId: string, sessionId: string, tenantId: string, membershipId: string, now = new Date()) {
    return this.dataSource.transaction(async (manager) => {
      await requireRecentReauth(manager, sessionId, now);
      const gestor = await resolveTeamManager(manager, actorId, tenantId);
      const vinculo = await this.lockStaffMembership(manager, gestor.tenantId, membershipId);
      if (vinculo.status === 'SUSPENDED') throw conflito('JA_SUSPENSO', 'Este acesso já está suspenso.');
      await manager.query(
        `UPDATE memberships SET status = 'SUSPENDED', status_changed_at = $2, status_changed_by_user_id = $3 WHERE id = $1`,
        [vinculo.id, now, actorId],
      );
      const actor = await loadActor(manager, actorId);
      await recordAudit(
        manager,
        {
          action: 'MEMBERSHIP_SUSPENDED',
          actor,
          tenantId: gestor.tenantId,
          targetUserId: vinculo.user_id,
          summary: `Acesso de funcionário de ${vinculo.email} suspenso neste estabelecimento.`,
          previousData: { membershipId: vinculo.id, status: 'ACTIVE', professionalId: vinculo.professional_id },
          newData: { status: 'SUSPENDED' },
        },
        now,
      );
      return { membershipId: vinculo.id, status: 'SUSPENDED' as const };
    });
  }

  async reactivate(actorId: string, sessionId: string, tenantId: string, membershipId: string, now = new Date()) {
    return this.dataSource.transaction(async (manager) => {
      await requireRecentReauth(manager, sessionId, now);
      const gestor = await resolveTeamManager(manager, actorId, tenantId);
      // Estabelecimento antes do vínculo: mesma ordem do convite e do aceite.
      const tenant = await lockTenantForSeats(manager, gestor.tenantId);
      if (!isOperational(tenant.status)) throw new NotFoundException('Estabelecimento não encontrado.');
      const vinculo = await this.lockStaffMembership(manager, gestor.tenantId, membershipId);
      if (vinculo.status === 'ACTIVE') throw conflito('JA_ATIVO', 'Este acesso já está ativo.');
      if (vinculo.user_status === 'SUSPENDED') {
        throw conflito(
          'CONTA_BLOQUEADA',
          'A conta desta pessoa está bloqueada pela administração da plataforma. Só a administração pode reativá-la.',
        );
      }
      if (!vinculo.professional_active) {
        throw conflito('PROFISSIONAL_INATIVO', 'O profissional deste acesso está desativado. Reative-o antes.');
      }
      const vagas = await staffSeatUsage(manager, gestor.tenantId, tenant.plan.maxProfessionals, now);
      if (vagas.used >= vagas.limit) throw conflito('LIMITE_DO_PLANO', seatLimitMessage(vagas));
      await manager.query(
        `UPDATE memberships SET status = 'ACTIVE', status_changed_at = $2, status_changed_by_user_id = $3 WHERE id = $1`,
        [vinculo.id, now, actorId],
      );
      const actor = await loadActor(manager, actorId);
      await recordAudit(
        manager,
        {
          action: 'MEMBERSHIP_REACTIVATED',
          actor,
          tenantId: gestor.tenantId,
          targetUserId: vinculo.user_id,
          summary: `Acesso de funcionário de ${vinculo.email} reativado neste estabelecimento.`,
          previousData: { membershipId: vinculo.id, status: 'SUSPENDED' },
          newData: { status: 'ACTIVE', seatsUsed: vagas.used + 1, seatsLimit: vagas.limit },
        },
        now,
      );
      return { membershipId: vinculo.id, status: 'ACTIVE' as const };
    });
  }

  async remove(actorId: string, sessionId: string, tenantId: string, membershipId: string, now = new Date()) {
    await this.dataSource.transaction(async (manager) => {
      await requireRecentReauth(manager, sessionId, now);
      const gestor = await resolveTeamManager(manager, actorId, tenantId);
      const vinculo = await this.lockStaffMembership(manager, gestor.tenantId, membershipId);
      await manager.query('DELETE FROM memberships WHERE id = $1 AND tenant_id = $2', [vinculo.id, gestor.tenantId]);
      const actor = await loadActor(manager, actorId);
      await recordAudit(
        manager,
        {
          action: 'MEMBERSHIP_REMOVED',
          actor,
          tenantId: gestor.tenantId,
          targetUserId: vinculo.user_id,
          summary: `Acesso de funcionário de ${vinculo.email} removido deste estabelecimento.`,
          previousData: {
            membershipId: vinculo.id,
            role: 'PROFISSIONAL',
            status: vinculo.status,
            professionalId: vinculo.professional_id,
            granted: staffGrantedPermissions(EstablishmentRole.PROFISSIONAL, vinculo.overrides),
          },
        },
        now,
      );
    });
  }

  async setPermissions(
    actorId: string,
    sessionId: string,
    tenantId: string,
    membershipId: string,
    dto: StaffPermissionsChangeDto,
    now = new Date(),
  ) {
    return this.dataSource.transaction(async (manager) => {
      await requireRecentReauth(manager, sessionId, now);
      const gestor = await resolveTeamManager(manager, actorId, tenantId);
      const vinculo = await this.lockStaffMembership(manager, gestor.tenantId, membershipId);
      const atuais = staffGrantedPermissions(EstablishmentRole.PROFISSIONAL, vinculo.overrides).sort();
      if (JSON.stringify(atuais) !== JSON.stringify([...dto.expectedGranted].sort())) {
        throw conflito('ALTERADO_POR_OUTRA_TELA', 'As permissões mudaram desde que você abriu a tela. Recarregue.');
      }
      const novas = [...dto.granted].sort() as StaffPermission[];
      const acrescentar = novas.filter((p) => !atuais.includes(p));
      const remover = atuais.filter((p) => !novas.includes(p));
      // Só concede o que o próprio dono pode fazer. Retirar é sempre possível.
      const indevidas = acrescentar.filter((p) => !gestor.grantable.includes(p));
      if (indevidas.length) {
        throw conflito(
          'PERMISSAO_NAO_DISPONIVEL',
          'Você só pode liberar ações que você mesmo pode fazer neste estabelecimento.',
        );
      }
      if (remover.length) {
        await manager.query(
          `DELETE FROM membership_permission_overrides
            WHERE tenant_id = $1 AND membership_id = $2 AND mode = 'GRANTED' AND permission::text = ANY($3)`,
          [gestor.tenantId, vinculo.id, remover],
        );
      }
      for (const permission of acrescentar) {
        await manager.query(
          `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode)
           VALUES ($1, $2, $3, $4::permission, 'GRANTED')
           ON CONFLICT (tenant_id, membership_id, permission) DO UPDATE SET mode = 'GRANTED'`,
          [generateId(), gestor.tenantId, vinculo.id, permission],
        );
      }
      if (acrescentar.length || remover.length) {
        const actor = await loadActor(manager, actorId);
        await recordAudit(
          manager,
          {
            action: 'USER_PERMISSION_CHANGED',
            actor,
            tenantId: gestor.tenantId,
            targetUserId: vinculo.user_id,
            summary: `Permissões de funcionário de ${vinculo.email} alteradas.`,
            previousData: { granted: atuais },
            newData: { granted: novas },
          },
          now,
        );
      }
      return { membershipId: vinculo.id, grantedPermissions: novas };
    });
  }

  /** Trava um vínculo de FUNCIONÁRIO deste estabelecimento. Vínculo de dono,
   * de outro estabelecimento ou inexistente: 404 (indistinguíveis). */
  private async lockStaffMembership(
    manager: EntityManager,
    tenantId: string,
    membershipId: string,
  ): Promise<StaffMembershipRow> {
    const linhas = linhasDe<StaffMembershipRow>(
      await manager.query(
        `SELECT m.id, m.user_id, m.status, m.professional_id, COALESCE(u.email::text, u.username::text) AS email, u.name, u.status AS user_status,
                p.active AS professional_active,
                COALESCE((SELECT json_agg(json_build_object('permission', o.permission, 'mode', o.mode))
                  FROM membership_permission_overrides o WHERE o.tenant_id = m.tenant_id AND o.membership_id = m.id),
                  '[]'::json) AS overrides
           FROM memberships m
           JOIN users u ON u.id = m.user_id
           LEFT JOIN professionals p ON p.tenant_id = m.tenant_id AND p.id = m.professional_id
          WHERE m.id = $1 AND m.tenant_id = $2 AND m.role = 'PROFISSIONAL'
          FOR UPDATE OF m`,
        [membershipId, tenantId],
      ),
    );
    const [vinculo] = linhas;
    if (!vinculo) throw new NotFoundException(ACCESS_NOT_FOUND_MESSAGE);
    return vinculo;
  }
}
