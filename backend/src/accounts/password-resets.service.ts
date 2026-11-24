// Redefinição de senha por link. Duas origens (`password_resets.origin`):
//
// - ADMIN: a administração dispara o link para o e-mail da conta (aqui, em
//   `request`). Nunca vê nem define a senha. 24 horas; um pedido novo da
//   administração revoga o pendente, inclusive um de autoatendimento.
// - SELF_SERVICE: "Esqueci minha senha", pedido anônimo resolvido em
//   password-reset-requests.ts. 1 hora; nunca revoga um link pendente.
//
// Para as duas: uso único, só o hash no banco, no máximo um pendente por
// conta (índice parcial), envio depois do commit com o estado registrado.
// Quem abre o link cria a senha nova (`complete`); depois disso, todas as
// sessões da conta são encerradas e nenhum link pendente sobra. O segundo
// fator não é tocado: o próximo login continua pedindo.
import { ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { generateId } from '../entities/common/generate-id.js';
import { CREDENTIAL_ALGORITHM, hashPassword } from '../auth/password-hasher.js';
import { isUniqueViolation } from '../auth/unique-violation.js';
import type { EmailSendResult } from '../email/email-sender.js';
import { AccountDelivery } from './account-delivery.js';
import { emailDeRedefinicao, linkDeRedefinicao } from './account-emails.js';
import { generateAccountToken, hashAccountToken, isValidAccountTokenFormat, linkExpiresAt } from './account-token.js';
import { assertCanManageAccount, loadActor } from './actor.js';
import { recordAudit } from './audit.js';
import { avancarVersao } from './user-version.js';

export interface PasswordResetView {
  id: string;
  status: 'PENDING' | 'USED' | 'REVOKED' | 'EXPIRED';
  delivery: { status: string; attempts: number; lastAt: string | null; failure: string | null };
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  origin: 'ADMIN' | 'SELF_SERVICE';
  /** Quem pediu, só na origem ADMIN. O pedido de autoatendimento é anônimo. */
  requestedBy: { id: string; name: string } | null;
}

export const PASSWORD_RESET_COLUMNS = `json_build_object(
  'id', r.id,
  'status', CASE WHEN r.status = 'PENDING' AND r.expires_at <= now() THEN 'EXPIRED' ELSE r.status END,
  'delivery', json_build_object('status', r.delivery_status, 'attempts', r.delivery_attempts,
    'lastAt', r.last_delivery_at, 'failure', r.delivery_failure),
  'createdAt', r.created_at,
  'expiresAt', r.expires_at,
  'usedAt', r.used_at,
  'origin', r.origin,
  'requestedBy', CASE WHEN req.id IS NULL THEN NULL ELSE json_build_object('id', req.id, 'name', req.name) END
) AS reset`;

/** FROM para `PASSWORD_RESET_COLUMNS`: autor opcional (autoatendimento). */
export const PASSWORD_RESET_FROM = 'password_resets r LEFT JOIN users req ON req.id = r.requested_by_user_id';

export async function loadPasswordResetView(manager: EntityManager, id: string): Promise<PasswordResetView | null> {
  const [linha] = await manager.query<{ reset: PasswordResetView }[]>(
    `SELECT ${PASSWORD_RESET_COLUMNS} FROM ${PASSWORD_RESET_FROM} WHERE r.id = $1`,
    [id],
  );
  return linha?.reset ?? null;
}

type PublicResetStatus = 'VALID' | 'INVALID' | 'EXPIRED' | 'USED' | 'REVOKED' | 'UNAVAILABLE';

const MENSAGEM: Record<Exclude<PublicResetStatus, 'VALID' | 'INVALID'>, string> = {
  EXPIRED: 'Este link expirou. Peça outro em "Esqueci minha senha" ou à administração.',
  USED: 'Este link já foi usado.',
  REVOKED: 'Este link não vale mais. Use o link mais recente ou peça outro em "Esqueci minha senha".',
  UNAVAILABLE: 'Esta conta não pode redefinir a senha agora. Fale com a administração.',
};

interface ResetRow {
  id: string;
  user_id: string;
  status: string;
  expires_at: Date;
  user_name: string;
  user_email: string;
  user_status: string;
}

@Injectable()
export class PasswordResetsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly delivery: AccountDelivery,
  ) {}

  async request(actorId: string, userId: string, requestKey: string, now = new Date()) {
    const anterior = await this.findByRequestKey(actorId, requestKey);
    if (anterior) return { created: false, reset: anterior, delivery: null };
    let issued: { id: string; token: string; tokenHash: string; name: string; email: string; validityMs: number };
    try {
      issued = await this.dataSource.transaction(async (manager) => {
        const actor = await loadActor(manager, actorId);
        const [target] = await manager.query<
          { id: string; name: string; email: string; status: string; platform_role: string | null; has_credential: boolean }[]
        >(
          `SELECT u.id, u.name, u.email, u.status, u.platform_role,
                  EXISTS (SELECT 1 FROM credentials c WHERE c.user_id = u.id) AS has_credential
             FROM users u WHERE u.id = $1 FOR UPDATE`,
          [userId],
        );
        if (!target) throw new NotFoundException('Conta não encontrada.');
        assertCanManageAccount(actor, { id: target.id, platformRole: target.platform_role as never });
        // Conta de funcionário com usuário e senha, sem e-mail: não há para
        // onde mandar o link. A nova senha temporária é gerada pelo dono do
        // estabelecimento, em Equipe e acessos.
        if (!target.email) {
          throw new ConflictException({
            code: 'CONTA_SEM_EMAIL',
            message:
              'Esta conta entra com nome de usuário e não tem e-mail. O dono do estabelecimento gera uma nova senha temporária em Equipe e acessos.',
          });
        }
        if (target.status !== 'ACTIVE' || !target.has_credential) {
          throw new ConflictException({
            code: 'CONTA_SEM_SENHA_ATIVA',
            message:
              target.status === 'SUSPENDED'
                ? 'A conta está bloqueada. Reative-a antes de pedir a redefinição.'
                : 'A conta ainda não foi ativada. Reenvie o convite em vez de redefinir a senha.',
          });
        }
        await manager.query(
          `UPDATE password_resets SET status = 'REVOKED', revoked_at = $2, delivery_due_at = NULL
            WHERE user_id = $1 AND status = 'PENDING'`,
          [target.id, now],
        );
        const id = generateId();
        const { token, tokenHash } = generateAccountToken();
        const expiresAt = linkExpiresAt(now);
        await manager.query(
          `INSERT INTO password_resets (id, user_id, requested_by_user_id, origin, token_hash, status, created_at,
              expires_at, request_key)
           VALUES ($1, $2, $3, 'ADMIN', $4, 'PENDING', $5, $6, $7)`,
          [id, target.id, actor.id, tokenHash, now, expiresAt, requestKey],
        );
        await recordAudit(
          manager,
          {
            action: 'PASSWORD_RESET_REQUESTED',
            actor,
            targetUserId: target.id,
            summary: `Redefinição de senha enviada para ${target.email}.`,
            newData: { passwordResetId: id },
          },
          now,
        );
        return {
          id,
          token,
          tokenHash,
          name: target.name,
          email: target.email,
          validityMs: expiresAt.getTime() - now.getTime(),
        };
      });
    } catch (error) {
      if (isUniqueViolation(error, 'uq_password_resets_requested_by_request_key')) {
        const repetido = await this.findByRequestKey(actorId, requestKey);
        if (repetido) return { created: false, reset: repetido, delivery: null };
      }
      throw error;
    }
    const delivery: EmailSendResult = await this.delivery.deliver(
      'password_resets',
      { id: issued.id, tokenHash: issued.tokenHash },
      emailDeRedefinicao(issued, linkDeRedefinicao(this.delivery.frontendUrl, issued.token)),
    );
    return { created: true, reset: (await loadPasswordResetView(this.dataSource.manager, issued.id))!, delivery };
  }

  async preview(token: string, now = new Date()) {
    const reset = await this.findByToken(this.dataSource.manager, token, false);
    const status = this.status(reset, now);
    if (status !== 'VALID') return { status };
    return { status, name: reset!.user_name, email: reset!.user_email };
  }

  async complete(token: string, password: string, now = new Date()): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const reset = await this.findByToken(manager, token, true);
      const status = this.status(reset, now);
      if (status === 'INVALID') throw new NotFoundException({ code: 'LINK_INVALIDO', message: 'Link inválido.' });
      if (status !== 'VALID') throw new GoneException({ code: `LINK_${status}`, message: MENSAGEM[status] });
      const alvo = reset!;
      const [user] = await manager.query<{ status: string }[]>('SELECT status FROM users WHERE id = $1 FOR UPDATE', [
        alvo.user_id,
      ]);
      if (user?.status !== 'ACTIVE') {
        throw new GoneException({ code: 'LINK_UNAVAILABLE', message: MENSAGEM.UNAVAILABLE });
      }
      await manager.query(
        `UPDATE credentials SET password_hash = $2, algorithm = $3, updated_at = $4 WHERE user_id = $1`,
        [alvo.user_id, await hashPassword(password), CREDENTIAL_ALGORITHM, now],
      );
      // O link chegou ao e-mail da conta: isso prova o endereço.
      await manager.query(`UPDATE users SET email_verified = true, ${avancarVersao('$2')} WHERE id = $1`, [
        alvo.user_id,
        now,
      ]);
      await manager.query(`UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL`, [
        alvo.user_id,
        now,
      ]);
      await manager.query(
        `UPDATE password_resets SET status = 'USED', used_at = $2, delivery_due_at = NULL WHERE id = $1`,
        [alvo.id, now],
      );
      // Nenhum outro link da conta continua valendo (o índice parcial já
      // impede dois pendentes; isto fecha o caso por construção).
      await manager.query(
        `UPDATE password_resets SET status = 'REVOKED', revoked_at = $2, delivery_due_at = NULL
          WHERE user_id = $1 AND status = 'PENDING' AND id <> $3`,
        [alvo.user_id, now, alvo.id],
      );
      await recordAudit(
        manager,
        {
          action: 'PASSWORD_RESET_COMPLETED',
          actor: { id: alvo.user_id, name: alvo.user_name },
          targetUserId: alvo.user_id,
          summary: 'Senha redefinida pelo link enviado ao e-mail da conta. Sessões encerradas.',
          newData: { passwordResetId: alvo.id },
        },
        now,
      );
    });
  }

  async findByRequestKey(actorId: string, requestKey: string): Promise<PasswordResetView | null> {
    const [linha] = await this.dataSource.query<{ id: string }[]>(
      'SELECT id FROM password_resets WHERE requested_by_user_id = $1 AND request_key = $2',
      [actorId, requestKey],
    );
    return linha ? loadPasswordResetView(this.dataSource.manager, linha.id) : null;
  }

  private async findByToken(manager: EntityManager, token: string, lock: boolean): Promise<ResetRow | null> {
    if (!isValidAccountTokenFormat(token)) return null;
    const [linha] = await manager.query<ResetRow[]>(
      `SELECT r.id, r.user_id, r.status, r.expires_at, u.name AS user_name, u.email AS user_email, u.status AS user_status
         FROM password_resets r JOIN users u ON u.id = r.user_id
        WHERE r.token_hash = $1${lock ? ' FOR UPDATE OF r' : ''}`,
      [hashAccountToken(token)],
    );
    return linha ?? null;
  }

  private status(reset: ResetRow | null, now: Date): PublicResetStatus {
    if (!reset) return 'INVALID';
    if (reset.status === 'USED') return 'USED';
    if (reset.status === 'REVOKED') return 'REVOKED';
    if (reset.status === 'EXPIRED' || new Date(reset.expires_at) <= now) return 'EXPIRED';
    if (reset.user_status !== 'ACTIVE') return 'UNAVAILABLE';
    return 'VALID';
  }
}
