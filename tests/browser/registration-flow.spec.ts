// Teste de navegador do cadastro REAL (Lote 6C.2) — o requisito do lote é
// que a conta seja criada PREENCHENDO E ENVIANDO O FORMULÁRIO da tela, nunca
// por uma fixture que chame a API direto nem que grave no banco. Roda contra
// o backend real e um PostgreSQL descartável (nunca Neon/produção — ver
// .github/workflows/test-frontend-auth.yml).
//
// Orçamento de POST /auth/register: o rate limit real é de
// REGISTER_RATE_LIMIT_MAX = 5 por 15 min por IP (ver
// backend/src/auth/register-rate-limit.ts) e todos os testes saem do mesmo
// IP. Este arquivo gasta 3 (um cadastro válido, uma tentativa com e-mail
// duplicado e um cadastro com /auth/me derrubado) e auth-cookie-flow.spec.ts
// gasta 1 — os testes de envio duplicado e de recuperação de sessão provam
// justamente que NÃO há POST extra. Somando, 4 de 5: conferir esta conta
// antes de acrescentar qualquer caso novo que cadastre.
import { expect, test, type Page } from "@playwright/test";

const SENHA_TESTE = "senha-de-cadastro-e2e-123";

interface DadosCadastro {
  nome: string;
  estabelecimento: string;
  email: string;
  telefone: string;
  senha: string;
}

function dadosDeCadastro(): DadosCadastro {
  const sufixo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    nome: "Maria Cadastro E2E",
    estabelecimento: `Studio Cadastro ${sufixo}`,
    email: `cadastro-${sufixo}@example.test`,
    telefone: "(11) 98888-7777",
    senha: SENHA_TESTE,
  };
}

async function preencherFormulario(page: Page, dados: DadosCadastro): Promise<void> {
  await page.getByLabel("Seu nome").fill(dados.nome);
  await page.getByLabel("Nome do estabelecimento").fill(dados.estabelecimento);
  await page.getByLabel("E-mail").fill(dados.email);
  await page.getByLabel("Telefone").fill(dados.telefone);
  await page.getByLabel("Senha").fill(dados.senha);
}

