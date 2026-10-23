// Administração da plataforma integrada à área da conta: mesmo menu,
// cabeçalho, aparência e menu da conta. PostgreSQL descartável real; a
// promoção de papel é só fixture de teste: não existe rota pública para
// promover uma conta. As contas nascem pela fixture de convite
// (support/contas-de-teste.ts): o cadastro público foi fechado.
import { expect, test, type Page } from "@playwright/test";
import { criarContaDeTeste as contaPorConvite } from "./support/contas-de-teste";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

const API = "http://localhost:3001";
const id = () => randomUUID().replaceAll("-", "").slice(0, 24);
const LISTA = "/conta/administracao/estabelecimentos";
const SEM_ACESSO = "Sua conta não tem acesso à administração da plataforma.";

async function conectar(): Promise<Client> {
  const url = process.env.DATABASE_URL;
  if (
    !url ||
    !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)
  ) {
    throw new Error("Este teste só conecta ao PostgreSQL descartável local.");
  }
  const db = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: true },
  });
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
    password: "senha-administracao-123",
  });
}

const nav = (page: Page) =>
  page.getByRole("navigation", { name: "Áreas da conta" });

/** Sem rolagem horizontal, nas três larguras, em claro e escuro. */
async function capturar(page: Page, nome: string, pasta: (f: string) => string) {
  for (const tema of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: tema });
    for (const width of [1280, 390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: pasta(`administracao-${nome}-${tema}-${width}.png`),
        fullPage: true,
      });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 844 });
}

