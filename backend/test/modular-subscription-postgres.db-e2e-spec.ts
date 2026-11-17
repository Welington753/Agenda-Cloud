// Assinatura modular e limite de usuários da equipe contra PostgreSQL
// DESCARTÁVEL (migration ModularSubscription aplicada). Serviços de verdade;
// e-mail numa caixa HTTP local. Preços são EXEMPLOS (29,90 / 9,90 / 14,90),
// nunca preços aprovados. Prova:
// - contagem: usuário com login conta uma vez; dono e profissional sem login
//   ficam fora; convite válido reserva (um por e-mail, nunca para quem já tem
//   vínculo); vencido e revogado liberam;
// - transição: cliente atual segue o limite do plano; acima do limite depois
//   da contagem nova, nada é suspenso, só novas entradas são recusadas;
// - limite e redução recusada com o motivo; concorrência na última vaga e
//   entre convite e redução;
// - assinatura: versões, catálogo sem reajuste, valor negociado com motivo,
//   módulo indisponível, liberação só dos adicionais (outros overrides
//   intactos), conversão explícita (inclusive trimestral);
// - rotas antigas recusadas para estabelecimento modular;
// - permissões, isolamento, Visão geral sem indicadores;
// - compatibilidade com o web e a API anteriores (validadores e SQL
//   congelados em support/contrato-web-anterior-assinatura.ts).
// Não usa o papel GERENTE em vínculo (o check do piloto de gerentes divide o
// banco); o convite GERENTE é linha de `invites`, que esse check não lê.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { globSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DataSource } from 'typeorm';
import type { ConfigService } from '@nestjs/config';
import { buildRuntimeDataSourceOptions } from '../src/database/runtime-data-source.js';
import { hashPassword } from '../src/auth/password-hasher.js';
import { AccountDelivery } from '../src/accounts/account-delivery.js';
import { AccountsAdminService } from '../src/accounts/accounts-admin.service.js';
import { AccountsDirectoryService } from '../src/accounts/accounts-directory.service.js';
import { InvitesService } from '../src/accounts/invites.service.js';
import { createEstablishmentSchema } from '../src/accounts/accounts.dto.js';
import { DashboardService } from '../src/dashboard/dashboard.service.js';
import { EstablishmentAdminService } from '../src/platform/establishment-admin.service.js';
import { AccessValidityService } from '../src/platform/access-validity.service.js';
import { PricingService, pricingFor } from '../src/platform/pricing.service.js';
import { SubscriptionService } from '../src/platform/subscription.service.js';
import { TeamService } from '../src/team/team.service.js';
import { staffSeatUsage } from '../src/team/seats.js';
import { seatTransitionReport } from '../src/team/seat-transition.js';
import { MODULAR_PLAN_ID } from '../src/commercial/modular-plan.js';
import { comTodosOsRecursos } from './support/plano-de-teste.js';
import { garantirPrecoBase } from './support/assinatura.js';
import * as webAnterior from './support/contrato-web-anterior-assinatura.js';

const url = process.env.DB_E2E_DIRECT_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
  throw new Error('Este teste exige PostgreSQL descartável local.');
}
const id = () => randomUUID().replaceAll('-', '').slice(0, 24);
const SENHA = 'senha-de-teste-forte-1';
const TZ = 'America/Sao_Paulo';
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

function caixaDeEmail() {
  const recebidos: { to: string; text: string }[] = [];
  const server: Server = createServer((req, res) => {
    let corpo = '';
    req.on('data', (parte) => (corpo += parte));
    req.on('end', () => {
      const json = JSON.parse(corpo) as { to: { email: string }[]; textContent: string };
      recebidos.push({ to: json.to[0].email, text: json.textContent });
      res.statusCode = 201;
      res.end(JSON.stringify({ messageId: id() }));
    });
  });
  return { server, recebidos };
}

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

