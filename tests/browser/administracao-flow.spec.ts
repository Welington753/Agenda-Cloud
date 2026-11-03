// Portal da plataforma: área PRÓPRIA (`/portal`), com entrada, cabeçalho e
// menu separados da operação dos estabelecimentos, que não tem atalho para
// cá (a entrada e o login do portal estão em portal-entrada-flow.spec.ts). PostgreSQL descartável real;
// a promoção de papel e os planos fictícios são só fixture de teste: não
// existe rota pública para promover uma conta, e nenhum preço real é gravado.
// As contas nascem pela fixture de convite (support/contas-de-teste.ts).
import { expect, test, type Page } from "@playwright/test";
import { criarContaDeTeste as contaPorConvite } from "./support/contas-de-teste";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

const API = "http://localhost:3001";
const id = () => randomUUID().replaceAll("-", "").slice(0, 24);
const LISTA = "/portal/estabelecimentos";
const SEM_ACESSO = "Sua conta não tem acesso ao portal da plataforma.";
const SENHA = "senha-administracao-123";

async function conectar(): Promise<Client> {
  const url = process.env.DATABASE_URL;
  if (!url || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) {
    throw new Error("Este teste só conecta ao PostgreSQL descartável local.");
  }
  const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
  await db.connect();
  return db;
}

/** Responsável com estabelecimento próprio, ativado pelo convite real; a
 * página fica com a sessão dele. */
function cadastrar(page: Page, marca: string) {
  return contaPorConvite(page.request, {
    ownerName: "Responsável Plataforma",
    businessName: `${marca} Principal`,
    email: `${marca}@example.test`,
    phone: "11999998888",
    password: SENHA,
  });
}

const navConta = (page: Page) => page.getByRole("navigation", { name: "Áreas da conta" });
const navPortal = (page: Page) => page.getByRole("navigation", { name: "Seções da administração" });

async function confirmarSenhaSePedir(page: Page) {
  const dialogo = page.getByTestId("confirmar-senha");
  const apareceu = await dialogo
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (apareceu) {
    await page.getByLabel("Sua senha", { exact: true }).fill(SENHA);
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  }
}

/** Sem rolagem horizontal, nas três larguras, em claro e escuro. */
async function capturar(page: Page, nome: string, pasta: (f: string) => string) {
  for (const tema of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: tema });
    for (const width of [1280, 390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: pasta(`administracao-${nome}-${tema}-${width}.png`), fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 844 });
}

