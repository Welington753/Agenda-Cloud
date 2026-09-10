// Núcleo transacional do cadastro (Lote 6B.3) — tudo dentro de uma única
// `DataSource.transaction`: se qualquer etapa falhar, TypeORM faz ROLLBACK
// total (nenhuma linha parcial), e nenhum cookie é emitido pelo controller
// porque a promise rejeita antes de chegar lá. Plano nunca é criado aqui —
// só consultado (`code = 'equipe'`); ausência do plano é erro controlado
// (`PlanUnavailableError`), nunca criação silenciosa de catálogo.
import { Injectable } from '@nestjs/common';
// Import de valor (não `import type`) — o Nest usa `design:paramtypes` do
// construtor para resolver o token de injeção; um `import type` apagaria essa
// referência em runtime e a DI falharia com "dependency ... is undefined".
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity.js';
import { Credential } from '../entities/credential.entity.js';
import { AuditAction } from '../entities/enums/audit-action.enum.js';
import { BusinessCategory } from '../entities/enums/business-category.enum.js';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { TenantStatus } from '../entities/enums/tenant-status.enum.js';
import { Membership } from '../entities/membership.entity.js';
import { Plan } from '../entities/plan.entity.js';
import { Session } from '../entities/session.entity.js';
import { Tenant } from '../entities/tenant.entity.js';
import { Unit } from '../entities/unit.entity.js';
import { User } from '../entities/user.entity.js';
import { DEFAULT_SESSION_MAX_AGE_MS } from '../config/session-cookie.config.js';
import { EmailAlreadyInUseError, PlanUnavailableError } from './auth.errors.js';
import { CREDENTIAL_ALGORITHM, hashPassword } from './password-hasher.js';
import type { RegisterDto } from './register.dto.js';
import { generateSessionToken } from './session-token.js';
import { resolveSlug, slugify } from './slug.js';
import { TRIAL_DURATION_DAYS, computeTrialWindow } from './trial-policy.js';
import { isUniqueViolation } from './unique-violation.js';

// Não coletados no DTO mínimo do cadastro — o estabelecimento ajusta depois
// (fora do escopo deste lote). `''` é aceito pela coluna `address` (NOT NULL
// sem regra de conteúdo no banco).
const DEFAULT_TENANT_CATEGORY = BusinessCategory.OTHER;
const DEFAULT_TENANT_TIMEZONE = 'America/Sao_Paulo';
const DEFAULT_UNIT_ADDRESS = '';

const REGISTER_PLAN_CODE = 'equipe';

// Retry de colisão real de slug (`uq_tenants_slug` no `save`, não na checagem
// prévia de `resolveSlug`) — janela rara: outro processo commitou o mesmo
// slug entre a checagem desta tentativa e o INSERT. Cada tentativa é uma
// `DataSource.transaction` inteira nova (nunca reaproveita o EntityManager de
// uma transação abortada pelo Postgres após 23505 — ver auditoria do Lote
// 6B.3). Baixo porque é diferente do espaço de busca de sufixo do
// `resolveSlug` (`MAX_SLUG_COLLISION_ATTEMPTS`, ver slug.ts): aqui é só a
// corrida check-then-insert, não "nome comum com muitos concorrentes".
export const MAX_SLUG_SAVE_RETRIES = 3;

export interface RegisterContext {
  now: Date;
  userAgent?: string;
  ipAddress?: string;
}

export interface RegisterResult {
  /** Só para o controller emitir o cookie depois do COMMIT — nunca serializar
   * isto na resposta HTTP. */
  token: string;
  user: { id: string; name: string; email: string };
  tenant: { id: string; slug: string; status: TenantStatus };
  unit: { id: string; name: string; isPrimary: boolean };
  membership: { role: EstablishmentRole };
  plan: { code: string; name: string; priceCents: number | null };
  trial: { trialStartAt: Date; trialEndAt: Date; durationDays: number };
}

@Injectable()
export class AuthService {
  constructor(private readonly dataSource: DataSource) {}

