// Acesso de equipe com LOGIN INTERNO e SENHA TEMPORÁRIA, sem e-mail (ver
// docs/plans/operacao-diaria-configuracoes.md, PR 2, e
// docs/plans/equipe-gerente-login-interno.md).
//
// CRIAR (dono, senha confirmada há pouco nesta sessão): numa transação só,
// com o estabelecimento travado (mesma fila das vagas, ver seats.ts):
// estabelecimento em operação; perfil PROFISSIONAL (sempre com profissional)
// ou GERENTE (com ou sem profissional); o profissional, quando há, ativo, sem
// acesso e sem convite pendente; vaga livre no plano; login livre na
// plataforma (também contra os e-mails, ver migration TeamManagerAccess); e
// só as permissões que o dono pode conceder, com as dependências junto (ver
// team-permissions.ts). Grava conta NOVA (sem e-mail, e-mail não verificado,
// troca de senha obrigatória), credencial (Argon2id), vínculo, permissões (no
// gerente, já confirmadas pelo dono), a chave do formulário e o histórico.
// Qualquer recusa desfaz tudo: nunca sobra conta sem vínculo, e nunca uma
// conta existente é ligada ou assumida: login em uso é recusado.
//
// Gerente sem profissional ocupa vaga de equipe, mas NÃO cria profissional.
//
// A senha temporária é gerada aqui, devolvida UMA vez nesta resposta e nunca
// guardada em claro, em log ou no histórico. Repetir o mesmo formulário
// (mesma chave) devolve o acesso já criado, SEM senha: para outra, o dono
// gera uma nova.
//
// NOVA SENHA TEMPORÁRIA (dono, profissional ou gerente): só para a conta
// criada assim — sem e-mail,
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
import { validarConcessoes } from './team-permissions.js';
import { TEAM_ROLES } from './staff-access.js';

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
  role: string;
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
    // Sem `role` (chamada direta, como a rota anterior): PROFISSIONAL.
    dto: Omit<StaffAccountDto, 'role'> & { role?: StaffAccountDto['role'] },
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
        // Sem perfil (quem chama sem passar pelo DTO, como a tela anterior): profissional.
        const role = dto.role ?? 'PROFISSIONAL';
        if (!(TEAM_ROLES as readonly string[]).includes(role)) throw conflito('PERFIL_INVALIDO', 'Perfil inválido.');
        await expireStaleStaffInvites(manager, tenant.id, now);
        let profissional: { id: string; name: string } | null = null;
        if (dto.professionalId) {
          const [encontrado] = await manager.query<{ id: string; name: string; active: boolean }[]>(
            'SELECT id, name, active FROM professionals WHERE tenant_id = $1 AND id = $2 FOR SHARE',
            [tenant.id, dto.professionalId],
          );
          if (!encontrado) throw new NotFoundException('Profissional não encontrado.');
          if (!encontrado.active) {
            throw conflito('PROFISSIONAL_INATIVO', 'Este profissional está desativado. Reative-o antes de criar o acesso.');
          }
          const [vinculo] = await manager.query<unknown[]>(
            'SELECT 1 FROM memberships WHERE tenant_id = $1 AND professional_id = $2',
            [tenant.id, encontrado.id],
          );
          if (vinculo) {
            throw conflito(
              'PROFISSIONAL_COM_ACESSO',
              'Este profissional já tem um acesso. Para trocar a pessoa, remova o acesso atual antes.',
            );
          }
          const [pendente] = await manager.query<unknown[]>(
            `SELECT 1 FROM invites WHERE tenant_id = $1 AND professional_id = $2 AND status = 'PENDING'`,
            [tenant.id, encontrado.id],
          );
          if (pendente) {
            throw conflito('CONVITE_PENDENTE', 'Este profissional já tem um convite pendente. Revogue o convite antes.');
          }
          profissional = { id: encontrado.id, name: encontrado.name };
        }
        const vagas = await staffSeatUsage(manager, tenant.id, tenant.plan.maxProfessionals, now);
        if (vagas.used >= vagas.limit) throw conflito('LIMITE_DO_PLANO', seatLimitMessage(vagas));
        validarConcessoes(gestor, { role, withProfessional: !!profissional }, dto.permissions);
        const gerente = role === 'GERENTE';

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
        // No gerente, a criação JÁ É a confirmação do dono: o que ele marcou
        // e viu na tela é o que vale (ver effectiveOverrides).
        await manager.query(
          `INSERT INTO memberships (id, user_id, tenant_id, role, professional_id, status, created_at, permissions_confirmed_at)
           VALUES ($1, $2, $3, $4::establishment_role, $5, 'ACTIVE', $6, $7)`,
          [membershipId, userId, tenant.id, role, profissional?.id ?? null, now, gerente ? now : null],
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
            summary: `Acesso de ${gerente ? 'gerente' : 'profissional'} criado para ${dto.username}, ${
              profissional ? `ligado a ${profissional.name}` : 'sem profissional ligado'
            }.`,
            newData: {
              username: dto.username,
              role,
              professionalId: profissional?.id ?? null,
              granted: [...dto.permissions].sort(),
            },
          },
          now,
        );
        return { created: true, membershipId, userId, username: dto.username, role, temporaryPassword: senha };
      });
    } catch (error) {
      // Mesma mensagem para login de outra conta e e-mail de outra conta: a
      // tela não diz qual dos dois, e nada é ligado à conta existente.
      if (isUniqueViolation(error, 'uq_users_username') || isUniqueViolation(error, 'uq_users_login_identifier')) {
        throw conflito('USUARIO_EM_USO', 'Este login já está em uso na plataforma. Escolha outro.');
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
            WHERE m.id = $1 AND m.tenant_id = $2 AND m.role IN ('PROFISSIONAL', 'GERENTE')
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
    const [linha] = linhasDe<{ membership_id: string; user_id: string; username: string; role: string | null }>(
      await manager.query(
        `SELECT r.membership_id, r.user_id, u.username::text AS username, m.role::text AS role
           FROM staff_account_requests r JOIN users u ON u.id = r.user_id
           LEFT JOIN memberships m ON m.id = r.membership_id
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
      role: linha.role ?? 'PROFISSIONAL',
      temporaryPassword: null,
    };
  }
}