test("portal da plataforma: área própria, recusa por URL e API, ficha, preços, sem vencimento e revogação", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const db = await conectar();
  try {
    const marca = `portal-${id()}`;
    const principal = `${marca} Principal`;
    const account = await cadastrar(page, marca);
    // Dono de um estabelecimento no Max: o plano não dá acesso ao portal.
    await db.query("UPDATE tenants SET plan_id = 'plan_equipe' WHERE id = $1", [account.tenant.id]);
    const main = page.getByRole("main");

    // Sem papel de plataforma: nenhum atalho, e por URL direta (o endereço
    // novo e os antigos) a recusa aparece no portal, sem dados.
    await page.goto("/conta/visao-geral");
    await expect(navConta(page).getByRole("link", { name: "Agenda" })).toBeVisible();
    await expect(navConta(page).getByRole("link", { name: "Portal da plataforma" })).toHaveCount(0);
    for (const caminho of ["/portal", "/plataforma", "/administracao", "/conta/administracao", "/portal/planos", "/plataforma/pagamentos"]) {
      await page.goto(caminho);
      await expect(main.getByRole("alert")).toHaveText(SEM_ACESSO);
      await expect(navPortal(page)).toHaveCount(0);
    }
    await expect(page).toHaveURL("/portal/pagamentos");
    for (const rota of [
      "/platform/establishments",
      `/platform/establishments/${account.tenant.id}`,
      "/platform/prices",
      "/platform/subscription-payments",
      "/platform/users",
      "/platform/audit",
    ]) {
      expect((await page.request.get(`${API}${rota}`)).status()).toBe(403);
    }

    await db.query("UPDATE users SET platform_role = 'MASTER_OWNER' WHERE id = $1", [account.user.id]);
    const planoTeste = `pf${id()}`;
    const nomePlano = `Plano fictício ${planoTeste.slice(-6)}`;
    await db.query(
      `WITH novo AS (INSERT INTO plans (id, code, name, short_description, max_professionals, max_units)
                     VALUES ($1, $1, $2, '', 10, 1) RETURNING id)
       INSERT INTO plan_features (id, plan_id, feature_id)
       SELECT 'pf' || substr(md5(novo.id || f.id), 1, 26), novo.id, f.id FROM novo CROSS JOIN features f`,
      [planoTeste, nomePlano],
    );
    for (let n = 0; n < 21; n++) {
      const tenant = id();
      await db.query(
        "INSERT INTO tenants (id,slug,category,timezone,plan_id,status,access_legacy_since) VALUES ($1,$2,'OTHER','America/Sao_Paulo',$3,$4,now())",
        [tenant, `${marca}-${n}`, planoTeste, n === 0 ? "SUSPENDED" : "ACTIVE"],
      );
      await db.query(
        "INSERT INTO units (id,tenant_id,name,address,timezone,is_primary) VALUES ($1,$2,$3,'','America/Sao_Paulo',true)",
        [id(), tenant, `${marca} Negócio ${n}`],
      );
    }

    // Leituras do portal nunca escrevem nada (até a primeira ação explícita).
    let escritas = 0;
    const contarEscrita = (request: { method(): string; url(): string }) => {
      if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method()) && request.url().startsWith(API)) escritas++;
    };
    page.on("request", contarEscrita);

    // Mesmo com o papel confirmado, a operação continua sem atalho nem grupo
    // "Plataforma"; o portal abre pela entrada própria, com cabeçalho e menu
    // próprios (sem o menu da operação).
    await page.goto("/conta/visao-geral");
    await expect(navConta(page).getByRole("link", { name: "Agenda" })).toBeVisible();
    await expect(page.locator('a[href^="/portal"]')).toHaveCount(0);
    await expect(navConta(page).getByText("Plataforma", { exact: true })).toHaveCount(0);
    await page.goto("/portal");
    await expect(page).toHaveURL(LISTA);
    await expect(page.getByTestId("portal-plataforma")).toHaveText("Portal da plataforma");
    await expect(navConta(page)).toHaveCount(0);
    await expect(navPortal(page).getByRole("link")).toHaveText([
      "Estabelecimentos",
      "Responsáveis e acessos",
      "Convites",
      "Planos e preços",
      "Pagamentos das assinaturas",
      "Proprietários da plataforma",
      "Histórico administrativo",
    ]);
    await expect(page.getByRole("heading", { name: "Estabelecimentos", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /operação/i })).toHaveCount(0);

    await page.getByLabel("Buscar estabelecimento ou responsável").fill(marca);
    await page.getByRole("button", { name: "Pesquisar", exact: true }).click();
    await expect(main.getByRole("status")).toHaveText("22 estabelecimento(s) encontrado(s)");
    await expect(page.getByText("Página 1 de 2", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Próxima", exact: true }).click();
    await expect(page.getByText("Página 2 de 2", { exact: true })).toBeVisible();

    // Ficha de OUTRA empresa, inativa e sem responsável: não troca o
    // estabelecimento ativo nem cria vínculo.
    await page.getByRole("link", { name: `${marca} Negócio 0`, exact: true }).click();
    await expect(page.getByRole("heading", { name: `${marca} Negócio 0`, exact: true })).toBeVisible();
    await expect(page.getByText("Sem responsável vinculado.", { exact: true })).toBeVisible();
    await expect(page.getByTestId("situacao-operacional")).toHaveText("Inativo");

    // Endereços antigos da ficha encaminham para o portal.
    for (const antigo of ["/administracao", "/conta/administracao"]) {
      await page.goto(`${antigo}/estabelecimentos/${account.tenant.id}`);
      await expect(page).toHaveURL(`${LISTA}/${account.tenant.id}`);
    }
    await expect(page.getByRole("heading", { name: "Responsáveis", exact: true })).toBeVisible();
    await expect(page.getByText(`${marca}@example.test`, { exact: true }).first()).toBeVisible();
    // Estabelecimento gravado direto no banco, marcado como anterior ao
    // controle: validade ainda não definida, nem paga nem teste renovado.
    await expect(page.getByTestId("validade-acesso").getByTestId("estado-validade")).toHaveText("Validade ainda não definida");
    await expect(page.getByTestId("validade-nao-definida")).toContainText("individualmente");
    await capturar(page, "ficha", (f) => testInfo.outputPath(f));

    // Filtro por situação e falha de rede (que nunca vira zero estabelecimentos).
    await page.goto(LISTA);
    await page.getByLabel("Buscar estabelecimento ou responsável").fill(marca);
    await page.getByLabel("Situação do acesso").selectOption("SUSPENDED");
    await page.getByRole("button", { name: "Pesquisar", exact: true }).click();
    await expect(main.getByRole("status")).toHaveText("1 estabelecimento(s) encontrado(s)");
    await capturar(page, "lista", (f) => testInfo.outputPath(f));
    const rotaLista = `${API}/platform/establishments?*`;
    await page.route(rotaLista, (r) => r.abort("failed"));
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await expect(main.getByRole("alert")).toContainText("Não foi possível conectar ao servidor");
    await expect(page.getByLabel("Resumo de todos os estabelecimentos")).toHaveCount(0);
    await page.unroute(rotaLista);
    await page.getByRole("button", { name: "Tentar novamente" }).click();
    await expect(main.getByRole("status")).toHaveText("1 estabelecimento(s) encontrado(s)");

    // No celular, nem a barra nem o menu da conta têm atalho do portal; o
    // portal continua abrindo pelo próprio endereço.
    await page.goto("/conta/visao-geral");
    await page.setViewportSize({ width: 360, height: 844 });
    await expect(navConta(page).locator(":scope > ul > li:visible")).toHaveCount(4);
    await page.getByTestId("abrir-menu-conta").click();
    await expect(page.getByTestId("menu-perfil")).toBeVisible();
    await expect(page.locator('a[href^="/portal"]')).toHaveCount(0);
    await page.goto("/portal");
    await expect(page).toHaveURL(LISTA);
    await expect(navPortal(page)).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 844 });
    expect(escritas).toBe(0);
    page.off("request", contarEscrita);

    // Planos e preços: preço pendente nunca aparece como gratuito.
    await navPortal(page).getByRole("link", { name: "Planos e preços" }).click();
    await expect(page.getByTestId(`preco-${planoTeste}-MONTHLY`)).toHaveText("Pendente");
    const cartaoPlano = page
      .getByTestId("catalogo-de-precos")
      .locator(":scope > *")
      .filter({ has: page.getByRole("heading", { name: nomePlano, exact: true }) });
    await cartaoPlano.getByRole("button", { name: "Definir preço mensal" }).click();
    await page.getByTestId("form-preco-catalogo").getByLabel("Novo preço (R$)").fill("67,50");
    await page.getByRole("dialog").getByRole("button", { name: "Salvar preço" }).click();
    await confirmarSenhaSePedir(page);
    await expect(page.getByTestId(`preco-${planoTeste}-MONTHLY`)).toHaveText("R$ 67,50");
    await expect(page.getByTestId(`preco-${planoTeste}-QUARTERLY`)).toHaveText("Pendente");
    await capturar(page, "planos", (f) => testInfo.outputPath(f));

    // Ficha de outra empresa: preço sugerido do catálogo no pagamento, com a
    // origem.
    await navPortal(page).getByRole("link", { name: "Estabelecimentos" }).click();
    await page.getByLabel("Buscar estabelecimento ou responsável").fill(`${marca} Negócio 1`);
    await page.getByRole("button", { name: "Pesquisar", exact: true }).click();
    await page.getByRole("link", { name: `${marca} Negócio 1`, exact: true }).click();
    await expect(page.getByRole("heading", { name: `${marca} Negócio 1`, exact: true })).toBeVisible();
    await expect(page.getByTestId("situacao-operacional")).toHaveText("Ativo");
    await expect(page.getByTestId("preco-contratado").getByTestId("preco-MONTHLY")).toContainText("R$ 67,50");
    await expect(page.getByTestId("preco-contratado").getByTestId("preco-QUARTERLY")).toContainText("Pendente");
    await page.getByTestId("validade-acesso").getByRole("button", { name: "Registrar pagamento" }).click();
    await expect(page.getByTestId("valor-pagamento")).toHaveValue("67,50");
    await expect(page.getByTestId("origem-do-valor")).toContainText("Preço do catálogo");
    await page.getByTestId("valor-pagamento").fill("60,00");
    await expect(page.getByTestId("origem-do-valor")).toContainText("ajustado só neste pagamento");
    await expect(page.getByTestId("atualizar-contrato")).not.toBeChecked();
    await page.getByTestId("form-pagamento").getByLabel("Ciclo").selectOption("QUARTERLY");
    await expect(page.getByTestId("valor-pagamento")).toHaveValue("");
    await expect(page.getByTestId("origem-do-valor")).toContainText("Preço ainda não definido");
    await capturar(page, "registrar-pagamento", (f) => testInfo.outputPath(f));
    await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();

    // Sem vencimento: concessão com motivo e confirmação; a retirada mostra a
    // consequência antes (sem período: bloqueia, sem voltar ao legado).
    const semVencimento = page.getByTestId("sem-vencimento");
    await semVencimento.getByRole("button", { name: "Conceder sem vencimento" }).click();
    const formulario = page.getByTestId("form-sem-vencimento");
    await formulario.getByLabel("Motivo (fica no histórico)").fill("Parceria fictícia de teste");
    await expect(page.getByRole("dialog").getByRole("button", { name: "Conceder" })).toBeDisabled();
    await formulario.getByRole("checkbox").check();
    await page.getByRole("dialog").getByRole("button", { name: "Conceder" }).click();
    await confirmarSenhaSePedir(page);
    await expect(semVencimento).toContainText("Em vigor");
    await expect(page.getByTestId("validade-acesso").getByTestId("estado-validade")).toHaveText("Sem vencimento");
    await semVencimento.getByRole("button", { name: "Retirar sem vencimento" }).click();
    await expect(page.getByTestId("consequencia-retirada")).toContainText("não há período registrado");
    await capturar(page, "retirar-sem-vencimento", (f) => testInfo.outputPath(f));
    await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();

    const vinculos = await db.query<{ tenant_id: string }>("SELECT tenant_id FROM memberships WHERE user_id = $1", [
      account.user.id,
    ]);
    expect(vinculos.rows).toEqual([{ tenant_id: account.tenant.id }]);

    // A operação continua com o estabelecimento ativo de sempre.
    await page.goto("/conta/visao-geral");
    await expect(page.getByTestId("estabelecimento-ativo")).toHaveText(principal);

    // Papel revogado vale na próxima leitura, com a sessão e o portal abertos.
    await page.goto("/portal/pagamentos");
    await expect(page.getByRole("heading", { name: "Pagamentos das assinaturas" })).toBeVisible();
    await db.query("UPDATE users SET platform_role = NULL WHERE id = $1", [account.user.id]);
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await expect(main.getByRole("alert")).toHaveText(SEM_ACESSO);
    expect((await page.request.get(`${API}/platform/prices`)).status()).toBe(403);
  } finally {
    await db.end();
  }
});