describe.skipIf(!url)('assinatura modular e limite de usuários contra PostgreSQL descartável', () => {
  let db: DataSource;
  let invites: InvitesService;
  let team: TeamService;
  let admin: AccountsAdminService;
  let directory: AccountsDirectoryService;
  let estabelecimentos: EstablishmentAdminService;
  let validade: AccessValidityService;
  let precos: PricingService;
  let assinaturas: SubscriptionService;
  let painel: DashboardService;
  const caixa = caixaDeEmail();
  const marca = `modular-${id()}`;
  const email = (nome: string) => `${marca}-${nome}@example.test`;
  let hash: string;
  let master: { userId: string; sessionId: string };
  let planoTeste: string;
  let planoDois: string;

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query(sql, params)) as T[];
  const n = async (sql: string, params: unknown[] = []) => Number((await q<{ n: number }>(sql, params))[0].n);
  const chave = () => `chave-${id()}`;

  async function conta(nome: string, opcoes: { role?: string } = {}) {
    const userId = id();
    await q(
      `INSERT INTO users (id, name, email, status, platform_role, email_verified) VALUES ($1, $2, $3, 'ACTIVE', $4::platform_role, true)`,
      [userId, `Pessoa ${nome}`, email(nome), opcoes.role ?? null],
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

  /** Estabelecimento no plano anterior (legado), com dono e teste em vigor. */
  async function estabelecimento(nome: string, planId = planoTeste) {
    const tenantId = id();
    await q(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, access_legacy_since)
       VALUES ($1, $2, 'OTHER', $3, $4, 'ACTIVE', now())`,
      [tenantId, `${marca}-${nome}`, TZ, planId],
    );
    await q(`INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, $3, '', $4, true)`, [
      id(),
      tenantId,
      `${marca} ${nome}`,
      TZ,
    ]);
    const dono = await conta(`${nome}-dono`);
    await q(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [id(), dono.userId, tenantId]);
    return { tenantId, dono, nome };
  }
  type Est = Awaited<ReturnType<typeof estabelecimento>>;

  async function profissional(est: Est, nome: string) {
    const professionalId = id();
    await q(
      `INSERT INTO professionals (id, tenant_id, name, avatar_initials, avatar_color) VALUES ($1, $2, $3, 'PX', '#000000')`,
      [professionalId, est.tenantId, `Profissional ${nome}`],
    );
    return professionalId;
  }

  /** Vínculo direto (conta com login) com o papel dado. */
  async function vinculo(est: Est, nome: string, role: 'PROFISSIONAL' | 'RECEPCIONISTA', status = 'ACTIVE') {
    const pessoa = await conta(`${est.nome}-${nome}`);
    const professionalId = role === 'PROFISSIONAL' ? await profissional(est, nome) : null;
    const membershipId = id();
    await q(
      `INSERT INTO memberships (id, user_id, tenant_id, role, professional_id, status, permissions_confirmed_at)
       VALUES ($1, $2, $3, $4::establishment_role, $5, $6, now())`,
      [membershipId, pessoa.userId, est.tenantId, role, professionalId, status],
    );
    return { ...pessoa, membershipId, email: email(`${est.nome}-${nome}`) };
  }

  /** Convite gravado direto (para contar estados que a tela não cria). */
  async function conviteDireto(est: Est, alvo: string, role: string, status = 'PENDING', expira = "now() + interval '2 days'") {
    const professionalId = role === 'PROFISSIONAL' ? await profissional(est, `conv-${id().slice(0, 6)}`) : null;
    await q(
      `INSERT INTO invites (id, type, target_name, target_email, tenant_id, establishment_role, status, token_hash, expires_at,
          created_by_user_id, request_key, revoked_at, professional_id, created_at)
       VALUES ($1, 'ESTABLISHMENT', 'Alvo', $2, $3, $4::establishment_role, $5::invite_status, $6, ${expira}, $7, $8,
          CASE WHEN $5::text = 'REVOKED' THEN now() END, $9, now() - interval '3 days')`,
      [id(), alvo, est.tenantId, role, status, id() + id() + id(), est.dono.userId, chave(), professionalId],
    );
  }

  const convidar = (est: Est, professionalId: string, nome: string) =>
    invites.inviteStaff(est.dono.userId, est.tenantId, {
      requestKey: chave(),
      professionalId,
      name: `Funcionária ${nome}`,
      email: email(`${est.nome}-${nome}`),
    });

  const vagas = (est: Est) => team.overview(est.dono.userId, est.tenantId).then((v) => v.seats);
  const versao = async (tenantId: string) =>
    (await q<{ updated_at: Date }>('SELECT updated_at FROM tenants WHERE id = $1', [tenantId]))[0].updated_at.toISOString();
  const reauth = (quem: { userId: string; sessionId: string }) => admin.reauthenticate(quem.userId, quem.sessionId, SENHA);

  const mudar = async (est: Est, corpo: Record<string, unknown>, quem = master) =>
    assinaturas.change(quem.userId, quem.sessionId, est.tenantId, {
      expectedUpdatedAt: await versao(est.tenantId),
      requestKey: chave(),
      addons: [],
      teamUserLimit: 5,
      ...corpo,
    } as never);

  async function precoAdicional(code: string, centavos: number) {
    const atual = (await assinaturas.catalog(master.userId)).addons.find((a) => a.code === code)!.priceCents;
    if (atual === centavos) return;
    await assinaturas.setAddonPrice(master.userId, master.sessionId, code, {
      requestKey: chave(),
      expectedCurrentCents: atual,
      amountCents: centavos,
    });
  }

  const overrides = (tenantId: string) =>
    q<{ key: string; enabled: boolean; id: string }>(
      `SELECT f.key::text AS key, o.enabled, o.id FROM tenant_feature_overrides o JOIN features f ON f.id = o.feature_id
        WHERE o.tenant_id = $1 ORDER BY f.key::text`,
      [tenantId],
    );

  beforeAll(async () => {
    await new Promise<void>((resolve) => caixa.server.listen(0, '127.0.0.1', resolve));
    const porta = (caixa.server.address() as AddressInfo).port;
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
    invites = new InvitesService(db, new AccountDelivery(db, config));
    team = new TeamService(db);
    admin = new AccountsAdminService(db);
    directory = new AccountsDirectoryService(db);
    estabelecimentos = new EstablishmentAdminService(db);
    validade = new AccessValidityService(db);
    precos = new PricingService(db);
    assinaturas = new SubscriptionService(db);
    painel = new DashboardService(db);
    hash = await hashPassword(SENHA);
    master = await conta('master', { role: 'MASTER_OWNER' });
    await reauth(master);
    await garantirPrecoBase(db, master.userId);
    await precoAdicional('INDICADORES', 990);
    await precoAdicional('COMISSOES', 1490);
    planoTeste = id();
    planoDois = id();
    for (const [plano, max] of [
      [planoTeste, 5],
      [planoDois, 2],
    ] as const) {
      await q(
        comTodosOsRecursos(`INSERT INTO plans (id, code, name, short_description, max_professionals, max_units) VALUES ($1, $1, $2, '', $3, 1)`),
        [plano, `Plano de teste ${max}`, max],
      );
    }
  });

  afterAll(async () => {
    await db?.destroy();
    caixa.server.close();
  });

  it('conta cada usuário com login uma vez; dono, sem login, suspenso, vencido e revogado ficam fora', async () => {
    const est = await estabelecimento('conta');
    await profissional(est, 'sem-login');
    await vinculo(est, 'prof', 'PROFISSIONAL');
    const recepcao = await vinculo(est, 'recep', 'RECEPCIONISTA');
    await vinculo(est, 'susp', 'PROFISSIONAL', 'SUSPENDED');
    await conviteDireto(est, email('conta-conv-prof'), 'PROFISSIONAL');
    await conviteDireto(est, email('conta-conv-ger'), 'GERENTE');
    await conviteDireto(est, recepcao.email, 'PROFISSIONAL'); // já tem vínculo: não reserva de novo
    await conviteDireto(est, email('conta-venc'), 'PROFISSIONAL', 'PENDING', "now() - interval '1 minute'");
    await conviteDireto(est, email('conta-revog'), 'PROFISSIONAL', 'REVOKED');
    await conviteDireto(est, email('conta-dono-conv'), 'DONO');
    expect(await vagas(est)).toMatchObject({ limit: 5, activeAccesses: 2, pendingInvites: 2, suspendedAccesses: 1, used: 4, available: 1 });
  });

  it('relatório de transição: ocupação anterior × nova × limite, sem escrever nada', async () => {
    const est = await estabelecimento('relat', planoDois);
    await vinculo(est, 'a', 'PROFISSIONAL');
    await vinculo(est, 'b', 'RECEPCIONISTA');
    await conviteDireto(est, email('relat-ger'), 'GERENTE');
    const antes = await q(`SELECT count(*)::int AS n FROM audit_logs`);
    const linha = (await seatTransitionReport(db.manager)).find((l) => l.tenantId === est.tenantId);
    expect(linha).toMatchObject({ previousUsed: 1, newUsed: 3, limit: 2, limitSource: 'PLAN', overLimit: true });
    expect(await q(`SELECT count(*)::int AS n FROM audit_logs`)).toEqual(antes);
  });

  it('cliente atual acima do limite após a contagem nova: ninguém é suspenso, só novas entradas são recusadas', async () => {
    const est = await estabelecimento('acima', planoDois);
    const a = await vinculo(est, 'a', 'PROFISSIONAL');
    await vinculo(est, 'b', 'RECEPCIONISTA');
    const c = await vinculo(est, 'c', 'PROFISSIONAL', 'SUSPENDED');
    await conviteDireto(est, email('acima-ger'), 'GERENTE');
    expect(await vagas(est)).toMatchObject({ limit: 2, used: 3, available: 0 });
    expect(await codigo(convidar(est, await profissional(est, 'novo'), 'novo'))).toBe('LIMITE_DO_PLANO');
    await reauth(est.dono);
    expect(await codigo(team.reactivate(est.dono.userId, est.dono.sessionId, est.tenantId, c.membershipId))).toBe('LIMITE_DO_PLANO');
    expect(await q(`SELECT status FROM memberships WHERE id = $1`, [a.membershipId])).toEqual([{ status: 'ACTIVE' }]);
    expect(await n(`SELECT count(*)::int AS n FROM memberships WHERE tenant_id = $1 AND status = 'ACTIVE'`, [est.tenantId])).toBe(3);
  });

  it('limite próprio de cliente atual: vence o do plano, recusa redução abaixo do uso, nunca muda a mensalidade', async () => {
    const est = await estabelecimento('limite');
    await vinculo(est, 'a', 'PROFISSIONAL');
    await conviteDireto(est, email('limite-conv'), 'PROFISSIONAL');
    const recusa = await erroDe(
      assinaturas.setTeamLimit(master.userId, master.sessionId, est.tenantId, { expectedUpdatedAt: await versao(est.tenantId), teamUserLimit: 1 }),
    );
    expect(recusa.getResponse?.()).toMatchObject({ code: 'LIMITE_ABAIXO_DO_USO' });
    expect(recusa.getResponse?.()?.message).toMatch(/1 acesso\(s\) ativo\(s\) e 1 reservado\(s\) por convite/);
    await assinaturas.setTeamLimit(master.userId, master.sessionId, est.tenantId, { expectedUpdatedAt: await versao(est.tenantId), teamUserLimit: 2 });
    expect(await vagas(est)).toMatchObject({ limit: 2, used: 2, available: 0 });
    expect(await n(`SELECT count(*)::int AS n FROM tenant_contract_prices WHERE tenant_id = $1`, [est.tenantId])).toBe(0);
    expect(await n(`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action = 'TEAM_LIMIT_CHANGED'`, [est.tenantId])).toBe(1);
    // Zero é aceito sem uso.
    const vazio = await estabelecimento('limite-zero');
    await assinaturas.setTeamLimit(master.userId, master.sessionId, vazio.tenantId, { expectedUpdatedAt: await versao(vazio.tenantId), teamUserLimit: 0 });
    expect(await codigo(convidar(vazio, await profissional(vazio, 'x'), 'x'))).toBe('LIMITE_DO_PLANO');
  });

  it('duas entradas disputando a última vaga do limite: uma passa; convite × redução nunca passam juntos', async () => {
    const est = await estabelecimento('corrida');
    await assinaturas.setTeamLimit(master.userId, master.sessionId, est.tenantId, { expectedUpdatedAt: await versao(est.tenantId), teamUserLimit: 1 });
    // Profissionais antes: um convite iniciado enquanto o próximo await
    // corre rejeitaria sem tratador ligado (rejeição não tratada).
    const pessoas = [await profissional(est, 'a'), await profissional(est, 'b'), await profissional(est, 'c')];
    const resultados = await Promise.allSettled(pessoas.map((pessoa, i) => convidar(est, pessoa, 'abc'[i])));
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await vagas(est)).toMatchObject({ used: 1, limit: 1 });

    const outra = await estabelecimento('corrida-reducao');
    await assinaturas.setTeamLimit(master.userId, master.sessionId, outra.tenantId, { expectedUpdatedAt: await versao(outra.tenantId), teamUserLimit: 2 });
    await vinculo(outra, 'a', 'PROFISSIONAL');
    const p = await profissional(outra, 'b');
    const v = await versao(outra.tenantId);
    const [convite, reducao] = await Promise.allSettled([
      convidar(outra, p, 'b'),
      assinaturas.setTeamLimit(master.userId, master.sessionId, outra.tenantId, { expectedUpdatedAt: v, teamUserLimit: 1 }),
    ]);
    expect([convite.status, reducao.status].filter((s) => s === 'fulfilled')).toHaveLength(1);
    const uso = await vagas(outra);
    expect(uso.used).toBeLessThanOrEqual(uso.limit);
  });

  it('cria estabelecimento modular com limite explícito, versão 1, contrato mensal e sem pagamento', async () => {
    const dto = createEstablishmentSchema.parse({
      requestKey: chave(),
      businessName: `${marca} Barbearia Aurora`,
      category: 'BARBERSHOP',
      addons: ['INDICADORES'],
      teamUserLimit: 3,
      owner: { name: 'Dona Aurora', email: email('aurora-dona') },
    });
    const criado = await invites.createEstablishment(master.userId, dto);
    const tenantId = criado.tenant!.id;
    const [t] = await q<{ plan_id: string; team_user_limit: number }>(`SELECT plan_id, team_user_limit FROM tenants WHERE id = $1`, [tenantId]);
    expect(t).toEqual({ plan_id: MODULAR_PLAN_ID, team_user_limit: 3 });
    const visao = await assinaturas.view(master.userId, tenantId);
    const base = visao.catalog.basePriceCents!;
    expect(visao.current).toMatchObject({ version: 1, catalogTotalCents: base + 990, contractedTotalCents: base + 990, teamUserLimit: 3 });
    expect(visao.enabledAddons).toEqual(['INDICADORES']);
    expect(await n(`SELECT count(*)::int AS n FROM tenant_access_periods WHERE tenant_id = $1 AND kind = 'PAID'`, [tenantId])).toBe(0);
    expect(await pricingFor(db.manager, tenantId, MODULAR_PLAN_ID, 'MONTHLY')).toMatchObject({ suggestedCents: base + 990, source: 'CONTRACT' });
    // Módulo planejado não entra, nem com preço.
    const recusa = await erroDe(
      invites.createEstablishment(master.userId, createEstablishmentSchema.parse({ ...dto, requestKey: chave(), addons: ['ESTOQUE'] })),
    );
    expect(recusa.getResponse?.()?.code).toBe('MODULO_INDISPONIVEL');
  });

  it('versões: catálogo muda sem reajustar contrato, valor negociado exige motivo, histórico preserva valores e datas', async () => {
    const est = await estabelecimento('versoes');
    const base = (await assinaturas.catalog(master.userId)).basePriceCents!;
    await mudar(est, { addons: ['INDICADORES', 'COMISSOES'], confirmRemoval: true, teamUserLimit: 4 });
    expect(await codigo(mudar(est, { addons: ['INDICADORES'], contractedTotalCents: 3000, confirmRemoval: true }))).toBe('MOTIVO_OBRIGATORIO');
    await mudar(est, { addons: ['INDICADORES'], contractedTotalCents: 3000, reason: 'Desconto de lançamento', confirmRemoval: true });
    // Catálogo muda depois: nenhuma versão nem contrato muda.
    await precoAdicional('INDICADORES', 1190);
    const visao = await assinaturas.view(master.userId, est.tenantId);
    expect(visao.history.map((h) => [h.version, h.contractedTotalCents, h.negotiated])).toEqual([
      [2, 3000, true],
      [1, base + 990 + 1490, false],
    ]);
    expect(visao.history[1].items.map((i) => [i.code, i.catalogPriceCents])).toEqual([
      ['INDICADORES', 990],
      ['COMISSOES', 1490],
    ]);
    expect(visao.history[0].reason).toBe('Desconto de lançamento');
    expect(await pricingFor(db.manager, est.tenantId, MODULAR_PLAN_ID, 'MONTHLY')).toMatchObject({ suggestedCents: 3000, source: 'CONTRACT' });
    await precoAdicional('INDICADORES', 990);
    // Comissões retiradas: override apagado, regras do histórico intactas.
    expect((await overrides(est.tenantId)).map((o) => o.key)).toEqual(['RELATORIOS']);
    // Redução abaixo do uso também é recusada aqui.
    await vinculo(est, 'a', 'PROFISSIONAL');
    await vinculo(est, 'b', 'PROFISSIONAL');
    expect(await codigo(mudar(est, { addons: ['INDICADORES'], teamUserLimit: 1, contractedTotalCents: 3000, reason: 'mesmo valor' }))).toBe(
      'LIMITE_ABAIXO_DO_USO',
    );
  });

  it('conversão: recursos de hoje pré-confirmados, overrides de outros recursos intactos, isolamento', async () => {
    const est = await estabelecimento('conv');
    const vizinho = await estabelecimento('conv-vizinho');
    const tfo = id();
    await q(`INSERT INTO tenant_feature_overrides (id, tenant_id, feature_id, enabled) VALUES ($1, $2, 'feat_agenda', true)`, [tfo, est.tenantId]);
    await q(`INSERT INTO tenant_feature_overrides (id, tenant_id, feature_id, enabled) VALUES ($1, $2, 'feat_comissoes', false)`, [id(), vizinho.tenantId]);
    // O plano de teste libera tudo: retirar Comissões sem confirmar é recusado.
    expect(await codigo(mudar(est, { addons: ['INDICADORES'] }))).toBe('RECURSO_SERIA_RETIRADO');
    expect(await q(`SELECT plan_id FROM tenants WHERE id = $1`, [est.tenantId])).toEqual([{ plan_id: planoTeste }]);
    await mudar(est, { addons: ['INDICADORES', 'COMISSOES'] });
    expect(await overrides(est.tenantId)).toEqual([
      { key: 'AGENDA', enabled: true, id: tfo },
      expect.objectContaining({ key: 'COMISSOES', enabled: true }),
      expect.objectContaining({ key: 'RELATORIOS', enabled: true }),
    ]);
    expect((await overrides(vizinho.tenantId)).map((o) => [o.key, o.enabled])).toEqual([['COMISSOES', false]]);
    expect(await q(`SELECT plan_id FROM tenants WHERE id = $1`, [vizinho.tenantId])).toEqual([{ plan_id: planoTeste }]);
  });

  it('conversão de contrato trimestral: exige confirmação; pagamentos, validade e contrato anterior preservados', async () => {
    const est = await estabelecimento('trim');
    await precos.setContractPrice(master.userId, master.sessionId, est.tenantId, {
      expectedUpdatedAt: await versao(est.tenantId),
      requestKey: chave(),
      cycle: 'QUARTERLY',
      amountCents: 9000,
      reason: 'combinado trimestral',
    });
    await validade.recordPaid(master.userId, master.sessionId, est.tenantId, {
      expectedUpdatedAt: await versao(est.tenantId),
      requestKey: chave(),
      cycle: 'QUARTERLY',
      amountCents: 9000,
      paymentMethod: 'PIX',
      receivedOn: hoje(),
      manualConfirmation: true,
    });
    const periodosAntes = await q(`SELECT id, starts_at, ends_at, contracted_price_cents, billing_cycle::text FROM tenant_access_periods WHERE tenant_id = $1 ORDER BY starts_at`, [est.tenantId]);
    const contratosAntes = await q(`SELECT id, amount_cents, billing_cycle::text, plan_id FROM tenant_contract_prices WHERE tenant_id = $1 ORDER BY recorded_at`, [est.tenantId]);
    const recusa = await erroDe(mudar(est, { addons: ['INDICADORES', 'COMISSOES'] }));
    expect(recusa.getResponse?.()).toMatchObject({ code: 'CONVERSAO_DE_CICLO' });
    await mudar(est, { addons: ['INDICADORES', 'COMISSOES'], cycleChange: { from: 'QUARTERLY', acknowledged: true } });
    expect(
      await q(`SELECT id, starts_at, ends_at, contracted_price_cents, billing_cycle::text FROM tenant_access_periods WHERE tenant_id = $1 ORDER BY starts_at`, [est.tenantId]),
    ).toEqual(periodosAntes);
    const contratosDepois = await q<{ plan_id: string }>(
      `SELECT id, amount_cents, billing_cycle::text, plan_id FROM tenant_contract_prices WHERE tenant_id = $1 ORDER BY recorded_at`,
      [est.tenantId],
    );
    expect(contratosDepois.slice(0, contratosAntes.length)).toEqual(contratosAntes);
    expect(contratosDepois.at(-1)).toMatchObject({ plan_id: MODULAR_PLAN_ID, billing_cycle: 'MONTHLY' });
    const [{ previous_contract }] = await q<{ previous_contract: Record<string, unknown> }>(
      `SELECT previous_contract FROM tenant_subscriptions WHERE tenant_id = $1`,
      [est.tenantId],
    );
    expect(previous_contract).toMatchObject({ planId: planoTeste, contractCycle: 'QUARTERLY', contractCents: 9000, lastPaidCycle: 'QUARTERLY' });
    // Trimestral não volta pela porta dos fundos.
    expect(
      await codigo(
        validade.recordPaid(master.userId, master.sessionId, est.tenantId, {
          expectedUpdatedAt: await versao(est.tenantId),
          requestKey: chave(),
          cycle: 'QUARTERLY',
          amountCents: 9000,
          paymentMethod: 'PIX',
          receivedOn: hoje(),
          manualConfirmation: true,
        }),
      ),
    ).toBe('CICLO_NAO_DISPONIVEL');
  });

  it('rotas antigas recusam alterar plano, contrato e contrato pelo pagamento de estabelecimento modular', async () => {
    const est = await estabelecimento('antigas');
    const legado = await estabelecimento('antigas-legado');
    expect(
      await codigo(estabelecimentos.changePlan(master.userId, master.sessionId, legado.tenantId, { expectedUpdatedAt: await versao(legado.tenantId), planId: MODULAR_PLAN_ID })),
    ).toBe('ASSINATURA_MODULAR');
    await mudar(est, { addons: ['INDICADORES', 'COMISSOES'] });
    expect(
      await codigo(estabelecimentos.changePlan(master.userId, master.sessionId, est.tenantId, { expectedUpdatedAt: await versao(est.tenantId), planId: planoTeste })),
    ).toBe('ASSINATURA_MODULAR');
    expect(
      await codigo(
        precos.setContractPrice(master.userId, master.sessionId, est.tenantId, {
          expectedUpdatedAt: await versao(est.tenantId),
          requestKey: chave(),
          cycle: 'MONTHLY',
          amountCents: 100,
          reason: 'tentativa',
        }),
      ),
    ).toBe('ASSINATURA_MODULAR');
    const pago = {
      requestKey: chave(),
      cycle: 'MONTHLY' as const,
      amountCents: 1234,
      paymentMethod: 'PIX' as const,
      receivedOn: hoje(),
      manualConfirmation: true as const,
    };
    expect(
      await codigo(validade.recordPaid(master.userId, master.sessionId, est.tenantId, { ...pago, expectedUpdatedAt: await versao(est.tenantId), updateContract: true })),
    ).toBe('ASSINATURA_MODULAR');
    // Registrar o pagamento em si continua permitido, sem mexer no contrato.
    const contrato = await pricingFor(db.manager, est.tenantId, MODULAR_PLAN_ID, 'MONTHLY');
    await validade.recordPaid(master.userId, master.sessionId, est.tenantId, { ...pago, expectedUpdatedAt: await versao(est.tenantId) });
    expect(await pricingFor(db.manager, est.tenantId, MODULAR_PLAN_ID, 'MONTHLY')).toEqual(contrato);
    expect(
      await codigo(assinaturas.setTeamLimit(master.userId, master.sessionId, est.tenantId, { expectedUpdatedAt: await versao(est.tenantId), teamUserLimit: 9 })),
    ).toBe('ASSINATURA_MODULAR');
  });

  it('só o proprietário da plataforma com senha confirmada altera; dono e administrador delegado não', async () => {
    const est = await estabelecimento('perm');
    const delegado = await conta('perm-admin', { role: 'MASTER_ADMIN' });
    await reauth(delegado);
    await reauth(est.dono);
    expect((await erroDe(mudar(est, {}, delegado))).constructor.name).toBe('ForbiddenException');
    expect((await erroDe(mudar(est, {}, est.dono))).constructor.name).toBe('ForbiddenException');
    expect(
      (await erroDe(assinaturas.setTeamLimit(est.dono.userId, est.dono.sessionId, est.tenantId, { expectedUpdatedAt: await versao(est.tenantId), teamUserLimit: 50 })))
        .constructor.name,
    ).toBe('ForbiddenException');
    const semReauth = await conta('perm-sem-reauth', { role: 'MASTER_OWNER' });
    expect(await codigo(mudar(est, {}, semReauth))).toBe('REAUTENTICACAO_NECESSARIA');
    expect(await n(`SELECT count(*)::int AS n FROM tenant_subscriptions WHERE tenant_id = $1`, [est.tenantId])).toBe(0);
  });

  it('Visão geral: operação sempre disponível; indicadores só com o adicional; cliente atual mantém tudo', async () => {
    const est = await estabelecimento('painel');
    const legadoBasico = await estabelecimento('painel-basico', 'plan_essencial');
    const antes = await painel.summary(legadoBasico.dono.userId, legadoBasico.tenantId, {});
    expect(antes.indicators.contracted).toBe(true);
    expect(webAnterior.ehPainel(antes)).toBe(true);
    await mudar(est, { addons: [], confirmRemoval: true });
    const sem = await painel.summary(est.dono.userId, est.tenantId, {});
    expect(sem).toMatchObject({ periodSummary: null, finance: null, indicators: { contracted: false } });
    expect(sem.todaySummary).toBeDefined();
    expect(Array.isArray(sem.upcoming)).toBe(true);
    expect(sem.plan.staffSeats.limit).toBe(5);
    await mudar(est, { addons: ['INDICADORES'] });
    const com = await painel.summary(est.dono.userId, est.tenantId, {});
    expect(com.indicators.contracted).toBe(true);
    expect(com.periodSummary).not.toBeNull();
  });

  it('compatibilidade: listas que o web anterior lê nunca trazem o plano modular', async () => {
    expect(await n(`SELECT count(*)::int AS n FROM plans WHERE id = $1`, [MODULAR_PLAN_ID])).toBe(1);
    const planos = await directory.plans(master.userId);
    expect(webAnterior.ehPlanos(planos)).toBe(true);
    expect((planos as { id: string }[]).some((p) => p.id === MODULAR_PLAN_ID)).toBe(false);
    expect(webAnterior.ehCatalogoDePrecos(await precos.catalog(master.userId))).toBe(true);
    // A mesma lista pela API anterior, com o plano já criado (volta da API
    // sem voltar a migration), quebraria o web anterior: por isso o plano só
    // nasce pela API nova, depois de a migration rodar com a API anterior.
    expect(webAnterior.ehPlanos(await q(webAnterior.LISTA_DE_PLANOS_DA_API_ANTERIOR))).toBe(false);
  });

  it('compatibilidade: a API anterior não consegue criar nem trocar estabelecimento para o plano modular', async () => {
    const criar = db.transaction((m) =>
      m.query(webAnterior.INSERCAO_DE_ESTABELECIMENTO_DA_API_ANTERIOR, [id(), `${marca}-api-anterior`, 'OTHER', TZ, MODULAR_PLAN_ID, new Date()]),
    );
    expect(await erroDe(criar)).toMatchObject({ constraint: 'ck_tenants_modular_subscription' });
    expect(await n(`SELECT count(*)::int AS n FROM tenants WHERE slug = $1`, [`${marca}-api-anterior`])).toBe(0);
    const legado = await estabelecimento('api-anterior-troca');
    const trocar = db.transaction((m) => m.query(webAnterior.TROCA_DE_PLANO_DA_API_ANTERIOR, [legado.tenantId, new Date(), MODULAR_PLAN_ID]));
    expect(await erroDe(trocar)).toMatchObject({ constraint: 'ck_tenants_modular_subscription' });
    expect(await q(`SELECT plan_id FROM tenants WHERE id = $1`, [legado.tenantId])).toEqual([{ plan_id: planoTeste }]);
  });

  it('compatibilidade: corpo de criação do web anterior recebe 403 sem permissão e 409 TELA_DESATUALIZADA com ela', async () => {
    const comum = await conta('compat-comum');
    expect((await erroDe(invites.refuseOutdatedCreation(comum.userId))).constructor.name).toBe('ForbiddenException');
    const recusa = await erroDe(invites.refuseOutdatedCreation(master.userId));
    expect(recusa.getResponse?.()).toMatchObject({ code: 'TELA_DESATUALIZADA' });
    expect(recusa.getResponse?.()?.message).toMatch(/Recarregue a página/);
  });

  it('cliente atual sem configuração: limite do plano, recursos e contrato iguais aos de antes', async () => {
    const est = await estabelecimento('intacto', planoDois);
    const uso = await staffSeatUsage(db.manager, est.tenantId, 2, new Date());
    expect((await vagas(est)).limit).toBe(2);
    expect(uso.limit).toBe(2);
    expect(await q(`SELECT team_user_limit FROM tenants WHERE id = $1`, [est.tenantId])).toEqual([{ team_user_limit: null }]);
    expect(await overrides(est.tenantId)).toEqual([]);
    const ficha = await assinaturas.view(master.userId, est.tenantId);
    expect(ficha).toMatchObject({ modular: false, teamUserLimit: { value: 2, source: 'PLAN' }, current: null });
  });
});
