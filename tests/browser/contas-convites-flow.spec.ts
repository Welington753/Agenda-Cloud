// Gestão de contas de ponta a ponta, pela tela, contra o backend real, o
// PostgreSQL DESCARTÁVEL e a caixa de e-mail LOCAL
// (support/caixa-de-email.mjs): nenhuma mensagem sai da máquina.
//
// 1. A administração cria uma empresa com o responsável; o e-mail chega à
//    caixa local; a pessoa abre o link, cria a senha e entra. O link não
//    funciona de novo.
// 2. Uma conta EXISTENTE recebe convite para outra empresa: aceita com a
//    senha atual (senha errada é recusada) e continua entrando com ela.
// 3. Convite revogado e falha do provedor aparecem como são; reenviar emite
//    outro link.
// 4. Bloquear pede a senha de novo e derruba a sessão aberta da pessoa.
// 5. Telas em claro e escuro, 1280, 390 e 360 px, sem rolagem horizontal.
//
// A promoção a MASTER_OWNER é só fixture (não há rota para isso).
// Invocação própria (`npm run test:browser:contas`): aceite de convite tem
// limite de 10 por 15 minutos por IP, e esta suíte usa 6.
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { conectarBancoDeTeste, criarContaDeTeste } from "./support/contas-de-teste";

const CAIXA = "http://127.0.0.1:3025";
const SENHA_ADMIN = "senha-da-administracao-123";
const id = () => randomUUID().replaceAll("-", "").slice(0, 10);

