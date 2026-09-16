// Teste de navegador dos horários semanais reais (Lote 6D.3) — contra o
// backend real e um PostgreSQL descartável, mesmo padrão de
// professionals-flow.spec.ts.
//
// O FLUXO (abrir profissional → configurar manhã e tarde → salvar → reload →
// editar → reload) roda na tela de verdade. A AUTORIZAÇÃO (acesso cruzado
// entre estabelecimentos) é atacada DIRETAMENTE na API: botão escondido não
// é controle de acesso.
//
// Orçamento de POST /auth/register: o rate limit real é 5 por 15 min por IP e
// este arquivo gasta 2 (fluxo + isolamento). Roda em invocação SEPARADA do
// Playwright, com backend novo e limiter zerado (ver
// .github/workflows/test-frontend-auth.yml).
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const BACKEND_URL = "http://localhost:3001";
const SENHA_TESTE = "senha-de-horarios-e2e-123";

interface ContaCriada {
  email: string;
  senha: string;
}

async function criarConta(request: APIRequestContext, rotulo: string): Promise<ContaCriada> {
  const sufixo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `horarios-${rotulo}-${sufixo}@example.test`;

  const resposta = await request.post(`${BACKEND_URL}/auth/register`, {
    data: {
      ownerName: `Dono ${rotulo}`,
      businessName: `Estabelecimento ${rotulo} ${sufixo}`,
      email,
      phone: "11977776666",
      password: SENHA_TESTE,
    },
  });
  expect(resposta.status(), await resposta.text()).toBe(201);

  return { email, senha: SENHA_TESTE };
}

async function entrar(page: Page, conta: ContaCriada): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(conta.email);
  await page.getByLabel("Senha").fill(conta.senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/conta$/);
}

async function tenantDe(pagina: Page): Promise<string> {
  const corpo = await pagina.evaluate(async () => {
    const r = await fetch("http://localhost:3001/auth/me", { credentials: "include" });
    return (await r.json()) as { activeContext: { tenantId: string } | null };
  });
  expect(corpo.activeContext).not.toBeNull();
  return corpo.activeContext!.tenantId;
}

/** Cria o profissional pela API — a tela de profissionais já é provada em
 * professionals-flow.spec.ts; aqui ele é só a fixture. */
async function criarProfissional(pagina: Page, tenantId: string, nome: string): Promise<string> {
  return pagina.evaluate(
    async ({ tenantId, nome }) => {
      const r = await fetch(`http://localhost:3001/tenants/${tenantId}/professionals`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nome }),
      });
      const corpo = (await r.json()) as { professional: { id: string } };
      return corpo.professional.id;
    },
    { tenantId, nome },
  );
}

