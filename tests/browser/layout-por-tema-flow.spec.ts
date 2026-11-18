// Layout único em todos os temas, contra o backend real e o PostgreSQL
// DESCARTÁVEL, só com dados fictícios.
//
// Até 18/11/2026 o menu agrupado do portal e de /conta, a Visão geral nova do
// portal e algumas bordas só apareciam no "Azul e branco"; ao escolher outro
// tema a tela voltava ao arranjo antigo. Aqui, para cada tema (Claro, Escuro,
// Seguir aparelho com o aparelho escuro, Azul e branco), escolhido pelo
// seletor sem recarregar, e navegando depois da troca:
//
// - portal: menu com Gestão, Comercial e Administração; Visão geral com os
//   mesmos blocos e na mesma posição; ficha com as abas Dados, Plano e
//   adicionais, Responsáveis e Histórico; Contas e acessos; Planos e
//   adicionais;
// - /conta: dono e gerente com o menu agrupado, funcionário com a lista curta,
//   cada um só com as áreas do próprio perfil (o tema não libera nem esconde);
// - computador (1280) e celular (390): a estrutura visível (títulos, menus,
//   abas, `data-testid` e a posição de cada um) é idêntica entre os temas,
//   sem rolagem lateral, e só a paleta muda (fundo diferente por tema);
// - a escolha persiste ao recarregar.
//
// Capturas de cada local em cada tema ficam em PLAYWRIGHT_OUTPUT_DIR.
// Invocação própria (`npm run test:browser:layout-temas`): 2 aceites de
// convite e 1 login (limite de produção: 5 por 15 minutos por IP).
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { API_DE_TESTE, conectarBancoDeTeste, criarContaDeTeste } from "./support/contas-de-teste";
import { VISAO_GERAL_DO_PORTAL, abrirSecoesNoCelular, entrarPeloFormulario, navConta, navPortal, semRolagemHorizontal } from "./support/portal";

const id = () => randomUUID().replaceAll("-", "").slice(0, 24);
const SENHA = "senha-do-layout-por-tema-1";

const TEMAS = [
  { rotulo: "Claro", valor: "claro", fundo: "rgb(250, 247, 242)" },
  { rotulo: "Escuro", valor: "escuro", fundo: "rgb(20, 22, 25)" },
  // O contexto simula o aparelho escuro: "Seguir aparelho" fica escuro.
  { rotulo: "Seguir aparelho", valor: "sistema", fundo: "rgb(20, 22, 25)" },
  { rotulo: "Azul e branco", valor: "azul", fundo: "rgb(243, 247, 252)" },
] as const;
type Tema = (typeof TEMAS)[number];

const LARGURAS = [
  { nome: "computador", width: 1280, height: 900 },
  { nome: "celular", width: 390, height: 844 },
] as const;

/** O que estrutura a tela, sem cor: títulos, menus e abas visíveis, cada
 * `data-testid` visível e a caixa (arredondada) de cada um. */
type Estrutura = { textos: string[]; caixas: string[] };

async function estrutura(page: Page): Promise<Estrutura> {
  // Leituras concluídas e fontes carregadas: a medida é a da tela parada.
  await expect(page.getByText(/^Carregando/)).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const visivel = (el: Element) => el.checkVisibility() && (el as HTMLElement).getClientRects().length > 0;
    const texto = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
    const caixa = (el: Element) => {
      const r = el.getBoundingClientRect();
      return [r.x, r.y + scrollY, r.width, r.height].map((n) => Math.round(n)).join(",");
    };
    const textos: string[] = [];
    const caixas: string[] = [];
    for (const nav of document.querySelectorAll("nav")) {
      if (!visivel(nav)) continue;
      const itens = [...nav.querySelectorAll("a, p, button")].filter(visivel);
      textos.push(`nav[${nav.getAttribute("aria-label")}]: ${itens.map(texto).join(" | ")}`);
      for (const item of itens) caixas.push(`${nav.getAttribute("aria-label")}/${texto(item)}@${caixa(item)}`);
    }
    const main = document.querySelector("main");
    if (main) {
      for (const titulo of main.querySelectorAll("h1, h2, h3")) {
        if (!visivel(titulo)) continue;
        textos.push(`${titulo.tagName}: ${texto(titulo)}`);
        caixas.push(`${titulo.tagName}/${texto(titulo)}@${caixa(titulo)}`);
      }
      for (const el of main.querySelectorAll("[data-testid]")) {
        if (!visivel(el)) continue;
        const nome = el.getAttribute("data-testid");
        textos.push(`testid: ${nome}`);
        caixas.push(`${nome}@${caixa(el)}`);
      }
    }
    return { textos, caixas };
  });
}

