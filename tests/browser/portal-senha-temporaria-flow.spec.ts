// Primeiro acesso do proprietário da plataforma com senha temporária, feito
// INTEIRO pelo portal, sem estabelecimento nenhum, contra o backend real e o
// PostgreSQL DESCARTÁVEL (dados fictícios). A promoção a MASTER_OWNER e a
// marca de senha temporária são fixture de teste.
//
// Login pela entrada do portal; antes da troca, nenhum dado nem ação do
// portal (tela e API); troca pela tela do portal com a mesma política da
// operação; depois, o portal libera na página pedida, a outra sessão da
// conta é encerrada, papel e vínculos não mudam, e a nova senha entra pela
// entrada do portal. Sessão expirada e "Sair" continuam no portal.
//
// Invocação própria (`npm run test:browser:portal-senha-temporaria`): 1
// aceite de convite e 3 tentativas de login (uma com a senha antiga, recusada).
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { API_DE_TESTE, conectarBancoDeTeste, criarContaDeTeste } from "./support/contas-de-teste";
import {
  LISTA_DO_PORTAL as LISTA,
  acessoDaApi,
  entrarPeloFormulario,
  navConta,
  navPortal,
  sairDoPortal,
  semRolagemHorizontal,
} from "./support/portal";

const SENHA_TEMPORARIA = "senha-temporaria-do-portal-1";
const SENHA_NOVA = "senha-escolhida-no-portal-1";
const id = () => randomUUID().replaceAll("-", "").slice(0, 10);

test("proprietário sem estabelecimento troca a senha temporária pelo portal e só então acessa", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const db = await conectarBancoDeTeste();
  // A sessão do aceite do convite fica noutro contexto: é a "outra sessão"
  // que a troca precisa encerrar.
  const outra = await browser.newContext();
  try {
    const marca = `portal-senha-${id()}`;
    const email = `${marca}@example.test`;
    const conta = await criarContaDeTeste(outra.request, {
      ownerName: "Proprietária Temporária",
      businessName: `${marca} Negócio`,
      email,
      password: SENHA_TEMPORARIA,
    });
    await db.query("DELETE FROM memberships WHERE user_id = $1", [conta.user.id]);
    await db.query("UPDATE users SET platform_role = 'MASTER_OWNER', must_change_password = true WHERE id = $1", [
      conta.user.id,
    ]);

    // Login pela entrada do portal, voltando para a página pedida.
    await page.goto("/portal/papeis");
    await expect(page).toHaveURL("/portal?next=%2Fportal%2Fpapeis");
    await entrarPeloFormulario(page, email, SENHA_TEMPORARIA);
    await expect(page).toHaveURL("/portal/papeis");

    // Antes da troca: só a troca de senha, sem menu, sem dados, sem atalhos.
    const troca = page.getByTestId("portal-troca-de-senha");
    await expect(troca).toBeVisible();
    await expect(page.getByTestId("troca-obrigatoria")).toContainText("os dados e as ações do portal");
    await expect(navPortal(page)).toHaveCount(0);
    await expect(navConta(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Proprietários da plataforma" })).toHaveCount(0);
    await expect(page.locator('a[href^="/conta"]')).toHaveCount(0);
    for (const rota of ["/platform/access", "/platform/overview", "/platform/establishments", "/platform/users", "/platform/prices"]) {
      const r = await page.request.get(`${API_DE_TESTE}${rota}`);
      expect(r.status(), rota).toBe(403);
      expect(await r.text(), rota).toContain("TROCA_DE_SENHA_OBRIGATORIA");
    }
    const criar = await page.request.post(`${API_DE_TESTE}/platform/establishments`, { data: {} });
    expect(criar.status()).toBe(403);
    // Outras páginas do portal e a entrada mostram a mesma troca.
    await page.goto(LISTA);
    await expect(troca).toBeVisible();
    await expect(navPortal(page)).toHaveCount(0);
    await page.goto("/portal/visao-geral");
    await expect(troca).toBeVisible();
    await expect(page.getByTestId("indicador-total")).toHaveCount(0);
    await page.setViewportSize({ width: 360, height: 844 });
    await semRolagemHorizontal(page);
    await page.screenshot({ path: testInfo.outputPath("portal-troca-de-senha-360.png"), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.goto("/portal/papeis");
    await expect(troca).toBeVisible();

    // Mesma política da operação: a tela não deixa enviar senha curta nem
    // igual à temporária.
    await troca.getByLabel("Senha temporária").fill(SENHA_TEMPORARIA);
    await troca.getByLabel("Senha nova", { exact: true }).fill("curta");
    await expect(page.getByTestId("erro-trocar-senha")).toContainText("pelo menos 10 caracteres");
    await troca.getByLabel("Senha nova", { exact: true }).fill(SENHA_TEMPORARIA);
    await troca.getByLabel("Confirme a senha nova").fill(SENHA_TEMPORARIA);
    await expect(page.getByTestId("trocar-senha")).toBeDisabled();
    await troca.getByLabel("Senha nova", { exact: true }).fill(SENHA_NOVA);
    await troca.getByLabel("Confirme a senha nova").fill(SENHA_NOVA);
    await page.getByTestId("trocar-senha").click();

    // Depois da troca: o portal libera na mesma página, sem passar pela operação.
    await expect(page).toHaveURL("/portal/papeis");
    await expect(page.getByRole("heading", { name: "Proprietários da plataforma" })).toBeVisible();
    await expect(navPortal(page)).toBeVisible();
    await expect(troca).toHaveCount(0);
    expect(await acessoDaApi(page)).toBe(true);
    await navPortal(page).getByRole("link", { name: "Estabelecimentos" }).click();
    await expect(page).toHaveURL(LISTA);
    await expect(page.getByRole("heading", { name: "Estabelecimentos", exact: true })).toBeVisible();
    await expect(page.locator('a[href^="/conta"]')).toHaveCount(0);

    // Exigência limpa; papel e vínculos intactos; a outra sessão encerrada.
    const [usuario] = (
      await db.query<{ must_change_password: boolean; platform_role: string; status: string }>(
        "SELECT must_change_password, platform_role, status FROM users WHERE id = $1",
        [conta.user.id],
      )
    ).rows;
    expect(usuario).toEqual({ must_change_password: false, platform_role: "MASTER_OWNER", status: "ACTIVE" });
    expect((await db.query("SELECT 1 FROM memberships WHERE user_id = $1", [conta.user.id])).rowCount).toBe(0);
    expect((await outra.request.get(`${API_DE_TESTE}/auth/me`)).status()).toBe(401);

    // Sessão expirada continua no fluxo do portal.
    await db.query(
      "UPDATE sessions SET created_at = now() - interval '1 day', expires_at = now() - interval '1 minute' WHERE user_id = $1",
      [conta.user.id],
    );
    await page.reload();
    await expect(page).toHaveURL(`/portal?next=${encodeURIComponent(LISTA)}`);

    // A senha temporária deixou de valer; a nova entra pelo portal.
    await entrarPeloFormulario(page, email, SENHA_NOVA);
    await expect(page).toHaveURL(LISTA);
    await expect(navPortal(page)).toBeVisible();
    const antiga = await outra.request.post(`${API_DE_TESTE}/auth/login`, {
      data: { login: email, password: SENHA_TEMPORARIA },
    });
    expect(antiga.status()).toBe(401);

    // "Sair" volta para a entrada do portal.
    await sairDoPortal(page);
    await expect(page).toHaveURL("/portal");
    await expect(page.getByRole("heading", { name: "Entrar no portal" })).toBeVisible();
  } finally {
    await outra.close();
    await db.end();
  }
});
