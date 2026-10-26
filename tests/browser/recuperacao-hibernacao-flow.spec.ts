// Abertura do sistema enquanto a hospedagem gratuita (Render) acorda —
// navegador real, backend real, sessão real em cookie HttpOnly e PostgreSQL
// descartável. Só o "servidor dormindo" é simulado, com `page.route`:
// - 502 em HTML, como a borda do Render responde no lugar da API;
// - requisição pendurada, como a borda segurando a conexão enquanto o
//   serviço sobe.
// O tempo da página é o relógio do Playwright (`page.clock`): esperas e
// prazos andam pelo teste, sem sleeps.
//
// Prova: só LEITURAS se repetem (sessão, página pública, horários), uma por
// vez, dentro de um prazo total que conta o tempo das requisições; 401, 403,
// 429 e erro da própria API nunca viram "servidor acordando"; offline nada é
// enviado; voltar ao aplicativo reconecta sem perder o que foi digitado; e
// login e pedido público nunca são reenviados sozinhos.
//
// Orçamento: 1 cadastro e 1 login (limites reais de 5 por IP); 2 pedidos
// públicos (limite de 10 por hora). Invocação própria
// (`npm run test:browser:recuperacao`).
import { criarContaDeTeste as contaPorConvite } from "./support/contas-de-teste";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";
import { DATA, WEEKDAY_DA_DATA } from "./data-de-teste";

