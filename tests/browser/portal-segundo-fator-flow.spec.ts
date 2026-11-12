// Verificação em duas etapas do portal da plataforma, no navegador, contra o
// backend real e o PostgreSQL DESCARTÁVEL, só com dados fictícios. A chave
// TOTP é a fictícia da configuração de teste; os códigos são calculados aqui
// a partir da chave manual que a própria tela mostra (como um aplicativo).
//
// - Master existente (fase optional): portal aberto com o convite para ativar;
//   ativação pela Segurança da conta (senha, QR, chave manual colada no
//   aplicativo, código colado com espaço), códigos de recuperação mostrados
//   uma vez.
// - Nova entrada: o portão mostra só a etapa do código, sem dados do portal;
//   o código certo abre o portal.
// - No celular (390 px): entrada com código de recuperação colado em
//   minúsculas, sem rolagem lateral.
// - Outro proprietário envia uma liberação pela ficha (com a senha
//   confirmada); o link chega só ao e-mail; o master novo entra, usa o link e
//   cadastra o aplicativo.
//
// Invocação própria (`npm run test:browser:portal-segundo-fator`): 2 aceites
// de convite e 4 logins (limite de produção: 5 por 15 minutos por IP).
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import * as OTPAuth from "otpauth";
import { conectarBancoDeTeste, criarContaDeTeste } from "./support/contas-de-teste";
import { entrarPeloFormulario, sairDoPortal, semRolagemHorizontal, VISAO_GERAL_DO_PORTAL } from "./support/portal";

const SENHA = "senha-do-proprietario-2fa-1";
const id = () => randomUUID().replaceAll("-", "").slice(0, 16);

function codigo(chave: string, deslocamentoMs = 0): string {
  return new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(chave.replace(/ /g, "")),
  }).generate({ timestamp: Date.now() + deslocamentoMs });
}

async function colar(page: Page, seletor: string, texto: string) {
  await page.evaluate((t) => navigator.clipboard.writeText(t), texto);
  await page.locator(seletor).click();
  await page.keyboard.press("ControlOrMeta+V");
}

async function mensagensPara(page: Page, email: string): Promise<{ assunto: string; texto: string }[]> {
  const r = await page.request.get(`http://127.0.0.1:3025/mensagens?para=${encodeURIComponent(email)}`);
  return (await r.json()) as { assunto: string; texto: string }[];
}

