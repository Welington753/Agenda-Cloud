import { ConflictException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { TenantStatus } from '../entities/enums/tenant-status.enum.js';
import { SESSION_COOKIE_NAME } from '../config/session-cookie.config.js';
import { AuthController } from './auth.controller.js';
import { EmailAlreadyInUseError, InvalidCredentialsError, PlanUnavailableError } from './auth.errors.js';
import type { AuthService, LoginResult, RegisterResult } from './auth.service.js';
import type { LoginDto } from './login.dto.js';
import type { RegisterDto } from './register.dto.js';
import {
  AUTH_CONTEXT_REQUEST_KEY,
  type IdentityContext,
  type SessionContextResult,
  type TenantContext,
} from './session-context.js';

const DTO: RegisterDto = {
  ownerName: 'Maria Souza',
  businessName: 'Studio Bela',
  email: 'maria@example.com',
  phone: '+5511987654321',
  password: 'senha-valida-123',
};

const SUCCESS_RESULT: RegisterResult = {
  token: 'token-puro-nunca-deve-vazar-na-resposta',
  user: { id: 'user_1', name: 'Maria Souza', email: 'maria@example.com' },
  tenant: { id: 'tenant_1', slug: 'studio-bela', status: TenantStatus.TRIAL },
  unit: { id: 'unit_1', name: 'Studio Bela', isPrimary: true },
  membership: { role: EstablishmentRole.DONO },
  plan: { code: 'equipe', name: 'Gestão', priceCents: null },
  trial: {
    trialStartAt: new Date('2026-09-10T12:00:00.000Z'),
    trialEndAt: new Date('2026-09-24T12:00:00.000Z'),
    durationDays: 14,
  },
};

function buildReqStub() {
  return { get: () => 'vitest-agent', ip: '127.0.0.1' } as unknown as Parameters<
    AuthController['register']
  >[1];
}

function buildResStub() {
  return { cookie: vi.fn() } as unknown as Parameters<AuthController['register']>[2];
}

function buildConfigServiceStub(nodeEnv: string): ConfigService {
  return { getOrThrow: () => nodeEnv } as unknown as ConfigService;
}

describe('AuthController.register', () => {
  let authService: { register: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    authService = { register: vi.fn() };
  });

  it('retorna 201 com resposta sanitizada em caso de sucesso', async () => {
    authService.register.mockResolvedValue(SUCCESS_RESULT);
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );

    const response = await controller.register(DTO, buildReqStub(), buildResStub());

    expect(response).toEqual({
      user: SUCCESS_RESULT.user,
      tenant: SUCCESS_RESULT.tenant,
      unit: SUCCESS_RESULT.unit,
      membership: SUCCESS_RESULT.membership,
      plan: SUCCESS_RESULT.plan,
      trial: SUCCESS_RESULT.trial,
    });
  });

  it('nunca retorna token, tokenHash ou passwordHash na resposta', async () => {
    authService.register.mockResolvedValue(SUCCESS_RESULT);
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );

    const response = await controller.register(DTO, buildReqStub(), buildResStub());
    const serialized = JSON.stringify(response);

    expect(serialized).not.toContain('token-puro-nunca-deve-vazar-na-resposta');
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('tokenHash');
  });

  it('emite o cookie de sessão HttpOnly com o token puro depois do sucesso', async () => {
    authService.register.mockResolvedValue(SUCCESS_RESULT);
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );
    const res = buildResStub();

    await controller.register(DTO, buildReqStub(), res);

    expect(res.cookie).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      SUCCESS_RESULT.token,
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    );
  });

  it('cookie tem secure=false fora de produção', async () => {
    authService.register.mockResolvedValue(SUCCESS_RESULT);
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );
    const res = buildResStub();

    await controller.register(DTO, buildReqStub(), res);

    expect(res.cookie).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ secure: false }),
    );
  });

  it('cookie tem secure=true em produção', async () => {
    authService.register.mockResolvedValue(SUCCESS_RESULT);
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('production'),
    );
    const res = buildResStub();

    await controller.register(DTO, buildReqStub(), res);

    expect(res.cookie).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ secure: true }),
    );
  });

  it('mapeia EmailAlreadyInUseError para 409, sem emitir cookie', async () => {
    authService.register.mockRejectedValue(new EmailAlreadyInUseError());
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );
    const res = buildResStub();

    await expect(controller.register(DTO, buildReqStub(), res)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('mensagem de 409 nunca revela detalhe de banco/constraint', async () => {
    authService.register.mockRejectedValue(new EmailAlreadyInUseError());
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );

    try {
      await controller.register(DTO, buildReqStub(), buildResStub());
      expect.unreachable();
    } catch (error) {
      const message = (error as ConflictException).message;
      expect(message.toLowerCase()).not.toContain('constraint');
      expect(message.toLowerCase()).not.toContain('sql');
      expect(message.toLowerCase()).not.toContain('uq_users_email');
    }
  });

  it('mapeia PlanUnavailableError para 503, sem emitir cookie', async () => {
    authService.register.mockRejectedValue(new PlanUnavailableError());
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );
    const res = buildResStub();

    await expect(controller.register(DTO, buildReqStub(), res)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('erro inesperado propaga sem cookie e sem resposta customizada (deixa o filtro padrão do Nest agir)', async () => {
    authService.register.mockRejectedValue(new Error('falha interna qualquer'));
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );
    const res = buildResStub();

    await expect(controller.register(DTO, buildReqStub(), res)).rejects.toThrow(
      'falha interna qualquer',
    );
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('passa now/userAgent/ipAddress ao serviço a partir do request', async () => {
    authService.register.mockResolvedValue(SUCCESS_RESULT);
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );

    await controller.register(DTO, buildReqStub(), buildResStub());

    expect(authService.register).toHaveBeenCalledWith(
      DTO,
      expect.objectContaining({ userAgent: 'vitest-agent', ipAddress: '127.0.0.1' }),
    );
    const [, context] = authService.register.mock.calls[0];
    expect(context.now).toBeInstanceOf(Date);
  });
});

const LOGIN_DTO: LoginDto = {
  email: 'maria@example.com',
  password: 'senha-valida-123',
};

const TENANT_CONTEXT_STUB: TenantContext = {
  membershipId: 'membership_1',
  tenantId: 'tenant_1',
  tenantName: 'Studio Bela',
  tenantSlug: 'studio-bela',
  role: EstablishmentRole.DONO,
  unit: { id: 'unit_1', name: 'Studio Bela', isPrimary: true },
  planCode: 'equipe',
  planName: 'Gestão',
  trial: {
    trialStartAt: new Date('2026-09-10T12:00:00.000Z'),
    trialEndAt: new Date('2026-09-24T12:00:00.000Z'),
    durationDays: 14,
  },
  tenantStatus: TenantStatus.TRIAL,
};

const LOGIN_SUCCESS_RESULT: LoginResult = {
  token: 'token-puro-login-nunca-deve-vazar-na-resposta',
  user: { id: 'user_1', name: 'Maria Souza', email: 'maria@example.com' },
  contexts: [TENANT_CONTEXT_STUB],
  activeContext: TENANT_CONTEXT_STUB,
  requiresTenantSelection: false,
  hasEstablishmentAccess: true,
};

function buildLoginReqStub() {
  return { get: () => 'vitest-agent', ip: '127.0.0.1' } as unknown as Parameters<
    AuthController['login']
  >[1];
}

function buildLoginResStub() {
  return { cookie: vi.fn() } as unknown as Parameters<AuthController['login']>[2];
}

describe('AuthController.login', () => {
  let authService: { login: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    authService = { login: vi.fn() };
  });

  it('retorna 200 (implícito) com resposta sanitizada em caso de sucesso', async () => {
    authService.login.mockResolvedValue(LOGIN_SUCCESS_RESULT);
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );

    const response = await controller.login(LOGIN_DTO, buildLoginReqStub(), buildLoginResStub());

    expect(response).toEqual({
      user: LOGIN_SUCCESS_RESULT.user,
      contexts: LOGIN_SUCCESS_RESULT.contexts,
      activeContext: LOGIN_SUCCESS_RESULT.activeContext,
      requiresTenantSelection: LOGIN_SUCCESS_RESULT.requiresTenantSelection,
      hasEstablishmentAccess: LOGIN_SUCCESS_RESULT.hasEstablishmentAccess,
    });
  });

  it('nunca retorna token, tokenHash ou passwordHash na resposta', async () => {
    authService.login.mockResolvedValue(LOGIN_SUCCESS_RESULT);
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );

    const response = await controller.login(LOGIN_DTO, buildLoginReqStub(), buildLoginResStub());
    const serialized = JSON.stringify(response);

    expect(serialized).not.toContain(LOGIN_SUCCESS_RESULT.token);
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('tokenHash');
  });

  it('emite o cookie de sessão HttpOnly com o token puro depois do sucesso', async () => {
    authService.login.mockResolvedValue(LOGIN_SUCCESS_RESULT);
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );
    const res = buildLoginResStub();

    await controller.login(LOGIN_DTO, buildLoginReqStub(), res);

    expect(res.cookie).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      LOGIN_SUCCESS_RESULT.token,
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    );
  });

  it('mapeia InvalidCredentialsError para 401, sem emitir cookie', async () => {
    authService.login.mockRejectedValue(new InvalidCredentialsError());
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );
    const res = buildLoginResStub();

    await expect(controller.login(LOGIN_DTO, buildLoginReqStub(), res)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('mensagem de 401 nunca revela qual etapa falhou', async () => {
    authService.login.mockRejectedValue(new InvalidCredentialsError());
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );

    try {
      await controller.login(LOGIN_DTO, buildLoginReqStub(), buildLoginResStub());
      expect.unreachable();
    } catch (error) {
      const message = (error as UnauthorizedException).message.toLowerCase();
      expect(message).not.toContain('e-mail');
      expect(message).not.toContain('senha');
      expect(message).not.toContain('inativ');
    }
  });

  it('erro inesperado propaga sem cookie, deixando o filtro padrão do Nest agir', async () => {
    authService.login.mockRejectedValue(new Error('falha interna qualquer'));
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );
    const res = buildLoginResStub();

    await expect(controller.login(LOGIN_DTO, buildLoginReqStub(), res)).rejects.toThrow(
      'falha interna qualquer',
    );
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('múltiplos memberships: repassa contexts/requiresTenantSelection fielmente, sem escolher um', async () => {
    const doisContextos: LoginResult = {
      ...LOGIN_SUCCESS_RESULT,
      contexts: [TENANT_CONTEXT_STUB, { ...TENANT_CONTEXT_STUB, tenantId: 'tenant_2', membershipId: 'membership_2' }],
      activeContext: null,
      requiresTenantSelection: true,
    };
    authService.login.mockResolvedValue(doisContextos);
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );

    const response = await controller.login(LOGIN_DTO, buildLoginReqStub(), buildLoginResStub());

    expect(response.activeContext).toBeNull();
    expect(response.requiresTenantSelection).toBe(true);
    expect(response.contexts).toHaveLength(2);
  });

  it('login continua emitindo cookie mesmo sem nenhum estabelecimento (hasEstablishmentAccess=false)', async () => {
    const semEstabelecimento: LoginResult = {
      ...LOGIN_SUCCESS_RESULT,
      contexts: [],
      activeContext: null,
      requiresTenantSelection: false,
      hasEstablishmentAccess: false,
    };
    authService.login.mockResolvedValue(semEstabelecimento);
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );
    const res = buildLoginResStub();

    const response = await controller.login(LOGIN_DTO, buildLoginReqStub(), res);

    expect(response.hasEstablishmentAccess).toBe(false);
    expect(res.cookie).toHaveBeenCalled();
  });

  it('passa now/userAgent/ipAddress ao serviço a partir do request', async () => {
    authService.login.mockResolvedValue(LOGIN_SUCCESS_RESULT);
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );

    await controller.login(LOGIN_DTO, buildLoginReqStub(), buildLoginResStub());

    expect(authService.login).toHaveBeenCalledWith(
      LOGIN_DTO,
      expect.objectContaining({ userAgent: 'vitest-agent', ipAddress: '127.0.0.1' }),
    );
  });
});

