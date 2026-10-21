// Entrada e navegação para o piloto (Lote 6E.1) — contra o backend real e o
// frontend compilado, mesmo padrão de auth-cookie-flow.spec.ts.
//
// Prova três coisas que unit test não prova:
//  - a página inicial leva aos fluxos REAIS (cadastro e login) e mantém a
//    demonstração acessível, identificada como demonstração;
//  - sem sessão, a área real não mostra navegação nenhuma e vai para o login;
//  - com sessão, a navegação comum mostra o estabelecimento ativo, marca a
//    página atual e continua utilizável na largura de um celular;
//  - o login sem destino vai para a Visão geral (o `next` seguro é provado em
//    visao-geral-flow.spec.ts, que tem o próprio orçamento de login).
//
// Orçamento de POST /auth/register: este arquivo gasta 1 e roda na mesma
// invocação de services-flow.spec.ts (3) — total 4 de 5 (ver
// test:browser:services no package.json).
import { expect, test, type Page } from "@playwright/test";

const BACKEND_URL = "http://localhost:3001";
const SENHA = "senha-de-navegacao-e2e-123";
const CELULAR = { width: 390, height: 844 };

function navegacaoDaConta(page: Page) {
  return page.getByRole("navigation", { name: "Áreas da conta" });
}

/** A página não rola na horizontal: nada ficou largo demais para a tela. */
async function semRolagemHorizontal(page: Page) {
  const larguras = await page.evaluate(() => ({
    conteudo: document.documentElement.scrollWidth,
    tela: window.innerWidth,
  }));
  expect(larguras.conteudo).toBeLessThanOrEqual(larguras.tela);
}

