// Um cadastro, PostgreSQL descartável real. A promoção de papel é só
// fixture de teste: não existe rota pública para promover uma conta.
import { expect, test } from "@playwright/test";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

const API = "http://localhost:3001";
const id = () => randomUUID().replaceAll("-", "").slice(0, 24);

test("administração real: autorização, busca, paginação, ficha e revogação", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
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
  try {
    const marca = `administracao-${id()}`;
    const register = await page.request.post(`${API}/auth/register`, {
      data: {
        ownerName: "Responsável Plataforma",
        businessName: `${marca} Principal`,
        email: `${marca}@example.test`,
        phone: "11999998888",
        password: "senha-administracao-123",
      },
    });
    expect(register.status(), await register.text()).toBe(201);
    const account = (await register.json()) as {
      user: { id: string };
      tenant: { id: string };
    };
    await page.goto("/administracao");
    await expect(page.getByRole("alert")).toHaveText(
      "Sua conta não tem acesso à administração da plataforma.",
    );
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
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Estabelecimentos", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Buscar estabelecimento ou responsável").fill(marca);
    await page.getByRole("button", { name: "Pesquisar", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(
      "22 estabelecimento(s) encontrado(s)",
    );
    await expect(
      page.getByText("Página 1 de 2", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Próxima", exact: true }).click();
    await expect(
      page.getByText("Página 2 de 2", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: `${marca} Principal`, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Responsáveis", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(`${marca}@example.test`, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Não definido", { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        /Valor contratado, vencimento e pagamentos recebidos não estão disponíveis/,
      ),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: `${marca} Principal`, exact: true }),
    ).toBeVisible();
    for (const width of [1280, 390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`administracao-ficha-${width}.png`),
        fullPage: true,
      });
    }
    await page
      .getByRole("link", { name: "← Estabelecimentos", exact: true })
      .click();
    await page.getByLabel("Buscar estabelecimento ou responsável").fill(marca);
    await page.getByLabel("Situação do acesso").selectOption("SUSPENDED");
    await page.getByRole("button", { name: "Pesquisar", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(
      "1 estabelecimento(s) encontrado(s)",
    );
    for (const width of [1280, 390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`administracao-lista-${width}.png`),
        fullPage: true,
      });
    }
    // Falha de rede não se transforma em zero estabelecimentos.
    const route = `${API}/platform/establishments?*`;
    await page.route(route, (r) => r.abort("failed"));
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Não foi possível conectar ao servidor",
    );
    await expect(
      page.getByLabel("Resumo de todos os estabelecimentos"),
    ).toHaveCount(0);
    await page.unroute(route);
    await page.getByRole("button", { name: "Tentar novamente" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "1 estabelecimento(s) encontrado(s)",
    );
    // Papel revogado vale no próximo request, mesmo com sessão e layout montados.
    await db.query("UPDATE users SET platform_role = NULL WHERE id = $1", [
      account.user.id,
    ]);
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText(
      "Sua conta não tem acesso à administração da plataforma.",
    );
    await expect(
      page.getByText(`${marca} Negócio 0`, { exact: true }),
    ).toHaveCount(0);
    expect(escritas).toBe(0);
  } finally {
    await db.end();
  }
});
