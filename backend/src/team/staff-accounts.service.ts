// Acesso de funcionário com NOME DE USUÁRIO e SENHA TEMPORÁRIA, sem e-mail
// (ver docs/plans/operacao-diaria-configuracoes.md, PR 2).
//
// CRIAR (dono, senha confirmada há pouco nesta sessão): numa transação só,
// com o estabelecimento travado (mesma fila das vagas, ver seats.ts):
// estabelecimento em operação, profissional ativo, sem acesso e sem convite
// pendente, vaga livre no plano, nome de usuário livre na plataforma e só as
// permissões que o dono pode conceder. Grava conta (sem e-mail, e-mail não
// verificado, troca de senha obrigatória), credencial (Argon2id), vínculo
// PROFISSIONAL, permissões, a chave do formulário e o histórico. Qualquer
// recusa desfaz tudo: nunca sobra conta sem vínculo.
//
// A senha temporária é gerada aqui, devolvida UMA vez nesta resposta e nunca
// guardada em claro, em log ou no histórico. Repetir o mesmo formulário
// (mesma chave) devolve o acesso já criado, SEM senha: para outra, o dono
// gera uma nova.
//
// NOVA SENHA TEMPORÁRIA (dono): só para a conta criada assim — sem e-mail,
// sem papel na plataforma e com este único vínculo. Uma conta que entra por
// e-mail, que trabalha em outra empresa ou que administra a plataforma não é
// do dono: a senha dela é global, e trocá-la daria ao dono a conta inteira.
// Para essas, a recuperação é a redefinição por link da administração.
import { randomInt } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { loadActor } from '../accounts/actor.js';
import { recordAudit } from '../accounts/audit.js';
import { requireRecentReauth } from '../accounts/reauth.js';
import { CREDENTIAL_ALGORITHM, hashPassword } from '../auth/password-hasher.js';
import { isUniqueViolation } from '../auth/unique-violation.js';
import { generateId } from '../entities/common/generate-id.js';
import { linhasDe } from '../notifications/notification-jobs.repository.js';
import {
  expireStaleStaffInvites,
  isOperational,
  lockTenantForSeats,
  seatLimitMessage,
  staffSeatUsage,
} from './seats.js';
import { resolveTeamManager } from './team-authorization.js';
import type { StaffAccountDto } from './team.dto.js';

const conflito = (code: string, message: string) => new ConflictException({ code, message });