test("ativação, entrada com código, recuperação no celular e liberação por outro proprietário", async ({ page, context }) => {
  test.setTimeout(240_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:3000" });
  const db = await conectarBancoDeTeste();
  try {
    const marca = `portal-2fa-${id()}`;
    const dona = { email: `${marca}-dona@example.test` };
    const nova = { email: `${marca}-nova@example.test` };
    const contaDona = await criarContaDeTeste(page.request, {
      ownerName: "Proprietária Fictícia",
      businessName: `${marca} Dona`,
      email: dona.email,
      password: SENHA,
    });
    const contaNova = await criarContaDeTeste(page.request, {
      ownerName: "Nova Proprietária Fictícia",
      businessName: `${marca} Nova`,
      email: nova.email,
      password: SENHA,
    });
    await db.query("DELETE FROM memberships WHERE user_id = ANY($1::varchar[])", [[contaDona.user.id, contaNova.user.id]]);
    // Master existente (sem marca) e master novo (precisa cadastrar).
    await db.query("UPDATE users SET platform_role = 'MASTER_OWNER' WHERE id = $1", [contaDona.user.id]);
    await db.query("UPDATE users SET platform_role = 'MASTER_OWNER', second_factor_enrollment_required = true WHERE id = $1", [
      contaNova.user.id,
    ]);
    await page.context().clearCookies();

    // 1) Fase optional, sem fator: portal aberto, com o convite para ativar.
    await page.goto("/portal");
    await entrarPeloFormulario(page, dona.email, SENHA); // login 1
    await expect(page).toHaveURL(new RegExp(`${VISAO_GERAL_DO_PORTAL}$`));
    await expect(page.getByTestId("convite-ativar-segundo-fator")).toBeVisible();
    await page.getByTestId("convite-ativar-segundo-fator").getByRole("link", { name: "Ativar agora" }).click();
    await expect(page.getByTestId("situacao-segundo-fator")).toContainText("desativada");
    await page.getByRole("button", { name: "Ativar a verificação em duas etapas" }).click();
    await page.getByTestId("campo-senha-segundo-fator").fill(SENHA);
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByTestId("qr-code")).toBeVisible();
    await expect(page.getByRole("link", { name: "Abrir no aplicativo autenticador" })).toHaveAttribute("href", /^otpauth:\/\/totp\//);
    const chave = (await page.getByTestId("chave-manual").innerText()).trim();
    expect(chave).toMatch(/^[A-Z2-7 ]+$/);
    // Código errado não ativa.
    await page.getByTestId("campo-codigo-aplicativo").fill("000000");
    await page.getByRole("button", { name: "Confirmar cadastro" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Código incorreto" })).toBeVisible();
    // Código colado com espaço (como vem de alguns aplicativos).
    const doCadastro = codigo(chave);
    await colar(page, '[data-testid="campo-codigo-aplicativo"]', `${doCadastro.slice(0, 3)} ${doCadastro.slice(3)}`);
    await expect(page.getByTestId("campo-codigo-aplicativo")).toHaveValue(doCadastro);
    await page.getByRole("button", { name: "Confirmar cadastro" }).click();
    await expect(page.getByTestId("codigos-de-recuperacao")).toBeVisible();
    const codigos = await page.getByTestId("codigo-de-recuperacao").allInnerTexts();
    expect(codigos).toHaveLength(10);
    await expect(page.getByRole("button", { name: "Continuar" })).toBeDisabled();
    await page.getByLabel("Guardei os códigos em lugar seguro").check();
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByTestId("situacao-segundo-fator")).toContainText("ativa");
    await expect(page.getByTestId("codigos-restantes")).toContainText("Restam 10");
    await expect(page.getByTestId("convite-ativar-segundo-fator")).toHaveCount(0);

    // 2) Nova entrada: só a etapa do código, sem nenhum dado do portal.
    await sairDoPortal(page);
    await page.goto("/portal");
    await entrarPeloFormulario(page, dona.email, SENHA); // login 2
    await expect(page.getByTestId("verificacao-segundo-fator")).toBeVisible();
    await expect(page.getByTestId("conteudo-portal")).toHaveCount(0);
    const acesso = await page.request.get("http://localhost:3001/platform/access");
    expect(await acesso.json()).toMatchObject({ canViewEstablishments: false, secondFactor: { state: "VERIFICATION_REQUIRED" } });
    expect((await page.request.get("http://localhost:3001/platform/overview")).status()).toBe(403);
    // O código do cadastro não vale de novo; o do período seguinte vale.
    await page.getByTestId("campo-codigo-aplicativo").fill(doCadastro);
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Código incorreto" })).toBeVisible();
    await page.getByTestId("campo-codigo-aplicativo").fill(codigo(chave, 30_000));
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByTestId("conteudo-portal")).toBeVisible();

    // 3) Celular: entrada com código de recuperação colado em minúsculas.
    await sairDoPortal(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/portal");
    await entrarPeloFormulario(page, dona.email, SENHA); // login 3
    await expect(page.getByTestId("verificacao-segundo-fator")).toBeVisible();
    await expect(page.getByTestId("campo-codigo-aplicativo")).toHaveAttribute("inputmode", "numeric");
    await expect(page.getByTestId("campo-codigo-aplicativo")).toHaveAttribute("autocomplete", "one-time-code");
    await semRolagemHorizontal(page);
    await page.getByRole("button", { name: "Usar um código de recuperação" }).click();
    await colar(page, '[data-testid="campo-codigo-recuperacao"]', ` ${codigos[0].toLowerCase()} `);
    await expect(page.getByTestId("campo-codigo-recuperacao")).toHaveValue(codigos[0]);
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByTestId("conteudo-portal")).toBeVisible();
    await semRolagemHorizontal(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    // 4) A dona envia a liberação para a nova proprietária pela ficha.
    await page.goto(`/portal/usuarios/${contaNova.user.id}`);
    await page.getByTestId("motivo-liberacao").fill("Primeiro cadastro da proprietária promovida");
    await page.getByRole("button", { name: "Enviar liberação por e-mail" }).click();
    const confirmar = page.getByTestId("confirmar-senha");
    await expect(confirmar).toBeVisible();
    await confirmar.getByLabel("Sua senha").fill(SENHA);
    await confirmar.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByTestId("liberacao-emitida")).toContainText("Liberação enviada");
    await expect(page.getByTestId("secao-segundo-fator")).not.toContainText("liberacao-2fa");
    await expect
      .poll(async () => (await mensagensPara(page, nova.email)).some((m) => /verificação em duas etapas/i.test(m.assunto)))
      .toBe(true);
    const mensagem = (await mensagensPara(page, nova.email)).filter((m) => /verificação em duas etapas/i.test(m.assunto)).at(-1)!;
    const corpo = mensagem.texto;
    const link = /(http\S+\/portal\/liberacao-2fa#t=[0-9a-f]{64})/.exec(corpo)![1];
    await sairDoPortal(page);

    // 5) A nova proprietária: sem liberação, só a explicação; com o link, o cadastro.
    await page.goto(link);
    await expect(page).toHaveURL(/\/portal\?next=/);
    await entrarPeloFormulario(page, nova.email, SENHA); // login 4
    await expect(page).toHaveURL(/\/portal\/seguranca$/);
    await expect(page.getByTestId("cadastro-senha")).toBeVisible();
    await page.getByTestId("campo-senha-segundo-fator").fill(SENHA);
    await page.getByRole("button", { name: "Continuar" }).click();
    const chaveNova = (await page.getByTestId("chave-manual").innerText()).trim();
    await page.getByTestId("campo-codigo-aplicativo").fill(codigo(chaveNova));
    await page.getByRole("button", { name: "Confirmar cadastro" }).click();
    await expect(page.getByTestId("codigo-de-recuperacao")).toHaveCount(10);
    await page.getByLabel("Guardei os códigos em lugar seguro").check();
    await page.getByRole("button", { name: "Continuar" }).click();
    await expect(page.getByTestId("conteudo-portal")).toBeVisible();
    await expect(page.getByTestId("situacao-segundo-fator")).toContainText("ativa");
  } finally {
    await db.end();
  }
});