test.describe("entrada e navegação do piloto", () => {
  test("página inicial: Criar conta, Entrar e a demonstração identificada", async ({ page }) => {
    const conteudo = page.getByRole("main");

    await page.goto("/");
    await conteudo.getByRole("link", { name: "Criar conta" }).first().click();
    await expect(page).toHaveURL(/\/cadastro$/);

    await page.goto("/");
    await conteudo.getByRole("link", { name: "Entrar" }).first().click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/");
    await expect(conteudo.getByText("dados fictícios, guardados só neste navegador")).toBeVisible();
    await conteudo.getByRole("link", { name: "Ver demonstração" }).first().click();
    await expect(page).toHaveURL(/\/onboarding$/);

    // Celular: "Entrar" fica visível sem abrir o menu; o menu traz
    // "Criar conta" e a demonstração com o aviso de dados fictícios.
    await page.setViewportSize(CELULAR);
    await page.goto("/");
    const cabecalho = page.getByRole("banner");
    await expect(cabecalho.getByRole("link", { name: "Entrar" })).toBeInViewport();
    await cabecalho.getByRole("button", { name: "Abrir menu" }).click();
    const menu = page.getByRole("navigation", { name: "Navegação principal (celular)" });
    await expect(menu.getByRole("link", { name: "Criar conta" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Ver demonstração (dados fictícios)" })).toBeVisible();
    await semRolagemHorizontal(page);
  });

  test("sem sessão: a área real vai para o login e não mostra navegação", async ({ page }) => {
    await page.goto("/conta/agendamentos");
    await expect(page).toHaveURL(/\/login\?next=%2Fconta%2Fagendamentos$/);
    await expect(navegacaoDaConta(page)).toHaveCount(0);
  });

  test("com sessão: estabelecimento ativo, página atual, Abrir agenda, guia e celular", async ({
    page,
    request,
  }) => {
    const sufixo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `navegacao-${sufixo}@example.test`;
    const estabelecimento = `Estúdio Navegação ${sufixo}`;
    const cadastro = await request.post(`${BACKEND_URL}/auth/register`, {
      data: {
        ownerName: "Dona Navegação",
        businessName: estabelecimento,
        email,
        phone: "11977775555",
        password: SENHA,
      },
    });
    expect(cadastro.status(), await cadastro.text()).toBe(201);

    // Entrada pelo caminho real da página inicial.
    await page.goto("/");
    await page.getByRole("main").getByRole("link", { name: "Entrar" }).first().click();
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar" }).click();
    // Sem `next`, quem entra vai para a Visão geral.
    await expect(page).toHaveURL(/\/conta\/visao-geral$/);

    // Estrutura comum: estabelecimento ativo, usuário e página atual marcada.
    await expect(page.getByTestId("estabelecimento-ativo")).toHaveText(estabelecimento);
    await expect(page.getByTestId("usuario-conectado")).toContainText("Dona Navegação");
    const nav = navegacaoDaConta(page);
    expect(await nav.getByRole("link").allTextContents()).toEqual([
      "Visão geral",
      "Agenda",
      "Solicitações",
      "Clientes",
      "Serviços",
      "Profissionais",
      "Minha conta",
    ]);
    await expect(nav.getByRole("link", { name: "Visão geral" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.getByRole("link", { name: "Minha conta" })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
    // Nenhum link da área real aponta para a demonstração.
    const hrefs = await nav
      .getByRole("link")
      .evaluateAll((links) => links.map((l) => l.getAttribute("href")));
    expect(hrefs.every((h) => h?.startsWith("/conta"))).toBe(true);
    // Uma conta com um vínculo só não tem o que trocar.
    await expect(page.getByRole("link", { name: "Trocar de estabelecimento" })).toHaveCount(0);

    // Minha conta: o guia informativo continua lá, com os links da área real.
    await nav.getByRole("link", { name: "Minha conta" }).click();
    await expect(page).toHaveURL(/\/conta$/);
    await expect(nav.getByRole("link", { name: "Minha conta" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const passos = page.getByTestId("primeiros-passos").getByRole("listitem");
    await expect(passos).toHaveCount(4);
    const destinos = await page
      .getByTestId("primeiros-passos")
      .getByRole("link")
      .evaluateAll((links) => links.map((l) => l.getAttribute("href")));
    expect(destinos).toEqual([
      "/conta/servicos",
      "/conta/profissionais",
      "/conta/profissionais",
      "/conta/agendamentos",
    ]);

    // Ação principal de Minha conta: abrir a agenda.
    await page.getByTestId("abrir-agenda").click();
    await expect(page).toHaveURL(/\/conta\/agendamentos$/);
    await expect(nav.getByRole("link", { name: "Agenda" })).toHaveAttribute("aria-current", "page");

    for (const [rotulo, caminho] of [
      ["Clientes", /\/conta\/clientes$/],
      ["Serviços", /\/conta\/servicos$/],
      ["Profissionais", /\/conta\/profissionais$/],
      ["Visão geral", /\/conta\/visao-geral$/],
      ["Minha conta", /\/conta$/],
    ] as const) {
      await nav.getByRole("link", { name: rotulo }).click();
      await expect(page).toHaveURL(caminho);
      await expect(nav.getByRole("link", { name: rotulo })).toHaveAttribute("aria-current", "page");
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    }

    // Celular: quatro áreas e o "Mais" na barra inferior, e o "Sair", aparecem
    // na tela, com área de toque de pelo menos 44 px, sem rolar a página para
    // o lado. Profissionais e Minha conta ficam no "Mais".
    await page.setViewportSize(CELULAR);
    for (const caminho of [
      "/conta/visao-geral",
      "/conta/agendamentos",
      "/conta/clientes",
      "/conta/servicos",
      "/conta/profissionais",
      "/conta",
    ]) {
      await page.goto(caminho);
      for (const rotulo of ["Visão geral", "Agenda", "Clientes", "Serviços"]) {
        const link = nav.getByRole("link", { name: rotulo });
        await expect(link).toBeInViewport();
        const caixa = await link.boundingBox();
        expect(caixa!.height).toBeGreaterThanOrEqual(44);
      }
      await nav.getByRole("button", { name: "Mais" }).click();
      for (const rotulo of ["Profissionais", "Minha conta"]) {
        const link = nav.getByRole("link", { name: rotulo });
        await expect(link).toBeInViewport();
        const caixa = await link.boundingBox();
        expect(caixa!.height).toBeGreaterThanOrEqual(44);
      }
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Sair" })).toBeInViewport();
      await semRolagemHorizontal(page);
    }
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
