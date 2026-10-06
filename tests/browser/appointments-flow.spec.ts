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
// este arquivo gasta 4 — fluxo, isolamento, remarcar/cancelar (Lote 6D.6) e
// o andamento do atendimento (Lote 6D.7).
// Roda em invocação SEPARADA do Playwright, com backend novo e limiter zerado
// (ver .github/workflows/test-frontend-auth.yml). O limite nunca é afrouxado
// para o teste passar; se o orçamento apertar, o caminho é outra invocação
// separada, nunca mexer no limiter.
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
// Domingo no futuro, DERIVADO do relógio a cada execução, e os instantes UTC
// calculados a partir dele no fuso do estabelecimento (09:00 local segue sendo
// 12:00Z, como antes). Uma data fixa aqui envelhece e o horário deixa de ser
// oferecido — ver o porquê em data-de-teste.ts.
import { DATA, DATA_SEGUINTE, WEEKDAY_DA_DATA, instanteLocalDe } from "./data-de-teste";

const BACKEND_URL = "http://localhost:3001";
const SENHA_TESTE = "senha-de-agendamentos-e2e-123";

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
  requiresManualConfirmation = false,
): Promise<string> {
  return pagina.evaluate(
    async ({ tenantId, nome, durationMinutes, requiresManualConfirmation }) => {
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
          requiresManualConfirmation,
        }),
      });
      const corpo = (await r.json()) as { service: { id: string } };
      return corpo.service.id;
    },
    { tenantId, nome, durationMinutes, requiresManualConfirmation },
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

/** Horários oferecidos pelo painel de remarcação — vêm da rota
 * reschedule-options, calculados com a ocupação congelada da reserva. */
async function horariosDeRemarcacao(pagina: Page): Promise<string[]> {
  return pagina.locator('[data-testid="horario-remarcacao"]').allTextContents();
}

// Cores de globals.css como o navegador as computa: --color-accent e
// --color-border.
const COR_DESTAQUE = "rgb(181, 101, 29)";
const COR_BORDA_PADRAO = "rgb(230, 221, 206)";
const VIEWPORT_CELULAR = { width: 390, height: 844 };
const VIEWPORT_COMPUTADOR = { width: 1280, height: 720 };

/** Confere o destaque RENDERIZADO de um horário, não a classe CSS: cor da
 * borda e anel pelo estilo computado, ícone visível e `aria-pressed`. Uma
 * regra de borda sem camada já anulou `border-accent` antes, com a classe
 * presente e nada visível. */
async function conferirDestaque(botao: Locator, selecionado: boolean): Promise<void> {
  await expect(botao).toHaveAttribute("aria-pressed", String(selecionado));
  const estilo = await botao.evaluate((el) => {
    const c = getComputedStyle(el);
    return { borda: c.borderTopColor, sombra: c.boxShadow };
  });
  if (selecionado) {
    expect(estilo.borda).toBe(COR_DESTAQUE);
    expect(estilo.sombra).toContain(`${COR_DESTAQUE} 0px 0px 0px 1px`);
    await expect(botao.locator("svg")).toBeVisible();
  } else {
    expect(estilo.borda).toBe(COR_BORDA_PADRAO);
    expect(estilo.sombra).not.toContain(COR_DESTAQUE);
    await expect(botao.locator("svg")).toHaveCount(0);
  }
}

/** Exatamente um horário marcado na lista (ou nenhum, com `null`). */
async function conferirSelecaoUnica(pagina: Page, testId: string, inicio: string | null): Promise<void> {
  await expect(pagina.locator(`[data-testid="${testId}"][aria-pressed="true"]`)).toHaveCount(inicio ? 1 : 0);
  for (const botao of await pagina.locator(`[data-testid="${testId}"]`).all()) {
    await conferirDestaque(botao, (await botao.getAttribute("data-inicio")) === inicio);
  }
}

