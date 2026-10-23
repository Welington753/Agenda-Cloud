// Avisos de NOVAS solicitações dentro da área /conta — navegador real,
// backend real e PostgreSQL descartável.
//
// Prova, de ponta a ponta: o pedido feito pelo link público aparece como
// aviso em OUTRA página da conta, e o contador e a lista se atualizam sem
// recarregar; o que já estava pendente ao entrar não avisa; a mesma
// solicitação nunca avisa duas vezes; a consulta é sequencial, para com a
// página oculta ou sem conexão e volta na hora ao reaparecer; "Ver
// solicitação" só destaca o cartão (nenhuma escrita na API) e as ações
// existentes continuam respondendo; o som é opcional e, bloqueado, não tira o
// aviso visual; trocar de estabelecimento descarta avisos e leituras do
// anterior; sair encerra as consultas; computador e celular.
//
// O relógio do navegador é o de teste do Playwright (`page.clock`): o
// intervalo real de 30 s é avançado com `runFor`, sem esperar de verdade.
//
// O SEGUNDO VÍNCULO não tem rota no backend (não há convite): é gravado
// direto no PostgreSQL DESCARTÁVEL, e a conexão se recusa a abrir fora do
// loopback — nunca Neon, nunca banco existente.
//
// Orçamento: 2 cadastros e 1 login (limites reais de 5 por IP); 8 pedidos
// públicos (limite de 10 por hora por IP), cada um com um telefone. Invocação
// própria (`npm run test:browser:avisos-solicitacoes`).
import { criarContaDeTeste as contaPorConvite } from "./support/contas-de-teste";
import { expect, request as novoContextoApi, test, type APIRequestContext, type Page } from "@playwright/test";
import { Client } from "pg";
import { DATA, WEEKDAY_DA_DATA, instanteLocalDe } from "./data-de-teste";

const BACKEND_URL = "http://localhost:3001";
const SENHA = "senha-dos-avisos-de-solicitacoes-123";
const COMPUTADOR = { width: 1280, height: 800 };
const CELULAR = { width: 390, height: 844 };
const INTERVALO = 30_000;
const dataBr = DATA.split("-").reverse().join("/");

/** Fixture direto no banco descartável: recusa qualquer host fora do loopback. */
async function noBancoDescartavel(sql: string, valores: unknown[]): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL ausente: este teste só roda no ambiente descartável.");
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`recusado: ${host} não é o PostgreSQL descartável local`);
  }
  const cliente = new Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
  await cliente.connect();
  try {
    await cliente.query(sql, valores);
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
    businessName: `Estúdio ${rotulo} ${sufixo}`,
    email: `avisos-${rotulo.toLowerCase()}-${sufixo}@example.test`,
    phone: "11977774444",
    password: SENHA,
  };
  await contaPorConvite(api, dados);
  const me = await chamar<{ user: { id: string }; activeContext: { tenantId: string } }>(api, "GET", "/auth/me");
  return { ...dados, userId: me.user.id, tenantId: me.activeContext.tenantId };
}

/** Rotas de leitura das solicitações chamadas pela página. */
function vigiarConsultas(page: Page) {
  const urls: string[] = [];
  let emVoo = 0;
  let maximoEmVoo = 0;
  const ehConsulta = (url: string, metodo: string) =>
    metodo === "GET" && new URL(url).pathname.endsWith("/booking-requests");
  page.on("request", (r) => {
    if (!ehConsulta(r.url(), r.method())) return;
    urls.push(r.url());
    emVoo += 1;
    maximoEmVoo = Math.max(maximoEmVoo, emVoo);
  });
  const terminou = (r: { url(): string; method(): string }) => {
    if (ehConsulta(r.url(), r.method())) emVoo -= 1;
  };
  page.on("requestfinished", terminou);
  page.on("requestfailed", terminou);
  return { urls, emVoo: () => emVoo, maximoEmVoo: () => maximoEmVoo };
}

type Consultas = ReturnType<typeof vigiarConsultas>;

/** Nenhuma consulta em voo. */
async function ocioso(consultas: Consultas) {
  await expect.poll(() => consultas.emVoo()).toBe(0);
}

/** Avança o relógio do navegador um intervalo e espera a consulta seguinte. */
async function proximaConsulta(page: Page, consultas: Consultas) {
  await ocioso(consultas);
  const antes = consultas.urls.length;
  await page.clock.runFor(INTERVALO + 1_000);
  await expect.poll(() => consultas.urls.length).toBeGreaterThan(antes);
  await ocioso(consultas);
}

