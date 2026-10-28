// "Equipe e acessos": o dono vê os acessos da equipe (profissionais e
// gerentes), os profissionais sem acesso e os convites antigos ainda
// pendentes, e administra os acessos de equipe.
//
// O que cada ação faz (e o que NÃO faz):
//
// - Suspender: o vínculo fica `SUSPENDED`. A pessoa deixa de operar ESTE
//   estabelecimento já na próxima requisição; a conta, a senha, as sessões e
//   os acessos a outros estabelecimentos continuam. Libera a vaga do plano.
// - Reativar: volta a `ACTIVE` se houver vaga, se o profissional ligado (o
//   do funcionário sempre; o do gerente, quando há) estiver ativo e se a
//   CONTA não estiver bloqueada pela administração da plataforma (só ela
//   reativa uma conta bloqueada).
// - Remover acesso: apaga só este vínculo (e os ajustes dele). A conta e os
//   outros vínculos ficam; agenda, reservas e o cadastro do profissional ficam.
// - Permissões: as três ações sobre os próprios atendimentos (quem tem
//   profissional ligado) e, no gerente, as áreas do estabelecimento — só as
//   que o próprio dono pode fazer, com as dependências junto
//   (team-permissions.ts). Salvar as permissões de um gerente é a
//   CONFIRMAÇÃO do dono: um gerente antigo só passa a ter área depois disso.
// - Perfil e profissional: troca o perfil (profissional ou gerente) e o
//   profissional ligado do MESMO vínculo, sem remover e recriar. A conta, o
//   login, a senha, as sessões e o histórico ficam. Nenhum agendamento muda
//   de profissional. O novo profissional segue as regras da criação (deste
//   estabelecimento, ativo, sem outro acesso e sem convite pendente). A vaga
//   não muda: os dois perfis ocupam vaga igual. As permissões vão junto, no
//   conjunto que o dono conferiu e confirmou na tela: a troca nunca concede
//   nada sozinha. Trocar o PERFIL só vale para a conta que é só deste
//   estabelecimento (sem papel na plataforma e sem outro vínculo).
//
// Só vínculos PROFISSIONAL e GERENTE passam por aqui: o dono não altera outro
// dono nem a si mesmo, e nada aqui concede papel de plataforma. RECEPCIONISTA
// (papel antigo, sem área) aparece na lista, sem ações.
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
import { effectiveOverrides } from '../common/tenant-authorization.js';
import {
  MANAGER_AREA_LABELS,
  MANAGER_PERMISSIONS,
  MANAGER_PERMISSION_META,
  MANAGER_PERMISSION_REQUIRES,
  managerGrantedPermissions,
} from '../common/manager-permissions.js';
import { isUniqueViolation } from '../auth/unique-violation.js';
import {
  activeProfessionals,
  expireStaleStaffInvites,
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
  type TeamRole,
} from './staff-access.js';
import { resolveTeamManager } from './team-authorization.js';
import type { StaffAccessChangeDto, StaffPermissionsChangeDto, TeamPermission } from './team.dto.js';
import { validarConcessoes } from './team-permissions.js';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';

const conflito = (code: string, message: string) => new ConflictException({ code, message });
const ACCESS_NOT_FOUND_MESSAGE = 'Acesso não encontrado. Ele pode já ter sido removido.';
const ROLE_LABEL: Readonly<Record<TeamRole, string>> = { PROFISSIONAL: 'profissional', GERENTE: 'gerente' };

interface StaffMembershipRow {
  id: string;
  user_id: string;
  role: TeamRole;
  status: 'ACTIVE' | 'SUSPENDED';
  professional_id: string | null;
  email: string;
  name: string;
  user_status: string;
  professional_active: boolean | null;
  professional_name: string | null;
  papel_plataforma: boolean;
  vinculos: number;
  permissions_confirmed: boolean;
  overrides: OverrideRow[];
}

/** O que vale hoje para o vínculo: as três ações próprias e as áreas de
 * gerente, na ordem do catálogo. Com os ajustes EFETIVOS (gerente sem
 * confirmação não tem nada). */
