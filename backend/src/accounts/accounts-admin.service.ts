// Mudanças em contas e vínculos feitas pela administração. Regras comuns:
//
// - quem age é relido do banco dentro da transação (actor.ts);
// - ninguém age sobre a própria conta por aqui (nem o MASTER_OWNER);
// - conta com papel de plataforma só por quem gerencia a plataforma;
// - mudanças sensíveis exigem senha confirmada há pouco NESTA sessão;
// - a tela manda o `updated_at` (ou as restrições) que leu: se outra tela
//   mudou antes, 409 e nada é gravado;
// - mudança e histórico na mesma transação.
//
// Último MASTER_OWNER ativo: toda mudança que pode tirar um MASTER_OWNER
// (papel ou bloqueio) passa por um lock transacional único
// (`pg_advisory_xact_lock`) e reconfere, já com o lock, que quem age ainda é
// MASTER_OWNER ativo e que sobra pelo menos um outro. Duas mudanças
// cruzadas ("A rebaixa B" e "B rebaixa A") ficam em fila: a segunda já vê
// quem age sem o papel e é recusada.
import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { generateId } from '../entities/common/generate-id.js';
import { PlatformRole } from '../entities/enums/platform-role.enum.js';
import { CREDENTIAL_ALGORITHM, DUMMY_PASSWORD_HASH, verifyPassword } from '../auth/password-hasher.js';
import type { DeniedPermissionsDto, PlatformAccessDto, StatusChangeDto, UpdateUserDto } from './accounts.dto.js';
import { assertCanManageAccount, loadActor, requireCapability, FORBIDDEN_MESSAGE, type Actor } from './actor.js';
import { recordAudit } from './audit.js';
import { requireRecentReauth } from './reauth.js';
import { avancarVersao } from './user-version.js';
import { linhasDe } from '../notifications/notification-jobs.repository.js';
import { EFFECTIVE_TENANT_PERMISSIONS, RESTRICTABLE_TENANT_ROLES } from './tenant-effective-access.js';
import type { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';

/** Chave do lock que serializa mudanças capazes de tirar um MASTER_OWNER. */
export const OWNER_LOCK_KEY = 7_204_519_331;

interface TargetRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
  platform_role: PlatformRole | null;
  platform_permissions: string[] | null;
  updated_at: Date;
  has_credential: boolean;
}

const conflito = (code: string, message: string) => new ConflictException({ code, message });

@Injectable()
export class AccountsAdminService {
  constructor(private readonly dataSource: DataSource) {}

