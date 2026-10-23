// Cadastro público FECHADO. Prova, contra o backend real e o PostgreSQL
// descartável, que ninguém cria conta, estabelecimento ou vínculo por conta
// própria:
//
// - o site e o login não oferecem mais "Criar conta"; `/cadastro` só explica
//   que o acesso vem por convite, sem formulário nem chamada à API;
// - chamar a API direto (`POST /auth/register`) devolve 404, sem cookie, e
//   nada é gravado no banco;
// - o login das contas existentes continua igual.
//
// A conta usada no login é criada pela fixture de convite
// (support/contas-de-teste.ts), o caminho real de entrada de contas novas.
import { expect, test } from "@playwright/test";
import { conectarBancoDeTeste, criarContaDeTeste } from "./support/contas-de-teste";

const API = "http://localhost:3001";

test.describe("cadastro público fechado", () => {
  test("site, login e /cadastro não oferecem cadastro livre", async ({ page }) => {
    const chamadasAApi: string[] = [];
    page.on("request", (req) => {
      if (req.url().startsWith(API)) chamadasAApi.push(`${req.method()} ${new URL(req.url()).pathname}`);
    });

    await page.goto("/");
    await expect(page.getByRole("link", { name: "Criar conta" })).toHaveCount(0);
    await page.getByRole("link", { name: "Como obter acesso" }).first().click();
    await expect(page).toHaveURL(/\/cadastro$/);
    await expect(page.getByRole("heading", { name: "O acesso é liberado pela administração" })).toBeVisible();
    await expect(page.locator("form")).toHaveCount(0);
    await expect(page.locator("input")).toHaveCount(0);
    expect(chamadasAApi.filter((c) => c.includes("register"))).toEqual([]);

    await page.goto("/login");
    await expect(page.getByRole("link", { name: "Criar conta" })).toHaveCount(0);
    await page.getByRole("link", { name: "Saiba como obter" }).click();
    await expect(page).toHaveURL(/\/cadastro$/);
  });

  test("POST /auth/register direto na API: 404, sem cookie e sem gravar nada", async ({ request }) => {
    const email = `cadastro-fechado-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const negocio = `Estúdio Fechado ${Date.now()}`;
    const db = await conectarBancoDeTeste();
    try {
      const antes = await db.query<{ tenants: number }>("SELECT count(*)::int AS tenants FROM tenants");
      for (let i = 0; i < 6; i++) {
        const resposta = await request.post(`${API}/auth/register`, {
          data: { ownerName: "Pessoa Visitante", businessName: negocio, email, phone: "11999998888", password: "senha-qualquer-123" },
        });
        expect(resposta.status()).toBe(404);
        expect(resposta.headers()["set-cookie"]).toBeUndefined();
      }
      const usuarios = await db.query("SELECT 1 FROM users WHERE email = $1", [email]);
      const unidades = await db.query("SELECT 1 FROM units WHERE name = $1", [negocio]);
      const depois = await db.query<{ tenants: number }>("SELECT count(*)::int AS tenants FROM tenants");
      expect(usuarios.rows).toEqual([]);
      expect(unidades.rows).toEqual([]);
      expect(depois.rows[0].tenants).toBe(antes.rows[0].tenants);
    } finally {
      await db.end();
    }
  });

  test("conta existente continua entrando pelo login", async ({ page, playwright }) => {
    const senha = "senha-de-conta-existente-123";
    const email = `login-existente-${Date.now()}@example.test`;
    // A fixture ativa a conta num contexto à parte: a página entra pela tela.
    const outro = await playwright.request.newContext();
    try {
      await criarContaDeTeste(outro, { ownerName: "Dona Existente", businessName: `Estúdio Existente ${Date.now()}`, email, password: senha });
    } finally {
      await outro.dispose();
    }
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(senha);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/conta\/visao-geral$/);
  });
});