/** Fundo da página: prova que o tema (a paleta) de fato mudou. */
const fundo = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

async function escolherTema(page: Page, area: "portal" | "conta", tema: Tema) {
  const abrir = page.getByTestId(area === "portal" ? "abrir-menu-usuario" : "abrir-menu-conta");
  await abrir.click();
  const menu = page.getByTestId(area === "portal" ? "menu-usuario" : "menu-conta");
  await menu.getByTestId("seletor-aparencia").getByText(tema.rotulo, { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-tema", tema.valor);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect.poll(() => fundo(page)).toBe(tema.fundo);
}

type Local = { nome: string; abrir: (page: Page) => Promise<void> };

/**
 * Para cada largura: troca o tema pelo seletor (sem recarregar), percorre os
 * locais navegando e confere que a estrutura de cada local é a mesma do
 * primeiro tema. Devolve a estrutura de referência por local e largura.
 */
async function conferirLocais(page: Page, area: "portal" | "conta", prefixo: string, locais: Local[]) {
  for (const largura of LARGURAS) {
    await page.setViewportSize({ width: largura.width, height: largura.height });
    const referencia = new Map<string, Estrutura>();
    for (const tema of TEMAS) {
      await locais[0].abrir(page);
      await escolherTema(page, area, tema);
      for (const local of locais) {
        await local.abrir(page);
        expect(await fundo(page), `${local.nome} ${tema.rotulo}`).toBe(tema.fundo);
        await semRolagemHorizontal(page);
        // Cursor fora do menu: a captura não mostra o realce de hover.
        await page.mouse.move(largura.width - 1, largura.height - 1);
        const atual = await estrutura(page);
        await page.screenshot({
          path: test.info().outputPath(`${prefixo}-${local.nome}-${largura.nome}-${tema.valor}.png`),
          fullPage: true,
        });
        const chave = local.nome;
        const base = referencia.get(chave);
        if (!base) referencia.set(chave, atual);
        else {
          expect(atual.textos, `${prefixo}/${local.nome} ${largura.nome}: ${tema.rotulo} igual a ${TEMAS[0].rotulo}`).toEqual(base.textos);
          expect(atual.caixas, `${prefixo}/${local.nome} ${largura.nome}: posições em ${tema.rotulo}`).toEqual(base.caixas);
        }
      }
    }
  }
}

test("mesma estrutura em todos os temas: portal e /conta (dono, gerente, funcionário)", async ({ browser }) => {
  test.setTimeout(420_000);
  const contexto = await browser.newContext({ colorScheme: "dark", viewport: { width: 1280, height: 900 } });
  const page = await contexto.newPage();
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(e.message));
  const db = await conectarBancoDeTeste();
  try {
    const marca = `layout-tema-${id().slice(0, 8)}`;
    // ------------------------------------------- /conta: dono, gerente e funcionário (mesma conta, papel trocado no banco)
    const dono = await criarContaDeTeste(page.request, {
      ownerName: "Dona Fictícia Layout",
      businessName: `${marca} Estúdio`,
      email: `${marca}-dono@example.test`,
      password: SENHA,
    });
    const tenantId = dono.tenant.id;
    const profissional = await page.request.post(`${API_DE_TESTE}/tenants/${tenantId}/professionals`, {
      data: { name: "Profissional Fictícia", serviceIds: [] },
    });
    expect(profissional.status(), await profissional.text()).toBe(201);
    const professionalId = ((await profissional.json()) as { id: string }).id;

    const navegarPeloMenu = (rotulo: string, caminho: RegExp) => async (p: Page) => {
      if (caminho.test(new URL(p.url()).pathname)) return;
      const link = navConta(p).getByRole("link", { name: rotulo, exact: true });
      if (await link.isVisible()) await link.click();
      else {
        // Celular: o que não está na barra fica no menu da conta.
        await p.getByTestId("abrir-menu-conta").click();
        await p.getByTestId("menu-mais-areas").getByRole("link", { name: rotulo, exact: true }).click();
      }
      await expect(p).toHaveURL(caminho);
      await expect(p.getByRole("heading", { level: 1 })).toBeVisible();
    };
    const abrirInicio = (caminho: string, padrao: RegExp) => async (p: Page) => {
      if (!padrao.test(new URL(p.url()).pathname)) await p.goto(caminho);
      await expect(p.getByRole("heading", { level: 1 })).toBeVisible();
    };

    // Dono: menu agrupado (Atendimento, Gestão do negócio, Administração).
    await page.goto("/conta/visao-geral");
    await expect(navConta(page).getByText("Atendimento", { exact: true })).toBeVisible();
    const menuDoDono = await navConta(page).getByRole("link").allTextContents();
    await conferirLocais(page, "conta", "conta-dono", [
      { nome: "visao-geral", abrir: abrirInicio("/conta/visao-geral", /\/conta\/visao-geral$/) },
      { nome: "agenda", abrir: navegarPeloMenu("Agenda", /\/conta\/agendamentos$/) },
      { nome: "equipe", abrir: navegarPeloMenu("Equipe e acessos", /\/conta\/configuracoes\/equipe$/) },
      { nome: "configuracoes", abrir: navegarPeloMenu("Configurações", /\/conta\/configuracoes$/) },
    ]);
    // O tema não libera nem esconde área: o menu do dono é o mesmo no fim.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/conta/visao-geral");
    await expect(navConta(page).getByRole("link")).toHaveCount(menuDoDono.length);
    expect(await navConta(page).getByRole("link").allTextContents()).toEqual(menuDoDono);

    // Gerente: só as áreas concedidas, nos mesmos grupos.
    // Concessões confirmadas pelo dono (sem a confirmação, nenhuma vale).
    await db.query(
      "UPDATE memberships SET role = 'GERENTE', permissions_confirmed_at = now() WHERE tenant_id = $1 AND user_id = $2",
      [tenantId, dono.user.id],
    );
    for (const permissao of ["CONSUMIDORES_VISUALIZAR", "SERVICOS_VISUALIZAR"]) {
      await db.query(
        `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode)
         SELECT $1, tenant_id, id, $2, 'GRANTED' FROM memberships WHERE tenant_id = $3 AND user_id = $4`,
        [id(), permissao, tenantId, dono.user.id],
      );
    }
    await page.goto("/conta/clientes");
    await expect(navConta(page).getByText("Atendimento", { exact: true })).toBeVisible();
    const menuDoGerente = await navConta(page).getByRole("link").allTextContents();
    expect(menuDoGerente).toEqual(["Clientes", "Serviços", "Configurações"]);
    await conferirLocais(page, "conta", "conta-gerente", [
      { nome: "clientes", abrir: abrirInicio("/conta/clientes", /\/conta\/clientes$/) },
      { nome: "servicos", abrir: navegarPeloMenu("Serviços", /\/conta\/configuracoes\/servicos$/) },
    ]);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/conta/clientes");
    await expect(navConta(page).getByRole("link")).toHaveCount(menuDoGerente.length);
    expect(await navConta(page).getByRole("link").allTextContents()).toEqual(menuDoGerente);

    // Funcionário: lista curta (Minha agenda e Configurações), sem grupos.
    await db.query("UPDATE memberships SET role = 'PROFISSIONAL', professional_id = $3 WHERE tenant_id = $1 AND user_id = $2", [
      tenantId,
      dono.user.id,
      professionalId,
    ]);
    await page.goto("/conta/minha-agenda");
    await expect(page.getByRole("heading", { name: "Minha agenda" })).toBeVisible();
    await expect(navConta(page).getByText("Atendimento", { exact: true })).toHaveCount(0);
    await expect(navConta(page).getByRole("link")).toHaveCount(2);
    expect(await navConta(page).getByRole("link").allTextContents()).toEqual(["Minha agenda", "Configurações"]);
    await conferirLocais(page, "conta", "conta-funcionario", [
      { nome: "minha-agenda", abrir: abrirInicio("/conta/minha-agenda", /\/conta\/minha-agenda$/) },
    ]);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/conta/minha-agenda");
    // Espera o menu montar: `allTextContents` não espera nada.
    await expect(navConta(page).getByRole("link")).toHaveCount(2);
    expect(await navConta(page).getByRole("link").allTextContents()).toEqual(["Minha agenda", "Configurações"]);
    await db.query("UPDATE memberships SET role = 'DONO', professional_id = NULL WHERE tenant_id = $1 AND user_id = $2", [
      tenantId,
      dono.user.id,
    ]);

    // ------------------------------------------- portal da plataforma
    const email = `${marca}-portal@example.test`;
    const proprietaria = await criarContaDeTeste(page.request, {
      ownerName: "Proprietária Fictícia Layout",
      businessName: `${marca} Cadastro`,
      email,
      password: SENHA,
    });
    await db.query("DELETE FROM memberships WHERE user_id = $1", [proprietaria.user.id]);
    await db.query("UPDATE users SET platform_role = 'MASTER_OWNER' WHERE id = $1", [proprietaria.user.id]);
    await contexto.clearCookies();
    await page.goto("/portal");
    await entrarPeloFormulario(page, email, SENHA);
    await expect(page).toHaveURL(VISAO_GERAL_DO_PORTAL);

    const ficha = `/portal/estabelecimentos/${tenantId}`;
    const pelaSecao = (rotulo: string, caminho: RegExp) => async (p: Page) => {
      if (caminho.test(new URL(p.url()).pathname + new URL(p.url()).search)) return;
      if (!(await navPortal(p).isVisible())) await abrirSecoesNoCelular(p);
      await navPortal(p).getByRole("link", { name: rotulo, exact: true }).click();
      await expect(p).toHaveURL(caminho);
      await expect(p.getByRole("heading", { level: 1 })).toBeVisible();
      // Celular: a seção aberta fecha o menu.
      if ((p.viewportSize()?.width ?? 1280) < 768) await expect(navPortal(p)).toHaveCount(0);
    };
    const pelaAba = (rotulo: string, aba: string) => async (p: Page) => {
      if (!new URL(p.url()).pathname.startsWith(ficha)) await p.goto(ficha);
      const nav = p.getByRole("navigation", { name: "Seções do estabelecimento" });
      await nav.getByRole("link", { name: rotulo }).click();
      await expect(p).toHaveURL(aba === "dados" ? new RegExp(`${ficha}(\\?aba=dados)?$`) : new RegExp(`aba=${aba}`));
      await expect(nav.getByRole("link", { name: rotulo })).toHaveAttribute("aria-current", "page");
    };

    // Menu e Visão geral no layout novo, logo na entrada (tema do aparelho).
    await expect(navPortal(page).getByText("Gestão", { exact: true })).toBeVisible();
    await expect(navPortal(page).getByText("Comercial", { exact: true })).toBeVisible();
    await expect(navPortal(page).getByText("Administração", { exact: true })).toBeVisible();
    await expect(page.getByTestId("resumo-atencao")).toBeVisible();
    await expect(page.getByTestId("seletor-de-alcance").getByRole("button")).toHaveCount(3);
    const secoesDoPortal = await navPortal(page).getByRole("link").allTextContents();

    await conferirLocais(page, "portal", "portal", [
      {
        nome: "visao-geral",
        abrir: async (p) => {
          if (!new URL(p.url()).pathname.endsWith("/visao-geral")) await p.goto(VISAO_GERAL_DO_PORTAL);
          await expect(p.getByTestId("indicador-total")).toBeVisible();
          await expect(p.getByTestId("pagamentos-do-mes")).toBeVisible();
        },
      },
      { nome: "estabelecimentos", abrir: pelaSecao("Estabelecimentos", /\/portal\/estabelecimentos$/) },
      { nome: "ficha-dados", abrir: pelaAba("Dados", "dados") },
      { nome: "ficha-plano", abrir: pelaAba("Plano e adicionais", "plano") },
      { nome: "ficha-responsaveis", abrir: pelaAba("Responsáveis", "responsaveis") },
      { nome: "ficha-historico", abrir: pelaAba("Histórico", "historico") },
      { nome: "contas-e-acessos", abrir: pelaSecao("Contas e acessos", /\/portal\/usuarios$/) },
      { nome: "planos-e-adicionais", abrir: pelaSecao("Planos e adicionais", /\/portal\/planos$/) },
    ]);

    // Computador: Modalidade à esquerda de Atenção em qualquer tema.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(VISAO_GERAL_DO_PORTAL);
    const x = async (testId: string) => (await page.getByTestId(testId).boundingBox())!.x;
    expect(await x("modalidades")).toBeLessThan(await x("resumo-atencao"));
    expect(await navPortal(page).getByRole("link").allTextContents()).toEqual(secoesDoPortal);

    // Recarregar mantém o último tema escolhido (Azul e branco) e o layout.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-tema", "azul");
    await expect(page.getByTestId("resumo-atencao")).toBeVisible();
    // E um tema escolhido antes do layout novo, salvo no navegador, abre já no layout novo.
    await page.evaluate(() => localStorage.setItem("agenda-cloud:aparencia", "claro"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-tema", "claro");
    await expect(page.getByTestId("resumo-atencao")).toBeVisible();
    await expect(navPortal(page).getByText("Comercial", { exact: true })).toBeVisible();

    expect(erros, "sem erro de página").toEqual([]);
  } finally {
    await db.end();
    await contexto.close();
  }
});