async function definirVisibilidade(page: Page, oculta: boolean) {
  await page.evaluate((ocultar) => {
    if (ocultar) {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
    } else {
      delete (document as unknown as Record<string, unknown>).visibilityState;
      delete (document as unknown as Record<string, unknown>).hidden;
    }
    document.dispatchEvent(new Event("visibilitychange"));
  }, oculta);
}

async function semRolagemHorizontal(p: Page) {
  const l = await p.evaluate(() => ({ conteudo: document.documentElement.scrollWidth, janela: window.innerWidth }));
  expect(l.conteudo).toBeLessThanOrEqual(l.janela);
}

test("avisos de novas solicitações: chegam sem recarregar, sem repetir, pausam, trocam de estabelecimento", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize(COMPUTADOR);
  const errosDaPagina: string[] = [];
  page.on("pageerror", (e) => errosDaPagina.push(e.message));

  // ------------------------------------------------ estabelecimentos A e B
  const sufixo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const apiA = await novoContextoApi.newContext();
  const apiB = await novoContextoApi.newContext();
  const anonimo = await novoContextoApi.newContext();
  const a = await cadastrar(apiA, "A", sufixo);
  const b = await cadastrar(apiB, "B", sufixo);
  await noBancoDescartavel(`INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`, [
    `e2ea${Date.now().toString(36)}`.slice(0, 30),
    a.userId,
    b.tenantId,
  ]);

  const baseA = `/tenants/${a.tenantId}`;
  const servico = await chamar<{ service: { id: string } }>(apiA, "POST", `${baseA}/services`, {
    name: "Sessão de massagem",
    shortDescription: "Relaxante",
    priceCents: 9000,
    priceVisible: true,
    durationMinutes: 60,
    bufferAfterMinutes: 0,
    modality: "IN_PERSON",
    activeInPublicBooking: true,
    requiresManualConfirmation: false,
  });
  const prof = await chamar<{ professional: { id: string } }>(apiA, "POST", `${baseA}/professionals`, {
    name: "Rita Massagista",
    serviceIds: [servico.service.id],
  });
  await chamar(apiA, "PUT", `${baseA}/professionals/${prof.professional.id}/schedule`, {
    days: [{ weekday: WEEKDAY_DA_DATA, intervals: [{ start: "08:00", end: "18:00" }] }],
  });
  const { settings } = await chamar<{ settings: { slug: string } }>(apiA, "PUT", `${baseA}/public-booking`, {
    enabled: true,
  });

  let telefone = 0;
  /** Pedido pelo link público, sem sessão (como um cliente faria). */
  async function pedir(nome: string, hora: string) {
    telefone += 1;
    const r = await anonimo.post(`${BACKEND_URL}/public/${settings.slug}/booking-requests`, {
      data: {
        serviceId: servico.service.id,
        professionalId: prof.professional.id,
        startAt: instanteLocalDe(hora),
        name: nome,
        whatsapp: `(11) 98888-${String(1000 + telefone)}`,
        idempotencyKey: `aviso-${telefone}-${sufixo}`.replace(/[^A-Za-z0-9_-]/g, ""),
      },
    });
    expect(r.status(), await r.text()).toBe(201);
  }

  const aviso = (nome: string) => page.getByTestId("aviso-nova-solicitacao").filter({ hasText: nome });
  const avisos = page.getByTestId("aviso-nova-solicitacao");

  // ------------------------------------------------ pedido ANTES de entrar
  await pedir("Ana Antiga", "08:00");

  await page.clock.install();
  const consultas = vigiarConsultas(page);
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(a.email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/conta\/selecionar-estabelecimento$/);
  await page.getByRole("button", { name: new RegExp(a.businessName) }).click();
  await expect(page).toHaveURL(/\/conta\/visao-geral$/);

  // Pendente de antes: na lista e no contador, sem aviso — nem agora, nem depois.
  await expect(page.getByTestId("contador-solicitacoes")).toContainText("1");
  await proximaConsulta(page, consultas);
  await expect(avisos).toHaveCount(0);

  // Link público fácil de achar na Visão geral: copiar e abrir.
  const link = `http://localhost:3000/agendar/${settings.slug}`;
  await expect(page.getByTestId("atalho-link-publico-url")).toHaveText(link);
  await expect(page.getByTestId("abrir-pagina-publica")).toHaveAttribute("href", link);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByTestId("copiar-link").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

  // ------------------------------------------------ novo pedido em OUTRA página
  await page.getByRole("link", { name: "Clientes" }).click();
  await expect(page).toHaveURL(/\/conta\/clientes$/);
  // Marca na janela: some se a página recarregar.
  await page.evaluate(() => ((window as unknown as Record<string, unknown>).__semRecarregar = true));
  await pedir("Bia Nova", "09:00");
  await proximaConsulta(page, consultas);
  await expect(aviso("Bia Nova")).toHaveCount(1);
  await expect(aviso("Bia Nova").getByTestId("aviso-nova-solicitacao-texto")).toHaveText(
    `Bia Nova pediu Sessão de massagem com Rita Massagista, ${dataBr} às 09:00.`,
  );
  await expect(page.getByTestId("contador-solicitacoes")).toContainText("2");
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__semRecarregar)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("avisos-computador.png"), animations: "disabled" });

  // Nunca o mesmo aviso duas vezes; fechado, não volta.
  await proximaConsulta(page, consultas);
  await proximaConsulta(page, consultas);
  await expect(aviso("Bia Nova")).toHaveCount(1);
  await aviso("Bia Nova").getByTestId("fechar-aviso-solicitacao").click();
  await expect(avisos).toHaveCount(0);
  await proximaConsulta(page, consultas);
  await expect(avisos).toHaveCount(0);
  expect(consultas.maximoEmVoo(), "uma consulta por vez").toBe(1);

  // ------------------------------------------------ página oculta: nenhuma consulta
  await definirVisibilidade(page, true);
  await ocioso(consultas);
  const antesDeOcultar = consultas.urls.length;
  await pedir("Caio Oculto", "10:00");
  await page.clock.runFor(INTERVALO * 4);
  expect(consultas.urls.length, "oculta, não consulta").toBe(antesDeOcultar);
  await expect(avisos).toHaveCount(0);
  // Visível de novo: consulta na hora, sem esperar o intervalo.
  await definirVisibilidade(page, false);
  await expect(aviso("Caio Oculto")).toHaveCount(1);
  expect(consultas.urls.length).toBe(antesDeOcultar + 1);

  // ------------------------------------------------ "Ver solicitação" não grava nada
  const escritas: string[] = [];
  page.on("request", (r) => {
    if (r.url().startsWith(BACKEND_URL) && r.method() !== "GET") escritas.push(`${r.method()} ${r.url()}`);
  });
  await aviso("Caio Oculto").getByTestId("ver-solicitacao").click();
  await expect(page).toHaveURL(/\/conta\/solicitacoes#solicitacao-/);
  const cartaoCaio = page.getByTestId("lista-solicitacoes").getByTestId("solicitacao").filter({ hasText: "Caio Oculto" });
  await expect(cartaoCaio).toHaveAttribute("data-destacada", "true");
  await expect(cartaoCaio).toBeFocused();
  await expect(avisos).toHaveCount(0);
  await expect(cartaoCaio.getByTestId("contato-manual")).toContainText("Contato manual pelo WhatsApp");
  await ocioso(consultas);
  expect(escritas, "abrir o aviso não escreve nada").toEqual([]);
  const idCaio = await cartaoCaio.getAttribute("data-appointment-id");
  const pendente = await chamar<{ appointment: { status: string } }>(apiA, "GET", `${baseA}/appointments/${idCaio}`);
  expect(pendente.appointment.status).toBe("PENDING");
  // As ações existentes continuam respondendo (com expectedStartAt).
  await cartaoCaio.getByTestId("confirmar-solicitacao").click();
  await expect(cartaoCaio).toHaveCount(0);
  const confirmado = await chamar<{ appointment: { status: string } }>(apiA, "GET", `${baseA}/appointments/${idCaio}`);
  expect(confirmado.appointment.status).toBe("CONFIRMED");
  expect(escritas).toEqual([`POST ${BACKEND_URL}${baseA}/appointments/${idCaio}/confirm`]);

  // ------------------------------------------------ sem conexão: pausa e volta
  const lista = page.getByTestId("lista-solicitacoes").getByTestId("solicitacao");
  await expect(lista).toHaveCount(2);
  await ocioso(consultas);
  await context.setOffline(true);
  const antesDeCair = consultas.urls.length;
  await pedir("Davi Offline", "11:00");
  await page.clock.runFor(INTERVALO * 3);
  expect(consultas.urls.length, "offline, não consulta").toBe(antesDeCair);
  await expect(lista).toHaveCount(2);
  await context.setOffline(false);
  await expect(aviso("Davi Offline")).toHaveCount(1);
  await expect(lista.filter({ hasText: "Davi Offline" })).toHaveCount(1);

  // ------------------------------------------------ som opcional
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__bipes = 0;
    w.__bloquearSom = false;
    class AudioFalso {
      state = "running";
      currentTime = 0;
      destination = {};
      resume() {
        return Promise.resolve();
      }
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n: unknown) => n };
      }
      createOscillator() {
        if (w.__bloquearSom) throw new Error("NotAllowedError: áudio bloqueado");
        return {
          type: "",
          frequency: { value: 0 },
          connect: (n: unknown) => n,
          start: () => {
            w.__bipes = (w.__bipes as number) + 1;
          },
          stop() {},
        };
      }
    }
    w.AudioContext = AudioFalso;
  });
  await page.getByTestId("som-dos-avisos").check();
  const bipes = () => page.evaluate(() => (window as unknown as Record<string, number>).__bipes);
  expect(await bipes(), "bipe de amostra ao ligar").toBe(1);
  await pedir("Eva Som", "12:00");
  await proximaConsulta(page, consultas);
  await expect(aviso("Eva Som")).toHaveCount(1);
  expect(await bipes()).toBe(2);
  // Navegador bloqueia o áudio: o aviso visual chega do mesmo jeito.
  await page.evaluate(() => ((window as unknown as Record<string, unknown>).__bloquearSom = true));
  await pedir("Fábio Mudo", "13:00");
  await proximaConsulta(page, consultas);
  await expect(aviso("Fábio Mudo")).toHaveCount(1);
  expect(await bipes()).toBe(2);

  // ------------------------------------------------ trocar de estabelecimento
  await page.getByRole("link", { name: "Trocar de estabelecimento" }).click();
  await page.getByRole("button", { name: new RegExp(b.businessName) }).click();
  await expect(page.getByTestId("estabelecimento-ativo")).toHaveText(b.businessName);
  await expect(avisos).toHaveCount(0);
  await expect(page.getByTestId("contador-solicitacoes")).toHaveCount(0);
  const desdeATroca = consultas.urls.length;
  await pedir("Gil Outro", "14:00");
  await proximaConsulta(page, consultas);
  await expect(avisos).toHaveCount(0);
  const depois = consultas.urls.slice(desdeATroca);
  expect(depois.length).toBeGreaterThan(0);
  expect(depois.every((u) => u.includes(`/tenants/${b.tenantId}/`)), "só o estabelecimento ativo").toBe(true);
  // De volta ao A: Gil chegou enquanto estava no B — na lista, sem aviso.
  await page.getByRole("link", { name: "Trocar de estabelecimento" }).click();
  await page.getByRole("button", { name: new RegExp(a.businessName) }).click();
  await expect(page.getByTestId("estabelecimento-ativo")).toHaveText(a.businessName);
  await expect(page.getByTestId("contador-solicitacoes")).toContainText("6");
  await proximaConsulta(page, consultas);
  await expect(avisos).toHaveCount(0);

  // ------------------------------------------------ celular
  await page.setViewportSize(CELULAR);
  await pedir("Hugo Celular", "15:00");
  await proximaConsulta(page, consultas);
  await expect(aviso("Hugo Celular")).toBeVisible();
  await expect(page.getByTestId("contador-mais")).toBeVisible();
  const caixa = await aviso("Hugo Celular").boundingBox();
  expect(caixa).not.toBeNull();
  expect(caixa!.x).toBeGreaterThanOrEqual(0);
  expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(CELULAR.width);
  await semRolagemHorizontal(page);
  await page.screenshot({ path: test.info().outputPath("avisos-celular.png"), animations: "disabled" });
  await aviso("Hugo Celular").getByTestId("ver-solicitacao").click();
  await expect(
    page.getByTestId("lista-solicitacoes").getByTestId("solicitacao").filter({ hasText: "Hugo Celular" }),
  ).toHaveAttribute("data-destacada", "true");
  await semRolagemHorizontal(page);
  await page.setViewportSize(COMPUTADOR);

  // ------------------------------------------------ sair encerra as consultas
  // "Sair" fica no menu da conta.

  await page.getByTestId("abrir-menu-conta").click();

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await ocioso(consultas);
  const aoSair = consultas.urls.length;
  await page.clock.runFor(INTERVALO * 3);
  expect(consultas.urls.length, "depois de sair, nenhuma consulta").toBe(aoSair);
  expect(consultas.maximoEmVoo(), "uma consulta por vez").toBe(1);
  expect(errosDaPagina).toEqual([]);

  await Promise.all([apiA.dispose(), apiB.dispose(), anonimo.dispose()]);
});
