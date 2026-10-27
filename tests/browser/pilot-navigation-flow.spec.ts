// Entrada e navegação para o piloto (Lote 6E.1) — contra o backend real e o
// frontend compilado, mesmo padrão de auth-cookie-flow.spec.ts.
//
// Prova três coisas que unit test não prova:
//  - a página inicial leva aos fluxos REAIS (cadastro e login) e mantém a
//    demonstração acessível, identificada como demonstração;
//  - sem sessão, a área real não mostra navegação nenhuma e vai para o login;
//  - com sessão, a navegação comum mostra o estabelecimento ativo, marca a
//    página atual e continua utilizável na largura de um celular;
//  - o login sem destino vai para o Início (o `next` seguro é provado em
//    visao-geral-flow.spec.ts, que tem o próprio orçamento de login).
//
// Orçamento de POST /invites/accept (fixture de contas): este arquivo gasta 1 e roda na mesma
// invocação de services-flow.spec.ts (3) — total 4 de 10 (ver
// test:browser:services no package.json).
import { criarContaDeTeste as contaPorConvite } from "./support/contas-de-teste";
import { expect, test, type Page } from "@playwright/test";

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
  test("página inicial: Como obter acesso, Entrar e a demonstração identificada", async ({ page }) => {
    const conteudo = page.getByRole("main");

    await page.goto("/");
    await conteudo.getByRole("link", { name: "Como obter acesso" }).first().click();
    await expect(page).toHaveURL(/\/cadastro$/);

    await page.goto("/");
    await conteudo.getByRole("link", { name: "Entrar" }).first().click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/");
    await expect(conteudo.getByText("dados fictícios, guardados só neste navegador")).toBeVisible();
    await conteudo.getByRole("link", { name: "Ver demonstração" }).first().click();
    await expect(page).toHaveURL(/\/onboarding$/);

    // Celular: "Entrar" fica visível sem abrir o menu; o menu traz
    // "Como obter acesso" e a demonstração com o aviso de dados fictícios.
    await page.setViewportSize(CELULAR);
    await page.goto("/");
    const cabecalho = page.getByRole("banner");
    await expect(cabecalho.getByRole("link", { name: "Entrar" })).toBeInViewport();
    await cabecalho.getByRole("button", { name: "Abrir menu" }).click();
    const menu = page.getByRole("navigation", { name: "Navegação principal (celular)" });
    await expect(menu.getByRole("link", { name: "Como obter acesso" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Criar conta" })).toHaveCount(0);
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
    await contaPorConvite(request, {
        ownerName: "Dona Navegação",
        businessName: estabelecimento,
        email,
        phone: "11977775555",
        password: SENHA,
      });

    // Entrada pelo caminho real da página inicial.
    await page.goto("/");
    await page.getByRole("main").getByRole("link", { name: "Entrar" }).first().click();
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar" }).click();
    // Sem `next`, quem entra vai para o Início.
    await expect(page).toHaveURL(/\/conta\/visao-geral$/);

    // Estrutura comum: estabelecimento ativo, usuário e página atual marcada.
    await expect(page.getByTestId("estabelecimento-ativo")).toHaveText(estabelecimento);
    await expect(page.getByTestId("usuario-conectado")).toContainText("Dona Navegação");
    const nav = navegacaoDaConta(page);
    expect(await nav.getByRole("link").allTextContents()).toEqual(["Início", "Agenda", "Clientes", "Configurações"]);
    await expect(nav.getByRole("link", { name: "Início" })).toHaveAttribute("aria-current", "page");
    // Nenhum link da área real aponta para a demonstração.
    const hrefs = await nav
      .getByRole("link")
      .evaluateAll((links) => links.map((l) => l.getAttribute("href")));
    expect(hrefs.every((h) => h?.startsWith("/conta"))).toBe(true);
    // Uma conta com um vínculo só não tem o que trocar.
    await expect(page.getByRole("link", { name: "Trocar de estabelecimento" })).toHaveCount(0);

    // Configurações: as seções do estabelecimento e as pessoais.
    await nav.getByRole("link", { name: "Configurações" }).click();
    await expect(page).toHaveURL(/\/conta\/configuracoes$/);
    await expect(nav.getByRole("link", { name: "Configurações" })).toHaveAttribute("aria-current", "page");
    const secoes = page.getByTestId("secoes-configuracoes").getByRole("link");
    expect(await secoes.evaluateAll((links) => links.map((l) => l.getAttribute("href")))).toEqual([
      "/conta/configuracoes/estabelecimento",
      "/conta/configuracoes/servicos",
      "/conta/configuracoes/profissionais",
      "/conta/configuracoes/equipe",
      "/conta/configuracoes/notificacoes",
      "/conta/configuracoes/aparencia",
      "/conta/configuracoes/perfil",
    ]);

    // Estabelecimento: o guia informativo de primeiros passos, com links da
    // área real.
    await secoes.filter({ hasText: "Estabelecimento" }).click();
    await expect(page).toHaveURL(/\/conta\/configuracoes\/estabelecimento$/);
    const passos = page.getByTestId("primeiros-passos").getByRole("listitem");
    await expect(passos).toHaveCount(5);
    const destinos = await page
      .getByTestId("primeiros-passos")
      .getByRole("link")
      .evaluateAll((links) => links.map((l) => l.getAttribute("href")));
    expect(destinos).toEqual([
      "/conta/configuracoes/servicos",
      "/conta/configuracoes/profissionais",
      "/conta/configuracoes/profissionais",
      "/conta/agendamentos",
      "/conta/configuracoes/equipe",
    ]);
    // "Configurações" continua marcada nas subpáginas.
    await expect(nav.getByRole("link", { name: "Configurações" })).toHaveAttribute("aria-current", "page");

    // "/conta" (antiga Minha conta) leva ao Início do dono.
    await page.goto("/conta");
    await expect(page).toHaveURL(/\/conta\/visao-geral$/);

    for (const [rotulo, caminho] of [
      ["Agenda", /\/conta\/agendamentos$/],
      ["Clientes", /\/conta\/clientes$/],
      ["Configurações", /\/conta\/configuracoes$/],
      ["Início", /\/conta\/visao-geral$/],
    ] as const) {
      await nav.getByRole("link", { name: rotulo }).click();
      await expect(page).toHaveURL(caminho);
      await expect(nav.getByRole("link", { name: rotulo })).toHaveAttribute("aria-current", "page");
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    }

    // Endereços antigos levam aos novos.
    for (const [antigo, novoEndereco] of [
      ["/conta/servicos", /\/conta\/configuracoes\/servicos$/],
      ["/conta/profissionais", /\/conta\/configuracoes\/profissionais$/],
      ["/conta/equipe", /\/conta\/configuracoes\/equipe$/],
      ["/conta/solicitacoes", /\/conta\/agendamentos\/solicitacoes$/],
    ] as const) {
      await page.goto(antigo);
      await expect(page).toHaveURL(novoEndereco);
    }

    // Celular: as quatro áreas na barra inferior e o menu da conta aparecem
    // na tela, com área de toque de pelo menos 44 px, sem rolar a página para
    // o lado. Não há "Mais".
    await page.setViewportSize(CELULAR);
    for (const caminho of [
      "/conta/visao-geral",
      "/conta/agendamentos",
      "/conta/agendamentos/solicitacoes",
      "/conta/clientes",
      "/conta/configuracoes",
      "/conta/configuracoes/servicos",
      "/conta/configuracoes/profissionais",
      "/conta/configuracoes/perfil",
    ]) {
      await page.goto(caminho);
      for (const rotulo of ["Início", "Agenda", "Clientes", "Configurações"]) {
        const link = nav.getByRole("link", { name: rotulo });
        await expect(link).toBeInViewport();
        const caixa = await link.boundingBox();
        expect(caixa!.height).toBeGreaterThanOrEqual(44);
      }
      await expect(nav.getByRole("button", { name: "Mais" })).toHaveCount(0);
      await expect(page.getByTestId("abrir-menu-conta")).toBeInViewport();
      await semRolagemHorizontal(page);
    }
    await page.setViewportSize({ width: 1280, height: 720 });

    // "Sair" fica no menu da conta.
    await page.getByTestId("abrir-menu-conta").click();
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
