// Edição do catálogo modular pela API (HTTP, sem banco): rotas novas só de
// Planos e adicionais, corpo estrito e identidade do guard. A criação do
// estabelecimento e a aba "Plano e adicionais" da ficha nunca aceitam nome,
// descrição ou preço do catálogo, nem por chamada direta. Contra PostgreSQL:
// test/catalogo-modular-postgres.db-e2e-spec.ts.
import { Test } from '@nestjs/testing';
import { ForbiddenException, UnauthorizedException, type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { SessionGuard } from '../src/auth/session.guard.js';
import { PlatformSecondFactorGuard } from '../src/second-factor/second-factor.guard.js';
import { ModularCatalogService } from '../src/platform/modular-catalog.service.js';
import { SubscriptionService } from '../src/platform/subscription.service.js';
import { InvitesService } from '../src/accounts/invites.service.js';

const CHAVE = 'chave-de-formulario-0001';
const VERSAO = '2026-11-18T12:00:00.000Z';
const corpoValido = {
  requestKey: CHAVE,
  expected: { name: 'Comissões', description: 'Regras de comissão.', priceCents: 1490 },
  name: 'Comissões por serviço',
  description: 'Regras de comissão por profissional e serviço.',
  priceCents: 1590,
};

describe('edição do catálogo modular — HTTP', () => {
  let app: INestApplication;
  const guard = { canActivate: vi.fn() };
  const catalogo = { editEssential: vi.fn(), editAddon: vi.fn() };
  const assinaturas = { change: vi.fn(), view: vi.fn(), catalog: vi.fn() };
  const convites = { createEstablishment: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    guard.canActivate.mockImplementation((context) => {
      context.switchToHttp().getRequest().auth = { userId: 'proven_user', sessionId: 'session' };
      return true;
    });
    catalogo.editEssential.mockResolvedValue({ changed: true });
    catalogo.editAddon.mockResolvedValue({ changed: true });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DataSource)
      .useValue({ isInitialized: false })
      .overrideProvider(ModularCatalogService)
      .useValue(catalogo)
      .overrideProvider(SubscriptionService)
      .useValue(assinaturas)
      .overrideProvider(InvitesService)
      .useValue(convites)
      .overrideGuard(SessionGuard)
      .useValue(guard)
      // O guard do segundo fator lê o banco; aqui só o controller é testado.
      .overrideGuard(PlatformSecondFactorGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });

  it('essencial e adicional chegam ao serviço com a identidade do guard, sem cache', async () => {
    await request(app.getHttpServer())
      .put('/platform/catalog/essential')
      .send(corpoValido)
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(catalogo.editEssential).toHaveBeenCalledWith('proven_user', 'session', corpoValido);
    await request(app.getHttpServer()).put('/platform/catalog/addons/COMISSOES').send(corpoValido).expect(200);
    expect(catalogo.editAddon).toHaveBeenCalledWith('proven_user', 'session', 'COMISSOES', corpoValido);
  });

  it('preço pendente pode continuar pendente; motivo é opcional', async () => {
    const corpo = { ...corpoValido, expected: { ...corpoValido.expected, priceCents: null }, priceCents: null, reason: 'Nome novo' };
    await request(app.getHttpServer()).put('/platform/catalog/addons/MARKETING').send(corpo).expect(200);
    expect(catalogo.editAddon).toHaveBeenCalledWith('proven_user', 'session', 'MARKETING', corpo);
  });

  it('corpo forjado, incompleto ou fora dos limites nunca chega ao serviço', async () => {
    const semExpected: Record<string, unknown> = { ...corpoValido };
    delete semExpected.expected;
    for (const corpo of [
      semExpected,
      { ...corpoValido, name: 'A' },
      { ...corpoValido, name: ' '.repeat(5) },
      { ...corpoValido, name: 'x'.repeat(81) },
      { ...corpoValido, name: 'Linha\nquebrada' },
      { ...corpoValido, description: 'ab' },
      { ...corpoValido, description: 'x'.repeat(301) },
      { ...corpoValido, priceCents: 0 },
      { ...corpoValido, priceCents: 12.5 },
      { ...corpoValido, priceCents: '1590' },
      { ...corpoValido, requestKey: 'curta' },
      // Disponibilidade, código, recurso e vínculos não mudam por esta rota.
      { ...corpoValido, availability: 'AVAILABLE' },
      { ...corpoValido, featureKey: 'COMISSOES' },
      { ...corpoValido, code: 'OUTRO' },
      { ...corpoValido, tenantId: 'tenant_a' },
      { ...corpoValido, expected: { ...corpoValido.expected, availability: 'PLANNED' } },
    ]) {
      await request(app.getHttpServer()).put('/platform/catalog/essential').send(corpo).expect(400);
      await request(app.getHttpServer()).put('/platform/catalog/addons/COMISSOES').send(corpo).expect(400);
    }
    for (const code of ['comissoes', 'X', 'COMISSOES;DROP', '%20']) {
      await request(app.getHttpServer()).put(`/platform/catalog/addons/${code}`).send(corpoValido).expect(400);
    }
    expect(catalogo.editEssential).not.toHaveBeenCalled();
    expect(catalogo.editAddon).not.toHaveBeenCalled();
  });

  it('sem sessão: 401; sem a capacidade de proprietário: o 403 do serviço passa adiante', async () => {
    guard.canActivate.mockImplementationOnce(() => {
      throw new UnauthorizedException();
    });
    await request(app.getHttpServer()).put('/platform/catalog/essential').send(corpoValido).expect(401);
    expect(catalogo.editEssential).not.toHaveBeenCalled();
    catalogo.editAddon.mockRejectedValue(new ForbiddenException());
    await request(app.getHttpServer()).put('/platform/catalog/addons/COMISSOES').send(corpoValido).expect(403);
  });

  it('a aba "Plano e adicionais" da ficha não aceita nome, descrição nem preço do catálogo', async () => {
    const base = { expectedUpdatedAt: VERSAO, requestKey: CHAVE, addons: ['COMISSOES'], teamUserLimit: 3 };
    for (const extra of [
      { name: 'Outro nome' },
      { description: 'Outra descrição' },
      { priceCents: 100 },
      { basePriceCents: 100 },
      { essential: { name: 'Outro' } },
      { catalog: { COMISSOES: { name: 'Outro' } } },
    ]) {
      await request(app.getHttpServer())
        .put('/platform/establishments/tenant_a/subscription')
        .send({ ...base, ...extra })
        .expect(400);
    }
    for (const addons of [[{ code: 'COMISSOES', name: 'Outro' }], [{ code: 'COMISSOES', priceCents: 100 }]]) {
      await request(app.getHttpServer())
        .put('/platform/establishments/tenant_a/subscription')
        .send({ ...base, addons })
        .expect(400);
    }
    expect(assinaturas.change).not.toHaveBeenCalled();
  });

  it('a criação do estabelecimento não aceita nome, descrição nem preço do catálogo', async () => {
    const base = {
      requestKey: CHAVE,
      businessName: 'Estabelecimento de teste',
      category: 'OTHER',
      addons: ['COMISSOES'],
      teamUserLimit: 3,
      owner: { name: 'Pessoa Dona', email: 'dona@example.test' },
    };
    for (const extra of [
      { addonNames: { COMISSOES: 'Outro' } },
      { essential: { name: 'Outro' } },
      { basePriceCents: 100 },
      { catalog: [] },
      { addons: [{ code: 'COMISSOES', name: 'Outro', priceCents: 100 }] },
    ]) {
      await request(app.getHttpServer())
        .post('/platform/establishments')
        .send({ ...base, ...extra })
        .expect(400);
    }
    expect(convites.createEstablishment).not.toHaveBeenCalled();
  });
});
