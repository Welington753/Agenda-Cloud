// Entrada PRÓPRIA do portal da plataforma (`/portal`), separada da operação,
// contra o backend real e o PostgreSQL DESCARTÁVEL, só com dados fictícios.
// A promoção a MASTER_OWNER é fixture de teste: não existe rota para isso.
//
// Proprietário SEM estabelecimento: o portal pede o login do portal (e não o
// da operação), volta para a página pedida, funciona no celular, a sessão
// expirada e o "Sair" levam de novo à entrada do portal; o login da operação
// continua levando à operação, sem atalho para o portal; um `next` da
// operação na entrada do portal é ignorado.
//
// Invocação própria (`npm run test:browser:portal-entrada`): 1 aceite de
// convite e 3 logins. A senha temporária e as recusas têm suítes próprias
// (portal-senha-temporaria-flow, portal-recusas-flow).
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { conectarBancoDeTeste, criarContaDeTeste } from "./support/contas-de-teste";
import {
  LISTA_DO_PORTAL as LISTA,
  acessoDaApi,
  entrarPeloFormulario,
  navConta,
  navPortal,
  semRolagemHorizontal,
} from "./support/portal";

const SENHA_DONO = "senha-do-proprietario-1";
const id = () => randomUUID().replaceAll("-", "").slice(0, 10);

test("proprietário sem estabelecimento: entrada, login, celular, sessão expirada e logout do portal", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const db = await conectarBancoDeTeste();
  try {
    const marca = `portal-entrada-${id()}`;
    const email = `${marca}@example.test`;
    const conta = await criarContaDeTeste(page.request, {
      ownerName: "Proprietária Fictícia",
      businessName: `${marca} Negócio`,
      email,
      password: SENHA_DONO,
    });
    await db.query("DELETE FROM memberships WHERE user_id = $1", [conta.user.id]);
    await db.query("UPDATE users SET platform_role = 'MASTER_OWNER' WHERE id = $1", [conta.user.id]);
    await page.context().clearCookies();

    // Sem sessão, a página pedida leva à entrada do PORTAL, com a volta.
    await page.goto("/portal/papeis");
    await expect(page).toHaveURL("/portal?next=%2Fportal%2Fpapeis");
    await expect(page.getByRole("heading", { name: "Entrar no portal" })).toBeVisible();
    await expect(navConta(page)).toHaveCount(0);
    await expect(page.locator('a[href^="/conta"]')).toHaveCount(0);
    await entrarPeloFormulario(page, email, SENHA_DONO);
    await expect(page).toHaveURL("/portal/papeis");
    await expect(page.getByRole("heading", { name: "Proprietários da plataforma" })).toBeVisible();
    await expect(navPortal(page)).toBeVisible();
    await expect(page.locator('a[href^="/conta"]')).toHaveCount(0);
    // Entrar no portal não criou vínculo nem pediu estabelecimento.
    expect((await db.query("SELECT 1 FROM memberships WHERE user_id = $1", [conta.user.id])).rowCount).toBe(0);

    // Celular: menu do portal e "Sair" sem rolagem lateral.
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(navPortal(page)).toBeVisible();
      await expect(page.getByRole("button", { name: "Sair" })).toBeVisible();
      await semRolagemHorizontal(page);
      await page.screenshot({ path: testInfo.outputPath(`portal-entrada-celular-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 844 });

    // Sessão expirada no servidor: a próxima abertura volta à entrada do portal.
    await page.goto("/portal/usuarios");
    await expect(page.getByRole("heading", { name: "Usuários", exact: true })).toBeVisible();
    await db.query(
      "UPDATE sessions SET created_at = now() - interval '1 day', expires_at = now() - interval '1 minute' WHERE user_id = $1",
      [conta.user.id],
    );
    await page.reload();
    await expect(page).toHaveURL("/portal?next=%2Fportal%2Fusuarios");
    await entrarPeloFormulario(page, email, SENHA_DONO);
    await expect(page).toHaveURL("/portal/usuarios");

    // "Sair" do portal leva à entrada do portal; nada do portal sem sessão.
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL("/portal");
    await expect(page.getByRole("heading", { name: "Entrar no portal" })).toBeVisible();
    expect(await acessoDaApi(page)).toBe(401);
    await page.goto(LISTA);
    await expect(page).toHaveURL(`/portal?next=${encodeURIComponent(LISTA)}`);

    // O login da operação leva à operação: sem estabelecimento, só as
    // configurações pessoais e nenhum atalho para o portal.
    await page.goto("/login");
    await entrarPeloFormulario(page, email, SENHA_DONO);
    await expect(page).toHaveURL(/\/conta\/configuracoes$/);
    await expect(page.locator('a[href^="/portal"]')).toHaveCount(0);
    await page.setViewportSize({ width: 360, height: 844 });
    await page.getByTestId("abrir-menu-conta").click();
    await expect(page.getByTestId("menu-perfil")).toBeVisible();
    await expect(page.locator('a[href^="/portal"]')).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 844 });

    // Um `next` da operação na entrada do portal nunca é seguido.
    await page.goto("/portal?next=%2Fconta%2Fvisao-geral");
    await expect(page).toHaveURL(LISTA);
    await expect(navPortal(page)).toBeVisible();
  } finally {
    await db.end();
  }
});
