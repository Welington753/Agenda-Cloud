// Acesso de funcionário com NOME DE USUÁRIO e SENHA TEMPORÁRIA, sem e-mail,
// de ponta a ponta pela tela, contra o backend real e o PostgreSQL
// DESCARTÁVEL. Nada é enviado: este fluxo não usa e-mail.
//
// 1. O dono cria, em Configurações → Equipe e acessos, o acesso da
//    profissional (usuário, permissão) e vê a senha temporária uma vez.
// 2. A funcionária entra com o usuário: só a troca de senha funciona (pela
//    tela e pela API) até ela escolher a dela; depois, a própria agenda.
// 3. O mesmo nome de usuário não serve para outra pessoa.
// 4. O dono gera uma nova senha temporária: as sessões dela terminam e a
//    troca volta a ser obrigatória.
// 5. Capturas em claro e escuro, 1280, 390 e 360 px, sem rolagem horizontal.
//
// Invocação própria (`npm run test:browser:acesso-usuario`): 1 aceite de
// convite e 4 logins (limite de 5 por 15 minutos por IP).
import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { API_DE_TESTE, criarContaDeTeste } from "./support/contas-de-teste";

const SENHA_DONO = "senha-do-dono-usuarios-1";
const SENHA_NOVA = "senha-escolhida-pela-bia-1";
const id = () => randomUUID().replaceAll("-", "").slice(0, 8);

