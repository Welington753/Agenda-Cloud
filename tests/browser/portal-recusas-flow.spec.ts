// Recusas do portal da plataforma, contra o backend real e o PostgreSQL
// DESCARTÁVEL, só com dados fictícios. A promoção e a suspensão do
// proprietário são fixture de teste: não existe rota para isso.
//
// 1. Dono no plano Max, gerente e profissional (sem papel global): recusados
//    no portal pela URL nova e pelas antigas e pela API `/platform/*`; a
//    operação deles não tem atalho para o portal; a reautenticação
//    compartilhada (`/platform/reauth`) continua servindo às ações de equipe
//    do dono.
// 2. MASTER_OWNER suspenso: a sessão deixa de valer na próxima leitura, a API
//    recusa e o portal volta para a própria entrada.
//
// Invocação própria (`npm run test:browser:portal-recusas`): 2 aceites de
// convite e 2 logins.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { API_DE_TESTE, conectarBancoDeTeste, criarContaDeTeste } from "./support/contas-de-teste";
import { LISTA_DO_PORTAL as LISTA, SEM_ACESSO_AO_PORTAL, acessoDaApi, navConta, navPortal } from "./support/portal";

const SENHA_DONO = "senha-do-dono-do-max-1";
const SENHA_EQUIPE = "senha-da-equipe-do-max-1";
const id = () => randomUUID().replaceAll("-", "").slice(0, 10);
const ROTAS_DA_API = [
  "/platform/overview",
  "/platform/establishments",
  "/platform/establishments?filter=EXPIRING_SOON",
  "/platform/prices",
  "/platform/users",
  "/platform/audit",
  "/platform/subscription-payments",
];

async function recusadoNoPortal(page: Page) {
  for (const caminho of ["/portal", "/portal/visao-geral", "/portal/papeis", "/plataforma/usuarios", "/conta/administracao"]) {
    await page.goto(caminho);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(SEM_ACESSO_AO_PORTAL);
    await expect(navPortal(page)).toHaveCount(0);
  }
  for (const rota of ROTAS_DA_API) {
    expect((await page.request.get(`${API_DE_TESTE}${rota}`)).status(), rota).toBe(403);
  }
  expect(await acessoDaApi(page)).toBe(false);
}

async function paginaComLogin(browser: Browser, login: string, senha: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  const r = await page.request.post(`${API_DE_TESTE}/auth/login`, { data: { login, password: senha } });
  expect(r.status(), await r.text()).toBe(200);
  return page;
}

test("dono no Max, gerente e profissional são recusados no portal; a reautenticação da equipe continua", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const db = await conectarBancoDeTeste();
  try {
    const marca = `portal-max-${id()}`;
    const dono = await criarContaDeTeste(page.request, {
      ownerName: "Dono do Max",
      businessName: `${marca} Estúdio`,
      email: `${marca}@example.test`,
      password: SENHA_DONO,
    });
    const tenantId = dono.tenant.id;
    await db.query("UPDATE tenants SET plan_id = 'plan_equipe' WHERE id = $1", [tenantId]);

    // A reautenticação compartilhada serve ao dono (não é rota exclusiva do
    // portal) e libera a criação dos acessos da equipe.
    expect((await page.request.post(`${API_DE_TESTE}/platform/reauth`, { data: { password: SENHA_DONO } })).status()).toBe(204);
    const prof = await page.request.post(`${API_DE_TESTE}/tenants/${tenantId}/professionals`, {
      data: { name: "Profissional Fictícia", serviceIds: [] },
    });
    expect(prof.status(), await prof.text()).toBe(201);
    const professionalId = ((await prof.json()) as { professional: { id: string } }).professional.id;
    const logins = { GERENTE: `gerente@${marca}`, PROFISSIONAL: `profissional@${marca}` } as const;
    for (const role of ["GERENTE", "PROFISSIONAL"] as const) {
      const r = await page.request.post(`${API_DE_TESTE}/tenants/${tenantId}/team/staff-accounts`, {
        data: {
          requestKey: `chave-${id()}`,
          role,
          professionalId: role === "PROFISSIONAL" ? professionalId : null,
          name: role === "GERENTE" ? "Gerente Fictício" : "Profissional Fictícia",
          username: logins[role],
          permissions: [],
          password: SENHA_EQUIPE,
        },
      });
      expect(r.status(), await r.text()).toBe(200);
    }

    // Dono no Max: operação sem atalho; portal recusado pela URL e pela API.
    await page.goto("/conta/visao-geral");
    await expect(navConta(page).getByRole("link", { name: "Agenda" })).toBeVisible();
    await expect(page.locator('a[href^="/portal"]')).toHaveCount(0);
    await recusadoNoPortal(page);

    for (const role of ["GERENTE", "PROFISSIONAL"] as const) {
      const equipe = await paginaComLogin(browser, logins[role], SENHA_EQUIPE);
      await equipe.goto("/conta");
      await expect(navConta(equipe)).toBeVisible();
      await expect(equipe.locator('a[href^="/portal"]')).toHaveCount(0);
      await recusadoNoPortal(equipe);
      await equipe.context().close();
    }

    // Nenhuma recusa mexeu no papel global do dono.
    const papeis = await db.query("SELECT platform_role FROM users WHERE id = $1", [dono.user.id]);
    expect(papeis.rows).toEqual([{ platform_role: null }]);
  } finally {
    await db.end();
  }
});

test("proprietário suspenso é recusado no portal e na API", async ({ page }) => {
  test.setTimeout(60_000);
  const db = await conectarBancoDeTeste();
  try {
    const marca = `portal-suspenso-${id()}`;
    const conta = await criarContaDeTeste(page.request, {
      ownerName: "Proprietário Suspenso",
      businessName: `${marca} Negócio`,
      email: `${marca}@example.test`,
      password: SENHA_DONO,
    });
    await db.query("DELETE FROM memberships WHERE user_id = $1", [conta.user.id]);
    await db.query("UPDATE users SET platform_role = 'MASTER_OWNER' WHERE id = $1", [conta.user.id]);
    await page.goto(LISTA);
    await expect(navPortal(page)).toBeVisible();
    expect(await acessoDaApi(page)).toBe(true);

    await db.query("UPDATE users SET status = 'SUSPENDED' WHERE id = $1", [conta.user.id]);
    for (const rota of ["/platform/access", ...ROTAS_DA_API]) {
      expect((await page.request.get(`${API_DE_TESTE}${rota}`)).status(), rota).toBe(401);
    }
    await page.goto("/portal/papeis");
    await expect(page).toHaveURL("/portal?next=%2Fportal%2Fpapeis");
    await expect(navPortal(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Entrar no portal" })).toBeVisible();
  } finally {
    await db.end();
  }
});
