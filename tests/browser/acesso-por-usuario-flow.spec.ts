// Acesso de equipe com LOGIN INTERNO e a SENHA ESCOLHIDA PELO DONO, sem
// e-mail, de ponta a ponta pela tela, contra o backend real e o PostgreSQL
// DESCARTÁVEL. Nada é enviado: este fluxo não usa e-mail.
//
// 1. O dono cria, em Configurações → Equipe e acessos → "Criar acesso", o
//    acesso da profissional (perfil, login com aparência de e-mail, senha e
//    confirmação com mostrar/ocultar, permissão). A senha não volta em
//    lugar nenhum.
// 2. A funcionária entra com o login e essa senha direto na própria agenda,
//    sem troca obrigatória, e vê o link público do estabelecimento.
// 3. O mesmo login não serve para outra pessoa, nem o e-mail de outra conta.
// 4. O dono define outra senha: a sessão dela termina, a senha anterior deixa
//    de valer e a nova entra sem troca obrigatória.
// 5. Ela troca a própria senha, por vontade própria, em Perfil e segurança.
// 6. Capturas em claro e escuro, 1280, 390 e 360 px, sem rolagem horizontal.
//
// Invocação própria (`npm run test:browser:acesso-usuario`): 1 aceite de
// convite e 4 tentativas de login, uma recusada de propósito (limite de 5
// por 15 minutos por IP).
import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { API_DE_TESTE, criarContaDeTeste } from "./support/contas-de-teste";

const SENHA_DONO = "senha-do-dono-usuarios-1";
const SENHA_DEFINIDA = "senha-definida-pela-dona-1";
const SENHA_REDEFINIDA = "outra-senha-da-dona-2";
const SENHA_DA_BIA = "senha-escolhida-pela-bia-3";
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

/** O pedido de senha só aparece depois da resposta do servidor (403
 * REAUTENTICACAO_NECESSARIA): espera um pouco por ele antes de seguir. */
async function confirmarSenhaSePedir(page: Page, senha: string) {
  const dialogo = page.getByTestId("confirmar-senha");
  const apareceu = await dialogo
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (apareceu) {
    await page.getByLabel("Sua senha", { exact: true }).fill(senha);
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  }
}

async function entrar(page: Page, identificador: string, senha: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail ou login").fill(identificador);
  await page.getByLabel("Senha", { exact: true }).fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
}

async function novaPagina(browser: Browser) {
  const contexto = await browser.newContext();
  return { contexto, page: await contexto.newPage() };
}

