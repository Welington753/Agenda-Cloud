// Teste de navegador da Visão geral e da estrutura comum da área real
// (`/conta/**`) — contra o backend real e um PostgreSQL descartável, mesmo
// padrão de agenda-view-flow.spec.ts.
//
// Prova: os quatro indicadores e as listas a partir da agenda REAL de hoje;
// carregamento, falha, lista sem prova de completa e falta de permissão, cada
// um com o seu estado (zero só com resposta válida); o atalho de novo
// agendamento usando o formulário da agenda; a troca de estabelecimento sem
// sobra do anterior; o redirecionamento seguro por `next`; e as capturas da
// Visão geral, Agenda, Serviços e Profissionais em 1280 e 390 px.
//
// O SEGUNDO VÍNCULO e a PERMISSÃO NEGADA não têm rota no backend (não há
// convite nem gestão de papéis ainda): são gravados direto no PostgreSQL
// DESCARTÁVEL deste teste, e a conexão se recusa a abrir fora do loopback —
// nunca Neon, nunca banco existente.
//
// RELÓGIO DE TESTE: o spec só roda por playwright.visao-geral.config.ts, que
// sobe o backend com o relógio deslocado para as 10:00 de hoje (fuso do
// estabelecimento); o navegador começa no mesmo instante. Assim o caso não
// depende da hora real — nem pulo, nem espera pela virada do dia.
//
// Orçamento: 2 cadastros e 3 logins (limites reais: 5 de cada por 15 min por
// IP), em invocação SEPARADA do Playwright (ver test-frontend-auth.yml).
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { Client } from "pg";
import { hojeNoFusoDoTenant, proximoInicioDeHoje, weekdayDe } from "./data-de-teste";

const BACKEND_URL = "http://localhost:3001";
const SENHA = "senha-da-visao-geral-e2e-123";
const COMPUTADOR = { width: 1280, height: 800 };
const CELULAR = { width: 390, height: 844 };
const MINUTO = 60_000;

/** Fixture direto no banco descartável: recusa qualquer host fora do loopback. */
async function noBancoDescartavel(sql: string, valores: unknown[]): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL ausente: este teste só roda no ambiente descartável.");
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`recusado: ${host} não é o PostgreSQL descartável local`);
  }
  // TLS verificado, como o backend (o certificado vem de NODE_EXTRA_CA_CERTS).
  const cliente = new Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
  await cliente.connect();
  try {
    await cliente.query(sql, valores);
  } finally {
    await cliente.end();
  }
}

async function chamar<T>(api: APIRequestContext, metodo: string, caminho: string, corpo?: unknown) {
  const resposta = await api.fetch(`${BACKEND_URL}${caminho}`, { method: metodo, data: corpo });
  const texto = await resposta.text();
  return { status: resposta.status(), corpo: (texto ? JSON.parse(texto) : null) as T };
}

async function cadastrar(api: APIRequestContext, rotulo: string) {
  const sufixo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dados = {
    ownerName: `Dona ${rotulo}`,
    businessName: `Estúdio ${rotulo} ${sufixo}`,
    email: `visao-${rotulo.toLowerCase()}-${sufixo}@example.test`,
    phone: "11977773333",
    password: SENHA,
  };
  const r = await api.post(`${BACKEND_URL}/auth/register`, { data: dados });
  expect(r.status(), await r.text()).toBe(201);
  const me = await chamar<{
    user: { id: string };
    activeContext: { tenantId: string; trial: { trialStartAt: string } };
  }>(api, "GET", "/auth/me");
  return {
    ...dados,
    userId: me.corpo.user.id,
    tenantId: me.corpo.activeContext.tenantId,
    // Instante do cadastro pelo relógio do BACKEND (`new Date()` do controller).
    cadastradoEm: Date.parse(me.corpo.activeContext.trial.trialStartAt),
  };
}

async function entrar(page: Page, email: string, destino = "/login") {
  await page.goto(destino);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
}

