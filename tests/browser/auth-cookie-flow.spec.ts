// Teste de navegador do fluxo real de login/sessão/logout (Lote 6C.1) — o
// requisito explícito do lote é validar cookies e navegação num navegador de
// verdade, nunca substituindo isto por mock de fetch. Roda contra o backend
// real (Postgres descartável, nunca Neon/produção — ver
// .github/workflows/test-frontend-auth-cookie-flow.yml) e o frontend real
// compilado (ver playwright.config.ts).
//
// O usuário de teste é criado por POST /auth/register direto na API (nunca
// pela UI, que não tem tela de cadastro neste lote, e nunca uma fixture que
// grave direto no banco — usar o próprio endpoint real prova que o cadastro
// funciona de ponta a ponta o suficiente para autenticar depois).
import { expect, test, type APIRequestContext } from "@playwright/test";

const BACKEND_URL = "http://localhost:3001";
const SENHA_TESTE = "senha-de-teste-e2e-123";

interface ContaTeste {
  email: string;
  senha: string;
}

async function criarContaDeTeste(request: APIRequestContext): Promise<ContaTeste> {
  const sufixo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `playwright-${sufixo}@example.test`;

  const resposta = await request.post(`${BACKEND_URL}/auth/register`, {
    data: {
      ownerName: "Maria Teste E2E",
      businessName: `Estúdio Teste ${sufixo}`,
      email,
      phone: "11999998888",
      password: SENHA_TESTE,
    },
  });
  expect(resposta.status(), await resposta.text()).toBe(201);

  return { email, senha: SENHA_TESTE };
}

test.describe("login real, restauração de sessão e logout (cookie HttpOnly)", () => {
  test("credenciais inválidas mostram erro genérico e não autenticam", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill("ninguem-existe@example.test");
    await page.getByLabel("Senha").fill("senha-que-nao-existe-123");
    await page.getByRole("button", { name: "Entrar" }).click();

    await expect(page.getByRole("alert")).toHaveText("E-mail ou senha inválidos.");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("login real → /conta autenticado → reload preserva sessão → logout bloqueia acesso", async ({
    page,
    request,
    context,
  }) => {
    const conta = await criarContaDeTeste(request);

    await page.goto("/login");
    await page.getByLabel("E-mail").fill(conta.email);
    await page.getByLabel("Senha").fill(conta.senha);
    await page.getByRole("button", { name: "Entrar" }).click();

    await expect(page).toHaveURL(/\/conta$/);
    await expect(page.getByText("Dono(a)")).toBeVisible();
    await expect(page.getByText("Plano Gestão")).toBeVisible();

    // Cookie de sessão é HttpOnly de verdade — o navegador o guarda, mas
    // nenhum JavaScript da página o expõe (ver real-auth-context.tsx: o
    // estado da sessão vem sempre de /auth/me, nunca do próprio cookie).
    const cookiesAntesDoLogout = await context.cookies("http://localhost:3001");
    const cookieSessao = cookiesAntesDoLogout.find((c) => c.name === "session_token");
    expect(cookieSessao, "cookie de sessão precisa existir após login").toBeTruthy();
    expect(cookieSessao?.httpOnly).toBe(true);

    // Restauração de sessão: recarregar a página não desloga nem exige novo
    // login (a identidade é restaurada via /auth/me antes de decidir o
    // acesso).
    await page.reload();
    await expect(page).toHaveURL(/\/conta$/);
    await expect(page.getByText("Dono(a)")).toBeVisible();

    // Acesso direto a uma rota protegida SEM sessão nenhuma (contexto de
    // navegador novo, sem os cookies do contexto atual) precisa cair no
    // login — nunca mostrar dado de outra sessão nem a demonstração.
    const paginaSemSessao = await context.browser()!.newPage();
    await paginaSemSessao.goto("/conta");
    await expect(paginaSemSessao).toHaveURL(/\/login\?next=%2Fconta$/);
    await paginaSemSessao.close();

    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login$/);

    const cookiesDepoisDoLogout = await context.cookies("http://localhost:3001");
    expect(cookiesDepoisDoLogout.find((c) => c.name === "session_token")).toBeFalsy();

    // Mesmo tentando voltar direto para /conta (ex.: botão "voltar" do
    // navegador) depois do logout, o servidor já revogou a sessão — nunca
    // basta limpar só o estado local do cliente.
    await page.goto("/conta");
    await expect(page).toHaveURL(/\/login\?next=%2Fconta$/);
  });
});