async function semRolagemHorizontal(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function capturar(page: Page, nome: string) {
  for (const tema of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: tema });
    for (const width of [1280, 390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await semRolagemHorizontal(page);
      await page.screenshot({ path: test.info().outputPath(`usuario-${nome}-${tema}-${width}.png`), fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 844 });
}

async function confirmarSenhaSePedir(page: Page, senha: string) {
  const dialogo = page.getByTestId("confirmar-senha");
  if (await dialogo.isVisible().catch(() => false)) {
    await page.getByLabel("Sua senha", { exact: true }).fill(senha);
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  }
}

async function entrar(page: Page, identificador: string, senha: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail ou usuário").fill(identificador);
  await page.getByLabel("Senha", { exact: true }).fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
}

async function novaPagina(browser: Browser) {
  const contexto = await browser.newContext();
  return { contexto, page: await contexto.newPage() };
}

test("dono cria acesso com usuário e senha; troca obrigatória; nova senha temporária", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const marca = `usuarios-${id()}`;
  const usuario = `bia.${marca}`;

  // ------------------------------------------------------------- cenário
  const dono = await criarContaDeTeste(page.request, {
    ownerName: "Dona dos Usuários",
    businessName: `${marca} Salão`,
    email: `${marca}-dona@example.test`,
    password: SENHA_DONO,
  });
  const tenantId = dono.tenant.id;
  for (const nome of ["Bia Souza", "Caio Lima"]) {
    const r = await page.request.post(`${API_DE_TESTE}/tenants/${tenantId}/professionals`, { data: { name: nome, serviceIds: [] } });
    expect(r.status(), await r.text()).toBe(201);
  }

  // ------------------------------------------- 1. dono cria o acesso da Bia
  await page.goto("/conta/configuracoes/equipe");
  const bia = page.getByTestId("membro-equipe").filter({ hasText: "Bia Souza" });
  await bia.getByRole("button", { name: "Criar usuário e senha" }).click();
  const formulario = bia.getByTestId("criar-acesso-usuario");
  await expect(formulario.getByLabel("Nome de usuário")).toHaveValue("bia.souza");
  await formulario.getByLabel("Nome de usuário").fill(usuario);
  await formulario.getByLabel("Iniciar os próprios atendimentos").check();
  await formulario.getByRole("button", { name: "Criar acesso" }).click();
  await confirmarSenhaSePedir(page, SENHA_DONO);
  const quadro = bia.getByTestId("senha-temporaria");
  await expect(quadro).toBeVisible();
  await expect(quadro.getByTestId("senha-temporaria-usuario")).toHaveText(usuario);
  const temporaria = (await quadro.getByTestId("senha-temporaria-valor").textContent())!.trim();
  expect(temporaria).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
  await capturar(page, "senha-temporaria");
  await quadro.getByRole("button", { name: "Já entreguei" }).click();
  await expect(bia).toContainText(`usuário ${usuario}`);
  await expect(bia).toContainText("Acesso ativo");
  // Depois de fechado, a senha não aparece mais em lugar nenhum.
  await page.reload();
  await expect(page.getByRole("main")).not.toContainText(temporaria);

  // O mesmo usuário não serve para o Caio.
  const caio = page.getByTestId("membro-equipe").filter({ hasText: "Caio Lima" });
  await caio.getByRole("button", { name: "Criar usuário e senha" }).click();
  await caio.getByLabel("Nome de usuário").fill(usuario.toUpperCase());
  await caio.getByRole("button", { name: "Criar acesso" }).click();
  await confirmarSenhaSePedir(page, SENHA_DONO);
  await expect(caio.getByTestId("erro-criar-acesso")).toContainText("já está em uso");
  await caio.getByRole("button", { name: "Cancelar" }).click();

  // ------------------------------------------- 2. primeiro acesso da Bia
  const fp = await novaPagina(browser);
  try {
    await entrar(fp.page, usuario.toUpperCase(), temporaria);
    await expect(fp.page).toHaveURL(/\/conta\/configuracoes\/perfil$/);
    await expect(fp.page.getByTestId("troca-obrigatoria")).toBeVisible();
    await expect(fp.page.getByTestId("perfil-usuario")).toHaveText(usuario);
    await expect(fp.page.getByRole("navigation", { name: "Áreas da conta" })).toHaveCount(0);
    // Outras páginas levam de volta; a API recusa até a troca.
    await fp.page.goto("/conta/minha-agenda");
    await expect(fp.page).toHaveURL(/\/conta\/configuracoes\/perfil$/);
    const agenda = await fp.page.request.get(`${API_DE_TESTE}/tenants/${tenantId}/my-agenda/range?from=2031-01-01&to=2031-01-02`);
    expect(agenda.status()).toBe(403);
    expect(((await agenda.json()) as { code?: string }).code).toBe("TROCA_DE_SENHA_OBRIGATORIA");
    await capturar(fp.page, "troca-obrigatoria");

    await fp.page.getByLabel("Senha temporária").fill(temporaria);
    await fp.page.getByLabel("Senha nova").fill(SENHA_NOVA);
    await fp.page.getByLabel("Confirme a senha nova").fill(SENHA_NOVA);
    await fp.page.getByTestId("trocar-senha").click();
    await expect(fp.page).toHaveURL(/\/conta\/minha-agenda$/);
    await expect(fp.page.getByRole("navigation", { name: "Áreas da conta" }).getByRole("link")).toHaveText([
      "Minha agenda",
      "Configurações",
    ]);
    await expect(fp.page.getByTestId("minhas-permissoes")).toContainText("Iniciar os seus atendimentos");
    expect((await fp.page.request.get(`${API_DE_TESTE}/tenants/${tenantId}/my-agenda/range?from=2031-01-01&to=2031-01-02`)).status()).toBe(
      200,
    );
    // A conta não ganhou e-mail nenhum; a agenda geral continua recusada.
    expect((await fp.page.request.get(`${API_DE_TESTE}/tenants/${tenantId}/dashboard`)).status()).toBe(403);
    const me = (await (await fp.page.request.get(`${API_DE_TESTE}/auth/me`)).json()) as { user: Record<string, unknown> };
    expect(me.user).toMatchObject({ email: null, username: usuario, mustChangePassword: false });

    // ------------------------------------------- 4. nova senha temporária
    await page.goto("/conta/configuracoes/equipe");
    await bia.getByRole("button", { name: "Gerar nova senha temporária" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Gerar senha" }).click();
    await confirmarSenhaSePedir(page, SENHA_DONO);
    const outra = (await bia.getByTestId("senha-temporaria-valor").textContent())!.trim();
    expect(outra).not.toBe(temporaria);
    // A sessão aberta da Bia terminou.
    expect((await fp.page.request.get(`${API_DE_TESTE}/auth/me`)).status()).toBe(401);
    await fp.page.context().clearCookies();
    await entrar(fp.page, usuario, outra);
    await expect(fp.page).toHaveURL(/\/conta\/configuracoes\/perfil$/);
    await expect(fp.page.getByTestId("troca-obrigatoria")).toBeVisible();
  } finally {
    await fp.contexto.close();
  }

  // ------------------------------------------- login antigo por e-mail continua
  await page.context().clearCookies();
  await entrar(page, `${marca}-dona@example.test`, SENHA_DONO);
  await expect(page).toHaveURL(/\/conta\/visao-geral$/);
});
