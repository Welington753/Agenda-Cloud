// "Esqueci minha senha" de ponta a ponta, pela tela, contra o backend real, o
// PostgreSQL DESCARTÁVEL e a caixa de e-mail LOCAL
// (support/caixa-de-email.mjs): nenhuma mensagem sai da máquina.
//
// 1. Do login: o link abre a tela simples; a orientação para login sem e-mail
//    está sempre visível. Um login de equipe e um e-mail confirmado recebem
//    a MESMA resposta; só o e-mail confirmado recebe mensagem.
// 2. O link abre "Nova senha" e "Confirmar senha"; salvar volta ao login, a
//    sessão aberta com a senha antiga cai e a senha nova entra. O link não
//    funciona de novo.
// 3. Do portal: o link leva à mesma tela e "Voltar" volta ao portal.
// 4. Capturas nos quatro temas, 390 e 1280 px, sem rolagem horizontal.
//
// Invocação própria (`npm run test:browser:recuperacao-senha`): o pedido tem
// limite de 5 por 15 minutos por IP (esta suíte usa 2), e o login, 5 por
// processo da API (esta suíte usa 1).
import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { conectarBancoDeTeste, criarContaDeTeste } from "./support/contas-de-teste";
import { entrarPeloFormulario, semRolagemHorizontal } from "./support/portal";

const CAIXA = "http://127.0.0.1:3025";
const CHAVE_APARENCIA = "agenda-cloud:aparencia";
const SENHA_ANTIGA = "senha-antiga-da-dona-1";
const SENHA_NOVA = "senha-nova-pelo-esqueci-1";
const id = () => randomUUID().replaceAll("-", "").slice(0, 10);

async function mensagensPara(page: Page, email: string): Promise<{ assunto: string; texto: string }[]> {
  return (await (await page.request.get(`${CAIXA}/mensagens?para=${encodeURIComponent(email)}`)).json()) as {
    assunto: string;
    texto: string;
  }[];
}

async function capturarNosTemas(browser: Browser, caminho: string, nome: string) {
  for (const tema of ["claro", "escuro", "sistema", "azul"] as const) {
    for (const width of [390, 1280]) {
      const contexto = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: "dark" });
      await contexto.addInitScript(([chave, valor]) => localStorage.setItem(chave, valor), [CHAVE_APARENCIA, tema]);
      const page = await contexto.newPage();
      await page.goto(caminho);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await semRolagemHorizontal(page);
      await page.screenshot({ path: test.info().outputPath(`recuperacao-${nome}-${tema}-${width}.png`), fullPage: true });
      await contexto.close();
    }
  }
}