test("dono cria acesso com login e senha escolhida; entra sem troca; dono redefine; troca voluntária", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const marca = `usuarios-${id()}`;
  // Aparência de e-mail, sem ser um: nada é enviado para ele.
  const usuario = `bia@${marca}.salao`;

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
  await page.getByTestId("profissional-sem-acesso").filter({ hasText: "Bia Souza" }).getByRole("button", { name: /Criar acesso/ }).click();
  const formulario = page.getByTestId("criar-acesso");
  await expect(formulario.getByLabel("Profissional vinculado")).toHaveValue(/.+/);
  await expect(formulario.getByLabel("Login")).toHaveValue("bia.souza");
  await formulario.getByLabel("Login").fill(usuario);
  await formulario.getByLabel("Iniciar os próprios atendimentos").check();
  await expect(formulario.getByTestId("resumo-permissoes")).toContainText("iniciar os próprios atendimentos");
  // Sem senha (ou curta, ou diferente da confirmação), não envia.
  const criar = formulario.getByRole("button", { name: "Criar acesso" });
  await expect(criar).toBeDisabled();
  const senha = formulario.getByLabel("Senha", { exact: true });
  const confirmar = formulario.getByLabel("Confirmar senha");
  await expect(senha).toHaveAttribute("type", "password");
  await senha.fill("curta");
  await expect(formulario.getByText("A senha precisa ter pelo menos 10 caracteres.")).toBeVisible();
  await senha.fill(SENHA_DEFINIDA);
  await confirmar.fill(`${SENHA_DEFINIDA}x`);
  await expect(formulario.getByText("A confirmação não é igual à senha.")).toBeVisible();
  await expect(criar).toBeDisabled();
  await confirmar.fill(SENHA_DEFINIDA);
  await formulario.getByRole("button", { name: "Mostrar senha" }).click();
  await expect(senha).toHaveAttribute("type", "text");
  await expect(confirmar).toHaveAttribute("type", "text");
  await formulario.getByRole("button", { name: "Ocultar senha" }).click();
  await expect(senha).toHaveAttribute("type", "password");
  await capturar(page, "criar-acesso");
  const [resposta] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/team/staff-accounts") && r.request().method() === "POST" && r.status() === 200),
    (async () => {
      await criar.click();
      await confirmarSenhaSePedir(page, SENHA_DONO);
    })(),
  ]);
  // A senha escolhida nunca volta na resposta.
  expect(await resposta.text()).not.toContain(SENHA_DEFINIDA);
  expect(await resposta.json()).toMatchObject({ created: true, username: usuario, temporaryPassword: null });
  const criado = page.getByTestId("acesso-criado");
  await expect(criado.getByTestId("acesso-criado-usuario")).toHaveText(usuario);
  await expect(criado).toContainText("sem precisar trocar");
  await expect(page.getByTestId("senha-temporaria")).toHaveCount(0);
  await expect(page.getByRole("main")).not.toContainText(SENHA_DEFINIDA);
  await capturar(page, "acesso-criado");
  await criado.getByRole("button", { name: "Concluir" }).click();
  const bia = page.getByTestId("acesso-equipe").filter({ hasText: "Bia Souza" });
  await expect(bia).toContainText(`login ${usuario}`);
  await expect(bia.getByTestId("situacao-acesso")).toHaveText("Acesso ativo");
  await expect(bia.getByTestId("perfil-acesso")).toHaveText("Profissional");
  await expect(bia.getByTestId("profissional-vinculado")).toHaveText("Bia Souza");
  await page.reload();
  await expect(page.getByRole("main")).not.toContainText(SENHA_DEFINIDA);

  // O mesmo login não serve para o Caio, nem o e-mail real da dona.
  await page.getByTestId("profissional-sem-acesso").filter({ hasText: "Caio Lima" }).getByRole("button", { name: /Criar acesso/ }).click();
  const caio = page.getByTestId("criar-acesso");
  await caio.getByLabel("Senha", { exact: true }).fill("senha-do-caio-123");
  await caio.getByLabel("Confirmar senha").fill("senha-do-caio-123");
  for (const emUso of [usuario.toUpperCase(), `${marca}-dona@example.test`]) {
    await caio.getByLabel("Login").fill(emUso);
    await caio.getByRole("button", { name: "Criar acesso" }).click();
    await confirmarSenhaSePedir(page, SENHA_DONO);
    await expect(caio.getByTestId("erro-criar-acesso")).toContainText("já está em uso");
  }
  await caio.getByRole("button", { name: "Cancelar" }).click();

  // ------------------------------------------- 2. primeiro acesso da Bia
  const fp = await novaPagina(browser);
  try {
    await entrar(fp.page, usuario.toUpperCase(), SENHA_DEFINIDA);
    // Direto na agenda dela: nenhuma troca obrigatória.
    await expect(fp.page).toHaveURL(/\/conta\/minha-agenda$/);
    await expect(fp.page.getByTestId("troca-obrigatoria")).toHaveCount(0);
    await expect(fp.page.getByRole("navigation", { name: "Áreas da conta" }).getByRole("link")).toHaveText([
      "Minha agenda",
      "Configurações",
    ]);
    await expect(fp.page.getByTestId("minhas-permissoes")).toContainText("Iniciar os seus atendimentos");
    // O link público do estabelecimento, para copiar ou abrir (sem parâmetro inventado).
    await expect(fp.page.getByTestId("link-agendamento-endereco")).toHaveText(new RegExp(`/agendar/${dono.tenant.slug}$`));
    await capturar(fp.page, "minha-agenda-com-link");
    expect((await fp.page.request.get(`${API_DE_TESTE}/tenants/${tenantId}/my-agenda/range?from=2031-01-01&to=2031-01-02`)).status()).toBe(
      200,
    );
    // A conta não ganhou e-mail nenhum; a agenda geral continua recusada.
    expect((await fp.page.request.get(`${API_DE_TESTE}/tenants/${tenantId}/dashboard`)).status()).toBe(403);
    const me = (await (await fp.page.request.get(`${API_DE_TESTE}/auth/me`)).json()) as { user: Record<string, unknown> };
    expect(me.user).toMatchObject({ email: null, username: usuario, mustChangePassword: false });

    // ------------------------------------------- 4. dono define outra senha
    await page.goto("/conta/configuracoes/equipe");
    await bia.getByRole("button", { name: "Definir nova senha" }).click();
    const definir = bia.getByTestId("definir-senha");
    await definir.getByLabel("Senha", { exact: true }).fill(SENHA_REDEFINIDA);
    await definir.getByLabel("Confirmar senha").fill(SENHA_REDEFINIDA);
    await capturar(page, "definir-senha");
    const [redefinida] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/password") && r.request().method() === "PUT" && r.status() === 200),
      (async () => {
        await definir.getByRole("button", { name: "Salvar nova senha" }).click();
        await confirmarSenhaSePedir(page, SENHA_DONO);
      })(),
    ]);
    expect(await redefinida.text()).not.toContain(SENHA_REDEFINIDA);
    await expect(bia.getByTestId("senha-definida")).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText(SENHA_REDEFINIDA);
    // A sessão aberta da Bia terminou; a senha anterior não entra mais.
    expect((await fp.page.request.get(`${API_DE_TESTE}/auth/me`)).status()).toBe(401);
    await fp.page.context().clearCookies();
    const antiga = await fp.page.request.post(`${API_DE_TESTE}/auth/login`, { data: { login: usuario, password: SENHA_DEFINIDA } });
    expect(antiga.status()).toBe(401);
    await entrar(fp.page, usuario, SENHA_REDEFINIDA);
    await expect(fp.page).toHaveURL(/\/conta\/minha-agenda$/);

    // ------------------------------------------- 5. troca voluntária
    await fp.page.goto("/conta/configuracoes/perfil");
    await expect(fp.page.getByTestId("troca-obrigatoria")).toHaveCount(0);
    await fp.page.getByLabel("Senha atual").fill(SENHA_REDEFINIDA);
    await fp.page.getByLabel("Senha nova", { exact: true }).fill(SENHA_DA_BIA);
    await fp.page.getByLabel("Confirme a senha nova").fill(SENHA_DA_BIA);
    await fp.page.getByTestId("trocar-senha").click();
    await expect(fp.page.getByText("Senha trocada.", { exact: false })).toBeVisible();
    const daBia = (await (await fp.page.request.get(`${API_DE_TESTE}/auth/me`)).json()) as { user: Record<string, unknown> };
    expect(daBia.user).toMatchObject({ username: usuario, mustChangePassword: false });
  } finally {
    await fp.contexto.close();
  }

  // ------------------------------------------- login antigo por e-mail continua
  await page.context().clearCookies();
  await entrar(page, `${marca}-dona@example.test`, SENHA_DONO);
  await expect(page).toHaveURL(/\/conta\/visao-geral$/);
});
