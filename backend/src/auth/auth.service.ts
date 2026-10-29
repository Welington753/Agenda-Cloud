// Autenticação por sessão: login, leitura do contexto (/auth/me) e logout.
// O cadastro livre foi fechado; contas novas nascem por convite da
// administração (src/accounts/invites.service.ts), que reaproveita a mesma
// política de senha e o mesmo formato de sessão.
import { Injectable, UnauthorizedException } from '@nestjs/common';
// Import de valor (não `import type`) — o Nest usa `design:paramtypes` do
// construtor para resolver o token de injeção; um `import type` apagaria essa
// referência em runtime e a DI falharia com "dependency ... is undefined".
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { Credential } from '../entities/credential.entity.js';
import { UserStatus } from '../entities/enums/user-status.enum.js';
import { Membership } from '../entities/membership.entity.js';
import { Plan } from '../entities/plan.entity.js';
import { Session } from '../entities/session.entity.js';
import { Tenant } from '../entities/tenant.entity.js';
import { Unit } from '../entities/unit.entity.js';
import { User } from '../entities/user.entity.js';
import { DEFAULT_SESSION_MAX_AGE_MS } from '../config/session-cookie.config.js';
import { InvalidCredentialsError } from './auth.errors.js';
import type { ChangePasswordDto, LoginDto } from './login.dto.js';
import { CREDENTIAL_ALGORITHM, DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from './password-hasher.js';
import { recordAudit } from '../accounts/audit.js';
import type { SessionContextResult, TenantContext } from './session-context.js';
import { generateSessionToken, hashSessionToken, isValidSessionTokenFormat } from './session-token.js';
import { isTenantUsableForSession } from './tenant-access.js';
import { isMembershipActive } from '../common/tenant-authorization.js';
import { TRIAL_DURATION_DAYS, computeTrialWindow } from './trial-policy.js';
import { tenantAccessSituation } from '../commercial/commercial-gate.js';
import { sessionAreas } from './session-areas.js';

export interface LoginContext {
  now: Date;
  userAgent?: string;
  ipAddress?: string;
}

export interface LoginResult extends SessionContextResult {
  /** Só para o controller emitir o cookie depois do COMMIT — nunca serializar
   * isto na resposta HTTP. */
  token: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly dataSource: DataSource) {}

  /** POST /auth/login (Lote 6B.4, revisado no 6B.6). Numa única transação:
   * acha o usuário, verifica a senha (SEMPRE via Argon2id, com hash fictício
   * fixo quando não há credencial real para comparar — ver
   * password-hasher.ts) e confere status do usuário — só isso autentica a
   * IDENTIDADE. Todo caminho de recusa de identidade (e-mail inexistente,
   * senha errada, credencial ausente, algoritmo desconhecido, usuário
   * inativo) rejeita com a MESMA `InvalidCredentialsError` — nunca uma
   * mensagem diferente por caso, que seria um oráculo de enumeração de
   * e-mail. Uma vez autenticada a identidade, a sessão é criada
   * incondicionalmente: ter zero, um ou vários vínculos de estabelecimento
   * (Membership) utilizáveis é um estado de NEGÓCIO válido, nunca motivo
   * para recusar o login (ver `loadTenantContexts`) — um tenant inativo não
   * invalida a identidade, só fica fora da lista de contexts. */
  async login(dto: LoginDto, context: LoginContext): Promise<LoginResult> {
    return this.dataSource.transaction(async (manager) => {
      const user = await this.findLoginUser(manager, dto);
      const credential = user
        ? await manager.findOne(Credential, { where: { userId: user.id } })
        : null;

      const hasRealCredential = !!credential && credential.algorithm === CREDENTIAL_ALGORITHM;
      // SEMPRE roda o Argon2id, com o hash real quando existe ou o fictício
      // fixo quando não — nunca pula essa chamada, senão o tempo de resposta
      // por si só revelaria se o e-mail existe.
      const passwordMatches = await verifyPassword(
        hasRealCredential ? credential!.passwordHash : DUMMY_PASSWORD_HASH,
        dto.password,
      );

      const userActive = !!user && user.status === UserStatus.ACTIVE;
      if (!hasRealCredential || !passwordMatches || !userActive) {
        throw new InvalidCredentialsError();
      }

      const { token, tokenHash } = generateSessionToken();
      const session = manager.create(Session, {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(context.now.getTime() + DEFAULT_SESSION_MAX_AGE_MS),
        userAgent: context.userAgent,
        ipAddress: context.ipAddress,
      });
      await manager.save(session);

      const contexts = await this.loadTenantContexts(manager, user.id);

      return {
        token,
        ...(await this.buildSessionContextResult(manager, user, contexts)),
      };
    });
  }

  /** GET /auth/me (Lote 6B.4, revisado no 6B.6). Só leitura — nenhuma
   * transação, nenhuma escrita. `SessionGuard` já provou a identidade
   * (sessão válida + usuário ativo); aqui só resolvemos os vínculos de
   * estabelecimento utilizáveis para montar a resposta. Nunca lança para um
   * usuário autenticado sem nenhum vínculo — isso é `hasEstablishmentAccess:
   * false`, nunca um 401/500. */
  async getSessionContext(userId: string): Promise<SessionContextResult> {
    const manager = this.dataSource.manager;
    const user = await manager.findOne(User, { where: { id: userId } });
    if (!user) {
      // Não deveria acontecer — o guard acabou de validar este userId.
      // Propaga como erro desconhecido (500 genérico via filtro padrão do
      // Nest), nunca finge sucesso com dado inventado.
      throw new Error('Usuário da sessão autenticada não foi encontrado.');
    }

    const contexts = await this.loadTenantContexts(manager, user.id);
    return this.buildSessionContextResult(manager, user, contexts);
  }

  /** Monta um `TenantContext` por Membership utilizável (tenant TRIAL ou
   * ACTIVE — ver tenant-access.ts) do usuário; memberships de tenant
   * inativo (SUSPENDED/PAST_DUE/CANCELED) são silenciosamente excluídas da
   * lista, nunca causam erro. Reaproveitado por `login` e
   * `getSessionContext` — única fonte de verdade, os dois nunca podem
   * divergir sobre o que é um contexto utilizável. */
  private async loadTenantContexts(
    manager: EntityManager,
    userId: string,
  ): Promise<TenantContext[]> {
    const memberships = await manager.find(Membership, { where: { userId } });
    const contexts: TenantContext[] = [];

    for (const membership of memberships) {
      // Acesso suspenso pelo dono: o estabelecimento some da lista desta
      // conta, sem afetar os demais vínculos dela.
      if (!isMembershipActive(membership)) continue;
      const tenant = await manager.findOne(Tenant, { where: { id: membership.tenantId } });
      if (!tenant || !isTenantUsableForSession(tenant.status)) {
        continue;
      }

      const unit = await manager.findOne(Unit, {
        where: { tenantId: tenant.id, isPrimary: true },
      });
      const plan = await manager.findOne(Plan, { where: { id: tenant.planId } });
      if (!plan) {
        // FK RESTRICT garante que isto não deveria acontecer — pula em vez
        // de quebrar a resposta inteira por um tenant com dado inconsistente.
        continue;
      }

      const { trialStartAt, trialEndAt } = computeTrialWindow(tenant.createdAt);
      const access = await tenantAccessSituation(manager, tenant.id, new Date());

      contexts.push({
        membershipId: membership.id,
        tenantId: tenant.id,
        tenantName: unit?.name ?? tenant.slug,
        tenantSlug: tenant.slug,
        role: membership.role,
        unit: unit ? { id: unit.id, name: unit.name, isPrimary: unit.isPrimary } : null,
        planCode: plan.code,
        planName: plan.name,
        trial: { trialStartAt, trialEndAt, durationDays: TRIAL_DURATION_DAYS },
        tenantStatus: tenant.status,
        access,
        // Vencido: nenhuma área (as rotas respondem ACESSO_VENCIDO).
        areas: access.blocked ? [] : await sessionAreas(manager, membership),
      });
    }

    return contexts;
  }

  /** Regra única de decisão de `activeContext`/`requiresTenantSelection`/
   * `hasEstablishmentAccess` a partir da lista de contexts — nunca escolhe o
   * primeiro quando há mais de um. */
  /** Conta pelo identificador do login: e-mail OU login interno (que pode ter
   * `@`). O banco impede o mesmo texto em contas diferentes
   * (`uq_users_login_identifier`); se ainda assim duas contas aparecerem, o
   * login é recusado como credencial inválida, nunca resolvido escolhendo
   * uma delas. As colunas novas não estão na entidade: SQL explícito. */
  private async findLoginUser(manager: EntityManager, dto: LoginDto): Promise<User | null> {
    const linhas = await manager.query<{ id: string }[]>(
      'SELECT id FROM users WHERE email = $1 OR username = $1 LIMIT 2',
      [dto.identifier],
    );
    if (linhas.length !== 1) return null;
    return manager.findOne(User, { where: { id: linhas[0].id } });
  }

  private async buildSessionContextResult(
    manager: EntityManager,
    user: User,
    contexts: TenantContext[],
  ): Promise<SessionContextResult> {
    const [extra] = await manager.query<{ username: string | null; must_change_password: boolean }[]>(
      'SELECT username, must_change_password FROM users WHERE id = $1',
      [user.id],
    );
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email ?? null,
        username: extra?.username ?? null,
        mustChangePassword: extra?.must_change_password === true,
      },
      contexts,
      activeContext: contexts.length === 1 ? contexts[0] : null,
      requiresTenantSelection: contexts.length > 1,
      hasEstablishmentAccess: contexts.length >= 1,
    };
  }

  /** POST /auth/password: troca da própria senha. A senha atual é conferida
   * com Argon2id (hash fictício quando não há credencial real, como no
   * login); errada, 401 `SENHA_INCORRETA` sem gravar nada. Na mesma
   * transação: hash novo, fim da senha temporária, as OUTRAS sessões
   * encerradas e o histórico (sem senha nenhuma). */
  async changePassword(userId: string, sessionId: string, dto: ChangePasswordDto, now: Date): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const [conta] = await manager.query<{ name: string; password_hash: string | null; algorithm: string | null }[]>(
        `SELECT u.name, c.password_hash, c.algorithm FROM users u
           LEFT JOIN credentials c ON c.user_id = u.id
          WHERE u.id = $1 FOR UPDATE OF u`,
        [userId],
      );
      const real = !!conta?.password_hash && conta.algorithm === CREDENTIAL_ALGORITHM;
      const confere = await verifyPassword(real ? conta.password_hash! : DUMMY_PASSWORD_HASH, dto.currentPassword);
      if (!conta || !real || !confere) {
        throw new UnauthorizedException({ code: 'SENHA_INCORRETA', message: 'Senha atual incorreta.' });
      }
      await manager.query(
        `UPDATE credentials SET password_hash = $2, algorithm = $3, updated_at = $4 WHERE user_id = $1`,
        [userId, await hashPassword(dto.newPassword), CREDENTIAL_ALGORITHM, now],
      );
      await manager.query(
        `UPDATE users SET must_change_password = false,
                updated_at = GREATEST($2::timestamptz, updated_at + interval '1 millisecond')
          WHERE id = $1`,
        [userId, now],
      );
      await manager.query(
        `UPDATE sessions SET revoked_at = $3 WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`,
        [userId, sessionId, now],
      );
      await recordAudit(
        manager,
        {
          action: 'PASSWORD_CHANGED',
          actor: { id: userId, name: conta.name },
          targetUserId: userId,
          summary: 'Senha trocada pela própria pessoa. As outras sessões foram encerradas.',
        },
        now,
      );
    });
  }

  /** POST /auth/logout (Lote 6B.5). Idempotente por natureza: cookie
   * ausente, token malformado, sessão desconhecida ou já revogada terminam em
   * no-op silencioso (controller sempre responde 204, nunca revela qual
   * caso). Só quando a sessão existe e está válida é que roda dentro de uma
   * transação (revogação atômica). Nenhum AuditLog aqui ainda — pendência
   * documentada (`AuditAction` não tem LOGIN_SUCCEEDED/LOGOUT; adicionar
   * exigiria migration, fora do escopo deste lote). */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken || !isValidSessionTokenFormat(rawToken)) {
      return;
    }
    const tokenHash = hashSessionToken(rawToken);

    await this.dataSource.transaction(async (manager) => {
      const session = await manager.findOne(Session, { where: { tokenHash } });
      if (!session || session.revokedAt) {
        return;
      }
      session.revokedAt = new Date();
      await manager.save(session);
    });
  }
}