async function linkDoConvite(api: APIRequestContext, email: string, anteriores = 0): Promise<string> {
  let link = "";
  await expect
    .poll(async () => {
      const mensagens = (await (await api.get(`${CAIXA}/mensagens?para=${encodeURIComponent(email)}`)).json()) as {
        texto: string;
      }[];
      if (mensagens.length <= anteriores) return false;
      link = /(http:\/\/localhost:3000\/[a-z-]+#t=[0-9a-f]{64})/.exec(mensagens.at(-1)!.texto)?.[1] ?? "";
      return link !== "";
    })
    .toBe(true);
  return link;
}

async function semRolagemHorizontal(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function capturar(page: Page, nome: string) {
  for (const tema of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: tema });
    for (const width of [1280, 390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await semRolagemHorizontal(page);
      await page.screenshot({ path: test.info().outputPath(`contas-${nome}-${tema}-${width}.png`), fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 844 });
}

async function novaPagina(browser: Browser) {
  const contexto = await browser.newContext();
  return { contexto, page: await contexto.newPage() };
}

test("convites, ativação, conta existente, revogação, falha de envio e bloqueio pela tela", async ({ page, browser, request }) => {
  test.setTimeout(180_000);
  const marca = `contas-${id()}`;
  const db = await conectarBancoDeTeste();
  try {
    // Administração: conta com estabelecimento próprio promovida por fixture.
    const admin = await criarContaDeTeste(page.request, {
      ownerName: "Pessoa Administradora",
      businessName: `${marca} Sede`,
      email: `${marca}-admin@example.test`,
      password: SENHA_ADMIN,
    });
    await db.query("UPDATE users SET platform_role = 'MASTER_OWNER' WHERE id = $1", [admin.user.id]);
    const main = page.getByRole("main");

    // ---------------------------------------------- 1. empresa nova + ativação
    await page.goto("/conta/administracao/estabelecimentos");
    await page.getByRole("link", { name: "Novo estabelecimento" }).click();
    await page.getByLabel("Nome do estabelecimento").fill(`${marca} Barbearia Nova`);
    await page.getByLabel("Segmento").selectOption("BARBERSHOP");
    await page.getByLabel("Plano do catálogo").selectOption({ index: 1 });
    await page.getByLabel("Nome", { exact: true }).fill("Dona Nova");
    await page.getByLabel("E-mail").fill(`${marca}-DONA@example.test`);
    await capturar(page, "novo-estabelecimento");
    await page.getByRole("button", { name: "Criar e convidar" }).click();
    const resultado = page.getByTestId("resultado-envio");
    await expect(resultado).toContainText("Estabelecimento criado e convite registrado.");
    await expect(resultado).toContainText("E-mail aceito pelo provedor");
    await expect(resultado).toContainText("conta nova, aguardando ativação");

    const emailDona = `${marca}-dona@example.test`;
    const link = await linkDoConvite(request, emailDona);
    const dona = await novaPagina(browser);
    await dona.page.goto(link);
    await expect(dona.page.getByRole("heading", { name: `Convite para ${marca} Barbearia Nova` })).toBeVisible();
    // O token sai da barra de endereço logo ao abrir.
    expect(new URL(dona.page.url()).hash).toBe("");
    await capturar(dona.page, "convite");
    await dona.page.getByLabel("Crie sua senha").fill("senha-da-dona-nova-1");
    await dona.page.getByLabel("Repita a senha").fill("senha-da-dona-nova-2");
    await dona.page.getByRole("button", { name: "Ativar minha conta" }).click();
    await expect(dona.page.getByRole("main").getByRole("alert")).toContainText("não são iguais");
    await dona.page.getByLabel("Repita a senha").fill("senha-da-dona-nova-1");
    await dona.page.getByRole("button", { name: "Ativar minha conta" }).click();
    await expect(dona.page).toHaveURL(/\/conta\/visao-geral$/);
    await expect(dona.page.getByTestId("estabelecimento-ativo")).toHaveText(`${marca} Barbearia Nova`);
    // Link usado não funciona de novo.
    const reuso = await novaPagina(browser);
    await reuso.page.goto(link);
    await expect(reuso.page.getByRole("main").getByRole("alert")).toHaveText("Este convite já foi usado. Se foi você, entre com a sua senha.");
    await reuso.contexto.close();

    // ---------------------------------- 2. conta existente, outra empresa
    const existente = await novaPagina(browser);
    const senhaExistente = "senha-da-conta-existente-1";
    await criarContaDeTeste(existente.page.request, {
      ownerName: "Conta Existente",
      businessName: `${marca} Clínica Antiga`,
      email: `${marca}-existente@example.test`,
      password: senhaExistente,
    });
    const [nova] = (await db.query("SELECT id FROM units WHERE name = $1", [`${marca} Barbearia Nova`])).rows;
    const [{ tenant_id: tenantNovo }] = (await db.query("SELECT tenant_id FROM units WHERE id = $1", [nova.id])).rows;
    await page.goto(`/conta/administracao/estabelecimentos/${tenantNovo}`);
    const pessoas = main.getByText("Pessoas com acesso").locator("..");
    await expect(pessoas.getByTestId("pessoas-estabelecimento")).toContainText("Dona Nova");
    await page.getByLabel("Nome", { exact: true }).fill("Nome Digitado Diferente");
    await page.getByLabel("E-mail").fill(`${marca}-EXISTENTE@example.test`);
    await page.getByRole("button", { name: "Convidar como dono(a)" }).click();
    await expect(page.getByTestId("resultado-envio")).toContainText("Convite registrado.");
    const linkExistente = await linkDoConvite(request, `${marca}-existente@example.test`);
    await existente.page.goto(linkExistente);
    await existente.page.getByLabel("Senha da sua conta").fill("senha-errada-qualquer");
    await existente.page.getByRole("button", { name: "Aceitar o convite" }).click();
    await expect(existente.page.getByRole("main").getByRole("alert")).toHaveText("Senha incorreta para esta conta.");
    await existente.page.getByLabel("Senha da sua conta").fill(senhaExistente);
    await existente.page.getByRole("button", { name: "Aceitar o convite" }).click();
    await expect(existente.page).toHaveURL(/\/conta\/(visao-geral|selecionar-estabelecimento)$/);
    const [contaExistente] = (
      await db.query("SELECT name, (SELECT count(*)::int FROM memberships m WHERE m.user_id = u.id) AS vinculos FROM users u WHERE email = $1", [
        `${marca}-existente@example.test`,
      ])
    ).rows;
    expect(contaExistente).toEqual({ name: "Conta Existente", vinculos: 2 });

    // ------------------------------------ 3. revogação e falha de envio
    await page.reload();
    await page.getByLabel("Nome", { exact: true }).fill("Pessoa Revogada");
    await page.getByLabel("E-mail").fill(`${marca}-revogada@example.test`);
    await page.getByRole("button", { name: "Convidar como dono(a)" }).click();
    await expect(page.getByTestId("resultado-envio")).toContainText("Convite registrado.");
    const linkRevogado = await linkDoConvite(request, `${marca}-revogada@example.test`);
    await page.goto("/conta/administracao/convites");
    await page.getByLabel("Buscar por nome ou e-mail").fill(`${marca}-revogada`);
    await page.getByRole("button", { name: "Pesquisar" }).click();
    await page.getByTestId("lista-convites").getByRole("button", { name: "Revogar" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Revogar" }).click();
    await expect(page.getByTestId("lista-convites")).toContainText("Revogado");
    const revogado = await novaPagina(browser);
    await revogado.page.goto(linkRevogado);
    await expect(revogado.page.getByRole("main").getByRole("alert")).toHaveText("Este convite foi cancelado pela administração.");
    await revogado.contexto.close();

    await request.post(`${CAIXA}/controle`, { data: { falhar: true } });
    try {
      await page.goto(`/conta/administracao/estabelecimentos/${tenantNovo}`);
      await page.getByLabel("Nome", { exact: true }).fill("Pessoa Sem Envio");
      await page.getByLabel("E-mail").fill(`${marca}-sem-envio@example.test`);
      await page.getByRole("button", { name: "Convidar como dono(a)" }).click();
      await expect(page.getByTestId("resultado-envio")).toContainText("Falha no envio");
      await expect(page.getByTestId("resultado-envio")).toContainText("recusou o envio");
    } finally {
      await request.post(`${CAIXA}/controle`, { data: { falhar: false } });
    }
    await page.goto("/conta/administracao/convites");
    await page.getByLabel("Buscar por nome ou e-mail").fill(`${marca}-sem-envio`);
    await page.getByRole("button", { name: "Pesquisar" }).click();
    await page.getByTestId("lista-convites").getByRole("button", { name: "Reenviar" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reenviar" }).click();
    await expect(page.getByTestId("lista-convites")).toContainText("E-mail aceito pelo provedor");
    await linkDoConvite(request, `${marca}-sem-envio@example.test`);
    await capturar(page, "convites");

    // ------------------------------------- 4. bloqueio com sessão aberta
    await page.goto("/conta/administracao/usuarios");
    await page.getByLabel("Buscar por nome ou e-mail").fill(emailDona);
    await page.getByRole("button", { name: "Pesquisar" }).click();
    await expect(main.getByRole("status")).toHaveText("1 conta(s) encontrada(s)");
    await capturar(page, "usuarios");
    await page.getByTestId("lista-usuarios").getByRole("link", { name: "Dona Nova" }).click();
    await expect(page.getByRole("heading", { name: "Dona Nova", level: 1 })).toBeVisible();
    await capturar(page, "ficha-usuario");
    await page.getByRole("button", { name: "Bloquear conta" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Bloquear" }).click();
    const senha = page.getByTestId("confirmar-senha");
    await expect(senha).toBeVisible();
    await senha.getByLabel("Sua senha").fill(SENHA_ADMIN);
    await senha.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText("Conta bloqueada e sessões encerradas.").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Reativar conta" })).toBeVisible();
    // A sessão que a Dona tinha aberto caiu: a próxima navegação vai ao login.
    await dona.page.goto("/conta/agendamentos");
    await expect(dona.page).toHaveURL(/\/login/);
    await dona.contexto.close();

    // A conta existente continua entrando com a própria senha.
    await existente.contexto.clearCookies();
    await existente.page.goto("/login");
    await existente.page.getByLabel("E-mail").fill(`${marca}-existente@example.test`);
    await existente.page.getByLabel("Senha").fill(senhaExistente);
    await existente.page.getByRole("button", { name: "Entrar" }).click();
    await expect(existente.page).toHaveURL(/\/conta\/(visao-geral|selecionar-estabelecimento)$/);
    await existente.contexto.close();

    // Histórico com as ações, sem token.
    await page.goto("/conta/administracao/historico");
    const historico = page.getByTestId("historico");
    for (const acao of ["Conta bloqueada", "Convite aceito", "Convite revogado", "Estabelecimento criado"]) {
      await expect(historico.getByText(acao, { exact: true }).first()).toBeVisible();
    }
    expect(await historico.textContent()).not.toMatch(/[0-9a-f]{64}/);
  } finally {
    await db.end();
  }
});

test("usuário comum e suporte sem permissão não acessam a gestão de contas", async ({ page }) => {
  const marca = `contas-barrado-${id()}`;
  const conta = await criarContaDeTeste(page.request, {
    ownerName: "Pessoa Comum",
    businessName: `${marca} Loja`,
    email: `${marca}@example.test`,
    password: "senha-da-pessoa-comum-1",
  });
  for (const caminho of ["/platform/users", "/platform/invites", "/platform/audit"]) {
    expect((await page.request.get(`http://localhost:3001${caminho}`)).status()).toBe(403);
  }
  const criar = await page.request.post("http://localhost:3001/platform/establishments", {
    data: {
      requestKey: `barrado${id()}chave`,
      businessName: `${marca} Tentativa`,
      category: "OTHER",
      planId: "qualquer",
      owner: { name: "Alguém", email: `${marca}-alvo@example.test` },
    },
  });
  expect(criar.status()).toBe(403);
  await page.goto("/conta/administracao/usuarios");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Sua conta não tem acesso à administração da plataforma.");

  const db = await conectarBancoDeTeste();
  try {
    await db.query(
      "UPDATE users SET platform_role = 'MASTER_SUPPORT', platform_permissions = ARRAY['ESTABLISHMENTS_MANAGE']::platform_permission[] WHERE id = $1",
      [conta.user.id],
    );
    await page.goto("/conta/administracao/estabelecimentos");
    await expect(page.getByRole("heading", { name: "Estabelecimentos", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Novo estabelecimento" })).toHaveCount(0);
    expect((await page.request.post("http://localhost:3001/platform/establishments", { data: {} })).status()).toBe(400);
    const comCorpoValido = await page.request.post("http://localhost:3001/platform/establishments", {
      data: {
        requestKey: `suporte${id()}chave`,
        businessName: `${marca} Suporte`,
        category: "OTHER",
        planId: "qualquer",
        owner: { name: "Alguém", email: `${marca}-suporte@example.test` },
      },
    });
    expect(comCorpoValido.status()).toBe(403);
  } finally {
    await db.end();
  }
});