const IDENTITY_STUB: IdentityContext = { userId: 'user_1', sessionId: 'session_1' };

const SESSION_CONTEXT_RESULT_STUB: SessionContextResult = {
  user: { id: 'user_1', name: 'Maria Souza', email: 'maria@example.com' },
  contexts: [TENANT_CONTEXT_STUB],
  activeContext: TENANT_CONTEXT_STUB,
  requiresTenantSelection: false,
  hasEstablishmentAccess: true,
};

function buildMeReqStub(identity: IdentityContext | undefined = IDENTITY_STUB) {
  return { [AUTH_CONTEXT_REQUEST_KEY]: identity } as unknown as Parameters<AuthController['me']>[0];
}

describe('AuthController.me', () => {
  let authService: { getSessionContext: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    authService = { getSessionContext: vi.fn() };
  });

  it('pede o contexto ao serviço usando o userId anexado pelo guard, nunca outro dado da request', async () => {
    authService.getSessionContext.mockResolvedValue(SESSION_CONTEXT_RESULT_STUB);
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );

    await controller.me(buildMeReqStub());

    expect(authService.getSessionContext).toHaveBeenCalledWith(IDENTITY_STUB.userId);
    expect(authService.getSessionContext).toHaveBeenCalledTimes(1);
  });

  it('exatamente 1 contexto: devolve activeContext preenchido e requiresTenantSelection=false', async () => {
    authService.getSessionContext.mockResolvedValue(SESSION_CONTEXT_RESULT_STUB);
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );

    const response = await controller.me(buildMeReqStub());

    expect(response).toEqual({
      user: SESSION_CONTEXT_RESULT_STUB.user,
      contexts: SESSION_CONTEXT_RESULT_STUB.contexts,
      activeContext: SESSION_CONTEXT_RESULT_STUB.activeContext,
      requiresTenantSelection: false,
      hasEstablishmentAccess: true,
    });
  });

  it('zero contextos: 200 com hasEstablishmentAccess=false, nunca erro', async () => {
    authService.getSessionContext.mockResolvedValue({
      user: SESSION_CONTEXT_RESULT_STUB.user,
      contexts: [],
      activeContext: null,
      requiresTenantSelection: false,
      hasEstablishmentAccess: false,
    });
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );

    const response = await controller.me(buildMeReqStub());

    expect(response.hasEstablishmentAccess).toBe(false);
    expect(response.activeContext).toBeNull();
  });

  it('múltiplos contextos: activeContext=null e requiresTenantSelection=true, nunca escolhe o primeiro', async () => {
    const segundoContexto: TenantContext = {
      ...TENANT_CONTEXT_STUB,
      membershipId: 'membership_2',
      tenantId: 'tenant_2',
    };
    authService.getSessionContext.mockResolvedValue({
      user: SESSION_CONTEXT_RESULT_STUB.user,
      contexts: [TENANT_CONTEXT_STUB, segundoContexto],
      activeContext: null,
      requiresTenantSelection: true,
      hasEstablishmentAccess: true,
    });
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );

    const response = await controller.me(buildMeReqStub());

    expect(response.activeContext).toBeNull();
    expect(response.requiresTenantSelection).toBe(true);
    expect(response.contexts).toEqual([TENANT_CONTEXT_STUB, segundoContexto]);
  });

  it('nunca retorna tokenHash, passwordHash ou qualquer dado interno', async () => {
    authService.getSessionContext.mockResolvedValue(SESSION_CONTEXT_RESULT_STUB);
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );

    const response = await controller.me(buildMeReqStub());
    const serialized = JSON.stringify(response);

    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('tokenHash');
    expect(serialized).not.toContain('credential');
  });
});