  async register(dto: RegisterDto, context: RegisterContext): Promise<RegisterResult> {
    for (let attempt = 1; attempt <= MAX_SLUG_SAVE_RETRIES; attempt++) {
      try {
        // Tentativa inteira, atômica, numa `DataSource.transaction` própria —
        // nunca reaproveitada entre tentativas. Se o Postgres devolver 23505
        // na constraint de slug, ESTA transação já está abortada (igual a
        // qualquer transação real após um erro): a única saída seva é deixar
        // o TypeORM fazer ROLLBACK dela (ao propagar o erro) e abrir outra do
        // zero, nunca continuar chamando `manager` na mesma.
        return await this.dataSource.transaction((manager) =>
          this.attemptRegister(manager, dto, context),
        );
      } catch (error) {
        if (isUniqueViolation(error, 'uq_tenants_slug') && attempt < MAX_SLUG_SAVE_RETRIES) {
          continue;
        }
        throw error;
      }
    }
    // Inatingível: o loop acima sempre retorna ou lança na última iteração.
    throw new Error('Não foi possível criar o tenant após várias tentativas de slug.');
  }

  /** Uma tentativa completa e atômica de cadastro, dentro de UMA transação —
   * chamada de novo do zero (com um `manager` novo) a cada retry de colisão
   * real de slug (ver `register`). Nunca captura a violação de
   * `uq_tenants_slug` aqui: deixa propagar para abortar esta transação e
   * deixar `register` decidir o retry. */
  private async attemptRegister(
    manager: EntityManager,
    dto: RegisterDto,
    context: RegisterContext,
  ): Promise<RegisterResult> {
    const plan = await manager.findOne(Plan, { where: { code: REGISTER_PLAN_CODE } });
    if (!plan) {
      throw new PlanUnavailableError();
    }

    const existingUser = await manager.findOne(User, { where: { email: dto.email } });
    if (existingUser) {
      throw new EmailAlreadyInUseError();
    }

    const passwordHash = await hashPassword(dto.password);

    let user = manager.create(User, {
      name: dto.ownerName,
      email: dto.email,
      phone: dto.phone,
    });
    try {
      user = await manager.save(user);
    } catch (error) {
      if (isUniqueViolation(error, 'uq_users_email')) {
        throw new EmailAlreadyInUseError();
      }
      throw error;
    }

    const credential = manager.create(Credential, {
      userId: user.id,
      passwordHash,
      algorithm: CREDENTIAL_ALGORITHM,
    });
    await manager.save(credential);

    const baseSlug = slugify(dto.businessName);
    const { trialStartAt, trialEndAt } = computeTrialWindow(context.now);

    const candidateSlug = await resolveSlug(
      baseSlug,
      async (candidate) => !!(await manager.findOne(Tenant, { where: { slug: candidate } })),
    );

    const tenantAttempt = manager.create(Tenant, {
      slug: candidateSlug,
      category: DEFAULT_TENANT_CATEGORY,
      timezone: DEFAULT_TENANT_TIMEZONE,
      planId: plan.id,
      status: TenantStatus.TRIAL,
      createdAt: trialStartAt,
    });
    // Se isto lançar 23505 em `uq_tenants_slug` (corrida real: alguém
    // commitou o mesmo slug entre o `resolveSlug` acima e este `save`), o
    // erro propaga sem tratamento — aborta esta transação inteira, e
    // `register` decide o retry numa transação nova.
    const tenant = await manager.save(tenantAttempt);

    const unit = manager.create(Unit, {
      tenantId: tenant.id,
      name: dto.businessName,
      address: DEFAULT_UNIT_ADDRESS,
      timezone: DEFAULT_TENANT_TIMEZONE,
      isPrimary: true,
    });
    await manager.save(unit);

    const membership = manager.create(Membership, {
      userId: user.id,
      tenantId: tenant.id,
      role: EstablishmentRole.DONO,
    });
    await manager.save(membership);

    const { token, tokenHash } = generateSessionToken();
    const session = manager.create(Session, {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(context.now.getTime() + DEFAULT_SESSION_MAX_AGE_MS),
    });
    await manager.save(session);

    const auditLog = manager.create(AuditLog, {
      action: AuditAction.TENANT_CREATED,
      actorUserId: user.id,
      actorName: user.name,
      tenantId: tenant.id,
      summary: 'Cadastro de novo estabelecimento (auto-registro).',
      newData: {
        planCode: plan.code,
        role: EstablishmentRole.DONO,
        trialStartAt: trialStartAt.toISOString(),
        trialEndAt: trialEndAt.toISOString(),
      },
    });
    await manager.save(auditLog);

    return {
      token,
      user: { id: user.id, name: user.name, email: user.email },
      tenant: { id: tenant.id, slug: tenant.slug, status: tenant.status },
      unit: { id: unit.id, name: unit.name, isPrimary: unit.isPrimary },
      membership: { role: membership.role },
      plan: { code: plan.code, name: plan.name, priceCents: plan.priceCents },
      trial: { trialStartAt, trialEndAt, durationDays: TRIAL_DURATION_DAYS },
    };
  }
}
