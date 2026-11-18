// Edição do catálogo modular (Planos e adicionais) contra PostgreSQL
// DESCARTÁVEL (migrations até CatalogItemEdit). Serviços de verdade. Preços
// são EXEMPLOS, nunca preços aprovados. Prova:
// - nome, descrição e preço padrão persistem, com histórico administrativo
//   (quem, quando, antes e depois), do essencial e de cada adicional,
//   inclusive planejado (que continua não contratável);
// - mudar o preço padrão não reajusta versão de assinatura, contrato,
//   pagamento nem período;
// - renomear não muda código, recurso, liberação, overrides nem versões: a
//   assinatura continua pelo código e as telas mostram o nome atual;
// - só o proprietário da plataforma com senha confirmada edita (rotas novas
//   e as rotas de preço que já existiam);
// - repetição, leitura desatualizada, nome repetido, preço de volta a
//   pendente e chave reaproveitada;
// - criar estabelecimento ou alterar a assinatura nunca muda o catálogo.
// Os specs dividem o banco: o afterAll devolve nomes, descrições e preços
// que este spec mudou (preço volta por uma linha nova, como sempre).
import { randomUUID } from 'node:crypto';
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DataSource } from 'typeorm';
import type { ConfigService } from '@nestjs/config';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { hashPassword } from '../src/auth/password-hasher.js';
import { AccountDelivery } from '../src/accounts/account-delivery.js';
import { AccountsAdminService } from '../src/accounts/accounts-admin.service.js';
import { InvitesService } from '../src/accounts/invites.service.js';
import { createEstablishmentSchema } from '../src/accounts/accounts.dto.js';
import { AccessValidityService } from '../src/platform/access-validity.service.js';
import { PricingService, pricingFor } from '../src/platform/pricing.service.js';
import { SubscriptionService } from '../src/platform/subscription.service.js';
import { ModularCatalogService } from '../src/platform/modular-catalog.service.js';
import { DashboardService } from '../src/dashboard/dashboard.service.js';
import { featureEnabled } from '../src/commercial/commercial-gate.js';
import { FeatureKey } from '../src/entities/enums/feature-key.enum.js';
import { MODULAR_PLAN_ID } from '../src/commercial/modular-plan.js';
import { garantirPrecoBase } from './support/assinatura.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const id = () => randomUUID().replaceAll('-', '').slice(0, 24);
const SENHA = 'senha-de-teste-forte-1';
const TZ = 'America/Sao_Paulo';
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

type ErroHttp = Error & { getResponse?: () => { code?: string; message?: string } };
const erroDe = async (promessa: Promise<unknown>): Promise<ErroHttp> => {
  try {
    await promessa;
  } catch (error) {
    return error as ErroHttp;
  }
  throw new Error('era esperado um erro');
};
const codigo = async (promessa: Promise<unknown>) => (await erroDe(promessa)).getResponse?.()?.code;

interface Estado {
  name: string;
  description: string;
  priceCents: number | null;
}

