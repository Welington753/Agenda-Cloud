// Teste de navegador da criação e consulta de agendamentos reais (Lote
// 6D.5) — contra o backend real e um PostgreSQL descartável, mesmo padrão de
// availability-flow.spec.ts.
//
// O FLUXO (criar dados → configurar jornada → consultar disponibilidade →
// agendar → reload → conferir reserva e ocupação) roda na tela de verdade. A
// AUTORIZAÇÃO (acesso cruzado entre estabelecimentos) é atacada DIRETAMENTE
// na API: botão escondido não é controle de acesso.
//
// Orçamento de POST /auth/register: o rate limit real é 5 por 15 min por IP e
// este arquivo gasta 2 (fluxo + isolamento). Roda em invocação SEPARADA do
// Playwright, com backend novo e limiter zerado (ver
// .github/workflows/test-frontend-auth.yml). O limite nunca é afrouxado para
// o teste passar.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const BACKEND_URL = "http://localhost:3001";
const SENHA_TESTE = "senha-de-agendamentos-e2e-123";

/** Domingo, bem no futuro: nenhum teste depende do dia em que roda. */
const DATA = "2026-09-20";
const WEEKDAY_DA_DATA = 0;

interface ContaCriada {
  email: string;
  senha: string;
}

async function criarConta(request: APIRequestContext, rotulo: string): Promise<ContaCriada> {
  const sufixo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `agendamentos-${rotulo}-${sufixo}@example.test`;

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

/** Serviço, profissional e jornada pela API — as telas deles já são provadas
 * nos lotes anteriores; aqui são só a fixture. */
async function criarServico(
  pagina: Page,
  tenantId: string,
  nome: string,
  durationMinutes: number,
): Promise<string> {
  return pagina.evaluate(
    async ({ tenantId, nome, durationMinutes }) => {
      const r = await fetch(`http://localhost:3001/tenants/${tenantId}/services`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nome,
          shortDescription: "",
          priceCents: 5000,
          priceVisible: true,
          durationMinutes,
          bufferAfterMinutes: 0,
          modality: "IN_PERSON",
          activeInPublicBooking: true,
          requiresManualConfirmation: false,
        }),
      });
      const corpo = (await r.json()) as { service: { id: string } };
      return corpo.service.id;
    },
    { tenantId, nome, durationMinutes },
  );
}

async function criarProfissional(
  pagina: Page,
  tenantId: string,
  nome: string,
  serviceIds: string[],
): Promise<string> {
  return pagina.evaluate(
    async ({ tenantId, nome, serviceIds }) => {
      const r = await fetch(`http://localhost:3001/tenants/${tenantId}/professionals`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nome, serviceIds }),
      });
      const corpo = (await r.json()) as { professional: { id: string } };
      return corpo.professional.id;
    },
    { tenantId, nome, serviceIds },
  );
}

async function definirJornada(
  pagina: Page,
  tenantId: string,
  professionalId: string,
): Promise<void> {
  const status = await pagina.evaluate(
    async ({ tenantId, professionalId, weekday }) => {
      const r = await fetch(
        `http://localhost:3001/tenants/${tenantId}/professionals/${professionalId}/schedule`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            days: [{ weekday, intervals: [{ start: "09:00", end: "12:00" }] }],
          }),
        },
      );
      return r.status;
    },
    { tenantId, professionalId, weekday: WEEKDAY_DA_DATA },
  );
  expect(status).toBe(200);
}

async function horariosLivres(pagina: Page): Promise<string[]> {
  return pagina.locator('[data-testid="horario-livre"]').allTextContents();
}