test.describe("horários semanais reais", () => {
  test("configurar manhã e tarde → salvar → reload → editar → reload, tudo persistido", async ({
    page,
    request,
  }) => {
    const conta = await criarConta(request, "fluxo");
    await entrar(page, conta);
    const tenantId = await tenantDe(page);
    await criarProfissional(page, tenantId, "Ana Souza");

    await page.goto("/conta/profissionais");
    await page.getByRole("link", { name: "Horários de Ana Souza" }).click();
    await expect(page).toHaveURL(/\/conta\/profissionais\/[^/]+\/horarios$/);

    // Estado inicial sem configuração: todo dia aparece como "não atende",
    // nunca como disponível.
    await expect(page.getByText("Não atende neste dia.")).toHaveCount(7);
    // O fuso aplicável é o do estabelecimento, dito na tela.
    await expect(page.getByText("America/Sao_Paulo")).toBeVisible();

    // Segunda-feira: manhã e tarde.
    await page.getByRole("button", { name: "Adicionar intervalo em Segunda-feira" }).click();
    await page.getByLabel("Início 1 — Segunda-feira").fill("09:00");
    await page.getByLabel("Fim 1 — Segunda-feira").fill("12:00");
    await page.getByRole("button", { name: "Adicionar intervalo em Segunda-feira" }).click();
    await page.getByLabel("Início 2 — Segunda-feira").fill("13:00");
    await page.getByLabel("Fim 2 — Segunda-feira").fill("18:00");

    // Localizador pelo `type`, nunca pelo texto: durante a gravação o rótulo
    // vira "Salvando...", e um locator por nome deixaria de casar.
    const salvar = page.locator('form button[type="submit"]');

    // Sobreposição é recusada com mensagem, sem ir à API.
    let gravacoesInvalidas = 0;
    const contarPut = (req: { method: () => string; url: () => string }) => {
      if (req.method() === "PUT" && /\/schedule$/.test(req.url())) gravacoesInvalidas += 1;
    };
    page.on("request", contarPut);
    await page.getByLabel("Fim 1 — Segunda-feira").fill("14:00");
    await salvar.click();
    await expect(page.getByText(/se sobrep/)).toBeVisible();
    expect(gravacoesInvalidas, "semana inválida nunca chega na API").toBe(0);
    page.off("request", contarPut);

    await page.getByLabel("Fim 1 — Segunda-feira").fill("12:00");

    // Envio duplicado: o botão fica desabilitado enquanto a gravação está em
    // voo, então dois cliques nunca viram dois PUT.
    let gravacoes = 0;
    page.on("request", (req) => {
      if (req.method() === "PUT" && /\/schedule$/.test(req.url())) gravacoes += 1;
    });
    // Matcher por função, não por glob: o caminho tem duas partes variáveis
    // (tenant e profissional) e um padrão que não casasse deixaria a
    // requisição passar direto — a gravação terminaria antes do teste
    // conseguir observar o botão desabilitado, e o bloqueio de envio
    // duplicado ficaria sem prova nenhuma.
    const ehGravacaoDeHorarios = (url: URL) => url.pathname.endsWith("/schedule");
    await page.route(ehGravacaoDeHorarios, async (rota) => {
      if (rota.request().method() === "PUT") {
        await new Promise((resolver) => setTimeout(resolver, 1_500));
      }
      await rota.continue();
    });

    await salvar.click();
    await expect(salvar).toBeDisabled();
    await salvar.click({ force: true });
    await page.unroute(ehGravacaoDeHorarios);

    await expect(page.getByText("Horários salvos.")).toBeVisible();
    expect(gravacoes, "um envio só, mesmo com dois cliques").toBe(1);

    // Persistência real: o reload relê do banco pela API.
    await page.reload();
    await expect(page.getByLabel("Início 1 — Segunda-feira")).toHaveValue("09:00");
    await expect(page.getByLabel("Fim 1 — Segunda-feira")).toHaveValue("12:00");
    await expect(page.getByLabel("Início 2 — Segunda-feira")).toHaveValue("13:00");
    await expect(page.getByLabel("Fim 2 — Segunda-feira")).toHaveValue("18:00");
    await expect(page.getByText("Não atende neste dia.")).toHaveCount(6);

    // Edita: remove a tarde da segunda e acrescenta a quarta.
    await page.getByRole("button", { name: "Remover intervalo 2 de Segunda-feira" }).click();
    await page.getByRole("button", { name: "Adicionar intervalo em Quarta-feira" }).click();
    await page.getByLabel("Início 1 — Quarta-feira").fill("10:00");
    await page.getByLabel("Fim 1 — Quarta-feira").fill("16:00");
    await salvar.click();
    await expect(page.getByText("Horários salvos.")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Início 1 — Segunda-feira")).toHaveValue("09:00");
    await expect(page.getByLabel("Fim 1 — Segunda-feira")).toHaveValue("12:00");
    await expect(page.getByLabel("Início 2 — Segunda-feira")).toHaveCount(0);
    await expect(page.getByLabel("Início 1 — Quarta-feira")).toHaveValue("10:00");
    await expect(page.getByText("Não atende neste dia.")).toHaveCount(5);
  });

  test("isolamento entre estabelecimentos, atacado direto na API com sessão válida", async ({
    browser,
    request,
  }) => {
    const contaA = await criarConta(request, "iso-a");
    const contaB = await criarConta(request, "iso-b");

    const contextoA = await browser.newContext();
    const contextoB = await browser.newContext();
    const paginaA = await contextoA.newPage();
    const paginaB = await contextoB.newPage();

    await entrar(paginaA, contaA);
    await entrar(paginaB, contaB);

    const tenantA = await tenantDe(paginaA);
    const tenantB = await tenantDe(paginaB);
    const profissionalDeA = await criarProfissional(paginaA, tenantA, "Profissional de A");

    // A configura a semana pela tela.
    await paginaA.goto(`/conta/profissionais/${profissionalDeA}/horarios`);
    await paginaA.getByRole("button", { name: "Adicionar intervalo em Sexta-feira" }).click();
    await paginaA.getByLabel("Início 1 — Sexta-feira").fill("08:00");
    await paginaA.getByLabel("Fim 1 — Sexta-feira").fill("17:00");
    await paginaA.getByRole("button", { name: "Salvar horários" }).click();
    await expect(paginaA.getByText("Horários salvos.")).toBeVisible();

    const comoB = async (caminho: string, method = "GET", body?: unknown) =>
      paginaB.evaluate(
        async ({ caminho, method, body }) => {
          const r = await fetch(`http://localhost:3001${caminho}`, {
            method,
            credentials: "include",
            headers: body ? { "Content-Type": "application/json" } : undefined,
            body: body ? JSON.stringify(body) : undefined,
          });
          return { status: r.status, texto: await r.text() };
        },
        { caminho, method, body },
      );

    // 1. Ler os horários do profissional de A, pelo tenant de A.
    const leituraCruzada = await comoB(
      `/tenants/${tenantA}/professionals/${profissionalDeA}/schedule`,
    );
    expect(leituraCruzada.status).toBe(404);
    expect(leituraCruzada.texto).not.toContain("08:00");

    // 2. Ler pelo PRÓPRIO tenant de B (vínculo existe, recurso é de outro).
    expect(
      (await comoB(`/tenants/${tenantB}/professionals/${profissionalDeA}/schedule`)).status,
    ).toBe(404);

    // 3. Gravar horário no profissional de A.
    expect(
      (await comoB(`/tenants/${tenantB}/professionals/${profissionalDeA}/schedule`, "PUT", {
        days: [{ weekday: 1, intervals: [{ start: "00:00", end: "23:59" }] }],
      })).status,
    ).toBe(404);

    // 4. Forjar tenantId no corpo: o campo nem existe no contrato.
    expect(
      (await comoB(`/tenants/${tenantB}/professionals/${profissionalDeA}/schedule`, "PUT", {
        days: [],
        tenantId: tenantA,
      })).status,
    ).toBe(400);

    // Nada disso alterou a semana de A.
    await paginaA.reload();
    await expect(paginaA.getByLabel("Início 1 — Sexta-feira")).toHaveValue("08:00");
    await expect(paginaA.getByLabel("Fim 1 — Sexta-feira")).toHaveValue("17:00");
    await expect(paginaA.getByLabel("Início 1 — Segunda-feira")).toHaveCount(0);

    // Sem sessão nenhuma, a API recusa antes de qualquer consulta.
    const semSessao = await browser.newContext();
    const paginaAnonima = await semSessao.newPage();
    await paginaAnonima.goto("/login");
    const anonimo = await paginaAnonima.evaluate(
      async ({ tenantId, professionalId }) => {
        const r = await fetch(
          `http://localhost:3001/tenants/${tenantId}/professionals/${professionalId}/schedule`,
          { credentials: "include" },
        );
        return r.status;
      },
      { tenantId: tenantA, professionalId: profissionalDeA },
    );
    expect(anonimo).toBe(401);

    await semSessao.close();
    await contextoA.close();
    await contextoB.close();
  });
});