test("esqueci minha senha: pedido genérico, link por e-mail confirmado, nova senha, sessões encerradas", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const marca = `recup-${id()}`;
  const email = `${marca}-dona@example.test`;
  const loginEquipe = `${marca}-maria@salao`;

  // Dona ativada por convite (e-mail confirmado) e com sessão aberta neste
  // navegador; funcionária só com login (sem e-mail).
  await criarContaDeTeste(page.request, {
    ownerName: "Dona Recuperação",
    businessName: `${marca} Salão`,
    email,
    password: SENHA_ANTIGA,
  });
  const db = await conectarBancoDeTeste();
  try {
    const equipeId = `u${id()}${id()}`.slice(0, 24);
    await db.query(`INSERT INTO users (id, name, username, status) VALUES ($1, 'Maria Equipe', $2, 'ACTIVE')`, [
      equipeId,
      loginEquipe,
    ]);
    const [{ password_hash }] = (await db.query(`SELECT c.password_hash FROM credentials c JOIN users u ON u.id = c.user_id WHERE u.email = $1`, [email])).rows;
    await db.query(`INSERT INTO credentials (id, user_id, password_hash, algorithm) VALUES ($1, $2, $3, 'argon2id')`, [
      `c${id()}${id()}`.slice(0, 24),
      equipeId,
      password_hash,
    ]);
  } finally {
    await db.end();
  }
  const sessaoAntiga = await browser.newContext();
  await sessaoAntiga.addCookies(await page.context().cookies());
  const paginaAntiga = await sessaoAntiga.newPage();
  await paginaAntiga.goto("/conta");
  await expect(paginaAntiga).toHaveURL(/\/conta/);

  // ------------------------------------------------ 1. do login, pedido genérico
  // Azul e branco: as capturas dos estados de sucesso saem neste tema.
  const anonimo = await browser.newContext({ viewport: { width: 1280, height: 844 } });
  await anonimo.addInitScript(([chave, valor]) => localStorage.setItem(chave, valor), [CHAVE_APARENCIA, "azul"]);
  const a = await anonimo.newPage();
  const foto = async (nome: string, larguras: number[]) => {
    for (const width of larguras) {
      await a.setViewportSize({ width, height: 844 });
      await semRolagemHorizontal(a);
      await a.screenshot({ path: test.info().outputPath(`recuperacao-azul-${nome}-${width}.png`), fullPage: true });
    }
    await a.setViewportSize({ width: 1280, height: 844 });
  };
  await a.goto("/login");
  await a.getByRole("link", { name: "Esqueci minha senha" }).click();
  await expect(a).toHaveURL(/\/esqueci-senha$/);
  await expect(a.getByRole("heading", { level: 1, name: "Recuperar senha" })).toBeVisible();
  await expect(a.getByText("Usa um login sem e-mail?")).toBeVisible();

  await a.getByLabel("E-mail ou login").fill(loginEquipe);
  await a.getByRole("button", { name: "Enviar link" }).click();
  const confirmacao = a.getByRole("status").filter({ hasText: "Pedido recebido." });
  await expect(confirmacao).toBeVisible();
  const textoParaEquipe = await confirmacao.textContent();
  await foto("pedido-recebido", [390, 1280]);
  await expect(a.getByText("Usa um login sem e-mail?")).toBeVisible();

  await a.getByRole("button", { name: "Usar outro e-mail ou login" }).click();
  await a.getByLabel("E-mail ou login").fill(email.toUpperCase());
  await a.getByRole("button", { name: "Enviar link" }).click();
  await expect(confirmacao).toBeVisible();
  // Mesma resposta para o login sem e-mail e para o e-mail confirmado.
  expect(await confirmacao.textContent()).toBe(textoParaEquipe);

  let link = "";
  await expect
    .poll(async () => {
      const recebidas = await mensagensPara(a, email);
      link = /(http:\/\/localhost:3000\/redefinir-senha#t=[0-9a-f]{64})/.exec(recebidas.at(-1)?.texto ?? "")?.[1] ?? "";
      return link !== "";
    })
    .toBe(true);
  expect((await mensagensPara(a, email)).at(-1)!.assunto).toBe("Recuperação de senha no TimVix");
  expect(await mensagensPara(a, loginEquipe)).toEqual([]);

  // ------------------------------------------------ 2. nova senha pelo link
  await a.goto(link);
  await expect(a.getByRole("heading", { level: 1, name: "Criar nova senha" })).toBeVisible();
  await foto("nova-senha", [1280]);
  await a.getByLabel("Nova senha").fill(SENHA_NOVA);
  await a.getByLabel("Confirmar senha").fill("outra-coisa-qualquer");
  await a.getByRole("button", { name: "Salvar nova senha" }).click();
  await expect(a.getByRole("main").getByRole("alert")).toHaveText("As duas senhas não são iguais.");
  await a.setViewportSize({ width: 390, height: 844 });
  await semRolagemHorizontal(a);
  await a.screenshot({ path: test.info().outputPath("recuperacao-nova-senha-390.png"), fullPage: true });
  await a.getByLabel("Confirmar senha").fill(SENHA_NOVA);
  await a.getByRole("button", { name: "Salvar nova senha" }).click();
  await expect(a.getByRole("heading", { level: 1, name: "Senha alterada" })).toBeVisible();
  await expect(a.getByText("ela continua sendo pedida ao entrar")).toBeVisible();
  await expect(a.getByRole("link", { name: "Entrar no portal da plataforma" })).toHaveAttribute("href", "/portal");
  await foto("senha-alterada", [390, 1280]);

  // A sessão aberta com a senha antiga caiu.
  await paginaAntiga.goto("/conta");
  await expect(paginaAntiga).toHaveURL(/\/login/);

  await a.getByRole("link", { name: "Ir para o login" }).click();
  await expect(a).toHaveURL(/\/login$/);
  await entrarPeloFormulario(a, email, SENHA_NOVA);
  await expect(a).toHaveURL(/\/conta/);

  // O mesmo link não vale de novo.
  const outra = await browser.newContext();
  const o = await outra.newPage();
  await o.goto(link);
  await expect(o.getByRole("heading", { level: 1, name: "Link indisponível" })).toBeVisible();
  await expect(o.getByRole("main").getByRole("alert")).toHaveText("Este link já foi usado.");

  // ------------------------------------------------ 3. do portal
  await o.goto("/portal");
  await o.getByRole("link", { name: "Esqueci minha senha" }).click();
  await expect(o).toHaveURL(/\/esqueci-senha\?origem=portal$/);
  await o.getByRole("link", { name: "← Voltar para a entrada" }).click();
  await expect(o).toHaveURL(/\/portal$/);

  // ------------------------------------------------ 4. capturas
  await capturarNosTemas(browser, "/esqueci-senha", "pedido");
  await capturarNosTemas(browser, "/redefinir-senha", "link-indisponivel");

  await Promise.all([sessaoAntiga.close(), anonimo.close(), outra.close()]);
});