describe.skipIf(!url)('edição do catálogo modular contra PostgreSQL descartável', () => {
  let db: DataSource;
  let admin: AccountsAdminService;
  let invites: InvitesService;
  let validade: AccessValidityService;
  let precos: PricingService;
  let assinaturas: SubscriptionService;
  let catalogo: ModularCatalogService;
  let painel: DashboardService;
  let caixa: Server;
  const marca = `catalogo-${id()}`;
  const email = (nome: string) => `${marca}-${nome}@example.test`;
  let hash: string;
  let master: { userId: string; sessionId: string };
  const originais = new Map<string, Estado>();

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query(sql, params)) as T[];
  const n = async (sql: string, params: unknown[] = []) => Number((await q<{ n: number }>(sql, params))[0].n);
  const chave = () => `chave-${id()}`;

  async function conta(nome: string, role: string | null = null) {
    const userId = id();
    await q(
      `INSERT INTO users (id, name, email, status, platform_role, email_verified) VALUES ($1, $2, $3, 'ACTIVE', $4::platform_role, true)`,
      [userId, `Pessoa ${nome}`, email(nome), role],
    );
    await q(`INSERT INTO credentials (id, user_id, password_hash, algorithm) VALUES ($1, $2, $3, 'argon2id')`, [id(), userId, hash]);
    const sessionId = id();
    await q(`INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')`, [
      sessionId,
      userId,
      id() + id(),
    ]);
    return { userId, sessionId };
  }
  const reauth = (quem: { userId: string; sessionId: string }) => admin.reauthenticate(quem.userId, quem.sessionId, SENHA);

  /** Estado atual de um item como a tela de Planos e adicionais lê. */
  async function lido(code: string): Promise<Estado> {
    const c = await assinaturas.catalog(master.userId);
    if (code === MODULAR_PLAN_ID) {
      return { name: c.essential.name, description: c.essential.description, priceCents: c.essential.priceCents };
    }
    const a = c.addons.find((x) => x.code === code)!;
    return { name: a.name, description: a.description, priceCents: a.priceCents };
  }

  /** Edita a partir do que a tela leu agora. */
  async function editar(code: string, mudanca: Partial<Estado> & { reason?: string }, quem = master, requestKey = chave()) {
    const expected = await lido(code);
    const { reason, ...resto } = mudanca;
    const dto = { requestKey, expected, ...expected, ...resto, ...(reason ? { reason } : {}) };
    return code === MODULAR_PLAN_ID
      ? catalogo.editEssential(quem.userId, quem.sessionId, dto)
      : catalogo.editAddon(quem.userId, quem.sessionId, code, dto);
  }

  async function lembrar(code: string) {
    if (!originais.has(code)) originais.set(code, await lido(code));
  }

  async function criarModular(nome: string, addons: string[]) {
    const dto = createEstablishmentSchema.parse({
      requestKey: chave(),
      businessName: `${marca} ${nome}`,
      category: 'OTHER',
      addons,
      teamUserLimit: 3,
      owner: { name: `Dona ${nome}`, email: email(`${nome}-dona`) },
    });
    const criado = await invites.createEstablishment(master.userId, dto);
    return criado.tenant!.id;
  }

  const versao = async (tenantId: string) =>
    (await q<{ updated_at: Date }>('SELECT updated_at FROM tenants WHERE id = $1', [tenantId]))[0].updated_at.toISOString();

  /** Tudo o que é contratual de um estabelecimento, para comparar antes e depois. */
  const contratual = async (tenantId: string) => ({
    versoes: await q(`SELECT * FROM tenant_subscriptions WHERE tenant_id = $1 ORDER BY version`, [tenantId]),
    itens: await q(
      `SELECT i.* FROM tenant_subscription_items i JOIN tenant_subscriptions s ON s.id = i.subscription_id
        WHERE s.tenant_id = $1 ORDER BY i.id`,
      [tenantId],
    ),
    contratos: await q(`SELECT * FROM tenant_contract_prices WHERE tenant_id = $1 ORDER BY id`, [tenantId]),
    periodos: await q(`SELECT * FROM tenant_access_periods WHERE tenant_id = $1 ORDER BY id`, [tenantId]),
    overrides: await q(`SELECT * FROM tenant_feature_overrides WHERE tenant_id = $1 ORDER BY id`, [tenantId]),
    tenant: await q(`SELECT plan_id, team_user_limit, updated_at FROM tenants WHERE id = $1`, [tenantId]),
  });

  const ultimaAuditoria = async (item: string) =>
    (
      await q<{ actor_user_id: string; actor_name: string; summary: string; previous_data: Estado & { item: string }; new_data: Estado & { item: string; reason: string | null }; occurred_at: Date }>(
        `SELECT actor_user_id, actor_name, summary, previous_data, new_data, occurred_at FROM audit_logs
          WHERE action = 'CATALOG_ITEM_CHANGED' AND previous_data->>'item' = $1 ORDER BY occurred_at DESC, id DESC LIMIT 1`,
        [item],
      )
    )[0];

  beforeAll(async () => {
    caixa = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.statusCode = 201;
        res.end(JSON.stringify({ messageId: id() }));
      });
    });
    await new Promise<void>((resolve) => caixa.listen(0, '127.0.0.1', resolve));
    const porta = (caixa.address() as AddressInfo).port;
    const pasta = path.dirname(fileURLToPath(import.meta.url));
    const entities: (new () => object)[] = [];
    for (const file of globSync(path.join(pasta, '../src/entities/**/*.entity.ts'))) {
      const exports = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      for (const value of Object.values(exports)) if (typeof value === 'function') entities.push(value as new () => object);
    }
    db = new DataSource({ ...buildRuntimeDataSourceOptions(url!), entities, logging: ['error'] });
    await db.initialize();
    const valores: Record<string, string> = {
      EMAIL_PROVIDER: 'brevo',
      EMAIL_API_KEY: 'chave-local',
      EMAIL_FROM: 'nao-responda@example.test',
      EMAIL_API_BASE_URL: `http://127.0.0.1:${porta}`,
      FRONTEND_URL: 'http://localhost:3000',
    };
    const config = { get: (k: string) => valores[k], getOrThrow: (k: string) => valores[k] } as unknown as ConfigService;
    admin = new AccountsAdminService(db);
    invites = new InvitesService(db, new AccountDelivery(db, config));
    validade = new AccessValidityService(db);
    precos = new PricingService(db);
    assinaturas = new SubscriptionService(db);
    catalogo = new ModularCatalogService(db);
    painel = new DashboardService(db);
    hash = await hashPassword(SENHA);
    master = await conta('master', 'MASTER_OWNER');
    await reauth(master);
    await garantirPrecoBase(db, master.userId);
    for (const [code, centavos] of [
      ['INDICADORES', 990],
      ['COMISSOES', 1490],
    ] as const) {
      const atual = await lido(code);
      if (atual.priceCents === null) {
        await assinaturas.setAddonPrice(master.userId, master.sessionId, code, {
          requestKey: chave(),
          expectedCurrentCents: null,
          amountCents: centavos,
        });
      }
    }
  });

  afterAll(async () => {
    if (db?.isInitialized) {
      for (const [code, original] of originais) {
        const agora = await lido(code);
        if (code === MODULAR_PLAN_ID) {
          await q('UPDATE plans SET name = $2, short_description = $3 WHERE id = $1', [code, original.name, original.description]);
        } else {
          await q('UPDATE addon_modules SET name = $2, description = $3 WHERE code = $1', [code, original.name, original.description]);
        }
        if (original.priceCents !== null && agora.priceCents !== original.priceCents) {
          await q(
            code === MODULAR_PLAN_ID
              ? `INSERT INTO plan_prices (id, plan_id, billing_cycle, amount_cents, recorded_at, recorded_by_user_id, request_key)
                 VALUES ($1, $2, 'MONTHLY', $3, now(), $4, $5)`
              : `INSERT INTO addon_module_prices (id, module_code, amount_cents, recorded_at, recorded_by_user_id, request_key)
                 VALUES ($1, $2, $3, now(), $4, $5)`,
            [id(), code, original.priceCents, master.userId, chave()],
          );
        }
      }
      await db.destroy();
    }
    caixa?.close();
  });

  it('adicional: nome, descrição e preço persistem juntos, com histórico de quem, quando, antes e depois', async () => {
    await lembrar('COMISSOES');
    const antes = await lido('COMISSOES');
    const [modulo] = await q<{ feature_key: string; availability: string; sort_order: number }>(
      'SELECT feature_key, availability, sort_order FROM addon_modules WHERE code = $1',
      ['COMISSOES'],
    );
    const resposta = await editar('COMISSOES', {
      name: 'Comissões por serviço',
      description: 'Comissão por profissional e serviço, apurada por item concluído.',
      priceCents: antes.priceCents! + 100,
      reason: 'Reajuste de teste',
    });
    expect(resposta).toMatchObject({ changed: true, item: { code: 'COMISSOES', kind: 'ADDON', name: 'Comissões por serviço' } });
    expect(await lido('COMISSOES')).toEqual({
      name: 'Comissões por serviço',
      description: 'Comissão por profissional e serviço, apurada por item concluído.',
      priceCents: antes.priceCents! + 100,
    });
    // Código, recurso, disponibilidade e ordem intactos.
    expect(
      (await q('SELECT feature_key, availability, sort_order FROM addon_modules WHERE code = $1', ['COMISSOES']))[0],
    ).toEqual(modulo);
    // Preço é linha nova (o histórico de preços fica), com o motivo.
    const [preco] = await q<{ amount_cents: number; reason: string; recorded_by_user_id: string }>(
      `SELECT amount_cents, reason, recorded_by_user_id FROM addon_module_prices WHERE module_code = 'COMISSOES'
        ORDER BY recorded_at DESC, id DESC LIMIT 1`,
    );
    expect(preco).toEqual({ amount_cents: antes.priceCents! + 100, reason: 'Reajuste de teste', recorded_by_user_id: master.userId });
    const auditoria = await ultimaAuditoria('COMISSOES');
    expect(auditoria.actor_user_id).toBe(master.userId);
    expect(auditoria.actor_name).toBe('Pessoa master');
    expect(Date.now() - new Date(auditoria.occurred_at).getTime()).toBeLessThan(60_000);
    expect(auditoria.previous_data).toEqual({ item: 'COMISSOES', ...antes });
    expect(auditoria.new_data).toEqual({ item: 'COMISSOES', ...(await lido('COMISSOES')), reason: 'Reajuste de teste' });
    expect(auditoria.summary).toContain(`nome "${antes.name}" para "Comissões por serviço"`);
    expect(auditoria.summary).toContain('Assinaturas já contratadas, pagamentos e períodos não mudam.');
    // A lista de preços dos adicionais mostra o nome atual.
    expect((await assinaturas.catalog(master.userId)).history[0]).toMatchObject({ moduleCode: 'COMISSOES', moduleName: 'Comissões por serviço' });
  });

  it('essencial: nome, descrição e preço padrão persistem e as telas passam a usar o nome atual', async () => {
    await lembrar(MODULAR_PLAN_ID);
    const antes = await lido(MODULAR_PLAN_ID);
    const tenantId = await criarModular('essencial', []);
    await editar(MODULAR_PLAN_ID, { name: 'Agenda base', description: 'Agenda, link, equipe e recebimentos.', priceCents: antes.priceCents! + 50 });
    expect(await lido(MODULAR_PLAN_ID)).toEqual({ name: 'Agenda base', description: 'Agenda, link, equipe e recebimentos.', priceCents: antes.priceCents! + 50 });
    const visao = await assinaturas.view(master.userId, tenantId);
    expect(visao.plan.name).toBe('Agenda base');
    expect(visao.catalog.essential).toMatchObject({ name: 'Agenda base', description: 'Agenda, link, equipe e recebimentos.' });
    // Continua sendo a base obrigatória: o plano modular e o que ele libera não mudam.
    expect(visao.plan.id).toBe(MODULAR_PLAN_ID);
    expect(await featureEnabled(db.manager, tenantId, FeatureKey.AGENDA)).toBe(true);
    expect(await n(`SELECT count(*)::int AS n FROM plan_features WHERE plan_id = $1`, [MODULAR_PLAN_ID])).toBe(6);
    const auditoria = await ultimaAuditoria(MODULAR_PLAN_ID);
    expect(auditoria.previous_data).toEqual({ item: MODULAR_PLAN_ID, ...antes });
    expect(auditoria.new_data).toMatchObject({ item: MODULAR_PLAN_ID, name: 'Agenda base' });
  });

  it('planejado: nome, descrição e preço editáveis, e continua sem poder ser contratado', async () => {
    await lembrar('MARKETING');
    await editar('MARKETING', { name: 'Marketing e retorno de clientes', priceCents: 1990 });
    const c = await assinaturas.catalog(master.userId);
    expect(c.addons.find((a) => a.code === 'MARKETING')).toMatchObject({
      name: 'Marketing e retorno de clientes',
      availability: 'PLANNED',
      featureKey: null,
      priceCents: 1990,
    });
    expect(await codigo(criarModular('planejado', ['MARKETING']))).toBe('MODULO_INDISPONIVEL');
    // Só o nome, mantendo o preço pendente de outro planejado.
    await lembrar('ESTOQUE');
    if ((await lido('ESTOQUE')).priceCents === null) {
      expect(await editar('ESTOQUE', { name: 'Estoque de produtos' })).toMatchObject({ changed: true, item: { priceCents: null } });
      expect(await n(`SELECT count(*)::int AS n FROM addon_module_prices WHERE module_code = 'ESTOQUE'`)).toBe(0);
    }
  });

  it('preço padrão novo não reajusta versão, contrato, pagamento nem período já registrados', async () => {
    const tenantId = await criarModular('contrato', ['INDICADORES']);
    await validade.recordPaid(master.userId, master.sessionId, tenantId, {
      requestKey: chave(),
      cycle: 'MONTHLY',
      amountCents: 1234,
      paymentMethod: 'PIX',
      receivedOn: hoje(),
      manualConfirmation: true,
      expectedUpdatedAt: await versao(tenantId),
    });
    const antes = await contratual(tenantId);
    const sugestao = await pricingFor(db.manager, tenantId, MODULAR_PLAN_ID, 'MONTHLY');
    await lembrar('INDICADORES');
    await lembrar(MODULAR_PLAN_ID);
    await editar('INDICADORES', { priceCents: (await lido('INDICADORES')).priceCents! + 300 });
    await editar(MODULAR_PLAN_ID, { priceCents: (await lido(MODULAR_PLAN_ID)).priceCents! + 300 });
    expect(await contratual(tenantId)).toEqual(antes);
    // A sugestão do próximo pagamento continua sendo o contrato.
    // (o preço do catálogo exibido ao lado muda; o valor sugerido, não).
    const { contractCents, suggestedCents, source } = await pricingFor(db.manager, tenantId, MODULAR_PLAN_ID, 'MONTHLY');
    expect({ contractCents, suggestedCents, source }).toEqual({
      contractCents: sugestao.contractCents,
      suggestedCents: sugestao.suggestedCents,
      source: 'CONTRACT',
    });
    const visao = await assinaturas.view(master.userId, tenantId);
    expect(visao.current!.contractedTotalCents).toBe(Number((antes.versoes[0] as { contracted_total_cents: number }).contracted_total_cents));
    expect(visao.current!.items[0].catalogPriceCents).toBe(Number((antes.itens[0] as { catalog_price_cents: number }).catalog_price_cents));
  });

  it('renomear não muda código, recurso, liberação nem vínculos; a assinatura segue pelo código', async () => {
    await lembrar('INDICADORES');
    const tenantId = await criarModular('renomear', ['INDICADORES']);
    const antes = await contratual(tenantId);
    await editar('INDICADORES', { name: 'Painel de indicadores' });
    expect(await contratual(tenantId)).toEqual(antes);
    expect(await featureEnabled(db.manager, tenantId, FeatureKey.RELATORIOS)).toBe(true);
    const visao = await assinaturas.view(master.userId, tenantId);
    expect(visao.enabledAddons).toEqual(['INDICADORES']);
    expect(visao.current!.items).toEqual([expect.objectContaining({ code: 'INDICADORES', name: 'Painel de indicadores' })]);
    // Nova versão pelo código, com o nome atual no histórico administrativo.
    await assinaturas.change(master.userId, master.sessionId, tenantId, {
      expectedUpdatedAt: await versao(tenantId),
      requestKey: chave(),
      addons: ['INDICADORES'],
      teamUserLimit: 4,
    });
    const [registro] = await q<{ summary: string }>(
      `SELECT summary FROM audit_logs WHERE action = 'SUBSCRIPTION_CHANGED' AND tenant_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT 1`,
      [tenantId],
    );
    expect(registro.summary).toContain('Painel de indicadores');
    // O aviso da Visão geral do dono, sem o adicional, usa o nome atual.
    const semAdicional = await criarModular('renomear-painel', []);
    const dono = await conta('renomear-painel-dono');
    await q(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [id(), dono.userId, semAdicional]);
    expect((await painel.summary(dono.userId, semAdicional, {})).indicators).toEqual({ contracted: false, addonName: 'Painel de indicadores' });
    expect(await featureEnabled(db.manager, tenantId, FeatureKey.RELATORIOS)).toBe(true);
  });

  it('só o proprietário da plataforma com senha confirmada edita, inclusive pelas rotas de preço antigas', async () => {
    await lembrar('COMISSOES');
    const delegado = await conta('perm-admin', 'MASTER_ADMIN');
    const suporte = await conta('perm-suporte', 'MASTER_SUPPORT');
    const comum = await conta('perm-comum');
    for (const quem of [delegado, suporte, comum]) await reauth(quem);
    const semReauth = await conta('perm-sem-reauth', 'MASTER_OWNER');
    const precosAntes = await n(`SELECT (SELECT count(*) FROM addon_module_prices) + (SELECT count(*) FROM plan_prices) AS n`);
    const nomesAntes = await q(`SELECT code, name, description FROM addon_modules ORDER BY code`);
    const essencialAntes = await lido(MODULAR_PLAN_ID);
    for (const quem of [delegado, suporte, comum]) {
      expect((await erroDe(editar('COMISSOES', { name: 'Tentativa' }, quem))).constructor.name).toBe('ForbiddenException');
      expect((await erroDe(editar(MODULAR_PLAN_ID, { name: 'Tentativa' }, quem))).constructor.name).toBe('ForbiddenException');
      expect(
        (await erroDe(assinaturas.setAddonPrice(quem.userId, quem.sessionId, 'COMISSOES', { requestKey: chave(), expectedCurrentCents: null, amountCents: 1 })))
          .constructor.name,
      ).toBe('ForbiddenException');
      expect(
        (await erroDe(precos.setCatalogPrice(quem.userId, quem.sessionId, MODULAR_PLAN_ID, 'MONTHLY', { requestKey: chave(), expectedCurrentCents: null, amountCents: 1 })))
          .constructor.name,
      ).toBe('ForbiddenException');
    }
    expect(await codigo(editar('COMISSOES', { name: 'Tentativa' }, semReauth))).toBe('REAUTENTICACAO_NECESSARIA');
    expect(await codigo(editar(MODULAR_PLAN_ID, { name: 'Tentativa' }, semReauth))).toBe('REAUTENTICACAO_NECESSARIA');
    expect(await n(`SELECT (SELECT count(*) FROM addon_module_prices) + (SELECT count(*) FROM plan_prices) AS n`)).toBe(precosAntes);
    expect(await q(`SELECT code, name, description FROM addon_modules ORDER BY code`)).toEqual(nomesAntes);
    expect(await lido(MODULAR_PLAN_ID)).toEqual(essencialAntes);
  });

  it('repetição não grava duas vezes; leitura antiga, nome repetido, preço pendente e chave reaproveitada são recusados', async () => {
    await lembrar('WHATSAPP');
    await lembrar('GESTAO_FINANCEIRA');
    const lidoAgora = await lido('WHATSAPP');
    const dto = {
      requestKey: chave(),
      expected: lidoAgora,
      name: 'WhatsApp com lembretes',
      description: lidoAgora.description,
      // Sempre um preço diferente do atual (o banco é dividido entre execuções).
      priceCents: (lidoAgora.priceCents ?? 2400) + 90,
    };
    const auditoriasAntes = await n(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'CATALOG_ITEM_CHANGED'`);
    const precosAntes = await n(`SELECT count(*)::int AS n FROM addon_module_prices WHERE module_code = 'WHATSAPP'`);
    // Dois envios iguais ao mesmo tempo (rede caiu e a tela reenviou).
    const resultados = await Promise.all([
      catalogo.editAddon(master.userId, master.sessionId, 'WHATSAPP', dto),
      catalogo.editAddon(master.userId, master.sessionId, 'WHATSAPP', dto),
    ]);
    expect(resultados.map((r) => r.changed).sort()).toEqual([false, true]);
    expect(await catalogo.editAddon(master.userId, master.sessionId, 'WHATSAPP', dto)).toMatchObject({ changed: false });
    expect(await n(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'CATALOG_ITEM_CHANGED'`)).toBe(auditoriasAntes + 1);
    expect(await n(`SELECT count(*)::int AS n FROM addon_module_prices WHERE module_code = 'WHATSAPP'`)).toBe(precosAntes + 1);
    // Outra tela lendo o estado antigo.
    expect(await codigo(catalogo.editAddon(master.userId, master.sessionId, 'WHATSAPP', { ...dto, requestKey: chave(), name: 'Outro nome' }))).toBe(
      'ALTERADO_POR_OUTRA_TELA',
    );
    // Nome de outro item (sem diferença de maiúsculas e acentos).
    const indicadores = await lido('INDICADORES');
    expect(await codigo(editar('WHATSAPP', { name: indicadores.name.toUpperCase() }))).toBe('NOME_REPETIDO');
    expect(await codigo(editar('WHATSAPP', { name: (await lido(MODULAR_PLAN_ID)).name }))).toBe('NOME_REPETIDO');
    expect(await codigo(editar(MODULAR_PLAN_ID, { name: indicadores.name }))).toBe('NOME_REPETIDO');
    // Preço definido não volta a pendente.
    expect(await codigo(editar('WHATSAPP', { priceCents: null }))).toBe('PRECO_OBRIGATORIO');
    // Mesma chave de um preço já gravado, com outro conteúdo.
    expect(await codigo(editar('GESTAO_FINANCEIRA', { priceCents: 3990 }, master, dto.requestKey))).toBe('CHAVE_REPETIDA');
    expect(await lido('WHATSAPP')).toMatchObject({ name: 'WhatsApp com lembretes', priceCents: dto.priceCents });
    expect(
      (await erroDe(catalogo.editAddon(master.userId, master.sessionId, 'INEXISTENTE', { ...dto, requestKey: chave() }))).constructor.name,
    ).toBe('NotFoundException');
  });

  it('criar estabelecimento e alterar a assinatura nunca mudam nome, descrição nem preço do catálogo', async () => {
    const catalogoAntes = await q(`SELECT code, name, description, feature_key, availability FROM addon_modules ORDER BY code`);
    const essencialAntes = await q(`SELECT name, short_description FROM plans WHERE id = $1`, [MODULAR_PLAN_ID]);
    const precosAntes = await n(`SELECT (SELECT count(*) FROM addon_module_prices) + (SELECT count(*) FROM plan_prices) AS n`);
    const edicoesAntes = await n(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'CATALOG_ITEM_CHANGED'`);
    const tenantId = await criarModular('sem-catalogo', ['COMISSOES']);
    await assinaturas.change(master.userId, master.sessionId, tenantId, {
      expectedUpdatedAt: await versao(tenantId),
      requestKey: chave(),
      addons: ['COMISSOES', 'INDICADORES'],
      contractedTotalCents: 5000,
      reason: 'Valor combinado só com este cliente',
      teamUserLimit: 5,
    });
    expect(await q(`SELECT code, name, description, feature_key, availability FROM addon_modules ORDER BY code`)).toEqual(catalogoAntes);
    expect(await q(`SELECT name, short_description FROM plans WHERE id = $1`, [MODULAR_PLAN_ID])).toEqual(essencialAntes);
    expect(await n(`SELECT (SELECT count(*) FROM addon_module_prices) + (SELECT count(*) FROM plan_prices) AS n`)).toBe(precosAntes);
    expect(await n(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'CATALOG_ITEM_CHANGED'`)).toBe(edicoesAntes);
  });
});