test("administração no menu principal: autorização, busca, ficha, contexto e revogação", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const db = await conectar();
  try {
    const marca = `administracao-${id()}`;
    const principal = `${marca} Principal`;
    const account = await cadastrar(page, marca);
    // O Next.js injeta `__next-route-announcer__` com role="alert" fora do
    // <main>, assim como a região de avisos com role="status".
    const main = page.getByRole("main");

    // Usuário comum: sem item no menu e, por URL direta (inclusive o
    // endereço antigo), a recusa aparece no mesmo menu da conta.
    await page.goto("/conta/visao-geral");
    await expect(nav(page).getByRole("link", { name: "Agenda" })).toBeVisible();
    await expect(
      nav(page).getByRole("link", { name: "Administração" }),
    ).toHaveCount(0);
    await page.goto("/administracao");
    await expect(page).toHaveURL(LISTA);
    await expect(main.getByRole("alert")).toHaveText(SEM_ACESSO);
    await expect(nav(page).getByRole("link", { name: "Agenda" })).toBeVisible();
    await expect(page.getByTestId("estabelecimento-ativo")).toHaveText(principal);
    expect(
      (await page.request.get(`${API}/platform/establishments`)).status(),
    ).toBe(403);
    expect(
      (
        await page.request.get(
          `${API}/platform/establishments/${account.tenant.id}`,
        )
      ).status(),
    ).toBe(403);

    await db.query(
      "UPDATE users SET platform_role = 'MASTER_OWNER' WHERE id = $1",
      [account.user.id],
    );
    const plans = await db.query<{ id: string }>(
      "SELECT id FROM plans WHERE code = 'equipe'",
    );
    for (let n = 0; n < 21; n++) {
      const tenant = id();
      await db.query(
        "INSERT INTO tenants (id,slug,category,timezone,plan_id,status) VALUES ($1,$2,'OTHER','America/Sao_Paulo',$3,$4)",
        [
          tenant,
          `${marca}-${n}`,
          plans.rows[0].id,
          n === 0 ? "SUSPENDED" : "ACTIVE",
        ],
      );
      await db.query(
        "INSERT INTO units (id,tenant_id,name,address,timezone,is_primary) VALUES ($1,$2,$3,'','America/Sao_Paulo',true)",
        [id(), tenant, `${marca} Negócio ${n}`],
      );
    }
    let escritas = 0;
    page.on("request", (request) => {
      if (
        ["POST", "PATCH", "PUT", "DELETE"].includes(request.method()) &&
        request.url().startsWith(API)
      )
        escritas++;
    });

    // Com o papel confirmado pelo backend, "Administração" entra no menu
    // principal e abre na área central, com o mesmo cabeçalho.
    await page.goto("/conta/visao-geral");
    await expect(page.getByTestId("modo-administracao")).toHaveCount(0);
    await nav(page).getByRole("link", { name: "Administração" }).click();
    await expect(page).toHaveURL(LISTA);
    await expect(
      page.getByRole("heading", { name: "Estabelecimentos", exact: true }),
    ).toBeVisible();
    await expect(
      nav(page).getByRole("link", { name: "Administração" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("modo-administracao")).toHaveText(
      "Administração da plataforma",
    );
    await expect(page.getByTestId("faixa-administracao")).toContainText(
      `Seu estabelecimento ativo continua sendo ${principal}`,
    );
    await expect(page.getByTestId("estabelecimento-ativo")).toHaveText(principal);

    await page.getByLabel("Buscar estabelecimento ou responsável").fill(marca);
    await page.getByRole("button", { name: "Pesquisar", exact: true }).click();
    await expect(main.getByRole("status")).toHaveText(
      "22 estabelecimento(s) encontrado(s)",
    );
    await expect(
      page.getByText("Página 1 de 2", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Próxima", exact: true }).click();
    await expect(
      page.getByText("Página 2 de 2", { exact: true }),
    ).toBeVisible();

    // Ficha de OUTRA empresa: não troca o estabelecimento ativo, não cria
    // vínculo e não entra como dono dela.
    await page
      .getByRole("link", { name: `${marca} Negócio 0`, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: `${marca} Negócio 0`, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Sem responsável vinculado.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("estabelecimento-ativo")).toHaveText(principal);
    await nav(page).getByRole("link", { name: "Agenda" }).click();
    await expect(page).toHaveURL("/conta/agendamentos");
    await expect(page.getByTestId("estabelecimento-ativo")).toHaveText(principal);
    await expect(page.getByTestId("modo-administracao")).toHaveCount(0);
    const vinculos = await db.query<{ tenant_id: string }>(
      "SELECT tenant_id FROM memberships WHERE user_id = $1",
      [account.user.id],
    );
    expect(vinculos.rows).toEqual([{ tenant_id: account.tenant.id }]);
    const me = await page.request.get(`${API}/auth/me`);
    expect(
      ((await me.json()) as { contexts: { tenantId: string }[] }).contexts.map(
        (c) => c.tenantId,
      ),
    ).toEqual([account.tenant.id]);

    // Endereço antigo da ficha encaminha para a experiência integrada.
    await page.goto(`/administracao/estabelecimentos/${account.tenant.id}`);
    await expect(page).toHaveURL(`${LISTA}/${account.tenant.id}`);
    await expect(
      page.getByRole("heading", { name: "Responsáveis", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(`${marca}@example.test`, { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("Não definido", { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        /Valor contratado, vencimento e pagamentos recebidos não estão disponíveis/,
      ),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: principal, exact: true }),
    ).toBeVisible();
    await capturar(page, "ficha", (f) => testInfo.outputPath(f));

    // No celular, a entrada fica no "Mais", sem apertar a barra.
    await page.setViewportSize({ width: 360, height: 844 });
    const mais = nav(page).getByRole("button", { name: /Mais/ });
    await mais.click();
    const menuMais = page.locator("#menu-mais");
    await expect(
      menuMais.getByRole("link", { name: "Administração" }),
    ).toBeVisible();
    await expect(nav(page).locator(":scope > ul:not(#menu-mais) > li:visible")).toHaveCount(5);
    await menuMais.getByRole("link", { name: "Administração" }).click();
    await expect(page).toHaveURL(LISTA);
    await page.setViewportSize({ width: 1280, height: 844 });

    await page.getByLabel("Buscar estabelecimento ou responsável").fill(marca);
    await page.getByLabel("Situação do acesso").selectOption("SUSPENDED");
    await page.getByRole("button", { name: "Pesquisar", exact: true }).click();
    await expect(main.getByRole("status")).toHaveText(
      "1 estabelecimento(s) encontrado(s)",
    );
    await capturar(page, "lista", (f) => testInfo.outputPath(f));

    // Falha de rede não se transforma em zero estabelecimentos.
    const route = `${API}/platform/establishments?*`;
    await page.route(route, (r) => r.abort("failed"));
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await expect(main.getByRole("alert")).toContainText(
      "Não foi possível conectar ao servidor",
    );
    await expect(
      page.getByLabel("Resumo de todos os estabelecimentos"),
    ).toHaveCount(0);
    await page.unroute(route);
    await page.getByRole("button", { name: "Tentar novamente" }).click();
    await expect(main.getByRole("status")).toHaveText(
      "1 estabelecimento(s) encontrado(s)",
    );
    // Papel revogado vale no próximo request, mesmo com sessão e layout montados.
    await db.query("UPDATE users SET platform_role = NULL WHERE id = $1", [
      account.user.id,
    ]);
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await expect(main.getByRole("alert")).toHaveText(SEM_ACESSO);
    await expect(
      page.getByText(`${marca} Negócio 0`, { exact: true }),
    ).toHaveCount(0);
    // Na próxima carga, o item sai do menu.
    await page.goto("/conta/visao-geral");
    await expect(nav(page).getByRole("link", { name: "Agenda" })).toBeVisible();
    await expect(
      nav(page).getByRole("link", { name: "Administração" }),
    ).toHaveCount(0);
    expect(escritas).toBe(0);
  } finally {
    await db.end();
  }
});

test("administrador sem estabelecimento usa a administração; suporte sem permissão não", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const db = await conectar();
  try {
    const marca = `administracao-sem-vinculo-${id()}`;
    const account = await cadastrar(page, marca);
    // Sem vínculo nenhum: a empresa criada no cadastro fica sem responsável.
    await db.query("DELETE FROM memberships WHERE user_id = $1", [
      account.user.id,
    ]);
    await db.query(
      "UPDATE users SET platform_role = 'MASTER_ADMIN', platform_permissions = ARRAY['ESTABLISHMENTS_MANAGE']::platform_permission[] WHERE id = $1",
      [account.user.id],
    );
    const main = page.getByRole("main");

    await page.goto("/conta");
    await expect(nav(page).getByRole("link")).toHaveText([
      "Administração",
      "Minha conta",
    ]);
    await expect(page.getByTestId("estabelecimento-ativo")).toHaveCount(0);
    await nav(page).getByRole("link", { name: "Administração" }).click();
    await expect(page).toHaveURL(LISTA);
    await expect(page.getByTestId("modo-administracao")).toBeVisible();
    await expect(page.getByTestId("faixa-administracao")).toContainText(
      "Sua conta não tem estabelecimento vinculado",
    );
    await page.getByLabel("Buscar estabelecimento ou responsável").fill(marca);
    await page.getByRole("button", { name: "Pesquisar", exact: true }).click();
    await expect(main.getByRole("status")).toHaveText(
      "1 estabelecimento(s) encontrado(s)",
    );
    // Celular: só duas áreas na barra, sem "Mais".
    await page.setViewportSize({ width: 360, height: 844 });
    await expect(nav(page).getByRole("button", { name: /Mais/ })).toHaveCount(0);
    await expect(
      nav(page).getByRole("link", { name: "Administração" }),
    ).toBeVisible();
    await capturar(page, "sem-estabelecimento", (f) => testInfo.outputPath(f));

    // Suporte só com SUPPORT_ACCESS: o servidor nega, o menu não oferece.
    await db.query(
      "UPDATE users SET platform_role = 'MASTER_SUPPORT', platform_permissions = ARRAY['SUPPORT_ACCESS']::platform_permission[] WHERE id = $1",
      [account.user.id],
    );
    await page.goto("/conta");
    await expect(
      page.getByRole("heading", { name: /^Olá/ }),
    ).toBeVisible();
    await expect(nav(page)).toHaveCount(0);
    await page.goto(LISTA);
    await expect(main.getByRole("alert")).toHaveText(SEM_ACESSO);
    expect(
      (await page.request.get(`${API}/platform/establishments`)).status(),
    ).toBe(403);
  } finally {
    await db.end();
  }
});
