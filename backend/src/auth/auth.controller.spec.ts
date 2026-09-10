import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EstablishmentRole } from '../entities/enums/establishment-role.enum.js';
import { TenantStatus } from '../entities/enums/tenant-status.enum.js';
import { SESSION_COOKIE_NAME } from '../config/session-cookie.config.js';
import { AuthController } from './auth.controller.js';
import { EmailAlreadyInUseError, PlanUnavailableError } from './auth.errors.js';
import type { AuthService, RegisterResult } from './auth.service.js';
import type { RegisterDto } from './register.dto.js';

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
