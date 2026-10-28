// Configurações como índice e submenu, e Serviços e Profissionais como áreas
// próprias do menu — contra o backend real e o frontend compilado.
//
// Prova o que unit test não prova:
//  - no computador, passar o mouse sobre "Configurações" abre o submenu sem
//    mover o foco, o mouse chega às opções sem ele sumir, e o clique no texto
//    abre o índice;
//  - pelo teclado, o botão separado abre e fecha, as setas levam à primeira
//    opção, Escape devolve o foco, e o foco que sai do item fecha;
//  - o submenu fica dentro da tela e abrir não faz requisição à API nem pede
//    permissão de notificações;
//  - cada opção mostra só o seu conteúdo, com retorno discreto ao índice, sem
//    barra interna; os endereços diretos e os antigos continuam valendo;
//  - no celular (toque), Configurações abre o índice e Serviços e
//    Profissionais ficam no menu da conta, sem hover;
//  - capturas em claro e escuro, 1280, 390 e 360 px, sem rolagem horizontal.
//
// Orçamento de POST /invites/accept: 1 (roda na invocação de
// test:browser:services, ver services-flow.spec.ts — total 5 de 10). Nenhum
// login pela tela: a sessão vem do aceite do convite.
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { criarContaDeTeste } from "./support/contas-de-teste";

const SENHA = "senha-de-configuracoes-e2e-1";
const SECOES = ["Estabelecimento", "Equipe e acessos", "Notificações", "Aparência", "Perfil e segurança"];
const CAMINHOS = ["estabelecimento", "equipe", "notificacoes", "aparencia", "perfil"].map(
  (c) => `/conta/configuracoes/${c}`,
);

const nav = (page: Page) => page.getByRole("navigation", { name: "Áreas da conta" });
const submenu = (page: Page) => page.getByTestId("submenu-configuracoes");
const botaoSubmenu = (page: Page) => page.getByTestId("abrir-submenu-configuracoes");

async function semRolagemHorizontal(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function capturar(page: Page, nome: string, larguras: readonly number[] = [1280, 390, 360]) {
  for (const tema of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: tema });
    for (const width of larguras) {
      await page.setViewportSize({ width, height: 844 });
      await semRolagemHorizontal(page);
      await page.screenshot({ path: test.info().outputPath(`configuracoes-${nome}-${tema}-${width}.png`) });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 844 });
}