test("proprietário sem estabelecimento entra no portal; papel delegado antigo não", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const db = await conectar();
  try {
    const marca = `portal-sem-vinculo-${id()}`;
    const account = await cadastrar(page, marca);
    await db.query("DELETE FROM memberships WHERE user_id = $1", [account.user.id]);
    await db.query("UPDATE users SET platform_role = 'MASTER_OWNER' WHERE id = $1", [account.user.id]);
    const main = page.getByRole("main");

    // Na operação, sem vínculo: só as configurações pessoais, sem menu de
    // áreas nem atalho do portal ("/conta" não leva mais ao portal).
    await page.goto("/conta");
    await expect(page).toHaveURL(/\/conta\/configuracoes$/);
    await expect(navConta(page)).toHaveCount(0);
    await expect(page.locator('a[href^="/portal"]')).toHaveCount(0);
    expect(
      await page.getByTestId("secoes-configuracoes").getByRole("link").evaluateAll((l) => l.map((a) => a.getAttribute("href"))),
    ).toEqual(["/conta/configuracoes/aparencia", "/conta/configuracoes/perfil"]);
    await page.goto("/conta/configuracoes/equipe");
    await expect(page).toHaveURL(/\/conta\/configuracoes$/);
    // O portal, pela entrada própria, sem pedir estabelecimento.
    await page.goto("/portal");
    await expect(page).toHaveURL(LISTA);
    await page.getByLabel("Buscar estabelecimento ou responsável").fill(marca);
    await page.getByRole("button", { name: "Pesquisar", exact: true }).click();
    await expect(main.getByRole("status")).toHaveText("1 estabelecimento(s) encontrado(s)");
    await capturar(page, "sem-estabelecimento", (f) => testInfo.outputPath(f));

    // Papel delegado antigo, mesmo com a permissão de gerir estabelecimentos:
    // o portal é exclusivo do proprietário.
    await db.query(
      "UPDATE users SET platform_role = 'MASTER_ADMIN', platform_permissions = ARRAY['ESTABLISHMENTS_MANAGE']::platform_permission[] WHERE id = $1",
      [account.user.id],
    );
    await page.goto("/conta");
    await expect(page).toHaveURL(/\/conta\/configuracoes$/);
    await page.goto(LISTA);
    await expect(main.getByRole("alert")).toHaveText(SEM_ACESSO);
    expect((await page.request.get(`${API}/platform/establishments`)).status()).toBe(403);
  } finally {
    await db.end();
  }
});