const BACKEND_URL = "http://localhost:3001";
const SENHA = "senha-da-recuperacao-123";
const AUTH_ME = "**/auth/me";
const BORDA_502 = { status: 502, contentType: "text/html; charset=utf-8", body: "<html><body>Bad Gateway</body></html>" };
const rotuloDoDia = (data: string) => {
  const semana = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][new Date(`${data}T12:00:00Z`).getUTCDay()];
  return `${semana} ${data.slice(8, 10)}/${data.slice(5, 7)}`;
};
// Um dia SEM jornada (só domingo tem), sempre dentro da lista do link público
// (DIAS_OFERECIDOS = 14, de hoje a hoje + 13). `DATA` cai entre hoje + 7 e
// hoje + 13; o dia SEGUINTE a ela saía da lista quando `DATA` era hoje + 13
// (execução numa segunda-feira). O dia ANTERIOR (sábado) fica entre hoje + 6
// e hoje + 12.
const DIA_SEM_JORNADA = new Date(Date.parse(`${DATA}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

type EstadoDoNavegador = Exclude<BrowserContextOptions["storageState"], string | undefined>;

let sessaoDoDono: EstadoDoNavegador;
let email: string;
let slug: string;
let tenantId: string;

test.beforeAll(async ({ browser }) => {
  const contexto = await browser.newContext();
  const sufixo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  email = `playwright-recuperacao-${sufixo}@example.test`;
  const api = contexto.request;
  await contaPorConvite(api, {
      ownerName: "Rita Recuperação",
      businessName: `Estúdio Recuperação ${sufixo}`,
      email,
      phone: "11977770009",
      password: SENHA,
    });
  const me = await (await api.get(`${BACKEND_URL}/auth/me`)).json();
  tenantId = me.activeContext.tenantId;
  const base = `${BACKEND_URL}/tenants/${tenantId}`;
  const servico = await api.post(`${base}/services`, {
    data: {
      name: "Corte",
      shortDescription: "Corte simples",
      priceCents: 5000,
      priceVisible: true,
      durationMinutes: 60,
      bufferAfterMinutes: 0,
      modality: "IN_PERSON",
      activeInPublicBooking: true,
      requiresManualConfirmation: false,
    },
  });
  expect(servico.status()).toBe(201);
  const serviceId = (await servico.json()).service.id;
  const prof = await api.post(`${base}/professionals`, { data: { name: "Bia Corte", serviceIds: [serviceId] } });
  expect(prof.status()).toBe(201);
  const professionalId = (await prof.json()).professional.id;
  const jornada = await api.put(`${base}/professionals/${professionalId}/schedule`, {
    data: { days: [{ weekday: WEEKDAY_DA_DATA, intervals: [{ start: "09:00", end: "11:00" }] }] },
  });
  expect(jornada.status()).toBe(200);
  const online = await api.put(`${base}/public-booking`, { data: { enabled: true } });
  expect(online.status()).toBe(200);
  slug = (await online.json()).settings.slug;
  sessaoDoDono = await contexto.storageState();
  await contexto.close();
});

async function comSessao(browser: Browser): Promise<{ contexto: BrowserContext; page: Page }> {
  const contexto = await browser.newContext({ storageState: sessaoDoDono });
  return { contexto, page: await contexto.newPage() };
}

async function cookieDeSessao(page: Page): Promise<string | undefined> {
  return (await page.context().cookies(BACKEND_URL)).find((c) => c.name === "session_token")?.value;
}

/** Conta as requisições que casam com `filtro` e o máximo simultâneo. */
function contarRequisicoes(page: Page, filtro: (r: Request) => boolean) {
  const registro = { total: 0, emVoo: 0, maxEmVoo: 0 };
  page.on("request", (r) => {
    if (!filtro(r)) return;
    registro.total += 1;
    registro.emVoo += 1;
    registro.maxEmVoo = Math.max(registro.maxEmVoo, registro.emVoo);
  });
  const fim = (r: Request) => {
    if (filtro(r)) registro.emVoo -= 1;
  };
  page.on("requestfinished", fim);
  page.on("requestfailed", fim);
  return registro;
}

const ehAuthMe = (r: Request) => new URL(r.url()).pathname === "/auth/me";

/** /auth/me "dormindo": a resposta de cada leitura vem de `comportamento`
 * (pela ordem); `undefined` segue para a API real. "pendurar" segura a
 * requisição até a página desistir dela. */
async function apiDormindo(page: Page, comportamento: (n: number) => "502" | "pendurar" | undefined) {
  const registro = { leituras: 0 };
  await page.route(AUTH_ME, async (rota: Route) => {
    registro.leituras += 1;
    const acao = comportamento(registro.leituras);
    if (acao === "502") return rota.fulfill(BORDA_502);
    if (acao === "pendurar") return; // nunca responde; a página cancela.
    return rota.continue();
  });
  return registro;
}

/** Avança o relógio da página até `condicao()` valer. */
async function avancarAte(page: Page, condicao: () => Promise<boolean> | boolean, passoMs = 2_000) {
  await expect
    .poll(
      async () => {
        if (await condicao()) return true;
        await page.clock.runFor(passoMs);
        return condicao();
      },
      { timeout: 50_000, intervals: [50] },
    )
    .toBe(true);
}

test.describe("sessão (/conta e login)", () => {
  test("API acordando (requisição pendurada e 502 da borda): conectando, recupera sozinha, mesma sessão", async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const { contexto, page } = await comSessao(browser);
    const cookieAntes = await cookieDeSessao(page);
    expect(cookieAntes).toBeTruthy();
    await page.clock.install();
    const requisicoes = contarRequisicoes(page, ehAuthMe);
    const api = await apiDormindo(page, (n) => (n === 1 ? "pendurar" : n <= 3 ? "502" : undefined));

    await page.goto("/conta");
    await expect.poll(() => api.leituras).toBe(1);
    // Ainda sem falha nenhuma: só demora. Depois de 3 s a tela já explica.
    await page.clock.runFor(3_000);
    await expect(page.getByTestId("conexao-acordando")).toContainText("Conectando ao servidor");
    await expect(page.getByText("Não foi possível conectar ao servidor")).toHaveCount(0);
    await expect(page).toHaveURL(/\/conta$/);

    // A tentativa pendurada é cancelada no limite (30 s) e as seguintes
    // continuam, uma por vez.
    await avancarAte(page, () => api.leituras >= 4);
    await expect(page.getByText("Dono(a)")).toBeVisible();
    await expect(page.getByTestId("conexao-acordando")).toHaveCount(0);
    expect(api.leituras).toBe(4);
    expect(requisicoes.maxEmVoo).toBe(1);
    expect(await cookieDeSessao(page)).toBe(cookieAntes);
    await contexto.close();
  });

  test("falha persistente: prazo total esgota, mensagem útil, nenhuma leitura depois; o botão recupera", async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const { contexto, page } = await comSessao(browser);
    const cookieAntes = await cookieDeSessao(page);
    await page.clock.install();
    let apiFora = true;
    const api = await apiDormindo(page, () => (apiFora ? "502" : undefined));

    await page.goto("/conta");
    const inicio = await page.evaluate(() => Date.now());
    const falha = page.getByRole("heading", { name: "Não foi possível conectar ao servidor" });
    await avancarAte(page, async () => (await falha.count()) > 0, 5_000);
    const fim = await page.evaluate(() => Date.now());

    await expect(page.getByTestId("motivo-falha-sessao")).toContainText("O servidor não respondeu a tempo");
    // Prazo total de 100 s, contando requisições e esperas.
    expect(fim - inicio).toBeLessThanOrEqual(100_000);
    const leiturasNaFalha = api.leituras;
    expect(leiturasNaFalha).toBeGreaterThanOrEqual(5);
    expect(leiturasNaFalha).toBeLessThanOrEqual(10);
    await expect(page).toHaveURL(/\/conta$/);

    // Terminou: o tempo passa e nada mais é consultado sozinho.
    await page.clock.runFor(10 * 60_000);
    expect(api.leituras).toBe(leiturasNaFalha);

    apiFora = false;
    await page.getByRole("button", { name: "Tentar novamente" }).click();
    await expect(page.getByText("Dono(a)")).toBeVisible();
    expect(api.leituras).toBe(leiturasNaFalha + 1);
    expect(await cookieDeSessao(page)).toBe(cookieAntes);
    await contexto.close();
  });

  for (const status of [403, 429, 500]) {
    test(`${status} da própria API em /auth/me: erro real na hora, nunca "servidor acordando"`, async ({
      browser,
    }) => {
      const { contexto, page } = await comSessao(browser);
      await page.clock.install();
      let leituras = 0;
      await page.route(AUTH_ME, (rota) => {
        leituras += 1;
        return rota.fulfill({ status, contentType: "application/json", body: JSON.stringify({ statusCode: status }) });
      });
      await page.goto("/conta");
      await expect(page.getByTestId("motivo-falha-sessao")).toContainText("O servidor respondeu com um erro");
      await page.clock.runFor(5 * 60_000);
      expect(leituras).toBe(1);
      await expect(page.getByTestId("conexao-acordando")).toHaveCount(0);
      await expect(page).toHaveURL(/\/conta$/);
      await contexto.close();
    });
  }

  test("sem internet: nada é enviado enquanto offline; a volta da conexão recupera sozinha", async ({ browser }) => {
    test.setTimeout(60_000);
    const { contexto, page } = await comSessao(browser);
    await page.clock.install();
    const api = await apiDormindo(page, (n) => (n === 1 ? "502" : undefined));
    const requisicoes = contarRequisicoes(page, ehAuthMe);

    await page.goto("/conta");
    await expect.poll(() => api.leituras).toBe(1);
    await contexto.setOffline(true);
    await avancarAte(page, async () => (await page.getByTestId("conexao-sem-internet").count()) > 0);
    const durante = requisicoes.total;
    await page.clock.runFor(10 * 60_000);
    expect(requisicoes.total, "nenhuma requisição offline").toBe(durante);
    await expect(page.getByText("Não foi possível conectar ao servidor")).toHaveCount(0);

    await contexto.setOffline(false);
    await expect(page.getByText("Dono(a)")).toBeVisible();
    expect(api.leituras).toBe(2);
    await contexto.close();
  });

  test("volta ao aplicativo (iPhone) com a API dormindo: faixa de reconexão, formulário preservado", async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const { contexto, page } = await comSessao(browser);
    const cookieAntes = await cookieDeSessao(page);
    await page.clock.install();
    let dormindo = false;
    const api = await apiDormindo(page, () => (dormindo ? "502" : undefined));
    const escritas: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET") escritas.push(`${r.method()} ${r.url()}`);
    });

    await page.goto("/conta/clientes");
    await page.getByRole("button", { name: "Novo cliente" }).click();
    await page.getByLabel("WhatsApp").fill("(11) 98888-1234");
    await page.getByLabel("E-mail (opcional)").fill("ana@example.com");
    const leiturasAntes = api.leituras;

    // Aplicativo em segundo plano por 20 min; a API hiberna nesse tempo.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.runFor(20 * 60_000);
    dormindo = true;
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await expect.poll(() => api.leituras).toBe(leiturasAntes + 1);
    await page.clock.runFor(3_000);
    await expect(page.getByTestId("faixa-conexao-acordando")).toBeVisible();
    // A tela não foi trocada por carregamento: o formulário continua ali.
    await expect(page.getByLabel("WhatsApp")).toHaveValue("(11) 98888-1234");

    dormindo = false;
    await avancarAte(page, async () => (await page.getByTestId("faixa-conexao-acordando").count()) === 0);
    await expect(page.getByLabel("WhatsApp")).toHaveValue("(11) 98888-1234");
    await expect(page.getByLabel("E-mail (opcional)")).toHaveValue("ana@example.com");
    expect(escritas, "voltar ao aplicativo nunca grava nada").toEqual([]);
    expect(await cookieDeSessao(page)).toBe(cookieAntes);

    // Retorno pela memória do Safari (bfcache): confere a sessão uma vez.
    const antesDoPageshow = api.leituras;
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await expect.poll(() => api.leituras).toBe(antesDoPageshow + 1);
    await expect(page.getByLabel("WhatsApp")).toHaveValue("(11) 98888-1234");
    await contexto.close();
  });

  test("login com a API acordando: o envio espera, o digitado fica e sai UM login", async ({ browser }) => {
    test.setTimeout(60_000);
    const contexto = await browser.newContext();
    const page = await contexto.newPage();
    await page.clock.install();
    const api = await apiDormindo(page, (n) => (n <= 2 ? "502" : undefined));
    let logins = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && new URL(r.url()).pathname === "/auth/login") logins += 1;
    });

    await page.goto("/login?next=%2Fconta%2Fclientes");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.clock.runFor(3_000);
    await expect(page.getByTestId("faixa-conexao-acordando")).toBeVisible();
    const botao = page.getByRole("button", { name: "Aguardando o servidor..." });
    await expect(botao).toBeDisabled();
    await page.getByLabel("Senha").press("Enter");
    expect(logins, "Enter durante a espera não envia").toBe(0);

    await avancarAte(page, () => api.leituras >= 3);
    await expect(page.getByRole("button", { name: "Entrar" })).toBeEnabled();
    await expect(page.getByLabel("E-mail")).toHaveValue(email);
    await expect(page.getByLabel("Senha")).toHaveValue(SENHA);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/conta\/clientes$/);
    expect(logins).toBe(1);
    await page.clock.runFor(5 * 60_000);
    expect(logins).toBe(1);
    await contexto.close();
  });
});

test.describe("link público de agendamento", () => {
  test("página acordando: conectando, recupera, sem leitura de sessão; pedido sem resposta nunca é reenviado sozinho", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const contexto = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await contexto.newPage();
    await p.clock.install();
    const paginaPublica = new RegExp(`/public/${slug}$`);
    let leiturasDaPagina = 0;
    await p.route(paginaPublica, (rota) => {
      leiturasDaPagina += 1;
      return leiturasDaPagina <= 2 ? rota.fulfill(BORDA_502) : rota.continue();
    });
    const sessao = contarRequisicoes(p, ehAuthMe);
    const pedidos = contarRequisicoes(p, (r) => r.method() === "POST" && r.url().includes("/booking-requests"));

    await p.goto(`/agendar/${slug}`);
    await p.clock.runFor(1_000);
    await expect(p.getByTestId("conexao-acordando")).toContainText("Conectando ao servidor");
    await avancarAte(p, async () => (await p.getByTestId("lista-servicos-publicos").count()) > 0);
    expect(leiturasDaPagina).toBe(3);
    expect(sessao.total, "a página pública não lê sessão").toBe(0);

    // Troca de dia com a leitura anterior ainda em voo: a anterior é
    // cancelada e a resposta atrasada dela nunca aparece.
    let segurar = true;
    let liberar: () => void = () => undefined;
    await p.route(`**/public/${slug}/availability**`, async (rota) => {
      if (segurar && rota.request().url().includes(`date=${DATA}`)) {
        segurar = false;
        const resposta = await rota.fetch();
        await new Promise<void>((r) => (liberar = r));
        await rota.fulfill({ response: resposta }).catch(() => undefined);
        return;
      }
      return rota.continue();
    });
    // Um profissional só: a etapa "Profissional" aparece com ele já escolhido.
    await p.getByTestId("lista-servicos-publicos").getByRole("button").first().click();
    await expect(p.getByTestId("profissional-unico")).toContainText("Bia Corte");
    await p.getByTestId("continuar-profissional").click();
    await p.getByTestId("lista-dias").getByRole("button", { name: rotuloDoDia(DATA) }).click();
    await p.getByTestId("lista-dias").getByRole("button", { name: rotuloDoDia(DIA_SEM_JORNADA) }).click();
    await expect(p.getByTestId("sem-horarios")).toBeVisible();
    liberar();
    await p.clock.runFor(1_000);
    await expect(p.getByTestId("sem-horarios")).toBeVisible();
    await expect(p.getByTestId("lista-horarios-publicos")).toHaveCount(0);

    await p.getByTestId("lista-dias").getByRole("button", { name: rotuloDoDia(DATA) }).click();
    await p.getByTestId("lista-horarios-publicos").getByRole("button", { name: "09:00", exact: true }).click();
    await p.getByTestId("continuar-horario").click();
    await p.getByLabel("Nome").fill("Carla Cliente");
    await p.getByLabel("WhatsApp com DDD").fill("(11) 98888-0009");
    await p.getByTestId("revisar-pedido").click();

    // O servidor grava, mas a resposta volta como a borda (502 em HTML).
    await p.route("**/booking-requests", async (rota) => {
      await rota.fetch();
      await rota.fulfill(BORDA_502);
    });
    await p.getByTestId("enviar-pedido").click();
    await expect(p.getByTestId("envio-incerto")).toContainText("pode ter sido registrado");
    await p.clock.runFor(10 * 60_000);
    expect(pedidos.total, "o envio nunca é repetido sozinho").toBe(1);
    // Os dados continuam na revisão, e voltar fica travado até verificar.
    await expect(p.getByTestId("resumo-nome")).toHaveText("Carla Cliente");
    await expect(p.getByTestId("voltar-etapa")).toBeDisabled();

    await p.unroute("**/booking-requests");
    await p.getByTestId("verificar-envio").click();
    await expect(p.getByTestId("recibo-titulo")).toHaveText("Solicitação enviada — aguardando confirmação");
    await expect(p.getByTestId("recibo-repetido")).toContainText("já tinha sido recebido");
    expect(pedidos.total).toBe(2);

    // No banco: UM pedido.
    const dono = await browser.newContext({ storageState: sessaoDoDono });
    const lista = await dono.request.get(`${BACKEND_URL}/tenants/${tenantId}/booking-requests`);
    expect(lista.status()).toBe(200);
    const corpo = await lista.json();
    const daCarla = JSON.stringify(corpo).match(/Carla Cliente/g) ?? [];
    expect(daCarla).toHaveLength(1);
    await dono.close();
    await contexto.close();
  });

  test("página pública: 429 e página inexistente são conclusivos, sem repetição", async ({ browser }) => {
    const contexto = await browser.newContext();
    const p = await contexto.newPage();
    await p.clock.install();
    let leituras = 0;
    await p.route(new RegExp(`/public/${slug}$`), (rota) => {
      leituras += 1;
      return rota.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ message: "Muitas tentativas. Aguarde." }),
      });
    });
    await p.goto(`/agendar/${slug}`);
    await expect(p.getByTestId("pagina-publica-falha")).toContainText("Muitas tentativas. Aguarde.");
    await p.clock.runFor(5 * 60_000);
    expect(leituras).toBe(1);

    await p.goto("/agendar/nao-existe-nenhum-estabelecimento");
    await expect(p.getByTestId("pagina-publica-falha")).toContainText("não está disponível");
    await expect(p.getByTestId("conexao-acordando")).toHaveCount(0);
    await contexto.close();
  });
});

// Comportamento do Render observado no piloto (2026-10-22, ver
// docs/plans/recuperacao-apos-hibernacao-continuidade.md): com a API
// hibernada, os pedidos do proxy recebem uma página 502 da hospedagem e
// NUNCA acordam a API; só um pedido de fora do Render a acorda. Aqui o proxy
// é simulado nas respostas (502 marcado, com a origem da API) e a API só
// "sobe" depois que o navegador fizer o pedido direto de partida.
const RAIZ_DA_API = `${BACKEND_URL}/`;
const PROXY_SEM_API = {
  status: 502,
  contentType: "application/json",
  headers: {
    "cache-control": "no-store",
    "x-agenda-proxy-error": "upstream-unavailable",
    "x-agenda-acordar-api": BACKEND_URL,
    // Esta suíte chama a API em outra origem (`NEXT_PUBLIC_API_URL`); no
    // piloto o proxy é da mesma origem e isto não é necessário.
    "access-control-allow-origin": "http://localhost:3000",
    "access-control-allow-credentials": "true",
    "access-control-expose-headers": "x-agenda-proxy-error, x-agenda-acordar-api",
  },
  body: JSON.stringify({ message: "API indisponível." }),
};

/** API hibernada atrás do proxy: só sobe depois do pedido direto de partida
 * e de mais `leiturasAteSubir` leituras (o tempo de subida). */
async function apiHibernadaAtrasDoProxy(page: Page, leiturasAteSubir = 2) {
  const registro = {
    partidas: [] as { metodo: string; origem: string | undefined; cookie: string | undefined }[],
    leiturasDepoisDaPartida: 0,
    acordada: false,
    dormir() {
      registro.acordada = false;
      registro.partidas = [];
      registro.leiturasDepoisDaPartida = 0;
    },
  };
  await page.route(RAIZ_DA_API, async (rota) => {
    const cabecalhos = await rota.request().allHeaders();
    // `no-cors` num GET de outra origem não envia `Origin`; um `fetch` CORS enviaria.
    registro.partidas.push({ metodo: rota.request().method(), origem: cabecalhos.origin, cookie: cabecalhos.cookie });
    return rota.continue();
  });
  const responderPeloProxy = async (rota: Route) => {
    if (registro.acordada) return rota.continue();
    if (registro.partidas.length > 0 && ++registro.leiturasDepoisDaPartida > leiturasAteSubir) {
      registro.acordada = true;
      return rota.continue();
    }
    return rota.fulfill(PROXY_SEM_API);
  };
  await page.route(AUTH_ME, responderPeloProxy);
  await page.route("**/auth/login", responderPeloProxy);
  return registro;
}

test.describe("API hibernada que o proxy não acorda", () => {
  test("/conta: o navegador pede a partida UMA vez, sem cookie, e a sessão volta", async ({ browser }) => {
    test.setTimeout(60_000);
    const { contexto, page } = await comSessao(browser);
    const cookieAntes = await cookieDeSessao(page);
    await page.clock.install();
    const api = await apiHibernadaAtrasDoProxy(page);
    const escritas: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET") escritas.push(`${r.method()} ${r.url()}`);
    });

    await page.goto("/conta");
    await expect.poll(() => api.partidas.length).toBe(1);
    await avancarAte(page, () => api.acordada);
    await expect(page.getByText("Dono(a)")).toBeVisible();
    expect(api.partidas).toEqual([{ metodo: "GET", origem: undefined, cookie: undefined }]);
    expect(escritas).toEqual([]);
    expect(await cookieDeSessao(page)).toBe(cookieAntes);
    await page.clock.runFor(10 * 60_000);
    expect(api.partidas, "nada de pedido periódico").toHaveLength(1);
    await contexto.close();
  });

  test("clicar em Entrar com a API hibernada: UM POST, nunca repetido; a partida é pedida e o 2º clique entra", async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const contexto = await browser.newContext();
    const page = await contexto.newPage();
    await page.clock.install();
    const api = await apiHibernadaAtrasDoProxy(page, 0);
    let logins = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && new URL(r.url()).pathname === "/auth/login") logins += 1;
    });

    // A página de login abre com a API acordada (leitura de sessão: 401)...
    api.acordada = true;
    await page.goto("/login?next=%2Fconta%2Fclientes");
    await expect(page.getByRole("button", { name: "Entrar" })).toBeEnabled();
    // ...e ela hiberna antes do clique.
    api.dormir();
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar" }).click();

    await expect.poll(() => api.partidas.length).toBe(1);
    await expect(page.getByText("Não foi possível conectar ao servidor").first()).toBeVisible();
    await page.clock.runFor(5 * 60_000);
    expect(logins, "o POST nunca é reenviado sozinho").toBe(1);
    await expect(page.getByLabel("E-mail")).toHaveValue(email);
    await expect(page.getByLabel("Senha")).toHaveValue(SENHA);
    expect(api.partidas).toEqual([{ metodo: "GET", origem: undefined, cookie: undefined }]);

    // A partida já foi pedida; a API subiu. A pessoa clica de novo.
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/conta\/clientes$/);
    expect(logins).toBe(2);
    await contexto.close();
  });
});
