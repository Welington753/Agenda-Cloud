// Convites: a ÚNICA entrada de conta nova no sistema (o cadastro público foi
// fechado). Três origens, sempre pela administração da plataforma:
//
// - nova empresa com o responsável (cria estabelecimento, unidade principal
//   e o convite de DONO numa transação só);
// - novo vínculo de DONO numa empresa existente;
// - convite de administração da plataforma (só MASTER_OWNER).
//
// E-mail que ainda não tem conta: cria a conta PENDENTE (`INVITED`, sem
// senha, e-mail não verificado). Ela só passa a entrar depois do aceite, em
// que a pessoa prova que recebeu o e-mail (o link) e define a própria senha.
// E-mail que já tem conta: nada da pessoa é alterado (nome, telefone,
// senha); o vínculo só nasce quando a própria conta aceita, confirmando a
// senha atual.
//
// Links: 24 horas, uso único, só o hash no banco. Reenviar emite outro link
// (o anterior deixa de valer). Abrir a página do link não consome nada: o
// aceite é um POST explícito, serializado por `FOR UPDATE` no convite.
import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { DEFAULT_SESSION_MAX_AGE_MS } from '../config/session-cookie.config.js';
import { generateId } from '../entities/common/generate-id.js';
import { CREDENTIAL_ALGORITHM, DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from '../auth/password-hasher.js';
import { generateSessionToken } from '../auth/session-token.js';
import { resolveSlug, slugify } from '../auth/slug.js';
import { isUniqueViolation } from '../auth/unique-violation.js';
import type { EmailSendResult } from '../email/email-sender.js';
import { AccountDelivery } from './account-delivery.js';
import { emailDeConvite, linkDeConvite, type ConviteParaEmail } from './account-emails.js';
import {
  MAX_INVITE_SENDS,
  generateAccountToken,
  hashAccountToken,
  isValidAccountTokenFormat,
  linkExpiresAt,
} from './account-token.js';
import type { CreateEstablishmentDto, InviteMemberDto, PlatformInviteDto } from './accounts.dto.js';
import { PLATFORM_ACCOUNT_MESSAGE, SELF_MESSAGE, loadActor, requireCapability, type Actor } from './actor.js';
import { recordAudit } from './audit.js';
import { loadInviteView, type InviteView } from './invite-views.js';
import { avancarVersao } from './user-version.js';
import {
  type LockedTenant,
  expireStaleStaffInvites,
  isOperational,
  lockTenantForSeats,
  seatLimitMessage,
  staffSeatUsage,
} from '../team/seats.js';
import { resolveTeamManager } from '../team/team-authorization.js';
import type { StaffInviteDto } from '../team/team.dto.js';
import { firstTrial } from '../commercial/access-periods.js';

export const LOGIN_IDENTIFIER_IN_USE_MESSAGE =
  'Este e-mail não está disponível para convite. Use outro e-mail.';

export const MAX_SLUG_SAVE_RETRIES = 3;

export interface InviteCreationResult {
  /** `false` quando a mesma chave de formulário já tinha criado o convite:
   * nada novo foi criado nem enviado. */
  created: boolean;
  tenant: { id: string; name: string } | null;
  invite: InviteView;
  delivery: EmailSendResult | null;
}

export interface AcceptResult {
  /** Só para o controller emitir o cookie depois do COMMIT. */
  sessionToken: string;
  userId: string;
  destination: string;
}

interface TargetAccount {
  id: string;
  name: string;
  /** Endereço como está na conta (o de um convite novo vem normalizado). */
  email: string;
  existed: boolean;
  hasCredential: boolean;
}

interface IssuedInvite {
  id: string;
  token: string;
  tokenHash: string;
  email: ConviteParaEmail;
}

const conflito = (code: string, message: string) => new ConflictException({ code, message });

@Injectable()
export class InvitesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly delivery: AccountDelivery,
  ) {}

  // ---------------------------------------------------------------- criação

  async createEstablishment(actorId: string, dto: CreateEstablishmentDto, now = new Date()) {
    const replay = await this.replay(actorId, dto.requestKey);
    if (replay) return replay;
    for (let attempt = 1; ; attempt++) {
      try {
        const issued = await this.dataSource.transaction((manager) =>
          this.attemptCreateEstablishment(manager, actorId, dto, now),
        );
        return await this.finish(issued);
      } catch (error) {
        if (isUniqueViolation(error, 'uq_invites_created_by_request_key')) {
          const repetido = await this.replay(actorId, dto.requestKey);
          if (repetido) return repetido;
        }
        if (isUniqueViolation(error, 'uq_tenants_slug') && attempt < MAX_SLUG_SAVE_RETRIES) continue;
        throw error;
      }
    }
  }

  private async attemptCreateEstablishment(
    manager: EntityManager,
    actorId: string,
    dto: CreateEstablishmentDto,
    now: Date,
  ): Promise<IssuedInvite & { tenantId: string }> {
    const actor = await loadActor(manager, actorId);
    requireCapability(actor, 'manageEstablishments');

    const [plan] = await manager.query<{ id: string; code: string; name: string }[]>(
      'SELECT id, code, name FROM plans WHERE id = $1',
      [dto.planId],
    );
    if (!plan) throw new NotFoundException('Plano não encontrado no catálogo.');

    const slug = await resolveSlug(slugify(dto.businessName), async (candidate) => {
      const linhas = await manager.query<unknown[]>('SELECT 1 FROM tenants WHERE slug = $1', [candidate]);
      return linhas.length > 0;
    });
    const tenantId = generateId();
    await manager.query(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, created_at, updated_at)
       VALUES ($1, $2, $3::business_category, $4, $5, 'TRIAL', $6, $6)`,
      [tenantId, slug, dto.category, dto.timezone, plan.id, now],
    );
    await manager.query(
      `INSERT INTO units (id, tenant_id, name, address, timezone, is_primary, created_at)
       VALUES ($1, $2, $3, '', $4, true, $5)`,
      [generateId(), tenantId, dto.businessName, dto.timezone, now],
    );
    // Teste gratuito gravado desde o cadastro: a validade passa a valer para
    // este estabelecimento (commercial/access-periods.ts).
    const teste = firstTrial(now, dto.timezone);
    await manager.query(
      `INSERT INTO tenant_access_periods (id, tenant_id, kind, plan_id, starts_at, ends_at, recorded_at, recorded_by_user_id)
       VALUES ($1, $2, 'TRIAL', $3, $4, $5, $6, $7)`,
      [generateId(), tenantId, plan.id, teste.startsAt, teste.endsAt, now, actor.id],
    );
    await recordAudit(
      manager,
      {
        action: 'TENANT_CREATED',
        actor,
        tenantId,
        summary: `Estabelecimento ${dto.businessName} criado pela administração.`,
        newData: {
          slug,
          planCode: plan.code,
          category: dto.category,
          timezone: dto.timezone,
          status: 'TRIAL',
          trialEndsAt: teste.endsAt.toISOString(),
        },
      },
      now,
    );

    const target = await this.prepareTarget(manager, actor, dto.owner, now);
    const issued = await this.issueInvite(manager, actor, target, now, {
      type: 'ESTABLISHMENT',
      requestKey: dto.requestKey,
      targetName: dto.owner.name,
      targetEmail: dto.owner.email,
      tenant: { id: tenantId, name: dto.businessName },
      role: 'DONO',
    });
    return { ...issued, tenantId };
  }

  async inviteMember(actorId: string, tenantId: string, dto: InviteMemberDto, now = new Date()) {
    const replay = await this.replay(actorId, dto.requestKey);
    if (replay) return replay;
    try {
      const issued = await this.dataSource.transaction(async (manager) => {
        const actor = await loadActor(manager, actorId);
        requireCapability(actor, 'manageEstablishments');
        const [tenant] = await manager.query<{ id: string; name: string }[]>(
          `SELECT t.id, COALESCE(u.name, t.slug::text) AS name FROM tenants t
             LEFT JOIN units u ON u.tenant_id = t.id AND u.is_primary = true
            WHERE t.id = $1 ORDER BY u.created_at LIMIT 1`,
          [tenantId],
        );
        if (!tenant) throw new NotFoundException('Estabelecimento não encontrado.');
        const target = await this.prepareTarget(manager, actor, { name: dto.name, email: dto.email }, now);
        return this.issueInvite(manager, actor, target, now, {
          type: 'ESTABLISHMENT',
          requestKey: dto.requestKey,
          targetName: dto.name,
          targetEmail: dto.email,
          tenant,
          role: dto.role,
        });
      });
      return await this.finish(issued);
    } catch (error) {
      return this.replayOnDuplicate(error, actorId, dto.requestKey);
    }
  }

  async invitePlatform(actorId: string, dto: PlatformInviteDto, now = new Date()) {
    const replay = await this.replay(actorId, dto.requestKey);
    if (replay) return replay;
    try {
      const issued = await this.dataSource.transaction(async (manager) => {
        const actor = await loadActor(manager, actorId);
        requireCapability(actor, 'managePlatformAccess');
        const [existente] = await manager.query<unknown[]>('SELECT 1 FROM users WHERE email = $1', [dto.email]);
        if (existente) {
          throw conflito(
            'CONTA_EXISTENTE',
            'Este e-mail já tem conta. Ajuste o papel de plataforma na ficha do usuário.',
          );
        }
        const target = await this.prepareTarget(manager, actor, { name: dto.name, email: dto.email }, now);
        return this.issueInvite(manager, actor, target, now, {
          type: 'PLATFORM',
          requestKey: dto.requestKey,
          targetName: dto.name,
          targetEmail: dto.email,
          tenant: null,
          platformRole: dto.platformRole,
          platformPermissions: dto.platformRole === 'MASTER_OWNER' ? [] : dto.permissions,
        });
      });
      return await this.finish(issued);
    } catch (error) {
      return this.replayOnDuplicate(error, actorId, dto.requestKey);
    }
  }

  /**
   * Convite de FUNCIONÁRIO feito pelo dono do estabelecimento ("Equipe e
   * acessos"). Sempre papel PROFISSIONAL, sempre ligado a um profissional
   * ativo deste estabelecimento que ainda não tem acesso nem convite
   * pendente, e só com vaga livre no plano. O dono nunca escolhe nem vê a
   * senha: a pessoa cria a dela pelo link (conta nova) ou aceita com a senha
   * que já tem (conta existente, nada dela é alterado).
   */
  async inviteStaff(actorId: string, tenantId: string, dto: StaffInviteDto, now = new Date()) {
    const replay = await this.replay(actorId, dto.requestKey);
    if (replay) return replay;
    try {
      const issued = await this.dataSource.transaction(async (manager) => {
        const gestor = await resolveTeamManager(manager, actorId, tenantId);
        const tenant = await lockTenantForSeats(manager, gestor.tenantId);
        const [profissional] = await manager.query<{ id: string; name: string; active: boolean }[]>(
          'SELECT id, name, active FROM professionals WHERE tenant_id = $1 AND id = $2 FOR SHARE',
          [tenant.id, dto.professionalId],
        );
        if (!profissional) throw new NotFoundException('Profissional não encontrado.');
        if (!profissional.active) {
          throw conflito('PROFISSIONAL_INATIVO', 'Este profissional está desativado. Reative-o antes de convidar.');
        }
        await this.assertProfessionalFree(manager, tenant.id, profissional.id);
        await expireStaleStaffInvites(manager, tenant.id, now);
        const [pendente] = await manager.query<{ id: string }[]>(
          `SELECT id FROM invites WHERE tenant_id = $1 AND professional_id = $2 AND status = 'PENDING'`,
          [tenant.id, profissional.id],
        );
        if (pendente) {
          throw new ConflictException({
            code: 'CONVITE_PENDENTE',
            message: 'Este profissional já tem um convite pendente. Reenvie ou revogue o convite atual.',
            inviteId: pendente.id,
          });
        }
        const vagas = await staffSeatUsage(manager, tenant.id, tenant.plan.maxProfessionals, now);
        if (vagas.used >= vagas.limit) throw conflito('LIMITE_DO_PLANO', seatLimitMessage(vagas));
        const actor = await loadActor(manager, actorId);
        const [propria] = await manager.query<unknown[]>('SELECT 1 FROM users WHERE id = $1 AND email = $2', [
          actorId,
          dto.email,
        ]);
        if (propria) throw conflito('PROPRIA_CONTA', 'Este é o seu e-mail: você já tem acesso a este estabelecimento.');
        const target = await this.prepareTarget(manager, actor, { name: dto.name, email: dto.email }, now);
        return this.issueInvite(manager, actor, target, now, {
          type: 'ESTABLISHMENT',
          requestKey: dto.requestKey,
          targetName: dto.name,
          targetEmail: dto.email,
          tenant: { id: tenant.id, name: tenant.name },
          role: 'PROFISSIONAL',
          professional: { id: profissional.id, name: profissional.name },
        });
      });
      return await this.finish(issued);
    } catch (error) {
      if (isUniqueViolation(error, 'uq_invites_pending_professional')) {
        throw conflito('CONVITE_PENDENTE', 'Este profissional já tem um convite pendente.');
      }
      return this.replayOnDuplicate(error, actorId, dto.requestKey);
    }
  }

  /** Reenvio e revogação pelo dono: só convites de funcionário DESTE
   * estabelecimento. Outro id é indistinguível de inexistente. */
  async resendStaff(actorId: string, tenantId: string, inviteId: string, now = new Date()) {
    return this.resendWith(actorId, inviteId, now, async (manager) => {
      const gestor = await resolveTeamManager(manager, actorId, tenantId);
      return (invite) => this.requireStaffInviteOf(invite, gestor.tenantId);
    });
  }

  async revokeStaff(actorId: string, tenantId: string, inviteId: string, now = new Date()): Promise<InviteView> {
    return this.revokeWith(actorId, inviteId, now, async (manager) => {
      const gestor = await resolveTeamManager(manager, actorId, tenantId);
      return (invite) => this.requireStaffInviteOf(invite, gestor.tenantId);
    });
  }

  /** Resultado de um formulário já enviado, para a tela conferir antes de
   * tentar de novo depois de uma resposta perdida. Só de quem criou. */
  async findByRequestKey(actorId: string, requestKey: string): Promise<InviteCreationResult | null> {
    return this.replay(actorId, requestKey);
  }

  // ------------------------------------------------------ reenvio e revogação

  async resend(actorId: string, inviteId: string, now = new Date()) {
    return this.resendWith(actorId, inviteId, now, async (manager) => {
      const actor = await loadActor(manager, actorId);
      return (invite) => this.requirePlatformScope(actor, invite);
    });
  }

  async revoke(actorId: string, inviteId: string, now = new Date()): Promise<InviteView> {
    return this.revokeWith(actorId, inviteId, now, async (manager) => {
      const actor = await loadActor(manager, actorId);
      return (invite) => this.requirePlatformScope(actor, invite);
    });
  }

  /** Reenvio com a autorização de quem chama (administração ou dono). Convite
   * de funcionário trava antes o estabelecimento (mesma ordem do aceite) e
   * confere de novo profissional e vaga: um convite vencido já tinha liberado
   * a vaga, e reenviá-lo volta a ocupá-la. */
  private async resendWith(actorId: string, inviteId: string, now: Date, autorizar: Autorizador) {
    const issued = await this.dataSource.transaction(async (manager) => {
      const conferir = await autorizar(manager);
      const tenant = await this.lockTenantOfStaffInvite(manager, inviteId);
      const invite = await this.lockInvite(manager, inviteId, conferir);
      const actor = await loadActor(manager, actorId);
      if (invite.status !== 'PENDING') {
        throw conflito(
          'CONVITE_ENCERRADO',
          invite.status === 'EXPIRED'
            ? 'Este convite expirou e não pode ser reenviado. Crie um convite novo.'
            : 'Este convite já foi aceito ou revogado.',
        );
      }
      if (invite.send_count >= MAX_INVITE_SENDS) {
        throw conflito(
          'LIMITE_DE_REENVIOS',
          `Este convite já teve ${MAX_INVITE_SENDS} links emitidos. Revogue e crie outro convite.`,
        );
      }
      if (invite.target_status === 'SUSPENDED') {
        throw conflito('CONTA_BLOQUEADA', 'A conta convidada está bloqueada. Reative-a antes de reenviar.');
      }
      if (invite.professional_id) await this.assertStaffInviteUsable(manager, invite, tenant, now);
      const { token, tokenHash } = generateAccountToken();
      const expiresAt = linkExpiresAt(now);
      await manager.query(
        `UPDATE invites
            SET token_hash = $2, expires_at = $3, send_count = send_count + 1,
                delivery_status = 'PENDING', delivery_failure = NULL, updated_at = $4
          WHERE id = $1`,
        [invite.id, tokenHash, expiresAt, now],
      );
      await recordAudit(
        manager,
        {
          action: 'INVITE_RESENT',
          actor,
          tenantId: invite.tenant_id,
          targetUserId: invite.target_user_id,
          summary: `Convite reenviado para ${invite.target_email}.`,
          newData: { inviteId: invite.id, sendCount: invite.send_count + 1 },
        },
        now,
      );
      return {
        id: invite.id,
        token,
        tokenHash,
        tenantId: invite.tenant_id,
        email: {
          targetName: invite.target_account_name ?? invite.target_name,
          targetEmail: invite.target_email,
          tenantName: invite.tenant_name,
          accountExists: invite.target_has_credential,
          resent: true,
          validityMs: expiresAt.getTime() - now.getTime(),
        },
      };
    });
    return this.finish(issued);
  }

  /** Revogar libera a reserva na hora: não ocupa vaga, então não trava o
   * estabelecimento. */
  private async revokeWith(actorId: string, inviteId: string, now: Date, autorizar: Autorizador): Promise<InviteView> {
    await this.dataSource.transaction(async (manager) => {
      const conferir = await autorizar(manager);
      const invite = await this.lockInvite(manager, inviteId, conferir);
      const actor = await loadActor(manager, actorId);
      if (invite.status !== 'PENDING') {
        throw conflito('CONVITE_ENCERRADO', 'Este convite já foi aceito ou revogado.');
      }
      await manager.query(
        `UPDATE invites SET status = 'REVOKED', revoked_at = $2, updated_at = $2 WHERE id = $1`,
        [invite.id, now],
      );
      await recordAudit(
        manager,
        {
          action: 'INVITE_REVOKED',
          actor,
          tenantId: invite.tenant_id,
          targetUserId: invite.target_user_id,
          summary: `Convite para ${invite.target_email} revogado.`,
          previousData: { inviteId: invite.id, status: 'PENDING', professionalId: invite.professional_id },
          newData: { status: 'REVOKED' },
        },
        now,
      );
    });
    return (await loadInviteView(this.dataSource.manager, inviteId))!;
  }

  // ----------------------------------------------------------------- público

  async preview(token: string, now = new Date()) {
    const invite = await this.findByToken(this.dataSource.manager, token, false);
    const status = this.publicStatus(invite, now);
    if (status !== 'VALID') return { status };
    return {
      status,
      type: invite!.type,
      targetName: invite!.target_account_name ?? invite!.target_name,
      targetEmail: invite!.target_email,
      tenantName: invite!.tenant_name,
      platformRole: invite!.platform_role,
      accountExists: invite!.target_has_credential,
    };
  }

  async accept(
    token: string,
    password: string,
    context: { now: Date; userAgent?: string; ipAddress?: string },
  ): Promise<AcceptResult> {
    return this.dataSource.transaction(async (manager) => {
      // Estabelecimento antes do convite: mesma ordem de quem convida, e o
      // aceite de funcionário confere a vaga já com o lock.
      const previa = await this.findByToken(manager, token, false);
      const tenant = previa?.type === 'ESTABLISHMENT' && previa.tenant_id
        ? await lockTenantForSeats(manager, previa.tenant_id)
        : null;
      const invite = await this.findByToken(manager, token, true);
      const status = this.publicStatus(invite, context.now);
      if (status === 'INVALID') throw new NotFoundException({ code: 'CONVITE_INVALIDO', message: 'Convite inválido.' });
      if (status !== 'VALID') throw new GoneException({ code: `CONVITE_${status}`, message: MENSAGEM_ESTADO[status] });
      const alvo = invite!;
      if (alvo.type === 'ESTABLISHMENT') {
        if (!tenant || tenant.id !== alvo.tenant_id || !isOperational(tenant.status)) {
          throw new GoneException({ code: 'CONVITE_UNAVAILABLE', message: MENSAGEM_ESTADO.UNAVAILABLE });
        }
        if (alvo.professional_id) await this.assertStaffInviteUsable(manager, alvo, tenant, context.now);
      }

      const [user] = await manager.query<{ id: string; name: string; status: string }[]>(
        'SELECT id, name, status FROM users WHERE id = $1 FOR UPDATE',
        [alvo.target_user_id],
      );
      if (!user || user.status === 'SUSPENDED') {
        throw new GoneException({ code: 'CONVITE_UNAVAILABLE', message: MENSAGEM_ESTADO.UNAVAILABLE });
      }
      const [credential] = await manager.query<{ id: string; password_hash: string; algorithm: string }[]>(
        'SELECT id, password_hash, algorithm FROM credentials WHERE user_id = $1 FOR UPDATE',
        [user.id],
      );
      if (credential) {
        // Conta existente: aceita quem prova ser a dona dela. Nada muda na senha.
        const confere = await verifyPassword(
          credential.algorithm === CREDENTIAL_ALGORITHM ? credential.password_hash : DUMMY_PASSWORD_HASH,
          password,
        );
        if (!confere || credential.algorithm !== CREDENTIAL_ALGORITHM || user.status !== 'ACTIVE') {
          throw new UnauthorizedException({ code: 'SENHA_INCORRETA', message: 'Senha incorreta para esta conta.' });
        }
        await manager.query(
          `UPDATE users SET email_verified = true, ${avancarVersao('$2')} WHERE id = $1 AND email_verified = false`,
          [user.id, context.now],
        );
      } else {
        await manager.query(
          `INSERT INTO credentials (id, user_id, password_hash, algorithm, updated_at) VALUES ($1, $2, $3, $4, $5)`,
          [generateId(), user.id, await hashPassword(password), CREDENTIAL_ALGORITHM, context.now],
        );
        await manager.query(
          `UPDATE users SET status = 'ACTIVE', email_verified = true, ${avancarVersao('$2')} WHERE id = $1`,
          [user.id, context.now],
        );
      }

      let destination = '/conta';
      if (alvo.type === 'ESTABLISHMENT') {
        try {
          await manager.query(
            `INSERT INTO memberships (id, user_id, tenant_id, role, professional_id, created_at)
             VALUES ($1, $2, $3, $4::establishment_role, $5, $6)`,
            [generateId(), user.id, alvo.tenant_id, alvo.establishment_role, alvo.professional_id, context.now],
          );
        } catch (error) {
          if (isUniqueViolation(error, 'uq_memberships_user_tenant')) {
            throw conflito('JA_VINCULADO', 'Esta conta já tem vínculo com este estabelecimento.');
          }
          if (isUniqueViolation(error, 'uq_memberships_professional_id')) {
            throw conflito('PROFISSIONAL_COM_ACESSO', 'Este profissional já tem um acesso. Fale com o estabelecimento.');
          }
          throw error;
        }
        destination = alvo.professional_id ? '/conta/minha-agenda' : '/conta/visao-geral';
      } else {
        await manager.query(
          `UPDATE users SET platform_role = $2::platform_role, platform_permissions = $3::platform_permission[],
                  ${avancarVersao('$4')} WHERE id = $1`,
          [user.id, alvo.platform_role, alvo.platform_permissions, context.now],
        );
        destination = '/conta/administracao';
      }
      await manager.query(
        `UPDATE invites SET status = 'ACCEPTED', accepted_at = $2, updated_at = $2 WHERE id = $1`,
        [alvo.id, context.now],
      );
      await recordAudit(
        manager,
        {
          action: 'INVITE_ACCEPTED',
          actor: { id: user.id, name: user.name },
          tenantId: alvo.tenant_id,
          targetUserId: user.id,
          summary: credential ? 'Convite aceito por conta existente.' : 'Conta ativada pelo convite.',
          newData: {
            inviteId: alvo.id,
            type: alvo.type,
            role: alvo.establishment_role,
            platformRole: alvo.platform_role,
            accountActivated: !credential,
            professionalId: alvo.professional_id,
          },
        },
        context.now,
      );

      const { token: sessionToken, tokenHash } = generateSessionToken();
      await manager.query(
        `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, user_agent, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          generateId(),
          user.id,
          tokenHash,
          context.now,
          new Date(context.now.getTime() + DEFAULT_SESSION_MAX_AGE_MS),
          context.userAgent ?? null,
          context.ipAddress ?? null,
        ],
      );
      return { sessionToken, userId: user.id, destination };
    });
  }

  // ---------------------------------------------------------------- internos

  private async replay(actorId: string, requestKey: string): Promise<InviteCreationResult | null> {
    const [linha] = await this.dataSource.query<{ id: string; tenant_id: string | null }[]>(
      'SELECT id, tenant_id FROM invites WHERE created_by_user_id = $1 AND request_key = $2',
      [actorId, requestKey],
    );
    if (!linha) return null;
    const invite = (await loadInviteView(this.dataSource.manager, linha.id))!;
    return { created: false, tenant: invite.tenant, invite, delivery: null };
  }

  private async replayOnDuplicate(error: unknown, actorId: string, requestKey: string) {
    if (isUniqueViolation(error, 'uq_invites_created_by_request_key')) {
      const repetido = await this.replay(actorId, requestKey);
      if (repetido) return repetido;
    }
    throw error;
  }

  /** Depois do COMMIT: envia o e-mail e devolve o convite com o estado do envio. */
  private async finish(issued: IssuedInvite & { tenantId?: string | null }): Promise<InviteCreationResult> {
    const message = emailDeConvite(issued.email, linkDeConvite(this.delivery.frontendUrl, issued.token));
    const delivery = await this.delivery.deliver('invites', { id: issued.id, tokenHash: issued.tokenHash }, message);
    const invite = (await loadInviteView(this.dataSource.manager, issued.id))!;
    return { created: true, tenant: invite.tenant, invite, delivery };
  }

  /** Conta do e-mail informado: a existente (sem alterar nada nela) ou uma
   * nova, PENDENTE, sem senha. Nunca a conta de um login interno. */
  private async prepareTarget(
    manager: EntityManager,
    actor: Actor,
    person: { name: string; email: string; phone?: string },
    now: Date,
  ): Promise<TargetAccount> {
    const [existente] = await manager.query<
      { id: string; name: string; email: string; status: string; platform_role: string | null; has_credential: boolean }[]
    >(
      `SELECT u.id, u.name, u.email, u.status, u.platform_role, EXISTS (SELECT 1 FROM credentials c WHERE c.user_id = u.id) AS has_credential
         FROM users u WHERE u.email = $1 FOR UPDATE`,
      [person.email],
    );
    if (existente) {
      if (existente.id === actor.id) throw new ForbiddenException(SELF_MESSAGE);
      // Conta com papel de plataforma só é atingida por quem gerencia a
      // plataforma, mesmo quando a ação é um convite (ver actor.ts).
      if (existente.platform_role && !actor.caps.managePlatformAccess) {
        throw new ForbiddenException(PLATFORM_ACCOUNT_MESSAGE);
      }
      if (existente.status === 'SUSPENDED') {
        throw conflito('CONTA_BLOQUEADA', 'Este e-mail pertence a uma conta bloqueada. Reative-a antes de convidar.');
      }
      return {
        id: existente.id,
        name: existente.name,
        email: existente.email,
        existed: true,
        hasCredential: existente.has_credential,
      };
    }
    // Um login interno com aparência de e-mail (migration TeamManagerAccess)
    // nunca é ligado a este convite: a conta por e-mail seria OUTRA conta com
    // o mesmo identificador. Recusa sem tocar na conta existente e sem dizer
    // que o texto é um login (nem de qual conta ou estabelecimento).
    const [comoLogin] = await manager.query<unknown[]>('SELECT 1 FROM users WHERE username = $1', [person.email]);
    if (comoLogin) throw conflito('IDENTIFICADOR_EM_USO', LOGIN_IDENTIFIER_IN_USE_MESSAGE);
    const id = generateId();
    try {
      await manager.query(
        `INSERT INTO users (id, name, email, phone, status, email_verified, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'INVITED', false, $5, $5)`,
        [id, person.name, person.email, person.phone ?? null, now],
      );
    } catch (error) {
      if (isUniqueViolation(error, 'uq_users_email')) {
        throw conflito('CONCORRENCIA', 'Outra operação acabou de usar este e-mail. Confira e tente de novo.');
      }
      if (isUniqueViolation(error, 'uq_users_login_identifier')) {
        throw conflito('IDENTIFICADOR_EM_USO', LOGIN_IDENTIFIER_IN_USE_MESSAGE);
      }
      throw error;
    }
    return { id, name: person.name, email: person.email, existed: false, hasCredential: false };
  }

  private async issueInvite(
    manager: EntityManager,
    actor: Actor,
    target: TargetAccount,
    now: Date,
    data: {
      type: 'ESTABLISHMENT' | 'PLATFORM';
      requestKey: string;
      targetName: string;
      targetEmail: string;
      tenant: { id: string; name: string } | null;
      role?: string;
      platformRole?: string;
      platformPermissions?: string[];
      /** Convite de funcionário: o profissional que ele reserva. */
      professional?: { id: string; name: string };
    },
  ): Promise<IssuedInvite> {
    const tenantId = data.tenant?.id ?? null;
    const targetEmail = target.email;
    if (tenantId) {
      const vinculo = await manager.query<unknown[]>(
        'SELECT 1 FROM memberships WHERE user_id = $1 AND tenant_id = $2',
        [target.id, tenantId],
      );
      if (vinculo.length) throw conflito('JA_VINCULADO', 'Esta conta já tem vínculo com este estabelecimento.');
    }
    // Pendente vencido deixa de bloquear um convite novo.
    await manager.query(
      `UPDATE invites SET status = 'EXPIRED', updated_at = $1
        WHERE status = 'PENDING' AND expires_at <= $1 AND type = $2::invite_type
          AND target_email = $3 AND tenant_id IS NOT DISTINCT FROM $4`,
      [now, data.type, targetEmail, tenantId],
    );
    const [pendente] = await manager.query<{ id: string }[]>(
      `SELECT id FROM invites WHERE status = 'PENDING' AND type = $1::invite_type
          AND target_email = $2 AND tenant_id IS NOT DISTINCT FROM $3`,
      [data.type, targetEmail, tenantId],
    );
    if (pendente) {
      throw new ConflictException({
        code: 'CONVITE_PENDENTE',
        message: 'Já existe um convite pendente para este e-mail. Reenvie ou revogue o convite atual.',
        inviteId: pendente.id,
      });
    }
    const id = generateId();
    const { token, tokenHash } = generateAccountToken();
    const expiresAt = linkExpiresAt(now);
    try {
      await manager.query(
        `INSERT INTO invites (id, type, target_name, target_email, tenant_id, establishment_role, platform_role,
            platform_permissions, status, token_hash, created_by_user_id, created_at, expires_at, target_user_id,
            request_key, updated_at, professional_id)
         VALUES ($1, $2::invite_type, $3, $4, $5, $6::establishment_role, $7::platform_role, $8::platform_permission[],
            'PENDING', $9, $10, $11, $12, $13, $14, $11, $15)`,
        [
          id,
          data.type,
          data.targetName,
          targetEmail,
          tenantId,
          data.role ?? null,
          data.platformRole ?? null,
          data.type === 'PLATFORM' ? (data.platformPermissions ?? []) : null,
          tokenHash,
          actor.id,
          now,
          expiresAt,
          target.id,
          data.requestKey,
          data.professional?.id ?? null,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error, 'uq_invites_pending_establishment') || isUniqueViolation(error, 'uq_invites_pending_platform')) {
        throw conflito('CONVITE_PENDENTE', 'Já existe um convite pendente para este e-mail.');
      }
      throw error;
    }
    await recordAudit(
      manager,
      {
        action: 'USER_INVITED',
        actor,
        tenantId,
        targetUserId: target.id,
        summary: data.professional
          ? `Convite de acesso de funcionário (${data.professional.name}) em ${data.tenant?.name} para ${targetEmail}.`
          : data.tenant
            ? `Convite de ${data.role} em ${data.tenant.name} para ${targetEmail}.`
            : `Convite de administração da plataforma para ${targetEmail}.`,
        newData: {
          inviteId: id,
          type: data.type,
          role: data.role ?? null,
          platformRole: data.platformRole ?? null,
          platformPermissions: data.platformPermissions ?? null,
          accountExisted: target.existed,
          professionalId: data.professional?.id ?? null,
        },
      },
      now,
    );
    return {
      id,
      token,
      tokenHash,
      email: {
        targetName: target.existed ? target.name : data.targetName,
        targetEmail: targetEmail,
        tenantName: data.tenant?.name ?? null,
        accountExists: target.hasCredential,
        resent: false,
        validityMs: expiresAt.getTime() - now.getTime(),
      },
    };
  }

  private async lockInvite(manager: EntityManager, inviteId: string, conferir: (invite: InviteRow) => void) {
    const [invite] = await manager.query<InviteRow[]>(`${INVITE_ROW_SELECT} WHERE i.id = $1 FOR UPDATE OF i`, [inviteId]);
    if (!invite) throw new NotFoundException(INVITE_NOT_FOUND_MESSAGE);
    conferir(invite);
    return invite;
  }

  private requirePlatformScope(actor: Actor, invite: InviteRow): void {
    requireCapability(actor, invite.type === 'PLATFORM' ? 'managePlatformAccess' : 'manageEstablishments');
  }

  /** O dono só alcança convites de funcionário do próprio estabelecimento. */
  private requireStaffInviteOf(invite: InviteRow, tenantId: string): void {
    if (invite.tenant_id !== tenantId || !invite.professional_id) throw new NotFoundException(INVITE_NOT_FOUND_MESSAGE);
  }

  /** Trava o estabelecimento de um convite de funcionário ANTES do convite
   * (mesma ordem do aceite e da criação). Outros convites: nada a travar. */
  private async lockTenantOfStaffInvite(manager: EntityManager, inviteId: string): Promise<LockedTenant | null> {
    const [linha] = await manager.query<{ tenant_id: string | null; professional_id: string | null }[]>(
      'SELECT tenant_id, professional_id FROM invites WHERE id = $1',
      [inviteId],
    );
    if (!linha?.tenant_id || !linha.professional_id) return null;
    return lockTenantForSeats(manager, linha.tenant_id);
  }

  /** O profissional ainda não tem acesso (vínculo em qualquer situação). */
  private async assertProfessionalFree(manager: EntityManager, tenantId: string, professionalId: string): Promise<void> {
    const [vinculo] = await manager.query<unknown[]>(
      'SELECT 1 FROM memberships WHERE tenant_id = $1 AND professional_id = $2',
      [tenantId, professionalId],
    );
    if (vinculo) {
      throw conflito(
        'PROFISSIONAL_COM_ACESSO',
        'Este profissional já tem um acesso. Para trocar a pessoa, remova o acesso atual antes.',
      );
    }
  }

  /**
   * Um convite de funcionário ainda pode virar acesso (reenvio e aceite):
   * estabelecimento em operação, profissional ativo e sem acesso, e vaga no
   * plano sem contar o próprio convite (ele já ocupava a vaga, ou a liberou
   * ao vencer e volta a ocupá-la agora).
   */
  private async assertStaffInviteUsable(
    manager: EntityManager,
    invite: InviteRow,
    tenant: LockedTenant | null,
    now: Date,
  ): Promise<void> {
    if (!tenant || tenant.id !== invite.tenant_id || !isOperational(tenant.status)) {
      throw conflito('ESTABELECIMENTO_INDISPONIVEL', 'O estabelecimento não está em operação.');
    }
    const [profissional] = await manager.query<{ active: boolean }[]>(
      'SELECT active FROM professionals WHERE tenant_id = $1 AND id = $2 FOR SHARE',
      [tenant.id, invite.professional_id],
    );
    if (!profissional?.active) {
      throw conflito('PROFISSIONAL_INATIVO', 'O profissional deste convite está desativado no estabelecimento.');
    }
    await this.assertProfessionalFree(manager, tenant.id, invite.professional_id!);
    const vagas = await staffSeatUsage(manager, tenant.id, tenant.plan.maxProfessionals, now, invite.id);
    if (vagas.used >= vagas.limit) throw conflito('LIMITE_DO_PLANO', seatLimitMessage(vagas));
  }

  private async findByToken(manager: EntityManager, token: string, lock: boolean): Promise<InviteRow | null> {
    if (!isValidAccountTokenFormat(token)) return null;
    const [invite] = await manager.query<InviteRow[]>(
      `${INVITE_ROW_SELECT} WHERE i.token_hash = $1${lock ? ' FOR UPDATE OF i' : ''}`,
      [hashAccountToken(token)],
    );
    return invite ?? null;
  }

  private publicStatus(invite: InviteRow | null, now: Date): PublicInviteStatus {
    if (!invite) return 'INVALID';
    if (invite.status === 'REVOKED') return 'REVOKED';
    if (invite.status === 'ACCEPTED') return 'ACCEPTED';
    if (invite.status === 'EXPIRED' || new Date(invite.expires_at) <= now) return 'EXPIRED';
    if (invite.target_status === 'SUSPENDED' || !invite.target_user_id) return 'UNAVAILABLE';
    return 'VALID';
  }
}