async function fotografar(page: Page, nome: string) {
  for (const [dispositivo, viewport] of [
    ["computador", COMPUTADOR],
    ["celular", CELULAR],
  ] as const) {
    await page.setViewportSize(viewport);
    if (dispositivo === "celular") {
      const larguras = await page.evaluate(() => ({
        conteudo: document.documentElement.scrollWidth,
        tela: window.innerWidth,
      }));
      expect(larguras.conteudo, `rolagem horizontal em ${nome}`).toBeLessThanOrEqual(larguras.tela);
    }
    // Mouse na borda direita, no meio da tela: fora do menu lateral e da barra
    // inferior, para nenhum item aparecer em "hover" na imagem.
    await page.mouse.move(viewport.width - 1, Math.round(viewport.height / 2));
    // No celular a barra inferior é fixa: uma imagem de página inteira a
    // desenharia no meio. São duas imagens da tela real, o topo e o fim.
    await page.screenshot({
      path: test.info().outputPath(`conta-${nome}-${dispositivo}.png`),
      fullPage: dispositivo === "computador",
    });
    if (dispositivo === "celular") {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.screenshot({ path: test.info().outputPath(`conta-${nome}-celular-fim.png`) });
      await page.evaluate(() => window.scrollTo(0, 0));
    }
  }
  await page.setViewportSize(COMPUTADOR);
}

const valor = (page: Page, id: string) => page.getByTestId(`indicador-${id}-valor`);
const nav = (page: Page) => page.getByRole("navigation", { name: "Áreas da conta" });
const ehListaDoDia = (url: URL) =>
  url.pathname.endsWith("/appointments") && url.searchParams.has("date");