  /** Confirma a senha de quem está na sessão e marca a confirmação nela. */
  async reauthenticate(userId: string, sessionId: string, password: string, now = new Date()): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const [credential] = await manager.query<{ password_hash: string; algorithm: string }[]>(
        'SELECT password_hash, algorithm FROM credentials WHERE user_id = $1',
        [userId],
      );
      const real = credential?.algorithm === CREDENTIAL_ALGORITHM;
      const confere = await verifyPassword(real ? credential!.password_hash : DUMMY_PASSWORD_HASH, password);
      if (!real || !confere) {
        throw new UnauthorizedException({ code: 'SENHA_INCORRETA', message: 'Senha incorreta.' });
      }
      await manager.query('UPDATE sessions SET reauthenticated_at = $2 WHERE id = $1 AND user_id = $3', [
        sessionId,
        now,
        userId,
      ]);
    });
  }

  async updateUser(actorId: string, userId: string, dto: UpdateUserDto, now = new Date()) {
    return this.dataSource.transaction(async (manager) => {
      const actor = await loadActor(manager, actorId);
      const target = await this.lockTarget(manager, actor, userId, dto.expectedUpdatedAt);
      const novo = {
        name: dto.name ?? target.name,
        phone: dto.phone === undefined ? target.phone : dto.phone,
      };
      if (novo.name === target.name && novo.phone === target.phone) return { updatedAt: target.updated_at };
      const [versao] = linhasDe<{ updated_at: Date }>(
        await manager.query(
          `UPDATE users SET name = $2, phone = $3, ${avancarVersao('$4')} WHERE id = $1 RETURNING updated_at`,
          [target.id, novo.name, novo.phone, now],
        ),
      );
      await recordAudit(
        manager,
        {
          action: 'USER_UPDATED',
          actor,
          targetUserId: target.id,
          summary: `Dados básicos da conta ${target.email} atualizados.`,
          previousData: { name: target.name, phone: target.phone },
          newData: novo,
        },
        now,
      );
      return { updatedAt: versao.updated_at };
    });
  }

  async block(actorId: string, sessionId: string, userId: string, dto: StatusChangeDto, now = new Date()) {
    return this.dataSource.transaction(async (manager) => {
      await requireRecentReauth(manager, sessionId, now);
      await manager.query('SELECT pg_advisory_xact_lock($1::bigint)', [OWNER_LOCK_KEY]);
      const actor = await loadActor(manager, actorId);
      const target = await this.lockTarget(manager, actor, userId, dto.expectedUpdatedAt);
      if (target.status === 'SUSPENDED') throw conflito('JA_BLOQUEADA', 'A conta já está bloqueada.');
      if (target.platform_role === PlatformRole.MASTER_OWNER && target.status === 'ACTIVE') {
        await this.requireAnotherOwner(manager, target.id);
      }
      const [versao] = linhasDe<{ updated_at: Date }>(
        await manager.query(
          `UPDATE users SET status = 'SUSPENDED', ${avancarVersao('$2')} WHERE id = $1 RETURNING updated_at`,
          [target.id, now],
        ),
      );
      // UPDATE ... RETURNING devolve [linhas, contagem] pelo TypeORM.
      const sessoes = linhasDe<{ id: string }>(
        await manager.query(
          `UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL RETURNING id`,
          [target.id, now],
        ),
      );
      await recordAudit(
        manager,
        {
          action: 'USER_BLOCKED',
          actor,
          targetUserId: target.id,
          summary: `Conta ${target.email} bloqueada; ${sessoes.length} sessão(ões) encerrada(s).`,
          previousData: { status: target.status },
          newData: { status: 'SUSPENDED', revokedSessions: sessoes.length },
        },
        now,
      );
      return { updatedAt: versao.updated_at, status: 'SUSPENDED' as const };
    });
  }

  async reactivate(actorId: string, sessionId: string, userId: string, dto: StatusChangeDto, now = new Date()) {
    return this.dataSource.transaction(async (manager) => {
      await requireRecentReauth(manager, sessionId, now);
      const actor = await loadActor(manager, actorId);
      const target = await this.lockTarget(manager, actor, userId, dto.expectedUpdatedAt);
      if (target.status !== 'SUSPENDED') throw conflito('NAO_BLOQUEADA', 'A conta não está bloqueada.');
      // Sem senha definida, a conta volta a ser só um convite pendente.
      const status = target.has_credential ? 'ACTIVE' : 'INVITED';
      const [versao] = linhasDe<{ updated_at: Date }>(
        await manager.query(
          `UPDATE users SET status = $2::user_status, ${avancarVersao('$3')} WHERE id = $1 RETURNING updated_at`,
          [target.id, status, now],
        ),
      );
      await recordAudit(
        manager,
        {
          action: 'USER_REACTIVATED',
          actor,
          targetUserId: target.id,
          summary: `Conta ${target.email} reativada.`,
          previousData: { status: 'SUSPENDED' },
          newData: { status },
        },
        now,
      );
      return { updatedAt: versao.updated_at, status };
    });
  }

  async setPlatformAccess(actorId: string, sessionId: string, userId: string, dto: PlatformAccessDto, now = new Date()) {
    return this.dataSource.transaction(async (manager) => {
      await requireRecentReauth(manager, sessionId, now);
      await manager.query('SELECT pg_advisory_xact_lock($1::bigint)', [OWNER_LOCK_KEY]);
      // Relido JÁ com o lock: uma mudança concorrente que tirou o papel de
      // quem age vale aqui.
      const actor = await loadActor(manager, actorId);
      requireCapability(actor, 'managePlatformAccess');
      const target = await this.lockTarget(manager, actor, userId, dto.expectedUpdatedAt);
      const role = dto.role;
      const permissions = role && role !== PlatformRole.MASTER_OWNER ? [...dto.permissions].sort() : [];
      const anterior = {
        role: target.platform_role,
        permissions: [...(target.platform_permissions ?? [])].sort(),
      };
      if (anterior.role === role && JSON.stringify(anterior.permissions) === JSON.stringify(permissions)) {
        return { updatedAt: target.updated_at };
      }
      if (anterior.role === PlatformRole.MASTER_OWNER && role !== PlatformRole.MASTER_OWNER && target.status === 'ACTIVE') {
        await this.requireAnotherOwner(manager, target.id);
      }
      await manager.query(
        `UPDATE users SET platform_role = $2::platform_role, platform_permissions = $3::platform_permission[],
                ${avancarVersao('$4')} WHERE id = $1`,
        [target.id, role, role ? permissions : null, now],
      );
      await recordAudit(
        manager,
        {
          action: 'PLATFORM_ACCESS_CHANGED',
          actor,
          targetUserId: target.id,
          summary: `Acesso de plataforma de ${target.email} alterado.`,
          previousData: anterior,
          newData: { role, permissions },
        },
        now,
      );
      return { updatedAt: now };
    });
  }

  async removeMembership(actorId: string, sessionId: string, membershipId: string, now = new Date()) {
    await this.dataSource.transaction(async (manager) => {
      await requireRecentReauth(manager, sessionId, now);
      const actor = await loadActor(manager, actorId);
      const vinculo = await this.lockMembership(manager, actor, membershipId);
      await manager.query('DELETE FROM memberships WHERE id = $1', [vinculo.id]);
      await recordAudit(
        manager,
        {
          action: 'MEMBERSHIP_REMOVED',
          actor,
          tenantId: vinculo.tenant_id,
          targetUserId: vinculo.user_id,
          summary: `Vínculo de ${vinculo.email} como ${vinculo.role} removido.`,
          previousData: { membershipId: vinculo.id, role: vinculo.role, denied: vinculo.denied },
        },
        now,
      );
    });
  }

  async setDeniedPermissions(
    actorId: string,
    sessionId: string,
    membershipId: string,
    dto: DeniedPermissionsDto,
    now = new Date(),
  ) {
    return this.dataSource.transaction(async (manager) => {
      await requireRecentReauth(manager, sessionId, now);
      const actor = await loadActor(manager, actorId);
      const vinculo = await this.lockMembership(manager, actor, membershipId);
      if (!RESTRICTABLE_TENANT_ROLES.includes(vinculo.role)) {
        throw conflito(
          'PAPEL_SEM_ACESSO',
          'Só as áreas de um dono são restringidas por aqui. As de um funcionário são ajustadas pelo dono em Equipe e acessos.',
        );
      }
      const atuais = vinculo.denied.filter((p) => EFFECTIVE_TENANT_PERMISSIONS.includes(p as never)).sort();
      if (JSON.stringify(atuais) !== JSON.stringify([...dto.expectedDenied].sort())) {
        throw conflito('ALTERADO_POR_OUTRA_TELA', 'As permissões mudaram desde que você abriu a tela. Recarregue.');
      }
      const novas = [...dto.denied].sort();
      const remover = atuais.filter((p) => !novas.includes(p));
      const acrescentar = novas.filter((p) => !atuais.includes(p));
      if (remover.length) {
        await manager.query(
          `DELETE FROM membership_permission_overrides
            WHERE tenant_id = $1 AND membership_id = $2 AND mode = 'DENIED' AND permission::text = ANY($3)`,
          [vinculo.tenant_id, vinculo.id, remover],
        );
      }
      for (const permission of acrescentar) {
        await manager.query(
          `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode)
           VALUES ($1, $2, $3, $4::permission, 'DENIED')
           ON CONFLICT (tenant_id, membership_id, permission) DO UPDATE SET mode = 'DENIED'`,
          [generateId(), vinculo.tenant_id, vinculo.id, permission],
        );
      }
      if (remover.length || acrescentar.length) {
        await recordAudit(
          manager,
          {
            action: 'USER_PERMISSION_CHANGED',
            actor,
            tenantId: vinculo.tenant_id,
            targetUserId: vinculo.user_id,
            summary: `Restrições de ${vinculo.email} como ${vinculo.role} alteradas.`,
            previousData: { denied: atuais },
            newData: { denied: novas },
          },
          now,
        );
      }
      return { denied: novas };
    });
  }

  // ---------------------------------------------------------------- internos

  private async lockTarget(manager: EntityManager, actor: Actor, userId: string, expectedUpdatedAt: string) {
    const [target] = await manager.query<TargetRow[]>(
      `SELECT u.id, u.name, u.email, u.phone, u.status, u.platform_role, u.platform_permissions::text[] AS platform_permissions, u.updated_at,
              EXISTS (SELECT 1 FROM credentials c WHERE c.user_id = u.id) AS has_credential
         FROM users u WHERE u.id = $1 FOR UPDATE`,
      [userId],
    );
    if (!target) throw new NotFoundException('Conta não encontrada.');
    assertCanManageAccount(actor, { id: target.id, platformRole: target.platform_role });
    if (new Date(target.updated_at).getTime() !== new Date(expectedUpdatedAt).getTime()) {
      throw conflito('ALTERADO_POR_OUTRA_TELA', 'A conta mudou desde que você abriu a tela. Recarregue e confira.');
    }
    return target;
  }

  private async lockMembership(manager: EntityManager, actor: Actor, membershipId: string) {
    if (!actor.caps.manageEstablishments) throw new ForbiddenException(FORBIDDEN_MESSAGE);
    const [vinculo] = await manager.query<
      {
        id: string;
        tenant_id: string;
        user_id: string;
        role: EstablishmentRole;
        email: string;
        platform_role: PlatformRole | null;
        denied: string[];
      }[]
    >(
      `SELECT m.id, m.tenant_id, m.user_id, m.role, u.email, u.platform_role,
              COALESCE((SELECT array_agg(o.permission::text ORDER BY o.permission) FROM membership_permission_overrides o
                WHERE o.membership_id = m.id AND o.tenant_id = m.tenant_id AND o.mode = 'DENIED'), '{}') AS denied
         FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.id = $1 FOR UPDATE OF m`,
      [membershipId],
    );
    if (!vinculo) throw new NotFoundException('Vínculo não encontrado. Ele pode já ter sido removido.');
    assertCanManageAccount(actor, { id: vinculo.user_id, platformRole: vinculo.platform_role });
    return vinculo;
  }

  private async requireAnotherOwner(manager: EntityManager, targetId: string): Promise<void> {
    const [linha] = await manager.query<{ total: number }[]>(
      `SELECT count(*)::int AS total FROM users
        WHERE platform_role = 'MASTER_OWNER' AND status = 'ACTIVE' AND id <> $1`,
      [targetId],
    );
    if (linha.total < 1) {
      throw conflito('ULTIMO_MASTER_OWNER', 'Esta é a última conta MASTER_OWNER ativa. Promova outra antes.');
    }
  }
}