async function registrarDestaque(pagina: Page, lista: string, nome: string): Promise<void> {
  // Imagem do destaque como o navegador desenhou, publicada pelo CI como
  // artefato (ver test-frontend-auth.yml).
  await pagina.getByTestId(lista).screenshot({ path: test.info().outputPath(`destaque-${nome}.png`) });
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
    // O POST fica retido por uma condição que o PRÓPRIO teste libera (nunca
    // um tempo fixo), e a interceptação só sai depois da resposta: remover a
    // rota com o handler pendente deixa o destino da requisição fora do
    // controle do teste (ver professional-working-hours-flow.spec.ts).
    const ehCriacao = (url: URL) => url.pathname.endsWith("/appointments");
    const criacaoInterceptada = Promise.withResolvers<void>();
    const liberarCriacao = Promise.withResolvers<void>();
    await page.route(ehCriacao, async (rota) => {
      if (rota.request().method() === "POST") {
        criacaoInterceptada.resolve();
        await liberarCriacao.promise;
      }
      await rota.continue();
    });

    const confirmar = page.locator('form button[type="submit"]');
    try {
      const respostaDaCriacao = page.waitForResponse(
        (resposta) => resposta.request().method() === "POST" && ehCriacao(new URL(resposta.url())),
      );
      try {
        await confirmar.click();
        await criacaoInterceptada.promise;
        await expect(confirmar).toBeDisabled();
        await confirmar.click({ force: true });
      } finally {
        liberarCriacao.resolve();
      }
      expect((await respostaDaCriacao).ok()).toBe(true);
    } finally {
      await page.unroute(ehCriacao);
    }

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
    await expect.poll(() => horariosLivres(page)).toContain("11:00");
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

    expect(await ocupar(instanteLocalDe("09:00"))).toBe(201);
    // O mesmo horário de novo é 409 — a constraint do banco é quem decide.
    expect(await ocupar(instanteLocalDe("09:00"))).toBe(409);

    // Na tela: escolher um horário livre, deixar outra reserva ocupá-lo por
    // fora e confirmar — o 409 precisa ser explicado e a agenda atualizada.
    await paginaA.goto("/conta/agendamentos");
    await paginaA.getByLabel("Dia").fill(DATA);
    await paginaA.getByRole("button", { name: "Cadastrar novo" }).click();
    await paginaA.getByLabel("Nome do cliente").fill("Cliente do Conflito");
    await paginaA.getByLabel("WhatsApp").fill("(11) 94444-3333");
    await paginaA.getByRole("button", { name: "Ver horários livres" }).click();
    await expect.poll(() => horariosLivres(paginaA)).toContain("10:00");

    await paginaA.locator(`[data-testid="horario-livre"][data-inicio="${instanteLocalDe("10:00")}"]`).click();
    // Alguém ocupa 10:00 por fora, depois da consulta e antes da confirmação.
    expect(await ocupar(instanteLocalDe("10:00"))).toBe(201);

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
          startAt: instanteLocalDe("11:00"),
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
          startAt: instanteLocalDe("11:00"),
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
          startAt: instanteLocalDe("11:00"),
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

  test("remarcar e cancelar na tela, com reload provando que persistiu (Lote 6D.6)", async ({
    page,
    request,
  }) => {
    const conta = await criarConta(request, "acoes");
    await entrar(page, conta);
    const tenantId = await tenantDe(page);

    const servicoId = await criarServico(page, tenantId, "Corte", 60);
    const profissionalId = await criarProfissional(page, tenantId, "Ana Souza", [servicoId]);
    await definirJornada(page, tenantId, profissionalId);

    await page.goto("/conta/agendamentos");
    await page.getByLabel("Dia").fill(DATA);

    // Uma reserva às 09:00, criada pela tela.
    await page.getByRole("button", { name: "Cadastrar novo" }).click();
    await page.getByLabel("Nome do cliente").fill("Cliente das Ações");
    await page.getByLabel("WhatsApp").fill("(11) 95555-4444");
    await page.getByRole("button", { name: "Ver horários livres" }).click();
    await expect.poll(() => horariosLivres(page)).toContain("09:00");

    // Destaque do horário escolhido na criação, no computador: antes de
    // escolher nenhum está marcado; escolher, trocar (pelo teclado, com o foco
    // visível) e limpar ao mudar o dia.
    const livre = (hora: string) =>
      page.locator(`[data-testid="horario-livre"][data-inicio="${instanteLocalDe(hora)}"]`);
    await page.setViewportSize(VIEWPORT_COMPUTADOR);
    await conferirSelecaoUnica(page, "horario-livre", null);
    await livre("09:00").click();
    await conferirSelecaoUnica(page, "horario-livre", instanteLocalDe("09:00"));
    await registrarDestaque(page, "horarios-livres", "criacao-computador");
    await page.keyboard.press("Tab");
    await expect(livre("09:15")).toBeFocused();
    await page.keyboard.press("Space");
    await conferirSelecaoUnica(page, "horario-livre", instanteLocalDe("09:15"));
    // O anel de seleção não substitui o foco de teclado: os dois aparecem.
    expect(await livre("09:15").evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
    await page.getByLabel("Dia").fill(DATA_SEGUINTE);
    await page.getByLabel("Dia").fill(DATA);
    await page.getByRole("button", { name: "Ver horários livres" }).click();
    await expect.poll(() => horariosLivres(page)).toContain("09:00");
    await conferirSelecaoUnica(page, "horario-livre", null);

    // No celular, o mesmo destaque.
    await page.setViewportSize(VIEWPORT_CELULAR);
    await livre("09:00").click();
    await conferirSelecaoUnica(page, "horario-livre", instanteLocalDe("09:00"));
    await registrarDestaque(page, "horarios-livres", "criacao-celular");
    await page.setViewportSize(VIEWPORT_COMPUTADOR);

    await page.locator('form button[type="submit"]').click();
    await expect(page.getByTestId("confirmacao")).toBeVisible();
    await expect(page.getByTestId("horario-agendado")).toHaveText("09:00–10:00");

    // ---------------------------------------------------------------- remarcar
    await page.getByTestId("abrir-remarcacao").click();
    // O painel mostra o horário ATUAL antes de qualquer escolha.
    await expect(page.getByTestId("horario-atual")).toContainText("09:00–10:00");

    // Os horários vêm do servidor (rota de reschedule-options), nunca montados
    // na tela — e o horário da própria reserva aparece, porque ela não bloqueia
    // a si mesma.
    await expect.poll(() => horariosDeRemarcacao(page)).toContain("09:00");

    // Destaque do horário escolhido na remarcação: nenhum antes, escolher,
    // trocar, limpar ao mudar o dia; depois, no celular, a escolha final.
    const opcao = (hora: string) =>
      page.locator(`[data-testid="horario-remarcacao"][data-inicio="${instanteLocalDe(hora)}"]`);
    const novoDia = page.getByLabel("Novo dia");
    await conferirSelecaoUnica(page, "horario-remarcacao", null);
    await opcao("10:15").click();
    await conferirSelecaoUnica(page, "horario-remarcacao", instanteLocalDe("10:15"));
    await registrarDestaque(page, "horarios-remarcacao", "remarcacao-computador");
    await opcao("10:30").click();
    await conferirSelecaoUnica(page, "horario-remarcacao", instanteLocalDe("10:30"));
    await novoDia.fill(DATA_SEGUINTE);
    await novoDia.fill(DATA);
    await expect.poll(() => horariosDeRemarcacao(page)).toContain("10:00");
    await conferirSelecaoUnica(page, "horario-remarcacao", null);

    await page.setViewportSize(VIEWPORT_CELULAR);
    await opcao("10:00").click();
    await conferirSelecaoUnica(page, "horario-remarcacao", instanteLocalDe("10:00"));
    await registrarDestaque(page, "horarios-remarcacao", "remarcacao-celular");
    await page.setViewportSize(VIEWPORT_COMPUTADOR);

    // O resumo mostra DE → PARA antes de confirmar, com cliente e serviço
    // preservados.
    await expect(page.getByTestId("resumo-remarcacao")).toContainText("De 09:00–10:00 para 10:00");
    await expect(page.getByTestId("resumo-remarcacao")).toContainText("Cliente das Ações");

    await page.getByTestId("confirmar-remarcacao").click();
    await expect(page.getByTestId("horario-agendado")).toHaveText("10:00–11:00");

    // Persistência real: o reload relê do banco pela API.
    await page.reload();
    await page.getByLabel("Dia").fill(DATA);
    await expect(page.getByTestId("agenda-do-dia")).toBeVisible();
    await expect(page.getByTestId("horario-agendado")).toHaveText("10:00–11:00");
    await expect(page.getByTestId("agenda-do-dia")).toContainText("Cliente das Ações");
    // O status não mudou com a remarcação.
    await expect(page.getByTestId("status-agendado")).toHaveText("Confirmado");

    // 09:00 voltou a ficar livre (a ocupação andou junto com a reserva).
    await page.getByRole("button", { name: "Ver horários livres" }).click();
    await expect.poll(() => horariosLivres(page)).toContain("09:00");
    await expect.poll(() => horariosLivres(page)).not.toContain("10:00");

    // --------------------------------------------------------------- cancelar
    let envioDeCancelamento = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().endsWith("/cancel")) envioDeCancelamento += 1;
    });

    await page.getByTestId("abrir-cancelamento").click();
    // A confirmação NOMEIA a reserva — não é um "tem certeza?" genérico.
    await expect(page.getByTestId("reserva-a-cancelar")).toContainText("10:00–11:00");
    await expect(page.getByTestId("reserva-a-cancelar")).toContainText("Cliente das Ações");

    // Com a confirmação ABERTA mostrando 10:00, outra sessão remarca a mesma
    // reserva para 11:00 direto na API (como outra aba ou outra pessoa).
    const remarcadaPorFora = await page.evaluate(
      async ({ tenantId, data, de, para }) => {
        const base = `http://localhost:3001/tenants/${tenantId}/appointments`;
        const lista = (await (
          await fetch(`${base}?date=${data}`, { credentials: "include" })
        ).json()) as { appointments: { id: string }[] };
        const r = await fetch(`${base}/${lista.appointments[0].id}/reschedule`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startAt: para, expectedStartAt: de }),
        });
        return r.status;
      },
      { tenantId, data: DATA, de: instanteLocalDe("10:00"), para: instanteLocalDe("11:00") },
    );
    expect(remarcadaPorFora).toBe(201);

    // A confirmação antiga é enviada: o servidor recusa com 409, nada é
    // cancelado, e a tela mostra que a reserva mudou, com os dados novos.
    await page.getByTestId("confirmar-cancelamento-botao").click();
    await expect(page.getByTestId("erro-acao-reserva")).toContainText("mudou");
    await expect(page.getByTestId("reserva-alterada")).toContainText("antes: 10:00–11:00");
    await expect(page.getByTestId("reserva-a-cancelar")).toContainText("11:00–12:00");
    await expect(page.getByTestId("status-agendado")).toHaveText("Confirmado");
    await expect(page.getByTestId("horario-agendado")).toHaveText("11:00–12:00");
    // Nenhum reenvio automático: uma tentativa só até aqui.
    expect(envioDeCancelamento).toBe(1);

    // Nova confirmação CONSCIENTE, agora sobre o horário que a tela mostra.
    await page.getByTestId("confirmar-cancelamento-botao").click();
    // A reserva continua listada, agora como cancelada (nada é apagado), e as
    // ações desaparecem dela.
    await expect(page.getByTestId("status-agendado")).toHaveText("Cancelado");
    await expect(page.getByTestId("acoes-reserva")).toHaveCount(0);
    expect(envioDeCancelamento).toBe(2);

    // Reload: o cancelamento persistiu.
    await page.reload();
    await page.getByLabel("Dia").fill(DATA);
    await expect(page.getByTestId("agenda-do-dia")).toBeVisible();
    await expect(page.getByTestId("status-agendado")).toHaveText("Cancelado");

    // E o horário 10:00 voltou a ser oferecido para uma nova reserva.
    await page.getByRole("button", { name: "Cadastrar novo" }).click();
    await page.getByLabel("Nome do cliente").fill("Outro Cliente");
    await page.getByLabel("WhatsApp").fill("(11) 96666-5555");
    await page.getByRole("button", { name: "Ver horários livres" }).click();
    await expect.poll(() => horariosLivres(page)).toContain("10:00");
  });

  test("andamento: os quatro botões, as confirmações e a recusa do servidor (Lote 6D.7)", async ({
    page,
    request,
  }) => {
    const conta = await criarConta(request, "andamento");
    await entrar(page, conta);
    const tenantId = await tenantDe(page);

    // Serviço de 30 min com confirmação manual: as reservas nascem PENDING.
    const servicoId = await criarServico(page, tenantId, "Corte", 30, true);
    const profissionalId = await criarProfissional(page, tenantId, "Ana Souza", [servicoId]);
    await definirJornada(page, tenantId, profissionalId);

    // Duas reservas pela API (a tela de criação já é provada acima): 09:00 e 09:45.
    for (const [hora, cliente, telefone] of [
      ["09:00", "Cliente das Nove", "(11) 94444-1111"],
      ["09:45", "Cliente das Nove e Quarenta", "(11) 94444-2222"],
    ]) {
      const status = await page.evaluate(
        async ({ tenantId, corpo }) => {
          const r = await fetch(`http://localhost:3001/tenants/${tenantId}/appointments`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(corpo),
          });
          return r.status;
        },
        {
          tenantId,
          corpo: {
            professionalId: profissionalId,
            serviceId: servicoId,
            startAt: instanteLocalDe(hora),
            consumer: { mode: "new", data: { name: cliente, whatsapp: telefone } },
          },
        },
      );
      expect(status).toBe(201);
    }

    const envios: string[] = [];
    page.on("request", (req) => {
      const acao = /\/appointments\/[^/]+\/(confirm|start|complete|no-show)$/.exec(req.url());
      if (req.method() === "POST" && acao) envios.push(acao[1]);
    });
    const linha = (hora: string) =>
      page.getByTestId("agenda-do-dia").locator("li").filter({ hasText: `${hora}–` });
    async function abrirAgenda() {
      await page.goto("/conta/agendamentos");
      await page.getByLabel("Dia").fill(DATA);
      await expect(page.getByTestId("agenda-do-dia")).toBeVisible();
    }

    // --------------------------------------------- relógio real: dias antes
    await abrirAgenda();
    const nove = linha("09:00");
    await expect(nove.getByTestId("status-agendado")).toHaveText("Aguardando confirmação");
    await expect(nove.getByTestId("confirmar-reserva")).toBeVisible();
    await expect(nove.getByTestId("abrir-remarcacao")).toBeVisible();
    await expect(nove.getByTestId("abrir-cancelamento")).toBeVisible();
    for (const ausente of ["iniciar-atendimento", "abrir-conclusao", "abrir-falta"]) {
      await expect(nove.getByTestId(ausente)).toHaveCount(0);
    }

    // Confirmar é um clique só e o servidor aceita (antes do início).
    await nove.getByTestId("confirmar-reserva").click();
    await expect(nove.getByTestId("status-agendado")).toHaveText("Confirmado");
    await expect(nove.getByTestId("confirmar-reserva")).toHaveCount(0);
    expect(envios).toEqual(["confirm"]);

    // ------------------------------- relógio do NAVEGADOR em 09:20 de DATA
    // Só a tela muda de opinião sobre o que oferecer; o servidor segue com o
    // relógio real (dias antes de DATA) e recusa — é isso que prova que cada
    // botão chama a SUA rota, sem reenvio, e que nada muda no banco. O
    // sucesso dessas ações é provado contra o PostgreSQL, com relógio injetado.
    await page.clock.setFixedTime(new Date(instanteLocalDe("09:20")));
    await abrirAgenda();

    // 09:00 confirmada e já começou: iniciar, concluir e falta — sem remarcar
    // nem cancelar.
    for (const presente of ["iniciar-atendimento", "abrir-conclusao", "abrir-falta"]) {
      await expect(nove.getByTestId(presente)).toBeVisible();
    }
    await expect(nove.getByTestId("abrir-remarcacao")).toHaveCount(0);
    await expect(nove.getByTestId("abrir-cancelamento")).toHaveCount(0);

    // 09:45 pendente, faltando 25 min: "Iniciar" SE SOMA a confirmar,
    // remarcar e cancelar.
    const noveEQuarenta = linha("09:45");
    for (const presente of [
      "confirmar-reserva",
      "iniciar-atendimento",
      "abrir-remarcacao",
      "abrir-cancelamento",
    ]) {
      await expect(noveEQuarenta.getByTestId(presente)).toBeVisible();
    }
    await expect(noveEQuarenta.getByTestId("abrir-falta")).toHaveCount(0);

    // Registrar falta: confirmação que NOMEIA a reserva; recusa do servidor.
    await nove.getByTestId("abrir-falta").click();
    await expect(page.getByTestId("reserva-com-falta")).toContainText(
      "09:00–09:30 · Corte · com Ana Souza · para Cliente das Nove",
    );
    await page.getByTestId("confirmar-falta-botao").click();
    await expect(page.getByTestId("erro-acao-reserva")).toContainText("registrar falta");
    expect(envios).toEqual(["confirm", "no-show"]);
    // A confirmação sobrevive ao reload da agenda e não reenvia nada.
    await expect(page.getByTestId("confirmar-falta")).toBeVisible();
    await page.getByTestId("confirmar-falta").getByRole("button", { name: "Voltar" }).click();
    await expect(page.getByTestId("confirmar-falta")).toHaveCount(0);

    // Concluir: desistir não envia nada; confirmar envia uma vez.
    await nove.getByTestId("abrir-conclusao").click();
    await expect(page.getByTestId("reserva-a-concluir")).toContainText("Cliente das Nove");
    await page.getByTestId("confirmar-conclusao").getByRole("button", { name: "Voltar" }).click();
    expect(envios).toEqual(["confirm", "no-show"]);
    await nove.getByTestId("abrir-conclusao").click();
    await page.getByTestId("confirmar-conclusao-botao").click();
    await expect(page.getByTestId("erro-acao-reserva")).toContainText("concluir");
    expect(envios).toEqual(["confirm", "no-show", "complete"]);
    await page.getByTestId("confirmar-conclusao").getByRole("button", { name: "Voltar" }).click();

    // Iniciar: um clique, sem confirmação; o servidor recusa pela antecedência.
    await noveEQuarenta.getByTestId("iniciar-atendimento").click();
    await expect(page.getByTestId("erro-acao-reserva")).toContainText("iniciar");
    expect(envios).toEqual(["confirm", "no-show", "complete", "start"]);

    // Nada mudou no banco: o reload relê pela API.
    await abrirAgenda();
    await expect(nove.getByTestId("status-agendado")).toHaveText("Confirmado");
    await expect(noveEQuarenta.getByTestId("status-agendado")).toHaveText(
      "Aguardando confirmação",
    );
    expect(envios).toEqual(["confirm", "no-show", "complete", "start"]);
  });
});
