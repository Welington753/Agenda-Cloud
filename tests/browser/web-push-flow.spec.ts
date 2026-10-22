// Web Push na área real — navegador real, backend real (com chaves VAPID
// geradas na hora, só para esta execução) e PostgreSQL descartável.
//
// O QUE ESTE TESTE PROVA: PWA instalável (manifesto, ícones, /sw.js sem
// cache); permissão pedida só no clique; estados ativado, desativado,
// bloqueado, não suportado e "instalar no iPhone"; inscrição gravada presa
// ao usuário/estabelecimento/sessão; desativar e sair desligam; tocar a
// notificação (a URL que o service worker abre) leva à solicitação certa,
// troca de estabelecimento quando a conta tem acesso, preserva o destino
// pelo login, recusa estabelecimento sem acesso e nunca confirma nada.
//
// O QUE ELE NÃO PROVA: recebimento num celular. O Chromium de teste não
// fala com o serviço de push do Google, então o PushManager é SIMULADO
// (inscrição com chaves P-256 de verdade, endpoint do FCM que nunca é
// chamado). Nenhuma mensagem sai: os pedidos são criados ANTES da ativação e
// o teste confere no banco que nenhuma tentativa de envio aconteceu. O
// recebimento real fica no roteiro físico (docs/runbooks/publicacao-piloto-render.md).
//
// Orçamento: 2 cadastros e 3 logins (limites de 5 por IP); 3 pedidos públicos.
// Invocação própria (`npm run test:browser:push`).
import { expect, request as novoContextoApi, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { Client } from "pg";
import { WEEKDAY_DA_DATA, instanteLocalDe } from "./data-de-teste";

const BACKEND_URL = "http://localhost:3001";
const SENHA = "senha-do-web-push-e2e-123";
const CELULAR = { width: 390, height: 844 };
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

/** Consulta direta ao banco descartável: recusa qualquer host fora do loopback. */
async function noBanco<T>(sql: string, valores: unknown[] = []): Promise<T[]> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL ausente: este teste só roda no ambiente descartável.");
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error(`recusado: ${host} não é o banco descartável`);
  const cliente = new Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
  await cliente.connect();
  try {
    return (await cliente.query(sql, valores)).rows as T[];
  } finally {
    await cliente.end();
  }
}

async function chamar<T>(api: APIRequestContext, metodo: string, caminho: string, corpo?: unknown) {
  const r = await api.fetch(`${BACKEND_URL}${caminho}`, { method: metodo, data: corpo });
  const texto = await r.text();
  expect(r.status(), `${metodo} ${caminho}: ${texto}`).toBeLessThan(300);
  return (texto ? JSON.parse(texto) : null) as T;
}

async function cadastrar(api: APIRequestContext, rotulo: string, sufixo: string) {
  const dados = {
    ownerName: `Dona ${rotulo}`,
    businessName: `Clínica ${rotulo} ${sufixo}`,
    email: `push-${rotulo.toLowerCase()}-${sufixo}@example.test`,
    phone: "11977775555",
    password: SENHA,
  };
  const r = await api.post(`${BACKEND_URL}/auth/register`, { data: dados });
  expect(r.status(), await r.text()).toBe(201);
  const me = await chamar<{ user: { id: string }; activeContext: { tenantId: string } }>(api, "GET", "/auth/me");
  const base = `/tenants/${me.activeContext.tenantId}`;
  const servico = await chamar<{ service: { id: string } }>(api, "POST", `${base}/services`, {
    name: "Consulta",
    shortDescription: "Avaliação",
    priceCents: 10000,
    priceVisible: true,
    durationMinutes: 60,
    bufferAfterMinutes: 0,
    modality: "IN_PERSON",
    activeInPublicBooking: true,
    requiresManualConfirmation: false,
  });
  const prof = await chamar<{ professional: { id: string } }>(api, "POST", `${base}/professionals`, {
    name: `Profissional ${rotulo}`,
    serviceIds: [servico.service.id],
  });
  await chamar(api, "PUT", `${base}/professionals/${prof.professional.id}/schedule`, {
    days: [{ weekday: WEEKDAY_DA_DATA, intervals: [{ start: "08:00", end: "18:00" }] }],
  });
  const { settings } = await chamar<{ settings: { slug: string } }>(api, "PUT", `${base}/public-booking`, { enabled: true });
  return { ...dados, userId: me.user.id, tenantId: me.activeContext.tenantId, slug: settings.slug, serviceId: servico.service.id, professionalId: prof.professional.id };
}