test("Configurações: submenu no computador, índice, seções e áreas próprias no celular", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const marca = `config-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  await criarContaDeTeste(page.request, {
    ownerName: "Dona das Configurações",
    businessName: `${marca} Estúdio`,
    email: `${marca}@example.test`,
    password: SENHA,
  });

  // Conta quantas vezes a página pede permissão de notificações.
  await page.addInitScript(() => {
    const w = window as unknown as { __pedidosDePermissao: number };
    w.__pedidosDePermissao = 0;
    if ("Notification" in window) {
      Notification.requestPermission = () => {
        w.__pedidosDePermissao += 1;
        return Promise.resolve("default");
      };
    }
  });

  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto("/conta/visao-geral");
  await expect(nav(page).getByRole("link")).toHaveText([
    "Início",
    "Agenda",
    "Clientes",
    "Serviços",
    "Profissionais",
    "Configurações",
  ]);

  // ------------------------------------------------ mouse: abre sem foco nem requisição
  const requisicoes: string[] = [];
  page.on("request", (r) => {
    if (r.url().startsWith("http://localhost:3001") || r.url().includes("/agenda_api/")) requisicoes.push(r.url());
  });
  const linkConfiguracoes = nav(page).getByRole("link", { name: "Configurações" });
  await linkConfiguracoes.hover();
  await expect(submenu(page).getByRole("link")).toHaveText(SECOES);
  expect(await submenu(page).getByRole("link").evaluateAll((l) => l.map((a) => a.getAttribute("href")))).toEqual(CAMINHOS);
  await expect(botaoSubmenu(page)).toHaveAttribute("aria-expanded", "true");
  expect(await page.evaluate(() => document.activeElement?.closest("[data-testid=submenu-configuracoes]") ?? null)).toBeNull();
  await page.waitForTimeout(300);
  expect(requisicoes).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __pedidosDePermissao: number }).__pedidosDePermissao)).toBe(0);
  await capturar(page, "submenu", [1280]);
  // `capturar` mexe no tamanho da janela; o mouse volta ao item.
  await linkConfiguracoes.hover();
  await expect(submenu(page)).toBeVisible();

  // Do item até a última opção, em vários passos (atravessando a faixa entre os dois).
  const origem = (await linkConfiguracoes.boundingBox())!;
  const destino = (await submenu(page).getByRole("link", { name: "Perfil e segurança" }).boundingBox())!;
  await page.mouse.move(origem.x + origem.width / 2, origem.y + origem.height / 2);
  await page.mouse.move(destino.x + 20, destino.y + destino.height / 2, { steps: 12 });
  await expect(submenu(page)).toBeVisible();
  await submenu(page).getByRole("link", { name: "Equipe e acessos" }).click();
  await expect(page).toHaveURL(/\/conta\/configuracoes\/equipe$/);
  await expect(submenu(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Equipe e acessos");
  await expect(linkConfiguracoes).toHaveAttribute("aria-current", "page");
  // Sem barra interna das seções; só o retorno ao índice.
  await expect(page.getByRole("navigation", { name: "Seções de configurações" })).toHaveCount(0);

  // Sair do item fecha (depois da pequena espera).
  await linkConfiguracoes.hover();
  await expect(submenu(page)).toBeVisible();
  await page.mouse.move(900, 700);
  await expect(submenu(page)).toHaveCount(0);

  // Aberto pelo mouse, com o foco numa opção: tirar o mouse não fecha nem
  // derruba o foco.
  await linkConfiguracoes.hover();
  await submenu(page).getByRole("link", { name: "Aparência" }).focus();
  await page.mouse.move(900, 700);
  await page.waitForTimeout(400);
  await expect(submenu(page).getByRole("link", { name: "Aparência" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(submenu(page)).toHaveCount(0);
  await expect(botaoSubmenu(page)).toBeFocused();

  // Retorno discreto ao índice.
  await page.getByTestId("voltar-configuracoes").click();
  await expect(page).toHaveURL(/\/conta\/configuracoes$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Configurações");
  await expect(page.getByTestId("secoes-configuracoes").getByRole("link")).toHaveCount(SECOES.length);
  await expect(page.getByTestId("voltar-configuracoes")).toHaveCount(0);

  // Clicar no texto "Configurações" abre o índice (não só o submenu).
  await page.goto("/conta/clientes");
  await linkConfiguracoes.click();
  await expect(page).toHaveURL(/\/conta\/configuracoes$/);
  await expect(page.getByTestId("secoes-configuracoes")).toBeVisible();

  // ------------------------------------------------ teclado
  await page.mouse.move(900, 700);
  await page.goto("/conta/clientes");
  await linkConfiguracoes.focus();
  await page.keyboard.press("Tab");
  await expect(botaoSubmenu(page)).toBeFocused();
  await expect(botaoSubmenu(page)).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(submenu(page)).toBeVisible();
  await expect(botaoSubmenu(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(submenu(page)).toHaveCount(0);
  await expect(botaoSubmenu(page)).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(submenu(page).getByRole("link", { name: "Estabelecimento" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(submenu(page).getByRole("link", { name: "Equipe e acessos" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(submenu(page)).toHaveCount(0);
  await expect(botaoSubmenu(page)).toBeFocused();

  // O foco que passa da última opção fecha o submenu.
  await page.keyboard.press("Enter");
  for (let i = 0; i < SECOES.length; i++) await page.keyboard.press("Tab");
  await expect(submenu(page).getByRole("link", { name: "Perfil e segurança" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(submenu(page)).toHaveCount(0);

  // Enter numa opção navega e fecha.
  await botaoSubmenu(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(submenu(page).getByRole("link", { name: "Estabelecimento" })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(submenu(page).getByRole("link", { name: "Notificações" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/conta\/configuracoes\/notificacoes$/);
  await expect(submenu(page)).toHaveCount(0);

  // Clique fora fecha.
  await botaoSubmenu(page).click();
  await expect(submenu(page)).toBeVisible();
  await page.getByRole("heading", { level: 1 }).click();
  await expect(submenu(page)).toHaveCount(0);

  // Dentro da tela, mesmo numa janela baixa.
  await page.setViewportSize({ width: 1280, height: 400 });
  await linkConfiguracoes.hover();
  const caixa = (await submenu(page).getByRole("navigation").boundingBox())!;
  expect(caixa.y).toBeGreaterThanOrEqual(0);
  expect(caixa.y + caixa.height).toBeLessThanOrEqual(400);
  expect(caixa.x + caixa.width).toBeLessThanOrEqual(1280);
  await page.mouse.move(900, 300);
  await page.setViewportSize({ width: 1280, height: 844 });

  // ------------------------------------------------ Serviços e Profissionais
  for (const [rotulo, caminho] of [
    ["Serviços", /\/conta\/configuracoes\/servicos$/],
    ["Profissionais", /\/conta\/configuracoes\/profissionais$/],
  ] as const) {
    await nav(page).getByRole("link", { name: rotulo }).click();
    await expect(page).toHaveURL(caminho);
    await expect(nav(page).locator('[aria-current="page"]')).toHaveText(rotulo);
    await expect(page.getByTestId("voltar-configuracoes")).toHaveCount(0);
  }
  // Endereços antigos continuam levando a elas.
  await page.goto("/conta/servicos");
  await expect(page).toHaveURL(/\/conta\/configuracoes\/servicos$/);
  await page.goto("/conta/profissionais");
  await expect(page).toHaveURL(/\/conta\/configuracoes\/profissionais$/);

  // ------------------------------------------------ endereços diretos das seções
  for (const [i, caminho] of CAMINHOS.entries()) {
    await page.goto(caminho);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(SECOES[i]);
    await expect(page.getByTestId("voltar-configuracoes")).toBeVisible();
  }
  expect(await page.evaluate(() => (window as unknown as { __pedidosDePermissao: number }).__pedidosDePermissao)).toBe(0);

  await page.goto("/conta/configuracoes");
  await capturar(page, "indice");
  await page.goto("/conta/configuracoes/aparencia");
  await capturar(page, "secao-aparencia");
  await page.goto("/conta/configuracoes/equipe");
  await capturar(page, "secao-equipe");

  // ------------------------------------------------ celular, por toque
  for (const width of [390, 360]) {
    const contexto = await browser.newContext({
      storageState: await page.context().storageState(),
      viewport: { width, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const celular = await contexto.newPage();
    try {
      await celular.goto("/conta/visao-geral");
      await expect(nav(celular).getByRole("link")).toHaveText(["Início", "Agenda", "Clientes", "Configurações"]);
      await expect(botaoSubmenu(celular)).toBeHidden();
      await nav(celular).getByRole("link", { name: "Configurações" }).tap();
      await expect(celular).toHaveURL(/\/conta\/configuracoes$/);
      await expect(submenu(celular)).toHaveCount(0);
      await celular.getByTestId("secoes-configuracoes").getByRole("link", { name: /Aparência/ }).tap();
      await expect(celular).toHaveURL(/\/conta\/configuracoes\/aparencia$/);
      await celular.getByTestId("voltar-configuracoes").tap();
      await expect(celular).toHaveURL(/\/conta\/configuracoes$/);
      await semRolagemHorizontal(celular);

      // Serviços e Profissionais pelo menu da conta.
      for (const [rotulo, caminho] of [
        ["Serviços", /\/conta\/configuracoes\/servicos$/],
        ["Profissionais", /\/conta\/configuracoes\/profissionais$/],
      ] as const) {
        await celular.getByTestId("abrir-menu-conta").tap();
        const area = celular.getByTestId("menu-mais-areas").getByRole("link", { name: rotulo });
        const toque = (await area.boundingBox())!;
        expect(toque.height).toBeGreaterThanOrEqual(44);
        await area.tap();
        await expect(celular).toHaveURL(caminho);
        await expect(celular.getByTestId("menu-conta")).toHaveCount(0);
        await semRolagemHorizontal(celular);
      }
      if (width === 390) {
        await celular.getByTestId("abrir-menu-conta").tap();
        for (const tema of ["light", "dark"] as const) {
          await celular.emulateMedia({ colorScheme: tema });
          await celular.screenshot({ path: test.info().outputPath(`configuracoes-menu-celular-${tema}-${width}.png`) });
        }
      }
    } finally {
      await contexto.close();
    }
  }
});