type Autorizador = (manager: EntityManager) => Promise<(invite: InviteRow) => void>;

const INVITE_NOT_FOUND_MESSAGE = 'Convite não encontrado.';

export type PublicInviteStatus = 'VALID' | 'INVALID' | 'EXPIRED' | 'REVOKED' | 'ACCEPTED' | 'UNAVAILABLE';

const MENSAGEM_ESTADO: Record<Exclude<PublicInviteStatus, 'VALID' | 'INVALID'>, string> = {
  EXPIRED: 'Este convite expirou. Peça um novo link à administração.',
  REVOKED: 'Este convite foi cancelado pela administração.',
  ACCEPTED: 'Este convite já foi usado.',
  UNAVAILABLE: 'Este convite não pode ser aceito agora. Fale com a administração.',
};

interface InviteRow {
  id: string;
  type: 'ESTABLISHMENT' | 'PLATFORM';
  status: string;
  target_name: string;
  target_email: string;
  tenant_id: string | null;
  tenant_name: string | null;
  establishment_role: string | null;
  platform_role: string | null;
  platform_permissions: string[] | null;
  expires_at: Date;
  send_count: number;
  target_user_id: string | null;
  target_status: string | null;
  target_account_name: string | null;
  target_has_credential: boolean;
  professional_id: string | null;
}

const INVITE_ROW_SELECT = `SELECT i.id, i.type, i.status, i.target_name, i.target_email, i.tenant_id,
    (SELECT COALESCE(u.name, t.slug::text) FROM tenants t
       LEFT JOIN units u ON u.tenant_id = t.id AND u.is_primary = true
      WHERE t.id = i.tenant_id ORDER BY u.created_at LIMIT 1) AS tenant_name,
    i.establishment_role, i.platform_role, i.platform_permissions::text[] AS platform_permissions, i.expires_at, i.send_count,
    i.professional_id, i.target_user_id, target.status AS target_status, target.name AS target_account_name,
    EXISTS (SELECT 1 FROM credentials c WHERE c.user_id = i.target_user_id) AS target_has_credential
  FROM invites i LEFT JOIN users target ON target.id = i.target_user_id`;
