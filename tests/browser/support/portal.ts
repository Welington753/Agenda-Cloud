// Peças comuns das suítes do portal da plataforma (`portal-*-flow.spec.ts`).
// Cada suíte roda na própria invocação do Playwright (no CI, com API nova e,
// portanto, contadores de login novos): o limite de 5 logins por 15 minutos
// por IP continua o de produção, e nenhuma suíte passa de 3 logins.
import { expect, type Page } from "@playwright/test";
import { API_DE_TESTE } from "./contas-de-teste";

export const LISTA_DO_PORTAL = "/portal/estabelecimentos";
export const SEM_ACESSO_AO_PORTAL = "Sua conta não tem acesso ao portal da plataforma.";

export const navPortal = (page: Page) => page.getByRole("navigation", { name: "Seções da administração" });
export const navConta = (page: Page) => page.getByRole("navigation", { name: "Áreas da conta" });

/** Login pelo formulário da página aberta (`/portal` ou `/login`). */
export async function entrarPeloFormulario(page: Page, login: string, senha: string) {
  await page.getByLabel("E-mail ou login").fill(login);
  await page.getByLabel("Senha", { exact: true }).fill(senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

export async function semRolagemHorizontal(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

/** `true`/`false` de `GET /platform/access`, ou o status quando não é 200. */
export async function acessoDaApi(page: Page): Promise<boolean | number> {
  const r = await page.request.get(`${API_DE_TESTE}/platform/access`);
  if (r.status() !== 200) return r.status();
  return ((await r.json()) as { canViewEstablishments: boolean }).canViewEstablishments;
}