test.describe("agendamentos reais", () => {
  test("consultar disponibilidade, agendar, recarregar e ver a reserva e a ocupação", async ({
    page,
    request,
  }) => {
    const conta = await criarConta(request, "fluxo");
    await entrar(page, conta);
    const tenantId = await tenantDe(page);

    const servicoId = await criarServico(page, tenantId, "Corte", 60);
    const profissionalId = await criarProfissional(page, tenantId, "Ana Souza", [servicoId]);
    await definirJornada(page, tenantId, profissionalId);

    await page.goto("/conta/agendamentos");
    await page.getByLabel("Dia").fill(DATA);

    // Dia ainda vazio.
    await expect(page.getByTestId("agenda-vazia")).toBeVisible();

    // Cliente novo, cadastrado junto com a reserva.
    await page.getByRole("button", { name: "Cadastrar novo" }).click();
    await page.getByLabel("Nome do cliente").fill("Maria Cliente");
    await page.getByLabel("WhatsApp").fill("(11) 90000-0000");

    // Os horários vêm da API de disponibilidade, nunca montados na tela.
    await page.getByRole("button", { name: "Ver horários livres" }).click();
    await expect.poll(() => horariosLivres(page)).toEqual([
      "09:00",
      "09:15",
      "09:30",
      "09:45",
      "10:00",
      "10:15",
      "10:30",
      "10:45",
      "11:00",
    ]);

    await page.locator('[data-testid="horario-livre"]').first().click();

    // Resumo antes de confirmar.
    await expect(page.getByTestId("resumo")).toContainText("Corte");
    await expect(page.getByTestId("resumo")).toContainText("Ana Souza");
    await expect(page.getByTestId("resumo")).toContainText("Maria Cliente");

    // Clique duplo: o botão fica desabilitado enquanto a criação está em voo,
    // então dois cliques nunca viram dois POST.
    let criacoes = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && /\/appointments$/.test(req.url())) criacoes += 1;
    });
    const ehCriacao = (url: URL) => url.pathname.endsWith("/appointments");
    await page.route(ehCriacao, async (rota) => {
      if (rota.request().method() === "POST") {
        await new Promise((resolver) => setTimeout(resolver, 1_500));
      }
      await rota.continue();
    });

    const confirmar = page.locator('form button[type="submit"]');
    await confirmar.click();
    await expect(confirmar).toBeDisabled();
    await confirmar.click({ force: true });
    await page.unroute(ehCriacao);

    await expect(page.getByTestId("confirmacao")).toBeVisible();
    expect(criacoes, "um envio só, mesmo com dois cliques").toBe(1);

    // A confirmação identifica a reserva.
    const idReserva = await page.getByTestId("id-reserva").textContent();
    expect(idReserva).toBeTruthy();
    await expect(page.getByTestId("confirmacao")).toContainText("09:00–10:00");

    // Persistência real: o reload relê do banco pela API.
    await page.reload();
    await page.getByLabel("Dia").fill(DATA);
    await expect(page.getByTestId("agenda-do-dia")).toBeVisible();
    await expect(page.getByTestId("horario-agendado")).toHaveText("09:00–10:00");
    await expect(page.getByTestId("agenda-do-dia")).toContainText("Maria Cliente");

    // A ocupação é real: 09:00 sai da lista de horários livres, 10:00 fica.
    await page.getByRole("button", { name: "Ver horários livres" }).click();
    await expect.poll(() => horariosLivres(page)).not.toContain("09:00");
    await expect.poll(() => horariosLivres(page)).toContain("10:00");
  });

  test("conflito 409 é explicado e a agenda é atualizada; isolamento atacado na API", async ({
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

    const servicoA = await criarServico(paginaA, tenantA, "Corte de A", 60);
    const profissionalA = await criarProfissional(paginaA, tenantA, "Profissional de A", [servicoA]);
    await definirJornada(paginaA, tenantA, profissionalA);

    const servicoB = await criarServico(paginaB, tenantB, "Corte de B", 60);
    const profissionalB = await criarProfissional(paginaB, tenantB, "Profissional de B", [servicoB]);

    const clienteA = await paginaA.evaluate(
      async ({ tenantId }) => {
        const r = await fetch(`http://localhost:3001/tenants/${tenantId}/consumers`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Cliente de A", whatsapp: "(11) 95555-4444" }),
        });
        const corpo = (await r.json()) as { consumer: { id: string } };
        return corpo.consumer.id;
      },
      { tenantId: tenantA },
    );

    // A ocupa 09:00 pela API, para a tela encontrar o horário já tomado.
    const ocupar = async (startAt: string) =>
      paginaA.evaluate(
        async ({ tenantId, professionalId, serviceId, consumerId, startAt }) => {
          const r = await fetch(`http://localhost:3001/tenants/${tenantId}/appointments`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              professionalId,
              serviceId,
              startAt,
              consumer: { mode: "existing", consumerId },
            }),
          });
          return r.status;
        },
        {
          tenantId: tenantA,
          professionalId: profissionalA,
          serviceId: servicoA,
          consumerId: clienteA,
          startAt,
        },
      );

    expect(await ocupar("2026-09-20T12:00:00.000Z")).toBe(201);
    // O mesmo horário de novo é 409 — a constraint do banco é quem decide.
    expect(await ocupar("2026-09-20T12:00:00.000Z")).toBe(409);

    // Na tela: escolher um horário livre, deixar outra reserva ocupá-lo por
    // fora e confirmar — o 409 precisa ser explicado e a agenda atualizada.
    await paginaA.goto("/conta/agendamentos");
    await paginaA.getByLabel("Dia").fill(DATA);
    await paginaA.getByRole("button", { name: "Cadastrar novo" }).click();
    await paginaA.getByLabel("Nome do cliente").fill("Cliente do Conflito");
    await paginaA.getByLabel("WhatsApp").fill("(11) 94444-3333");
    await paginaA.getByRole("button", { name: "Ver horários livres" }).click();
    await expect.poll(() => horariosLivres(paginaA)).toContain("10:00");

    await paginaA.locator('[data-testid="horario-livre"][data-inicio="2026-09-20T13:00:00.000Z"]').click();
    // Alguém ocupa 10:00 por fora, depois da consulta e antes da confirmação.
    expect(await ocupar("2026-09-20T13:00:00.000Z")).toBe(201);

    await paginaA.locator('form button[type="submit"]').click();

    // A tela explica que o horário deixou de estar disponível. Localizador
    // pelo testid do erro da RESERVA, não por `role=alert`: a página tem mais
    // de um alerta possível (disponibilidade e listagem), e um seletor
    // ambíguo falharia por strict mode em vez de provar o comportamento.
    await expect(paginaA.getByTestId("erro-reserva")).toContainText(/ocupado/i);
    // ...e a agenda do dia é recarregada, mostrando as duas reservas.
    await expect(paginaA.getByTestId("agenda-do-dia")).toBeVisible();
    await expect(paginaA.locator('[data-testid="horario-agendado"]')).toHaveCount(2);

    // Isolamento: B ataca a API de A diretamente, com sessão válida.
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

    // 1. Listar a agenda de A.
    const listagem = await comoB(`/tenants/${tenantA}/appointments?date=${DATA}`);
    expect(listagem.status).toBe(404);
    expect(listagem.texto).not.toContain("Cliente de A");

    // 2. Agendar na agenda do profissional de A, pelo tenant de A.
    expect(
      (
        await comoB(`/tenants/${tenantA}/appointments`, "POST", {
          professionalId: profissionalA,
          serviceId: servicoA,
          startAt: "2026-09-20T14:00:00.000Z",
          consumer: { mode: "new", data: { name: "Invasor", whatsapp: "(11) 93333-2222" } },
        })
      ).status,
    ).toBe(404);

    // 3. Pelo PRÓPRIO tenant de B, usando o profissional de A.
    expect(
      (
        await comoB(`/tenants/${tenantB}/appointments`, "POST", {
          professionalId: profissionalA,
          serviceId: servicoB,
          startAt: "2026-09-20T14:00:00.000Z",
          consumer: { mode: "new", data: { name: "Invasor", whatsapp: "(11) 93333-2222" } },
        })
      ).status,
    ).toBe(404);

    // 4. Buscar clientes de A.
    const busca = await comoB(`/tenants/${tenantA}/consumers?q=Cliente`);
    expect(busca.status).toBe(404);
    expect(busca.texto).not.toContain("Cliente de A");

    // 5. Forjar campos controlados pelo servidor: o contrato nem os aceita.
    expect(
      (
        await comoB(`/tenants/${tenantB}/appointments`, "POST", {
          professionalId: profissionalB,
          serviceId: servicoB,
          startAt: "2026-09-20T14:00:00.000Z",
          consumer: { mode: "new", data: { name: "X", whatsapp: "(11) 93333-2222" } },
          priceCents: 1,
          status: "COMPLETED",
        })
      ).status,
    ).toBe(400);

    // Nada disso mexeu na agenda de A.
    await paginaA.reload();
    await paginaA.getByLabel("Dia").fill(DATA);
    await expect(paginaA.locator('[data-testid="horario-agendado"]')).toHaveCount(2);

    // Sem sessão nenhuma, a API recusa antes de qualquer consulta.
    const semSessao = await browser.newContext();
    const paginaAnonima = await semSessao.newPage();
    await paginaAnonima.goto("/login");
    const anonimo = await paginaAnonima.evaluate(
      async ({ caminho }) => {
        const r = await fetch(`http://localhost:3001${caminho}`, { credentials: "include" });
        return r.status;
      },
      { caminho: `/tenants/${tenantA}/appointments?date=${DATA}` },
    );
    expect(anonimo).toBe(401);

    await semSessao.close();
    await contextoA.close();
    await contextoB.close();
  });
});