/**
 * PushManager e permissão SIMULADOS (o Chromium de teste não tem serviço de
 * push). A inscrição tem chaves P-256 reais (a API confere) e sobrevive a
 * recarregar a página, como no navegador de verdade.
 */
function simularPush(contexto: BrowserContext, opcoes: { permissao?: "default" | "denied" } = {}) {
  return contexto.addInitScript((permissaoInicial) => {
    const CHAVE = "__push_e2e";
    const ler = () => JSON.parse(localStorage.getItem(CHAVE) ?? "null") as
      | { permissao: string; json: PushSubscriptionJSON | null; chave: number[] | null; pedidos: number; cancelamentos: number }
      | null;
    const salvar = (v: object) => localStorage.setItem(CHAVE, JSON.stringify(v));
    if (!ler()) salvar({ permissao: permissaoInicial, json: null, chave: null, pedidos: 0, cancelamentos: 0 });
    const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    Object.defineProperty(Notification, "permission", { get: () => ler()!.permissao, configurable: true });
    Notification.requestPermission = async () => {
      const e = ler()!;
      e.pedidos += 1;
      if (e.permissao === "default") e.permissao = "granted";
      salvar(e);
      return e.permissao as NotificationPermission;
    };
    const montar = (e: NonNullable<ReturnType<typeof ler>>) =>
      e.json && {
        endpoint: e.json.endpoint,
        expirationTime: null,
        options: { userVisibleOnly: true, applicationServerKey: new Uint8Array(e.chave ?? []).buffer },
        toJSON: () => e.json,
        unsubscribe: async () => {
          const atual = ler()!;
          atual.json = null;
          atual.cancelamentos += 1;
          salvar(atual);
          return true;
        },
      };
    PushManager.prototype.getSubscription = async function () {
      return (montar(ler()!) || null) as unknown as PushSubscription | null;
    };
    PushManager.prototype.subscribe = async function (o?: PushSubscriptionOptionsInit) {
      const par = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
      const publica = new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey));
      const e = ler()!;
      e.json = {
        endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${b64(crypto.getRandomValues(new Uint8Array(12)))}`,
        expirationTime: null,
        keys: { p256dh: b64(publica), auth: b64(crypto.getRandomValues(new Uint8Array(16))) },
      };
      e.chave = [...new Uint8Array(o!.applicationServerKey as ArrayBuffer)];
      salvar(e);
      return montar(e) as unknown as PushSubscription;
    };
  }, opcoes.permissao ?? "default");
}

const estadoPush = (p: Page) => p.getByTestId("notificacoes-dispositivo");
const contadores = (p: Page) =>
  p.evaluate(() => JSON.parse(localStorage.getItem("__push_e2e") ?? "{}") as { pedidos: number; cancelamentos: number });

async function entrar(p: Page, email: string) {
  await p.getByLabel("E-mail").fill(email);
  await p.getByLabel("Senha").fill(SENHA);
  await p.getByRole("button", { name: "Entrar" }).click();
}

async function semRolagemHorizontal(p: Page) {
  const l = await p.evaluate(() => ({ conteudo: document.documentElement.scrollWidth, janela: window.innerWidth }));
  expect(l.conteudo).toBeLessThanOrEqual(l.janela);
}

test("Web Push: PWA, ativar neste dispositivo, estados, abrir a solicitação certa, sair desliga", async ({ page, context, browser }) => {
  test.setTimeout(180_000);

  // ------------------------------------------------ PWA instalável
  const manifesto = await page.request.get("/manifest.webmanifest");
  expect(manifesto.status()).toBe(200);
  const m = (await manifesto.json()) as { start_url: string; display: string; icons: { src: string; purpose?: string }[] };
  expect(m.start_url).toBe("/conta/visao-geral");
  expect(m.display).toBe("standalone");
  for (const icone of [...m.icons.map((i) => i.src), "/apple-icon"]) {
    const r = await page.request.get(icone);
    expect(r.status(), icone).toBe(200);
    expect(r.headers()["content-type"]).toContain("image/png");
  }
  expect(m.icons.some((i) => i.purpose === "maskable")).toBe(true);
  const sw = await page.request.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(sw.headers()["cache-control"]).toContain("no-store");
  expect(sw.headers()["content-type"]).toContain("javascript");
  expect(await sw.text()).not.toMatch(/addEventListener\(["']fetch|caches\./);

  // ------------------------------------------------ dois estabelecimentos, pedidos ANTES de ativar
  const sufixo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const apiA = await novoContextoApi.newContext();
  const apiB = await novoContextoApi.newContext();
  const anonimo = await novoContextoApi.newContext();
  const a = await cadastrar(apiA, "A", sufixo);
  const b = await cadastrar(apiB, "B", sufixo);
  const vinculoB = `e2ep${Date.now().toString(36)}`.slice(0, 30);
  await noBanco(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [vinculoB, a.userId, b.tenantId]);
  let telefone = 0;
  async function pedir(c: typeof a, hora: string) {
    telefone += 1;
    const r = await anonimo.post(`${BACKEND_URL}/public/${c.slug}/booking-requests`, {
      data: {
        serviceId: c.serviceId,
        professionalId: c.professionalId,
        startAt: instanteLocalDe(hora),
        name: "Cliente Sigilosa",
        whatsapp: `(11) 98777-${String(2000 + telefone)}`,
        idempotencyKey: `push-${telefone}-${sufixo}`.replace(/[^A-Za-z0-9_-]/g, ""),
      },
    });
    expect(r.status(), await r.text()).toBe(201);
    const [linha] = await noBanco<{ appointment_id: string }>(
      `SELECT appointment_id FROM booking_request_alerts WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [c.tenantId],
    );
    return linha.appointment_id;
  }
  const pedidoA = await pedir(a, "09:00");
  const pedidoB = await pedir(b, "10:00");
  // Evento registrado e já processado (ninguém inscrito ainda): nada a enviar.
  await expect
    .poll(async () => (await noBanco<{ status: string }>(`SELECT status FROM booking_request_alerts WHERE tenant_id IN ($1, $2)`, [a.tenantId, b.tenantId])).map((x) => x.status))
    .toEqual(["DONE", "DONE"]);

  // ------------------------------------------------ entrar, ativar SÓ no clique
  await simularPush(context);
  await page.goto("/login");
  await entrar(page, a.email);
  await expect(page).toHaveURL(/\/conta\/selecionar-estabelecimento$/);
  await page.getByRole("button", { name: new RegExp(a.businessName) }).click();
  await page.goto("/conta/solicitacoes");
  await expect(estadoPush(page)).toHaveAttribute("data-estado", "desativado");
  expect((await contadores(page)).pedidos, "abrir a tela não pede permissão").toBe(0);

  await page.getByTestId("ativar-push").click();
  await expect(estadoPush(page)).toHaveAttribute("data-estado", "ativado");
  expect((await contadores(page)).pedidos).toBe(1);
  const [inscrita] = await noBanco<{ user_id: string; status: string; endpoint: string; session_id: string }>(
    `SELECT user_id, status, endpoint, session_id FROM push_subscriptions WHERE tenant_id = $1`,
    [a.tenantId],
  );
  expect(inscrita).toMatchObject({ user_id: a.userId, status: "ACTIVE" });
  expect(inscrita.endpoint).toMatch(/^https:\/\/fcm\.googleapis\.com\//);
  // Service worker real registrado, sem nada em cache.
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration("/")))).toBe(true);
  expect(await page.evaluate(() => caches.keys())).toEqual([]);

  // Recarregar mantém "ativado" (confirmado pela API para esta sessão).
  await page.reload();
  await expect(estadoPush(page)).toHaveAttribute("data-estado", "ativado");

  // Desativar e ativar de novo.
  await page.getByTestId("desativar-push").click();
  await expect(estadoPush(page)).toHaveAttribute("data-estado", "desativado");
  expect((await noBanco<{ status: string }>(`SELECT status FROM push_subscriptions WHERE tenant_id = $1`, [a.tenantId]))[0].status).toBe("REVOKED");
  await page.getByTestId("ativar-push").click();
  await expect(estadoPush(page)).toHaveAttribute("data-estado", "ativado");

  // ------------------------------------------------ tocar a notificação: abrir a solicitação certa
  const escritas: string[] = [];
  page.on("request", (r) => {
    if (r.url().startsWith(BACKEND_URL) && r.method() !== "GET" && !r.url().endsWith("/push-subscription/status")) {
      escritas.push(`${r.method()} ${r.url()}`);
    }
  });
  await page.goto(`/conta/solicitacoes?estabelecimento=${a.tenantId}&solicitacao=${pedidoA}`);
  const cartaoA = page.locator(`[data-testid="solicitacao"][data-appointment-id="${pedidoA}"]`);
  await expect(cartaoA).toHaveAttribute("data-destacada", "true");
  await expect(cartaoA).toBeFocused();
  await expect(cartaoA).toContainText("Cliente Sigilosa");
  await expect(page).toHaveURL(/\/conta\/solicitacoes$/);

  // Outro estabelecimento da mesma conta: troca para ele, revalidado pela API.
  await page.goto(`/conta/solicitacoes?estabelecimento=${b.tenantId}&solicitacao=${pedidoB}`);
  await expect(page.getByTestId("estabelecimento-ativo")).toHaveText(b.businessName);
  await expect(page.locator(`[data-testid="solicitacao"][data-appointment-id="${pedidoB}"]`)).toHaveAttribute("data-destacada", "true");
  expect(escritas, "abrir a notificação não grava nada").toEqual([]);
  const status = await chamar<{ appointment: { status: string } }>(apiA, "GET", `/tenants/${a.tenantId}/appointments/${pedidoA}`);
  expect(status.appointment.status).toBe("PENDING");

  // Solicitação já respondida: aviso honesto, nada destacado.
  await chamar(apiB, "POST", `/tenants/${b.tenantId}/appointments/${pedidoB}/confirm`, {
    expectedStartAt: instanteLocalDe("10:00"),
  });
  await page.goto(`/conta/solicitacoes?estabelecimento=${b.tenantId}&solicitacao=${pedidoB}`);
  await expect(page.getByTestId("aviso-destino-notificacao")).toContainText("não está mais aguardando confirmação");

  // Vínculo removido: o estabelecimento some da sessão e nada dele abre.
  await noBanco(`DELETE FROM memberships WHERE id = $1`, [vinculoB]);
  await page.goto(`/conta/solicitacoes?estabelecimento=${b.tenantId}&solicitacao=${pedidoB}`);
  await expect(page.getByTestId("aviso-destino-notificacao")).toContainText("não acessa mais");
  await expect(page.getByTestId("estabelecimento-ativo")).toHaveText(a.businessName);
  await expect(page.locator(`[data-appointment-id="${pedidoB}"]`)).toHaveCount(0);

  // ------------------------------------------------ outros aparelhos (mesma sessão, sem novo login)
  // Mesma sessão (cookie), mas o "aparelho" começa sem a inscrição simulada.
  const estado = await context.storageState();
  const sessao = {
    ...estado,
    origins: estado.origins.map((o) => ({ ...o, localStorage: o.localStorage.filter((i) => i.name !== "__push_e2e") })),
  };
  async function aparelho(opcoes: { userAgent?: string; viewport?: { width: number; height: number } }, preparar: (c: BrowserContext) => Promise<unknown>) {
    const c = await browser.newContext({ storageState: sessao, ...opcoes });
    await preparar(c);
    const p = await c.newPage();
    await p.goto("/conta/solicitacoes");
    return { c, p };
  }
  const bloqueado = await aparelho({}, (c) => simularPush(c, { permissao: "denied" }));
  await expect(estadoPush(bloqueado.p)).toHaveAttribute("data-estado", "bloqueado");
  await expect(estadoPush(bloqueado.p)).toContainText("Bloqueado");
  await expect(bloqueado.p.getByTestId("ativar-push")).toHaveCount(0);
  await bloqueado.c.close();

  const semPush = await aparelho({}, (c) => c.addInitScript(() => delete (window as unknown as Record<string, unknown>).PushManager));
  await expect(estadoPush(semPush.p)).toHaveAttribute("data-estado", "nao_suportado");
  await semPush.c.close();

  const iphone = await aparelho({ userAgent: SAFARI_IPHONE, viewport: CELULAR }, (c) =>
    c.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).PushManager;
      delete (window as unknown as Record<string, unknown>).Notification;
    }),
  );
  await expect(estadoPush(iphone.p)).toHaveAttribute("data-estado", "instalar_no_iphone");
  await expect(estadoPush(iphone.p)).toContainText("Adicionar à Tela de Início");
  await semRolagemHorizontal(iphone.p);
  await estadoPush(iphone.p).scrollIntoViewIfNeeded();
  await iphone.p.screenshot({ path: test.info().outputPath("push-iphone-instalar.png"), animations: "disabled" });
  await iphone.c.close();

  // Celular Android (permissão concedida, ativado): tela sem rolagem lateral.
  await page.setViewportSize(CELULAR);
  await page.goto("/conta/solicitacoes");
  await expect(estadoPush(page)).toHaveAttribute("data-estado", "ativado");
  await semRolagemHorizontal(page);
  await estadoPush(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("push-celular-ativado.png"), animations: "disabled" });

  // ------------------------------------------------ sair desliga este aparelho
  // "Sair" fica no menu da conta.

  await page.getByTestId("abrir-menu-conta").click();

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await contadores(page)).cancelamentos).toBeGreaterThanOrEqual(1);
  const [depoisDeSair] = await noBanco<{ status: string; revoked_at: Date | null }>(
    `SELECT s.status, se.revoked_at FROM push_subscriptions s JOIN sessions se ON se.id = s.session_id WHERE s.tenant_id = $1`,
    [a.tenantId],
  );
  expect(depoisDeSair.status === "REVOKED" || depoisDeSair.revoked_at !== null).toBe(true);

  // ------------------------------------------------ sem sessão: o destino sobrevive ao login
  await page.goto(`/conta/solicitacoes?estabelecimento=${a.tenantId}&solicitacao=${pedidoA}`);
  await expect(page).toHaveURL(/\/login\?next=/);
  await entrar(page, a.email);
  await expect(page.locator(`[data-testid="solicitacao"][data-appointment-id="${pedidoA}"]`)).toHaveAttribute("data-destacada", "true");
  // Nova sessão não herda a ativação anterior.
  await expect(estadoPush(page)).toHaveAttribute("data-estado", "desativado");

  // Nenhuma tentativa de envio aconteceu (nenhum serviço externo chamado).
  const [{ total }] = await noBanco<{ total: number }>(
    `SELECT count(*)::int AS total FROM push_deliveries WHERE tenant_id IN ($1, $2)`,
    [a.tenantId, b.tenantId],
  );
  expect(total).toBe(0);

  await Promise.all([apiA.dispose(), apiB.dispose(), anonimo.dispose()]);
});