export function grantedTeamPermissions(
  role: string,
  permissionsConfirmed: boolean,
  overrides: readonly OverrideRow[],
): TeamPermission[] {
  if (role !== EstablishmentRole.PROFISSIONAL && role !== EstablishmentRole.GERENTE) return [];
  const valem = effectiveOverrides(role, permissionsConfirmed, overrides);
  return [...staffGrantedPermissions(role as EstablishmentRole, valem), ...managerGrantedPermissions(role, valem)];
}

@Injectable()
export class TeamService {
  constructor(private readonly dataSource: DataSource) {}

  /** Acessos, profissionais, convites e vagas, numa leitura consistente. */
  overview(userId: string, tenantId: string, now = new Date()) {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      const gestor = await resolveTeamManager(manager, userId, tenantId);
      const [tenant] = await manager.query<{ name: string; slug: string; plan_name: string; max_professionals: number }[]>(
        `SELECT COALESCE((SELECT name FROM units WHERE tenant_id = t.id AND is_primary = true ORDER BY created_at, id LIMIT 1),
                  t.slug::text) AS name, t.slug::text AS slug, p.name AS plan_name, p.max_professionals
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
          professional_id: string | null;
          user_id: string;
          name: string;
          email: string;
          sem_email: boolean;
          username: string | null;
          papel_plataforma: boolean;
          vinculos: number;
          user_status: string;
          status_changed_at: string | null;
          created_at: string;
          permissions_confirmed: boolean;
          overrides: OverrideRow[];
        }[]
      >(
        `SELECT m.id, m.role, m.status, m.professional_id, m.status_changed_at, m.created_at,
                m.permissions_confirmed_at IS NOT NULL AS permissions_confirmed,
                u.id AS user_id, u.name, COALESCE(u.email::text, u.username::text) AS email, u.email IS NULL AS sem_email,
                u.username::text AS username, u.platform_role IS NOT NULL AS papel_plataforma,
                (SELECT count(*)::int FROM memberships o WHERE o.user_id = u.id) AS vinculos,
                u.status AS user_status,
                COALESCE((SELECT json_agg(json_build_object('permission', o.permission, 'mode', o.mode))
                  FROM membership_permission_overrides o WHERE o.tenant_id = m.tenant_id AND o.membership_id = m.id),
                  '[]'::json) AS overrides
           FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.tenant_id = $1 AND (m.professional_id IS NOT NULL OR m.role <> 'DONO')
          ORDER BY m.created_at, m.id`,
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
      const profissionalPor = new Map(profissionais.map((p) => [p.id, p]));
      const vinculoPor = new Map(vinculos.filter((v) => v.professional_id).map((v) => [v.professional_id!, v]));
      const convitePor = new Map(convites.map((c) => [c.professional_id, c]));

      const acessoDe = (v: (typeof vinculos)[number]) => {
        const ehDono = v.role === EstablishmentRole.DONO;
        const deEquipe = v.role === EstablishmentRole.PROFISSIONAL || v.role === EstablishmentRole.GERENTE;
        return {
          membershipId: v.id,
          role: v.role,
          isOwner: ehDono,
          status: v.status,
          statusChangedAt: v.status_changed_at,
          user: {
            id: v.user_id,
            name: v.name,
            // E-mail ou, na conta sem e-mail, o login interno.
            email: v.email,
            username: v.username,
            hasEmail: !v.sem_email,
            status: v.user_status,
          },
          // Só a conta criada pelo dono (login e senha, sem e-mail, sem papel
          // na plataforma e só com este vínculo) recebe nova senha
          // temporária por aqui.
          canResetTemporaryPassword:
            deEquipe && v.sem_email && !!v.username && !v.papel_plataforma && v.vinculos === 1,
          // O perfil só muda na conta que é só deste estabelecimento. O
          // profissional ligado muda em qualquer acesso de equipe.
          canChangeRole: deEquipe && !v.papel_plataforma && v.vinculos === 1,
          /** Gerente de antes da tela nova: nada vale até o dono confirmar. */
          permissionsPending: v.role === EstablishmentRole.GERENTE && !v.permissions_confirmed,
          grantedPermissions: deEquipe ? grantedTeamPermissions(v.role, v.permissions_confirmed, v.overrides) : [],
        };
      };
      const situacaoDe = (v: (typeof vinculos)[number], profissionalAtivo: boolean | null) => {
        if (v.role === EstablishmentRole.DONO) return 'OWNER';
        if (v.role !== EstablishmentRole.PROFISSIONAL && v.role !== EstablishmentRole.GERENTE) return 'LEGACY_ROLE';
        if (v.status !== 'ACTIVE') return 'SUSPENDED';
        if (v.role === EstablishmentRole.PROFISSIONAL && !v.professional_id) return 'PROFESSIONAL_INACTIVE';
        if (v.professional_id && profissionalAtivo === false) return 'PROFESSIONAL_INACTIVE';
        if (v.role === EstablishmentRole.GERENTE && !v.permissions_confirmed) return 'PERMISSIONS_PENDING';
        return 'ACTIVE';
      };

      return {
        tenant: { id: gestor.tenantId, name: tenant.name, slug: tenant.slug },
        plan: { name: tenant.plan_name, maxProfessionals: tenant.max_professionals },
        seats: vagas,
        professionals: { active: ativos, limit: tenant.max_professionals },
        grantablePermissions: gestor.grantable.map((p) => ({ permission: p, label: STAFF_PERMISSION_LABELS[p] })),
        permissionLabels: STAFF_PERMISSIONS.map((p) => ({ permission: p, label: STAFF_PERMISSION_LABELS[p] })),
        /** Catálogo das áreas do gerente: rótulo, explicação, dependências e
         * se ESTE dono pode concedê-la. */
        managerPermissions: MANAGER_PERMISSIONS.map((p) => ({
          permission: p,
          area: MANAGER_PERMISSION_META[p].area,
          areaLabel: MANAGER_AREA_LABELS[MANAGER_PERMISSION_META[p].area],
          label: MANAGER_PERMISSION_META[p].label,
          detail: MANAGER_PERMISSION_META[p].detail,
          requires: MANAGER_PERMISSION_REQUIRES[p],
          grantable: gestor.grantableManager.includes(p),
        })),
        maxInviteSends: MAX_INVITE_SENDS,
        /** Todos os acessos que não são do dono, com ou sem profissional. */
        accesses: vinculos
          .filter((v) => v.role !== EstablishmentRole.DONO)
          .map((v) => {
            const p = v.professional_id ? profissionalPor.get(v.professional_id) : undefined;
            return {
              ...acessoDe(v),
              professional: p ? { id: p.id, name: p.name, active: p.active, futureAppointments: p.future_appointments } : null,
              situation: situacaoDe(v, p ? p.active : null),
            };
          }),
        /** Por profissional, como a tela anterior lê (mantido enquanto as duas
         * versões convivem). */
        members: profissionais.map((p) => {
          const v = vinculoPor.get(p.id);
          const c = convitePor.get(p.id);
          return {
            professional: { id: p.id, name: p.name, active: p.active, futureAppointments: p.future_appointments },
            access: v ? acessoDe(v) : null,
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
            situation: v ? situacaoDe(v, p.active) : c ? 'INVITED' : 'NO_ACCESS',
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
          summary: `Acesso de ${ROLE_LABEL[vinculo.role]} de ${vinculo.email} suspenso neste estabelecimento.`,
          previousData: {
            membershipId: vinculo.id,
            role: vinculo.role,
            status: 'ACTIVE',
            professionalId: vinculo.professional_id,
          },
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
      // O funcionário precisa do profissional dele ativo; o gerente, só se
      // tiver profissional ligado.
      const exigeProfissional = vinculo.role === 'PROFISSIONAL' || !!vinculo.professional_id;
      if (exigeProfissional && !vinculo.professional_active) {
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
          summary: `Acesso de ${ROLE_LABEL[vinculo.role]} de ${vinculo.email} reativado neste estabelecimento.`,
          previousData: { membershipId: vinculo.id, role: vinculo.role, status: 'SUSPENDED' },
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
          summary: `Acesso de ${ROLE_LABEL[vinculo.role]} de ${vinculo.email} removido deste estabelecimento.`,
          previousData: {
            membershipId: vinculo.id,
            role: vinculo.role,
            status: vinculo.status,
            professionalId: vinculo.professional_id,
            granted: grantedTeamPermissions(vinculo.role, vinculo.permissions_confirmed, vinculo.overrides),
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
      // O que a tela mostrava é o que VALE (gerente sem confirmação: nada).
      const atuais = grantedTeamPermissions(vinculo.role, vinculo.permissions_confirmed, vinculo.overrides).sort();
      if (JSON.stringify(atuais) !== JSON.stringify([...dto.expectedGranted].sort())) {
        throw conflito('ALTERADO_POR_OUTRA_TELA', 'As permissões mudaram desde que você abriu a tela. Recarregue.');
      }
      const novas = [...dto.granted].sort() as TeamPermission[];
      const entram = novas.filter((p) => !atuais.includes(p));
      // Só concede o que o próprio dono pode fazer. Retirar é sempre possível.
      validarConcessoes(gestor, { role: vinculo.role, withProfessional: !!vinculo.professional_id }, novas, entram);

      const { gravadas, remover, acrescentar } = await this.gravarConcessoes(manager, gestor.tenantId, vinculo, novas);
      const confirmou = vinculo.role === 'GERENTE' && !vinculo.permissions_confirmed;
      if (vinculo.role === 'GERENTE') {
        await manager.query('UPDATE memberships SET permissions_confirmed_at = $2 WHERE id = $1', [vinculo.id, now]);
      }
      if (remover.length || acrescentar.length || confirmou) {
        const actor = await loadActor(manager, actorId);
        await recordAudit(
          manager,
          {
            action: 'USER_PERMISSION_CHANGED',
            actor,
            tenantId: gestor.tenantId,
            targetUserId: vinculo.user_id,
            summary: confirmou
              ? `Permissões de gerente de ${vinculo.email} confirmadas pelo dono.`
              : `Permissões de ${ROLE_LABEL[vinculo.role]} de ${vinculo.email} alteradas.`,
            previousData: { granted: atuais, ...(confirmou ? { storedGranted: gravadas.sort() } : {}) },
            newData: { granted: novas },
          },
          now,
        );
      }
      return { membershipId: vinculo.id, grantedPermissions: novas };
    });
  }

  async changeAccess(
    actorId: string,
    sessionId: string,
    tenantId: string,
    membershipId: string,
    dto: StaffAccessChangeDto,
    now = new Date(),
  ) {
    try {
      return await this.dataSource.transaction(async (manager) => {
        await requireRecentReauth(manager, sessionId, now);
        const gestor = await resolveTeamManager(manager, actorId, tenantId);
        // Estabelecimento antes do vínculo: a mesma fila de quem ocupa um
        // profissional (criação, convite, aceite).
        const tenant = await lockTenantForSeats(manager, gestor.tenantId);
        const vinculo = await this.lockStaffMembership(manager, gestor.tenantId, membershipId);
        const atuais = grantedTeamPermissions(vinculo.role, vinculo.permissions_confirmed, vinculo.overrides).sort();
        if (
          vinculo.role !== dto.expected.role ||
          vinculo.professional_id !== dto.expected.professionalId ||
          JSON.stringify(atuais) !== JSON.stringify([...dto.expected.granted].sort())
        ) {
          throw conflito('ALTERADO_POR_OUTRA_TELA', 'Este acesso mudou desde que você abriu a tela. Recarregue.');
        }
        const trocaPerfil = dto.role !== vinculo.role;
        const trocaProfissional = dto.professionalId !== vinculo.professional_id;
        if (trocaPerfil && (vinculo.papel_plataforma || vinculo.vinculos !== 1)) {
          throw conflito(
            'PERFIL_NAO_E_DO_ESTABELECIMENTO',
            'Esta conta também trabalha em outro estabelecimento ou administra a plataforma: o perfil dela não muda por aqui.',
          );
        }
        let novoProfissional: string | null = null;
        if (trocaProfissional && dto.professionalId) {
          if (!isOperational(tenant.status)) {
            throw conflito('ESTABELECIMENTO_FORA_DE_OPERACAO', 'O estabelecimento não está em operação.');
          }
          novoProfissional = await this.profissionalLivre(manager, tenant.id, dto.professionalId, now);
        }
        const novas = [...dto.granted].sort() as TeamPermission[];
        const entram = novas.filter((p) => !atuais.includes(p));
        // Só o que o dono marcou e pode conceder, e só o que se aplica ao novo
        // perfil e profissional. Retirar é sempre possível.
        validarConcessoes(gestor, { role: dto.role, withProfessional: !!dto.professionalId }, novas, entram);

        const confirmou = dto.role === 'GERENTE' && (trocaPerfil || !vinculo.permissions_confirmed);
        if (trocaPerfil || trocaProfissional || confirmou) {
          // No gerente, salvar aqui é a confirmação do dono (ver
          // effectiveOverrides); no profissional, a marca não se aplica.
          await manager.query(
            `UPDATE memberships SET role = $2::establishment_role, professional_id = $3,
                    permissions_confirmed_at = CASE WHEN $2 = 'GERENTE' THEN COALESCE(permissions_confirmed_at, $4) END
              WHERE id = $1`,
            [vinculo.id, dto.role, dto.professionalId, now],
          );
        }
        const { remover, acrescentar } = await this.gravarConcessoes(manager, gestor.tenantId, vinculo, novas);
        if (trocaPerfil || trocaProfissional || confirmou || remover.length || acrescentar.length) {
          const actor = await loadActor(manager, actorId);
          const partes = [
            trocaPerfil ? `perfil de ${ROLE_LABEL[vinculo.role]} para ${ROLE_LABEL[dto.role]}` : null,
            trocaProfissional
              ? `profissional ligado de ${vinculo.professional_name ?? 'nenhum'} para ${novoProfissional ?? 'nenhum'}`
              : null,
            'permissões conferidas e confirmadas pelo dono',
          ].filter(Boolean);
          await recordAudit(
            manager,
            {
              action: 'USER_PERMISSION_CHANGED',
              actor,
              tenantId: gestor.tenantId,
              targetUserId: vinculo.user_id,
              summary: `Acesso de ${vinculo.email} alterado: ${partes.join('; ')}. Nenhum agendamento mudou de profissional.`,
              previousData: { role: vinculo.role, professionalId: vinculo.professional_id, granted: atuais },
              newData: { role: dto.role, professionalId: dto.professionalId, granted: novas },
            },
            now,
          );
        }
        return {
          membershipId: vinculo.id,
          role: dto.role,
          professionalId: dto.professionalId,
          grantedPermissions: novas,
        };
      });
    } catch (error) {
      if (isUniqueViolation(error, 'uq_memberships_professional_id')) {
        throw conflito('PROFISSIONAL_COM_ACESSO', 'Este profissional já tem um acesso.');
      }
      throw error;
    }
  }

  /** O profissional que um acesso existente passa a usar: deste
   * estabelecimento, ativo, sem outro acesso e sem convite pendente (as
   * mesmas regras da criação). Devolve o nome, para o histórico. */
  private async profissionalLivre(
    manager: EntityManager,
    tenantId: string,
    professionalId: string,
    now: Date,
  ): Promise<string> {
    await expireStaleStaffInvites(manager, tenantId, now);
    const [encontrado] = await manager.query<{ id: string; name: string; active: boolean }[]>(
      'SELECT id, name, active FROM professionals WHERE tenant_id = $1 AND id = $2 FOR SHARE',
      [tenantId, professionalId],
    );
    if (!encontrado) throw new NotFoundException('Profissional não encontrado.');
    if (!encontrado.active) {
      throw conflito('PROFISSIONAL_INATIVO', 'Este profissional está desativado. Reative-o antes de ligá-lo ao acesso.');
    }
    const [vinculo] = await manager.query<unknown[]>(
      'SELECT 1 FROM memberships WHERE tenant_id = $1 AND professional_id = $2',
      [tenantId, encontrado.id],
    );
    if (vinculo) {
      throw conflito(
        'PROFISSIONAL_COM_ACESSO',
        'Este profissional já tem um acesso. Escolha outro ou remova o acesso dele antes.',
      );
    }
    const [pendente] = await manager.query<unknown[]>(
      `SELECT 1 FROM invites WHERE tenant_id = $1 AND professional_id = $2 AND status = 'PENDING'`,
      [tenantId, encontrado.id],
    );
    if (pendente) {
      throw conflito('CONVITE_PENDENTE', 'Este profissional já tem um convite pendente. Revogue o convite antes.');
    }
    return encontrado.name;
  }

  /** Deixa os `GRANTED` gravados iguais a `novas`. Contra o que está GRAVADO
   * (não só o que vale): um `GRANTED` antigo de um gerente sem confirmação
   * que o dono não marcou sai agora. Os `DENIED` ficam (só restringem). */
  private async gravarConcessoes(
    manager: EntityManager,
    tenantId: string,
    vinculo: StaffMembershipRow,
    novas: readonly TeamPermission[],
  ) {
    const gravadas = vinculo.overrides.filter((o) => o.mode === 'GRANTED').map((o) => o.permission);
    const remover = gravadas.filter((p) => !novas.includes(p as TeamPermission));
    const acrescentar = novas.filter((p) => !gravadas.includes(p));
    if (remover.length) {
      await manager.query(
        `DELETE FROM membership_permission_overrides
          WHERE tenant_id = $1 AND membership_id = $2 AND mode = 'GRANTED' AND permission::text = ANY($3)`,
        [tenantId, vinculo.id, remover],
      );
    }
    for (const permission of acrescentar) {
      await manager.query(
        `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode)
         VALUES ($1, $2, $3, $4::permission, 'GRANTED')
         ON CONFLICT (tenant_id, membership_id, permission) DO UPDATE SET mode = 'GRANTED'`,
        [generateId(), tenantId, vinculo.id, permission],
      );
    }
    return { gravadas, remover, acrescentar };
  }

  /** Trava um vínculo de EQUIPE (profissional ou gerente) deste
   * estabelecimento. Vínculo de dono, de outro estabelecimento ou inexistente:
   * 404 (indistinguíveis). */
  private async lockStaffMembership(
    manager: EntityManager,
    tenantId: string,
    membershipId: string,
  ): Promise<StaffMembershipRow> {
    const linhas = linhasDe<StaffMembershipRow>(
      await manager.query(
        `SELECT m.id, m.user_id, m.role::text AS role, m.status, m.professional_id,
                m.permissions_confirmed_at IS NOT NULL AS permissions_confirmed,
                COALESCE(u.email::text, u.username::text) AS email, u.name, u.status AS user_status,
                p.active AS professional_active, p.name AS professional_name,
                u.platform_role IS NOT NULL AS papel_plataforma,
                (SELECT count(*)::int FROM memberships o WHERE o.user_id = u.id) AS vinculos,
                COALESCE((SELECT json_agg(json_build_object('permission', o.permission, 'mode', o.mode))
                  FROM membership_permission_overrides o WHERE o.tenant_id = m.tenant_id AND o.membership_id = m.id),
                  '[]'::json) AS overrides
           FROM memberships m
           JOIN users u ON u.id = m.user_id
           LEFT JOIN professionals p ON p.tenant_id = m.tenant_id AND p.id = m.professional_id
          WHERE m.id = $1 AND m.tenant_id = $2 AND m.role IN ('PROFISSIONAL', 'GERENTE')
          FOR UPDATE OF m`,
        [membershipId, tenantId],
      ),
    );
    const [vinculo] = linhas;
    if (!vinculo) throw new NotFoundException(ACCESS_NOT_FOUND_MESSAGE);
    return vinculo;
  }
}