test.describe("cadastro real pela tela (POST /auth/register a partir do formulário)", () => {
  test("o login tem um caminho visível para o cadastro e vice-versa", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Criar conta" }).click();
    await expect(page).toHaveURL(/\/cadastro$/);

    await page.getByRole("link", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("validação de campo acontece no cliente, sem chamar a API", async ({ page }) => {
    let chamadasDeCadastro = 0;
    page.on("request", (req) => {
      if (req.url().endsWith("/auth/register") && req.method() === "POST") chamadasDeCadastro += 1;
    });

    await page.goto("/cadastro");
    await page.getByLabel("Seu nome").fill("M");
    await page.getByLabel("Nome do estabelecimento").fill("Studio Teste");
    await page.getByLabel("E-mail").fill("nao-e-um-email");
    await page.getByLabel("Telefone").fill("123");
    await page.getByLabel("Senha").fill("curta");
    await page.getByRole("button", { name: "Criar conta" }).click();

    await expect(page.getByText("Informe um e-mail válido.")).toBeVisible();
    await expect(page.getByText("A senha precisa ter pelo menos 10 caracteres.")).toBeVisible();
    await expect(page).toHaveURL(/\/cadastro$/);
    expect(chamadasDeCadastro, "formulário inválido nunca deve chegar na API").toBe(0);
  });

  test("cadastro pela tela → /conta → reload mantém sessão → logout → login com a conta criada", async ({
    page,
    context,
  }) => {
    const dados = dadosDeCadastro();

    // Envio duplicado: dois cliques seguidos no mesmo submit não podem gerar
    // dois POST /auth/register (o segundo criaria um 409 ou, pior, uma
    // segunda conta). Contado no próprio fluxo feliz, sem gastar mais cota do
    // rate limit.
    let chamadasDeCadastro = 0;
    page.on("request", (req) => {
      if (req.url().endsWith("/auth/register") && req.method() === "POST") chamadasDeCadastro += 1;
    });

    // Segura a resposta do cadastro por tempo suficiente para clicar de novo
    // com a requisição comprovadamente em voo — sem isso o segundo clique
    // poderia cair depois da navegação e não provar nada. A requisição em si
    // continua indo para o backend real; nada é simulado aqui.
    await page.route("**/auth/register", async (rota) => {
      await new Promise((resolver) => setTimeout(resolver, 1_500));
      await rota.continue();
    });

    await page.goto("/cadastro");
    await preencherFormulario(page, dados);

    // Localizador pelo `type`, não pelo texto: durante o envio o rótulo muda
    // para "Criando conta...".
    const botao = page.locator('form button[type="submit"]');
    await botao.click();
    await expect(botao).toBeDisabled();
    // Segundo clique com a primeira requisição ainda em voo: `force` ignora a
    // checagem de "elemento acionável", então isto testa de fato que um
    // botão desabilitado não reenvia o cadastro.
    await botao.click({ force: true });

    // A conta criada aparece em /conta com os dados REAIS do cadastro
    // (nome do dono e do estabelecimento digitados agora), nunca dado demo.
    await expect(page).toHaveURL(/\/conta$/);
    await expect(page.getByRole("heading", { name: "Olá, Maria" })).toBeVisible();
    await expect(page.getByText(dados.email)).toBeVisible();
    await expect(page.getByText(dados.estabelecimento)).toBeVisible();
    await expect(page.getByText("Dono(a)")).toBeVisible();

    expect(chamadasDeCadastro, "um envio só, mesmo com dois cliques").toBe(1);

    // O cookie de sessão veio do próprio cadastro (o backend emite no 201),
    // é HttpOnly de verdade e nenhum JavaScript da página o lê.
    const cookieCadastro = (await context.cookies("http://localhost:3001")).find((c) => c.name === "session_token");
    expect(cookieCadastro, "cadastro precisa deixar a sessão ativa").toBeTruthy();
    expect(cookieCadastro?.httpOnly).toBe(true);

    // Nem senha nem token podem ter sido guardados no navegador pelo cadastro.
    const armazenamento = await page.evaluate(() => ({
      local: JSON.stringify(window.localStorage),
      sessao: JSON.stringify(window.sessionStorage),
    }));
    expect(armazenamento.local).not.toContain(SENHA_TESTE);
    expect(armazenamento.sessao).not.toContain(SENHA_TESTE);
    expect(armazenamento.local).not.toContain("session_token");
    expect(armazenamento.sessao).not.toContain("session_token");

    await page.reload();
    await expect(page).toHaveURL(/\/conta$/);
    await expect(page.getByText(dados.email)).toBeVisible();

    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await context.cookies("http://localhost:3001")).find((c) => c.name === "session_token")).toBeFalsy();

    // Entrar de novo com a conta que acabou de ser criada pela tela prova que
    // o cadastro gravou uma credencial utilizável de verdade.
    await page.getByLabel("E-mail").fill(dados.email);
    await page.getByLabel("Senha").fill(dados.senha);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/conta$/);
    await expect(page.getByText(dados.email)).toBeVisible();

    // E-mail duplicado é recusado pelo backend e mostrado como tal — nunca
    // como "falha de comunicação" e nunca criando uma segunda conta.
    const outraPagina = await context.browser()!.newPage();
    await outraPagina.goto("/cadastro");
    await preencherFormulario(outraPagina, { ...dados, estabelecimento: `${dados.estabelecimento} 2` });
    await outraPagina.getByRole("button", { name: "Criar conta" }).click();
    await expect(outraPagina.getByText("Este e-mail já está cadastrado.")).toBeVisible();
    await expect(outraPagina).toHaveURL(/\/cadastro$/);
    await outraPagina.close();
  });

  test("cadastro confirmado com /auth/me falhando: a conta é criada e a sessão se recupera sem reenviar o cadastro", async ({
    page,
  }) => {
    const dados = dadosDeCadastro();

    let chamadasDeCadastro = 0;
    page.on("request", (req) => {
      if (req.url().endsWith("/auth/register") && req.method() === "POST") chamadasDeCadastro += 1;
    });

    // Derruba só o GET /auth/me (o POST /auth/register vai normalmente até o
    // backend real e cria a conta de verdade). É a única forma de reproduzir
    // num navegador "conta criada, sessão não carregada".
    let derrubarSessao = true;
    await page.route("**/auth/me", async (rota) => {
      if (derrubarSessao) await rota.abort("failed");
      else await rota.continue();
    });

    await page.goto("/cadastro");
    await preencherFormulario(page, dados);
    await page.locator('form button[type="submit"]').click();

    // Nunca pode dizer que o cadastro falhou — a conta existe.
    await expect(page.getByText("Sua conta foi criada")).toBeVisible();
    await expect(page).toHaveURL(/\/cadastro$/);

    // A recuperação repete só o /auth/me; o contador prova que nenhum segundo
    // POST /auth/register foi disparado nem automaticamente nem pelo botão.
    derrubarSessao = false;
    await page.getByRole("button", { name: "Recuperar sessão" }).click();

    await expect(page).toHaveURL(/\/conta$/);
    await expect(page.getByText(dados.email)).toBeVisible();
    expect(chamadasDeCadastro, "a recuperação nunca reenvia o cadastro").toBe(1);
  });
});