function buildLogoutReqStub(cookieValue: string | undefined) {
  return { cookies: cookieValue ? { [SESSION_COOKIE_NAME]: cookieValue } : {} } as unknown as Parameters<
    AuthController['logout']
  >[0];
}

function buildLogoutResStub() {
  return { clearCookie: vi.fn() } as unknown as Parameters<AuthController['logout']>[1];
}

describe('AuthController.logout', () => {
  let authService: { logout: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    authService = { logout: vi.fn().mockResolvedValue(undefined) };
  });

  it('com cookie presente: chama authService.logout com o token e limpa o cookie', async () => {
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );
    const res = buildLogoutResStub();

    await controller.logout(buildLogoutReqStub('token-de-sessao'), res);

    expect(authService.logout).toHaveBeenCalledWith('token-de-sessao');
    expect(res.clearCookie).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    );
  });

  it('sem cookie: ainda chama authService.logout(undefined) e limpa o cookie, sem lançar', async () => {
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );
    const res = buildLogoutResStub();

    await expect(controller.logout(buildLogoutReqStub(undefined), res)).resolves.toBeUndefined();

    expect(authService.logout).toHaveBeenCalledWith(undefined);
    expect(res.clearCookie).toHaveBeenCalled();
  });

  it('opções do clearCookie nunca incluem maxAge', async () => {
    const controller = new AuthController(
      authService as unknown as AuthService,
      buildConfigServiceStub('development'),
    );
    const res = buildLogoutResStub();

    await controller.logout(buildLogoutReqStub('token-de-sessao'), res);

    const [, options] = (res.clearCookie as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(options.maxAge).toBeUndefined();
  });
});