test.describe("visão geral e estrutura comum da área real", () => {
  test("indicadores e listas reais, estados próprios, atalhos, troca de estabelecimento e next seguro", async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000);
    await page.setViewportSize(COMPUTADOR);

    // Relógio de TESTE (playwright.visao-geral.config.ts): o backend já sobe
    // deslocado para as 10:00 de hoje no fuso do estabelecimento, e o
    // navegador começa no mesmo instante. O caso precisa de um atendimento
    // que já pode ser iniciado e de 2 h de horários futuros depois dele, no
    // mesmo dia — com o relógio real isso não cabe perto da meia-noite.
    const deslocamento = Number(process.env.E2E_RELOGIO_DESLOCAMENTO_MS);
    expect(
      Number.isInteger(deslocamento),
      "rode pela playwright.visao-geral.config.ts (npm run test:browser:visao-geral)",
    ).toBe(true);
    const agora = new Date(Date.now() + deslocamento);
    await page.clock.install({ time: agora });

    // A última reserva começa 120 min depois e dura 30: precisa caber na
    // jornada, que termina às 23:45.
    const inicio = proximoInicioDeHoje(agora, 3, "21:15");
    expect(inicio, `sem horário hoje para montar o caso às ${agora.toISOString()}`).not.toBeNull();
    const hoje = hojeNoFusoDoTenant(agora);
    const instante = (minutosDepois: number) =>
      new Date(Date.parse(inicio!.startAt) + minutosDepois * MINUTO).toISOString();

    // ------------------------------------------------ estabelecimento A (fixture)
    const a = await cadastrar(request, "A");
    // O backend vê o mesmo "agora" do spec e do navegador.
    expect(Math.abs(a.cadastradoEm - (Date.now() + deslocamento))).toBeLessThan(MINUTO);
    const base = `/tenants/${a.tenantId}`;
    const servico = async (name: string, extra: Record<string, unknown> = {}) => {
      const r = await chamar<{ service: { id: string } }>(request, "POST", `${base}/services`, {
        name,
        shortDescription: "",
        priceCents: 5000,
        priceVisible: true,
        durationMinutes: 30,
        bufferAfterMinutes: 0,
        modality: "IN_PERSON",
        activeInPublicBooking: true,
        requiresManualConfirmation: false,
        ...extra,
      });
      expect(r.status).toBe(201);
      return r.corpo.service.id;
    };
    const corte = await servico("Corte", {
      shortDescription: "Tesoura e máquina, com acabamento.",
    });
    const barba = await servico("Barba", {
      shortDescription: "Toalha quente e navalha.",
      priceCents: 3500,
      requiresManualConfirmation: true,
    });
    const avaliacao = await servico("Avaliação", {
      shortDescription: "Primeira conversa.",
      priceCents: null,
    });
    const coloracao = await servico("Coloração", { durationMinutes: 90, priceCents: 12000 });

    const profissional = async (name: string, serviceIds: string[]) => {
      const r = await chamar<{ professional: { id: string } }>(
        request,
        "POST",
        `${base}/professionals`,
        {
          name,
          serviceIds,
        },
      );
      expect(r.status).toBe(201);
      return r.corpo.professional.id;
    };
    const ana = await profissional("Ana Souza", [corte, barba, avaliacao]);
    const bruno = await profissional("Bruno Lima", [corte, barba]);
    await profissional("Carla Dias", [corte, coloracao]);
    const diego = await profissional("Diego Reis", [corte]);
    expect([200, 201]).toContain(
      (await chamar(request, "POST", `${base}/services/${coloracao}/deactivate`)).status,
    );
    expect([200, 201]).toContain(
      (await chamar(request, "POST", `${base}/professionals/${diego}/deactivate`)).status,
    );

    for (const id of [ana, bruno]) {
      const r = await chamar(request, "PUT", `${base}/professionals/${id}/schedule`, {
        days: [{ weekday: weekdayDe(hoje), intervals: [{ start: "00:00", end: "23:45" }] }],
      });
      expect(r.status).toBe(200);
    }

    // Cada cliente novo precisa de um WhatsApp próprio no estabelecimento.
    let telefones = 0;
    const reservar = async (
      professionalId: string,
      serviceId: string,
      startAt: string,
      nome: string,
    ) => {
      const r = await chamar<{ appointment: { id: string; startAt: string } }>(
        request,
        "POST",
        `${base}/appointments`,
        {
          professionalId,
          serviceId,
          startAt,
          consumer: {
            mode: "new",
            data: { name: nome, whatsapp: `(11) 95555-${String(++telefones).padStart(4, "0")}` },
          },
        },
      );
      expect(r.status, JSON.stringify(r.corpo)).toBe(201);
      return r.corpo.appointment;
    };
    const acao = async (reserva: { id: string; startAt: string }, rota: string) => {
      const r = await chamar(request, "POST", `${base}/appointments/${reserva.id}/${rota}`, {
        expectedStartAt: reserva.startAt,
      });
      expect([200, 201], `${rota}: ${JSON.stringify(r.corpo)}`).toContain(r.status);
    };

    // Concluída (Ana: iniciada e encerrada), em atendimento (Bruno) e uma
    // cancelada, que fica fora do total.
    const concluida = await reservar(ana, corte, instante(0), "Cliente Concluída");
    await acao(concluida, "start");
    await acao(concluida, "complete");
    await acao(await reservar(ana, corte, instante(30), "Cliente Cancelada"), "cancel");
    await acao(await reservar(bruno, corte, instante(0), "Cliente Em Atendimento"), "start");
    // Futuras, criadas fora de ordem: 2 aguardando (Barba pede confirmação) e 1 confirmada.
    await reservar(bruno, barba, instante(120), "Próxima Três");
    await reservar(ana, corte, instante(90), "Próxima Dois");
    await reservar(ana, barba, instante(60), "Próxima Um");

    // ------------------------------------------------ estabelecimento B + vínculo de A
    const b = await cadastrar(request, "B");
    const membershipId = `e2em${Date.now().toString(36)}`.slice(0, 30);
    await noBancoDescartavel(
      `INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`,
      [membershipId, a.userId, b.tenantId],
    );

    // ------------------------------------------------ login de A: escolhe o A
    await entrar(page, a.email);
    await expect(page).toHaveURL(/\/conta\/selecionar-estabelecimento$/);
    const relogioDoNavegador = await page.evaluate(() => Date.now());
    expect(Math.abs(relogioDoNavegador - (Date.now() + deslocamento))).toBeLessThan(MINUTO);
    await page.getByRole("button", { name: new RegExp(a.businessName) }).click();
    await expect(page).toHaveURL(/\/conta\/visao-geral$/);
    await expect(page.getByTestId("estabelecimento-ativo")).toHaveText(a.businessName);

    // Indicadores: 5 não canceladas, 2 aguardando, 1 em atendimento, 1 concluída.
    await expect(valor(page, "agendamentos")).toHaveText("5");
    await expect(valor(page, "aguardando")).toHaveText("2");
    await expect(valor(page, "em-atendimento")).toHaveText("1");
    await expect(valor(page, "concluidos")).toHaveText("1");
    // Próximos: só futuros PENDING/CONFIRMED, em ordem cronológica.
    const proximos = page.getByTestId("proximo-atendimento");
    await expect(proximos).toHaveCount(3);
    expect(await page.getByTestId("proximo-cliente").allTextContents()).toEqual([
      "Próxima Um",
      "Próxima Dois",
      "Próxima Três",
    ]);
    await expect(proximos.first()).toContainText("Barba · com Ana Souza");
    await expect(proximos.first()).toContainText("Aguardando confirmação");
    await expect(proximos.nth(1)).toContainText("Confirmado");
    // Em atendimento aparece à parte, nunca entre os próximos.
    await expect(page.getByTestId("em-andamento")).toContainText("Cliente Em Atendimento");
    await expect(page.getByTestId("proximos-atendimentos")).not.toContainText(
      "Cliente Em Atendimento",
    );
    await expect(page.getByText("Cliente Cancelada")).toHaveCount(0);
    await fotografar(page, "visao-geral");

    // ------------------------------------------------ estados próprios
    // Carregando: retido pelo teste — nenhum número na tela.
    const retida = Promise.withResolvers<void>();
    const liberar = Promise.withResolvers<void>();
    await page.route(ehListaDoDia, async (rota) => {
      retida.resolve();
      await liberar.promise;
      await rota.continue();
    });
    try {
      await page.reload();
      await retida.promise;
      await expect(page.getByTestId("visao-geral-carregando")).toBeVisible();
      await expect(page.getByTestId("indicador-agendamentos")).toHaveCount(0);
    } finally {
      liberar.resolve();
    }
    await expect(valor(page, "agendamentos")).toHaveText("5");
    await page.unroute(ehListaDoDia);

    // Falha de comunicação: mensagem, "Tentar novamente", nenhum zero.
    await page.route(ehListaDoDia, (rota) => rota.abort("failed"));
    await page.reload();
    await expect(page.getByTestId("visao-geral-erro")).toContainText("carregar a agenda");
    await expect(page.getByTestId("indicador-agendamentos")).toHaveCount(0);
    await page.unroute(ehListaDoDia);
    await page.getByRole("button", { name: "Tentar novamente" }).click();
    await expect(valor(page, "agendamentos")).toHaveText("5");

    // Resposta real, mas sem a prova de que o dia veio inteiro (`complete`
    // falso ou ausente, como num backend anterior): nenhum total.
    for (const complete of [false, undefined]) {
      await page.route(ehListaDoDia, async (rota) => {
        const resposta = await rota.fetch();
        const corpo = (await resposta.json()) as Record<string, unknown>;
        await rota.fulfill({ response: resposta, json: { ...corpo, complete } });
      });
      await page.reload();
      await expect(page.getByTestId("visao-geral-incompleta")).toBeVisible();
      await expect(page.getByTestId("indicador-agendamentos")).toHaveCount(0);
      await page.unroute(ehListaDoDia);
    }
    await page.reload();
    await expect(valor(page, "agendamentos")).toHaveText("5");

    // ------------------------------------------------ atalhos
    await page.getByTestId("atalho-agenda").click();
    await expect(page).toHaveURL(/\/conta\/agendamentos$/);
    await expect(nav(page).getByRole("link", { name: "Agenda" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("agenda-do-dia")).toContainText("Cliente Em Atendimento");
    await fotografar(page, "agenda");

    await nav(page).getByRole("link", { name: "Visão geral" }).click();
    await page.getByTestId("atalho-novo-agendamento").click();
    // O formulário é o da agenda, aberto no painel; a URL volta a ficar limpa.
    await expect(page.getByTestId("painel-novo-agendamento")).toBeVisible();
    await expect(page).toHaveURL(/\/conta\/agendamentos$/);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("painel-novo-agendamento")).toHaveCount(0);

    // ------------------------------------------------ serviços e profissionais
    await nav(page).getByRole("link", { name: "Serviços" }).click();
    const cartaoAvaliacao = page.getByRole("article", { name: "Avaliação" });
    await expect(cartaoAvaliacao).toContainText("Sob consulta");
    await expect(cartaoAvaliacao).not.toContainText("R$ 0,00");
    await expect(page.getByRole("article", { name: "Coloração" })).toContainText("Inativo");
    await expect(
      page
        .getByRole("article", { name: "Coloração" })
        .getByRole("button", { name: "Reativar Coloração" }),
    ).toBeVisible();
    await expect(page.getByRole("article", { name: "Corte" })).toContainText("Ativo");
    await fotografar(page, "servicos");

    await nav(page).getByRole("link", { name: "Profissionais" }).click();
    const carla = page.getByRole("article", { name: "Carla Dias" });
    await expect(carla).toContainText("Coloração (inativo)");
    await expect(carla.getByRole("link", { name: "Horários de Carla Dias" })).toBeVisible();
    await expect(carla.getByRole("link", { name: "Disponibilidade de Carla Dias" })).toBeVisible();
    const diegoCartao = page.getByRole("article", { name: "Diego Reis" });
    await expect(diegoCartao).toContainText("Inativo");
    await expect(
      diegoCartao.getByRole("link", { name: "Disponibilidade de Diego Reis" }),
    ).toHaveCount(0);
    await expect(diegoCartao.getByRole("button", { name: "Reativar Diego Reis" })).toBeVisible();
    await fotografar(page, "profissionais");

    // Subpágina mantém "Profissionais" marcado.
    await carla.getByRole("link", { name: "Horários de Carla Dias" }).click();
    await expect(page).toHaveURL(/\/conta\/profissionais\/[^/]+\/horarios$/);
    await expect(nav(page).getByRole("link", { name: "Profissionais" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // ------------------------------------------------ troca para B, sem sobra de A
    await page.goto("/conta/visao-geral");
    await expect(valor(page, "agendamentos")).toHaveText("5");
    const listaDeBRetida = Promise.withResolvers<void>();
    const liberarListaDeB = Promise.withResolvers<void>();
    await page.route(
      (url) => ehListaDoDia(url) && url.pathname.includes(b.tenantId),
      async (rota) => {
        listaDeBRetida.resolve();
        await liberarListaDeB.promise;
        await rota.continue();
      },
    );
    try {
      await page.getByRole("link", { name: "Trocar de estabelecimento" }).click();
      await page.getByRole("button", { name: new RegExp(b.businessName) }).click();
      await expect(page).toHaveURL(/\/conta\/visao-geral$/);
      await listaDeBRetida.promise;
      // Enquanto a agenda de B não chega: carregando, e nada de A na tela.
      await expect(page.getByTestId("estabelecimento-ativo")).toHaveText(b.businessName);
      await expect(page.getByTestId("visao-geral-carregando")).toBeVisible();
      await expect(page.getByText("Próxima Um")).toHaveCount(0);
      await expect(page.getByTestId("indicador-agendamentos")).toHaveCount(0);
    } finally {
      liberarListaDeB.resolve();
    }
    // B não tem nada hoje: zero, provado por uma resposta válida.
    await expect(valor(page, "agendamentos")).toHaveText("0");
    await expect(valor(page, "aguardando")).toHaveText("0");
    await expect(page.getByTestId("sem-proximos")).toBeVisible();
    await expect(page.getByText("Cliente Em Atendimento")).toHaveCount(0);

    // ------------------------------------------------ sem permissão em B
    await noBancoDescartavel(
      `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode)
       VALUES ($1, $2, $3, 'AGENDA_VISUALIZAR', 'DENIED')`,
      [`e2eo${Date.now().toString(36)}`.slice(0, 30), b.tenantId, membershipId],
    );
    await page.reload();
    await expect(page.getByTestId("visao-geral-sem-permissao")).toBeVisible();
    await expect(page.getByTestId("indicador-agendamentos")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Tentar novamente" })).toHaveCount(0);
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // ------------------------------------------------ next seguro (conta só com B)
    await page.goto("/conta/servicos");
    await expect(page).toHaveURL(/\/login\?next=%2Fconta%2Fservicos$/);
    await entrar(page, b.email, page.url());
    await expect(page).toHaveURL(/\/conta\/servicos$/);
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await entrar(page, b.email, "/login?next=%2F%2Foutro-site.example%2Fphishing");
    await expect(page).toHaveURL(/^http:\/\/localhost:3000\/conta\/visao-geral$/);
  });
});
