// Regressão da falha "Não foi possível conectar ao servidor" depois de um
// período sem acesso ao piloto. Enquanto o serviço hibernado do Render
// acorda, a borda da hospedagem responde 502 em HTML, sem passar pela API
// (observado em 2026-10-21 com GET /agenda_api/auth/me). Antes, uma única
// leitura de /auth/me nesse momento já mostrava a tela de falha.
//
// Aqui a resposta da borda é simulada só para /auth/me (`page.route`); o
// resto é o backend e o frontend reais, com a sessão real em cookie
// HttpOnly. As esperas entre tentativas usam o relógio controlado do
// Playwright (`page.clock`): o teste avança o tempo até a próxima leitura
// chegar, sem sleeps.
//
// Um cadastro só para a suíte inteira: POST /auth/register tem limite de 5
// por 15 minutos por IP, dividido com os outros testes de `test:browser:auth`.
import { expect, test, type Browser, type BrowserContextOptions, type Page, type Route } from "@playwright/test";

const BACKEND_URL = "http://localhost:3001";
const AUTH_ME = "**/auth/me";

type EstadoDoNavegador = Exclude<BrowserContextOptions["storageState"], string | undefined>;

let sessaoCadastrada: EstadoDoNavegador;

test.beforeAll(async ({ browser }) => {
  const contexto = await browser.newContext();
  const sufixo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // `contexto.request` divide os cookies com o navegador: o cookie de sessão
  // do cadastro fica guardado como depois de um login de verdade.
  const resposta = await contexto.request.post(`${BACKEND_URL}/auth/register`, {
    data: {
      ownerName: "Maria Reconexão",
      businessName: `Estúdio Reconexão ${sufixo}`,
      email: `playwright-reconexao-${sufixo}@example.test`,
      phone: "11999998888",
      password: "senha-de-teste-e2e-123",
    },
  });
  expect(resposta.status(), await resposta.text()).toBe(201);
  sessaoCadastrada = await contexto.storageState();
  await contexto.close();
});

async function abrirComSessao(browser: Browser): Promise<Page> {
  const contexto = await browser.newContext({ storageState: sessaoCadastrada });
  return contexto.newPage();
}

async function cookieDeSessao(page: Page): Promise<string | undefined> {
  const cookies = await page.context().cookies(BACKEND_URL);
  return cookies.find((c) => c.name === "session_token")?.value;
}

/** /auth/me responde como a borda do Render acordando enquanto `falhar()`
 * for verdadeiro; depois segue para a API real. Conta as leituras: o total
 * exato prova que nenhuma leitura extra (sobreposta) foi feita. */
async function simularBordaAcordando(page: Page, falhar: () => boolean) {
  const registro = { leituras: 0 };
  await page.route(AUTH_ME, async (rota: Route) => {
    registro.leituras += 1;
    if (falhar()) {
      await rota.fulfill({
        status: 502,
        contentType: "text/html; charset=utf-8",
        body: "<html><body>Bad Gateway</body></html>",
      });
    } else {
      await rota.continue();
    }
  });
  return registro;
}

/** Avança o relógio da página até `registro.leituras` chegar a `total`. */
async function avancarAteLeitura(page: Page, registro: { leituras: number }, total: number) {
  await expect
    .poll(
      async () => {
        if (registro.leituras < total) await page.clock.runFor(2_000);
        return registro.leituras;
      },
      // Tempo REAL de espera do poll; o tempo da página só anda pelo runFor.
      { timeout: 20_000 },
    )
    .toBe(total);
}

test.describe("leitura de sessão enquanto a hospedagem acorda", () => {
  test("502 da borda nas primeiras leituras: recupera sozinho e mantém a sessão", async ({ browser }) => {
    const page = await abrirComSessao(browser);
    const cookieAntes = await cookieDeSessao(page);
    expect(cookieAntes).toBeTruthy();

    await page.clock.install();
    const registro = await simularBordaAcordando(page, () => registro.leituras <= 2);

    await page.goto("/conta");
    await expect.poll(() => registro.leituras).toBe(1);
    // Falha temporária ainda é carregamento: nem tela de erro, nem login.
    await expect(page.getByText("Não foi possível conectar ao servidor")).toHaveCount(0);
    await expect(page).toHaveURL(/\/conta$/);

    await avancarAteLeitura(page, registro, 3);

    await expect(page.getByText("Dono(a)")).toBeVisible();
    await expect(page).toHaveURL(/\/conta$/);
    expect(registro.leituras).toBe(3);
    expect(await cookieDeSessao(page)).toBe(cookieAntes);
    await page.context().close();
  });

  test("tentativas esgotadas: mostra a falha, preserva a sessão e o botão recupera", async ({ browser }) => {
    const page = await abrirComSessao(browser);
    const cookieAntes = await cookieDeSessao(page);

    await page.clock.install();
    let apiFora = true;
    const registro = await simularBordaAcordando(page, () => apiFora);

    await page.goto("/conta");
    // Prazo total da recuperação (lib/api/leitura-com-recuperacao.ts): o
    // relógio anda até a tela de falha aparecer.
    const falha = page.getByRole("heading", { name: "Não foi possível conectar ao servidor" });
    await expect
      .poll(
        async () => {
          if ((await falha.count()) === 0) await page.clock.runFor(5_000);
          return falha.count();
        },
        { timeout: 50_000, intervals: [50] },
      )
      .toBe(1);
    const leiturasNaFalha = registro.leituras;
    await expect(page).toHaveURL(/\/conta$/);
    await expect(page.getByText("E-mail ou senha inválidos.")).toHaveCount(0);
    expect(await cookieDeSessao(page)).toBe(cookieAntes);

    // Limite de tentativas: o tempo passa e nenhuma leitura nova acontece
    // sozinha depois da tela de falha.
    await page.clock.runFor(60_000);
    expect(registro.leituras).toBe(leiturasNaFalha);

    apiFora = false;
    await page.getByRole("button", { name: "Tentar novamente" }).click();

    await expect(page.getByText("Dono(a)")).toBeVisible();
    await expect(page).toHaveURL(/\/conta$/);
    expect(registro.leituras).toBe(leiturasNaFalha + 1);
    expect(await cookieDeSessao(page)).toBe(cookieAntes);
    await page.context().close();
  });
});