/** Sem letras e números que se confundem (0/O, 1/l/I). */
const ALFABETO = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 12 caracteres sorteados (≈ 69 bits), em três blocos para ditar ou copiar. */
export function gerarSenhaTemporaria(): string {
  const bloco = () => Array.from({ length: 4 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');
  return `${bloco()}-${bloco()}-${bloco()}`;
}

export interface StaffAccountCreated {
  /** `false`: o mesmo formulário já tinha criado este acesso. */
  created: boolean;
  membershipId: string;
  userId: string;
  username: string;
  /** Só na criação. Nunca de novo. */
  temporaryPassword: string | null;
}

@Injectable()
export class StaffAccountsService {
  constructor(private readonly dataSource: DataSource) {}

  async create(
    actorId: string,
    sessionId: string,
    tenantId: string,
    dto: StaffAccountDto,
    now = new Date(),
  ): Promise<StaffAccountCreated> {
    const repetido = await this.replay(actorId, dto.requestKey);
    if (repetido) return repetido;
    const senha = gerarSenhaTemporaria();
    const hash = await hashPassword(senha);
    try {
      return await this.dataSource.transaction(async (manager) => {
        await requireRecentReauth(manager, sessionId, now);
        const gestor = await resolveTeamManager(manager, actorId, tenantId);
        const tenant = await lockTenantForSeats(manager, gestor.tenantId);
        if (!isOperational(tenant.status)) {
          throw conflito('ESTABELECIMENTO_FORA_DE_OPERACAO', 'O estabelecimento não está em operação.');
        }
        const [profissional] = await manager.query<{ id: string; name: string; active: boolean }[]>(
          'SELECT id, name, active FROM professionals WHERE tenant_id = $1 AND id = $2 FOR SHARE',
          [tenant.id, dto.professionalId],
        );
        if (!profissional) throw new NotFoundException('Profissional não encontrado.');
        if (!profissional.active) {
          throw conflito('PROFISSIONAL_INATIVO', 'Este profissional está desativado. Reative-o antes de criar o acesso.');
        }
        const [vinculo] = await manager.query<unknown[]>(
          'SELECT 1 FROM memberships WHERE tenant_id = $1 AND professional_id = $2',
          [tenant.id, profissional.id],
        );
        if (vinculo) {
          throw conflito(
            'PROFISSIONAL_COM_ACESSO',
            'Este profissional já tem um acesso. Para trocar a pessoa, remova o acesso atual antes.',
          );
        }
        await expireStaleStaffInvites(manager, tenant.id, now);
        const [pendente] = await manager.query<unknown[]>(
          `SELECT 1 FROM invites WHERE tenant_id = $1 AND professional_id = $2 AND status = 'PENDING'`,
          [tenant.id, profissional.id],
        );
        if (pendente) {
          throw conflito('CONVITE_PENDENTE', 'Este profissional já tem um convite pendente. Revogue o convite antes.');
        }
        const vagas = await staffSeatUsage(manager, tenant.id, tenant.plan.maxProfessionals, now);
        if (vagas.used >= vagas.limit) throw conflito('LIMITE_DO_PLANO', seatLimitMessage(vagas));
        const indevidas = dto.permissions.filter((p) => !gestor.grantable.includes(p));
        if (indevidas.length) {
          throw conflito(
            'PERMISSAO_NAO_DISPONIVEL',
            'Você só pode liberar ações que você mesmo pode fazer neste estabelecimento.',
          );
        }

        const userId = generateId();
        const membershipId = generateId();
        await manager.query(
          `INSERT INTO users (id, name, email, username, email_verified, status, must_change_password, created_at, updated_at)
           VALUES ($1, $2, NULL, $3, false, 'ACTIVE', true, $4, $4)`,
          [userId, dto.name, dto.username, now],
        );
        await manager.query(
          `INSERT INTO credentials (id, user_id, password_hash, algorithm, updated_at) VALUES ($1, $2, $3, $4, $5)`,
          [generateId(), userId, hash, CREDENTIAL_ALGORITHM, now],
        );
        await manager.query(
          `INSERT INTO memberships (id, user_id, tenant_id, role, professional_id, status, created_at)
           VALUES ($1, $2, $3, 'PROFISSIONAL', $4, 'ACTIVE', $5)`,
          [membershipId, userId, tenant.id, profissional.id, now],
        );
        for (const permission of dto.permissions) {
          await manager.query(
            `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode)
             VALUES ($1, $2, $3, $4::permission, 'GRANTED')`,
            [generateId(), tenant.id, membershipId, permission],
          );
        }
        await manager.query(
          `INSERT INTO staff_account_requests (actor_user_id, request_key, tenant_id, membership_id, user_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [actorId, dto.requestKey, tenant.id, membershipId, userId, now],
        );
        const actor = await loadActor(manager, actorId);
        await recordAudit(
          manager,
          {
            action: 'STAFF_ACCESS_CREATED',
            actor,
            tenantId: tenant.id,
            targetUserId: userId,
            summary: `Acesso de funcionário criado para ${dto.username}, ligado a ${profissional.name}.`,
            newData: { username: dto.username, professionalId: profissional.id, granted: [...dto.permissions].sort() },
          },
          now,
        );
        return { created: true, membershipId, userId, username: dto.username, temporaryPassword: senha };
      });
    } catch (error) {
      if (isUniqueViolation(error, 'uq_users_username')) {
        throw conflito('USUARIO_EM_USO', 'Este nome de usuário já está em uso. Escolha outro.');
      }
      if (isUniqueViolation(error, 'uq_memberships_professional_id')) {
        throw conflito('PROFISSIONAL_COM_ACESSO', 'Este profissional já tem um acesso.');
      }
      if (isUniqueViolation(error, 'pk_staff_account_requests')) {
        const outro = await this.replay(actorId, dto.requestKey);
        if (outro) return outro;
      }
      throw error;
    }
  }

  /** Nova senha temporária para a conta de funcionário criada pelo dono. */
  async resetTemporaryPassword(
    actorId: string,
    sessionId: string,
    tenantId: string,
    membershipId: string,
    now = new Date(),
  ): Promise<{ membershipId: string; username: string; temporaryPassword: string }> {
    const senha = gerarSenhaTemporaria();
    const hash = await hashPassword(senha);
    return this.dataSource.transaction(async (manager) => {
      await requireRecentReauth(manager, sessionId, now);
      const gestor = await resolveTeamManager(manager, actorId, tenantId);
      const [conta] = linhasDe<{
        user_id: string;
        username: string | null;
        email: string | null;
        status: string;
        platform_role: string | null;
        vinculos: number;
      }>(
        await manager.query(
          `SELECT u.id AS user_id, u.username::text AS username, u.email::text AS email, u.status::text AS status,
                  u.platform_role::text AS platform_role,
                  (SELECT count(*)::int FROM memberships o WHERE o.user_id = u.id) AS vinculos
             FROM memberships m JOIN users u ON u.id = m.user_id
            WHERE m.id = $1 AND m.tenant_id = $2 AND m.role = 'PROFISSIONAL'
            FOR UPDATE OF u`,
          [membershipId, gestor.tenantId],
        ),
      );
      if (!conta) throw new NotFoundException('Acesso não encontrado. Ele pode já ter sido removido.');
      if (!conta.username || conta.email || conta.platform_role || conta.vinculos !== 1) {
        throw conflito(
          'SENHA_NAO_E_DO_ESTABELECIMENTO',
          'Esta conta tem e-mail, outros acessos ou papel na plataforma: a senha dela não é só deste estabelecimento. Peça a redefinição à administração da plataforma.',
        );
      }
      if (conta.status !== 'ACTIVE') {
        throw conflito('CONTA_BLOQUEADA', 'Esta conta está bloqueada pela administração da plataforma.');
      }
      await manager.query(`UPDATE credentials SET password_hash = $2, algorithm = $3, updated_at = $4 WHERE user_id = $1`, [
        conta.user_id,
        hash,
        CREDENTIAL_ALGORITHM,
        now,
      ]);
      await manager.query(
        `UPDATE users SET must_change_password = true,
                updated_at = GREATEST($2::timestamptz, updated_at + interval '1 millisecond')
          WHERE id = $1`,
        [conta.user_id, now],
      );
      await manager.query(`UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL`, [
        conta.user_id,
        now,
      ]);
      const actor = await loadActor(manager, actorId);
      await recordAudit(
        manager,
        {
          action: 'STAFF_PASSWORD_RESET',
          actor,
          tenantId: gestor.tenantId,
          targetUserId: conta.user_id,
          summary: `Nova senha temporária gerada para ${conta.username}; as sessões abertas foram encerradas.`,
        },
        now,
      );
      return { membershipId, username: conta.username, temporaryPassword: senha };
    });
  }

  private async replay(actorId: string, requestKey: string): Promise<StaffAccountCreated | null> {
    return this.replayWith(this.dataSource.manager, actorId, requestKey);
  }

  private async replayWith(
    manager: EntityManager,
    actorId: string,
    requestKey: string,
  ): Promise<StaffAccountCreated | null> {
    const [linha] = linhasDe<{ membership_id: string; user_id: string; username: string }>(
      await manager.query(
        `SELECT r.membership_id, r.user_id, u.username::text AS username
           FROM staff_account_requests r JOIN users u ON u.id = r.user_id
          WHERE r.actor_user_id = $1 AND r.request_key = $2`,
        [actorId, requestKey],
      ),
    );
    if (!linha) return null;
    return {
      created: false,
      membershipId: linha.membership_id,
      userId: linha.user_id,
      username: linha.username,
      temporaryPassword: null,
    };
  }
}
