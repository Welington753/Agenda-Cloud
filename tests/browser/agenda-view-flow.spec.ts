// Teste de navegador da VISUALIZAÇÃO da agenda real (`/conta/agendamentos`):
// agenda do dia como conteúdo principal, ordem cronológica, filtro por
// profissional, Hoje/Anterior/Próximo no fuso do estabelecimento, estados de
// carregamento, erro e vazio, "Novo agendamento" num painel e o destaque do
// atendimento em andamento — contra o backend real e um PostgreSQL
// descartável, mesmo padrão de appointments-flow.spec.ts.
//
// As regras das ações (confirmar, iniciar, concluir, falta, remarcar,
// cancelar) continuam provadas em appointments-flow.spec.ts; aqui o que se
// prova é o que a pessoa VÊ e que a tela continua falando com a API real.
//
// Orçamento de POST /auth/register: este arquivo gasta 1 (o limite real é 5
// por 15 min por IP) e roda em invocação SEPARADA do Playwright, com backend
// novo (ver .github/workflows/test-frontend-auth.yml). O limite nunca é
// afrouxado para o teste passar.
//
// Imagens: cada estado é fotografado no computador e no celular, publicadas
// pelo CI como artefato (`agenda-*.png`).
import { expect, test, type Page } from "@playwright/test";
import {
  DATA,
  DATA_SEGUINTE,
  WEEKDAY_DA_DATA,
  hojeNoFusoDoTenant,
  instanteLocalDe,
  proximoInicioDeHoje,
  weekdayDe,
} from "./data-de-teste";

const BACKEND_URL = "http://localhost:3001";
const SENHA_TESTE = "senha-da-visao-da-agenda-e2e-123";
const VIEWPORT_COMPUTADOR = { width: 1280, height: 800 };
const VIEWPORT_CELULAR = { width: 390, height: 844 };

/** Chamada autenticada à API real, com o cookie da sessão da página. */
async function api<T>(
  pagina: Page,
  caminho: string,
  method = "GET",
  body?: unknown,
): Promise<{
  status: number;
  corpo: T;
}> {
  return pagina.evaluate(
    async ({ url, method, body }) => {
      const r = await fetch(url, {
        method,
        credentials: "include",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const texto = await r.text();
      return { status: r.status, corpo: (texto ? JSON.parse(texto) : null) as T };
    },
    { url: `${BACKEND_URL}${caminho}`, method, body },
  );
}

async function fotografar(pagina: Page, nome: string): Promise<void> {
  for (const [dispositivo, viewport] of [
    ["computador", VIEWPORT_COMPUTADOR],
    ["celular", VIEWPORT_CELULAR],
  ] as const) {
    await pagina.setViewportSize(viewport);
    // Celular: nunca rolagem horizontal, em nenhum estado.
    if (dispositivo === "celular") {
      const larguras = await pagina.evaluate(() => ({
        conteudo: document.documentElement.scrollWidth,
        janela: window.innerWidth,
      }));
      expect(larguras.conteudo, `rolagem horizontal em ${nome}`).toBeLessThanOrEqual(
        larguras.janela,
      );
    }
    await pagina.screenshot({
      path: test.info().outputPath(`agenda-${nome}-${dispositivo}.png`),
      fullPage: true,
    });
  }
  await pagina.setViewportSize(VIEWPORT_COMPUTADOR);
}

const clientesNaTela = (pagina: Page) => pagina.getByTestId("cliente-agendado").allTextContents();
const horariosNaTela = (pagina: Page) => pagina.getByTestId("horario-agendado").allTextContents();
const campoDia = (pagina: Page) => pagina.getByLabel("Dia", { exact: true });
const filtro = (pagina: Page) => pagina.getByLabel("Filtrar por profissional");
const resumo = (pagina: Page) => pagina.getByTestId("resumo-do-dia");
const painel = (pagina: Page) => pagina.getByTestId("painel-novo-agendamento");
const cartao = (pagina: Page, texto: string) =>
  pagina.getByTestId("agenda-do-dia").locator("li").filter({ hasText: texto });

/** Lista do dia (GET /tenants/:id/appointments?date=...). */
const ehListaDoDia = (url: URL) =>
  url.pathname.endsWith("/appointments") && url.searchParams.has("date");

test.describe("visualização da agenda real", () => {
  test("agenda do dia: ordem, filtro, navegação, estados, painel e atendimento em andamento", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(VIEWPORT_COMPUTADOR);

    // ------------------------------------------------------------- fixture
    const sufixo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `agenda-visao-${sufixo}@example.test`;
    const cadastro = await request.post(`${BACKEND_URL}/auth/register`, {
      data: {
        ownerName: "Dona da Agenda",
        businessName: `Estúdio Agenda ${sufixo}`,
        email,
        phone: "11977774444",
        password: SENHA_TESTE,
      },
    });
    expect(cadastro.status(), await cadastro.text()).toBe(201);

    await page.goto("/login");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(SENHA_TESTE);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/conta$/);

    const me = await api<{ activeContext: { tenantId: string } }>(page, "/auth/me");
    const tenantId = me.corpo.activeContext.tenantId;
    const base = `/tenants/${tenantId}`;

    const criarServico = async (name: string, durationMinutes: number) => {
      const r = await api<{ service: { id: string } }>(page, `${base}/services`, "POST", {
        name,
        shortDescription: "",
        priceCents: 5000,
        priceVisible: true,
        durationMinutes,
        bufferAfterMinutes: 0,
        modality: "IN_PERSON",
        activeInPublicBooking: true,
        requiresManualConfirmation: false,
      });
      expect(r.status).toBe(201);
      return r.corpo.service.id;
    };
    const corte = await criarServico("Corte", 60);
    const barba = await criarServico("Barba", 15);

    const criarProfissional = async (name: string, serviceIds: string[]) => {
      const r = await api<{ professional: { id: string } }>(page, `${base}/professionals`, "POST", {
        name,
        serviceIds,
      });
      expect(r.status).toBe(201);
      return r.corpo.professional.id;
    };
    const ana = await criarProfissional("Ana Souza", [corte, barba]);
    const bruno = await criarProfissional("Bruno Lima", [corte]);
    await criarProfissional("Caio Reis", [corte]);

    // Jornada: 09:00–12:00 em DATA para os dois; Ana também o dia todo HOJE,
    // para o atendimento em andamento com o relógio real do servidor.
    const hoje = hojeNoFusoDoTenant(new Date());
    const weekdayHoje = weekdayDe(hoje);
    const jornada = async (
      professionalId: string,
      dias: { weekday: number; start: string; end: string }[],
    ) => {
      const r = await api(page, `${base}/professionals/${professionalId}/schedule`, "PUT", {
        days: dias.map((d) => ({
          weekday: d.weekday,
          intervals: [{ start: d.start, end: d.end }],
        })),
      });
      expect(r.status).toBe(200);
    };
    await jornada(
      ana,
      weekdayHoje === WEEKDAY_DA_DATA
        ? [{ weekday: WEEKDAY_DA_DATA, start: "00:00", end: "23:45" }]
        : [
            { weekday: WEEKDAY_DA_DATA, start: "09:00", end: "12:00" },
            { weekday: weekdayHoje, start: "00:00", end: "23:45" },
          ],
    );
    await jornada(bruno, [{ weekday: WEEKDAY_DA_DATA, start: "09:00", end: "12:00" }]);

    // Três reservas em DATA, criadas FORA da ordem cronológica.
    const reservar = async (
      professionalId: string,
      serviceId: string,
      startAt: string,
      name: string,
      whatsapp: string,
    ) => {
      const r = await api(page, `${base}/appointments`, "POST", {
        professionalId,
        serviceId,
        startAt,
        consumer: { mode: "new", data: { name, whatsapp } },
      });
      expect(r.status).toBe(201);
    };
    await reservar(bruno, corte, instanteLocalDe("10:00"), "Carla Cliente", "(11) 91111-1111");
    await reservar(ana, corte, instanteLocalDe("11:00"), "Elisa Cliente", "(11) 92222-2222");
    await reservar(ana, corte, instanteLocalDe("09:00"), "Diego Cliente", "(11) 93333-3333");

    // ------------------------------------------- carregamento (retido pelo teste)
    const listaRetida = Promise.withResolvers<void>();
    const liberarLista = Promise.withResolvers<void>();
    await page.route(ehListaDoDia, async (rota) => {
      listaRetida.resolve();
      await liberarLista.promise;
      await rota.continue();
    });
    try {
      await page.goto("/conta/agendamentos");
      await listaRetida.promise;
      await expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
      await expect(resumo(page)).toHaveText("Carregando atendimentos...");
      await fotografar(page, "carregando");
    } finally {
      liberarLista.resolve();
    }
    // A agenda abre no "hoje" do ESTABELECIMENTO.
    await expect(campoDia(page)).toHaveValue(hoje);
    await page.unroute(ehListaDoDia);

    // A ação principal está visível sem rolar, nos dois tamanhos.
    await expect(page.getByTestId("novo-agendamento")).toBeInViewport();

    // --------------------------------------------- vários atendimentos, em ordem
    await campoDia(page).fill(DATA);
    await expect(page.getByTestId("agenda-do-dia")).toBeVisible();
    await expect
      .poll(() => clientesNaTela(page))
      .toEqual(["Diego Cliente", "Carla Cliente", "Elisa Cliente"]);
    expect(await horariosNaTela(page)).toEqual(["09:00–10:00", "10:00–11:00", "11:00–12:00"]);
    await expect(resumo(page)).toHaveText("3 atendimentos");
    // Cada atendimento: cliente, serviço, profissional e status em texto.
    const diego = cartao(page, "Diego Cliente");
    await expect(diego).toContainText("Corte");
    await expect(diego).toContainText("com Ana Souza");
    await expect(diego.getByTestId("status-agendado")).toHaveText("Confirmado");
    await expect(page.getByTestId("novo-agendamento")).toBeInViewport();
    await fotografar(page, "varios-atendimentos");

    // ------------------------------------------------------------- filtro
    await filtro(page).selectOption({ label: "Bruno Lima" });
    await expect.poll(() => clientesNaTela(page)).toEqual(["Carla Cliente"]);
    await expect(resumo(page)).toHaveText("1 atendimento");

    await filtro(page).selectOption({ label: "Caio Reis" });
    await expect(page.getByTestId("agenda-vazia-filtro")).toBeVisible();
    await page.getByRole("button", { name: "Ver todos os profissionais" }).click();
    await expect.poll(() => clientesNaTela(page)).toHaveLength(3);

    // ------------------------------------------- Anterior / Próximo / Hoje
    await page.getByRole("button", { name: "Próximo dia" }).click();
    await expect(campoDia(page)).toHaveValue(DATA_SEGUINTE);
    await expect(page.getByTestId("agenda-vazia")).toBeVisible();
    await fotografar(page, "vazio");
    await page.getByRole("button", { name: "Dia anterior" }).click();
    await expect(campoDia(page)).toHaveValue(DATA);
    await expect.poll(() => clientesNaTela(page)).toHaveLength(3);
    await page.getByRole("button", { name: "Hoje", exact: true }).click();
    await expect(campoDia(page)).toHaveValue(hoje);
    await expect(page.getByRole("button", { name: "Hoje", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // ------------------------------------------------------------- erro
    await campoDia(page).fill(DATA);
    await expect.poll(() => clientesNaTela(page)).toHaveLength(3);
    await page.route(ehListaDoDia, (rota) => rota.abort("failed"));
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await expect(page.getByTestId("erro-agenda")).toContainText("carregar a agenda");
    await expect(page.getByTestId("erro-agenda")).not.toContainText("criada");
    await fotografar(page, "erro");
    await page.unroute(ehListaDoDia);
    await page.getByRole("button", { name: "Tentar novamente" }).click();
    await expect.poll(() => clientesNaTela(page)).toHaveLength(3);

    // --------------------------------------------- painel "Novo agendamento"
    // Com o filtro em Bruno, o formulário já abre com ele escolhido.
    await filtro(page).selectOption({ label: "Bruno Lima" });
    await page.getByTestId("novo-agendamento").click();
    await expect(painel(page)).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Novo agendamento" })).toBeVisible();
    await expect(page.getByLabel("Profissional", { exact: true })).toHaveValue(bruno);
    await expect(page.getByLabel("Data do agendamento")).toHaveValue(DATA);
    await page.getByRole("button", { name: "Cadastrar novo" }).click();
    await page.getByLabel("Nome do cliente").fill("Rascunho Descartado");
    await fotografar(page, "painel-novo-agendamento");

    // Escape fecha sem enviar nada; reabrir começa limpo.
    await page.keyboard.press("Escape");
    await expect(painel(page)).toHaveCount(0);
    await page.getByTestId("novo-agendamento").click();
    await page.getByRole("button", { name: "Cadastrar novo" }).click();
    await expect(page.getByLabel("Nome do cliente")).toHaveValue("");

    await page.getByLabel("Nome do cliente").fill("Fábio Cliente");
    await page.getByLabel("WhatsApp").fill("(11) 94444-4444");
    await page.getByRole("button", { name: "Ver horários livres" }).click();
    await page
      .locator(`[data-testid="horario-livre"][data-inicio="${instanteLocalDe("11:00")}"]`)
      .click();
    await expect(page.getByTestId("resumo")).toContainText("Bruno Lima");
    await page.locator('form button[type="submit"]').click();

    // Sucesso: o painel fecha, o formulário some, o aviso nomeia a reserva e
    // ela aparece marcada na agenda (o filtro em Bruno a mostra).
    await expect(painel(page)).toHaveCount(0);
    await expect(page.getByLabel("Nome do cliente")).toHaveCount(0);
    await expect(page.getByTestId("confirmacao")).toContainText("11:00–12:00");
    await expect(page.getByTestId("confirmacao")).toContainText("Fábio Cliente");
    await expect(page.getByTestId("confirmacao")).toContainText("com Bruno Lima");
    await expect(page.locator("[data-recem-criada]")).toContainText("Fábio Cliente");
    await expect.poll(() => clientesNaTela(page)).toEqual(["Carla Cliente", "Fábio Cliente"]);
    await fotografar(page, "reserva-criada");

    // Recarga: a reserva persistiu, e a ordem continua cronológica (empate às
    // 11:00 desempatado pela criação).
    await page.reload();
    await campoDia(page).fill(DATA);
    await expect
      .poll(() => clientesNaTela(page))
      .toEqual(["Diego Cliente", "Carla Cliente", "Elisa Cliente", "Fábio Cliente"]);

    // ----------------------------------------- atendimento em andamento (hoje)
    // Relógio REAL do servidor: só é possível iniciar a partir de 30 min antes.
    // Perto da meia-noite não há horário hoje para montar o caso.
    const inicio = proximoInicioDeHoje(new Date(), 3);
    if (inicio) {
      await reservar(ana, barba, inicio.startAt, "Gabi Em Atendimento", "(11) 95555-5555");
      await page.getByRole("button", { name: "Hoje", exact: true }).click();
      await expect(campoDia(page)).toHaveValue(hoje);
      const gabi = cartao(page, "Gabi Em Atendimento");
      await gabi.getByTestId("iniciar-atendimento").click();
      await expect(gabi.getByTestId("status-agendado")).toHaveText("Em atendimento");
      await expect(page.locator("[data-em-atendimento]")).toContainText("Gabi Em Atendimento");
      await expect(resumo(page)).toContainText("1 em atendimento");
      await fotografar(page, "em-atendimento");
    } else {
      test.info().annotations.push({
        type: "sem-horario-hoje",
        description: "perto da meia-noite: o caso de atendimento em andamento não foi montado",
      });
    }

    // --------------------------- "no horário agora" (relógio do NAVEGADOR)
    // Só destaque visual: o relógio do navegador decide o que é destacado,
    // nunca o que vale.
    await page.clock.setFixedTime(new Date(instanteLocalDe("09:20")));
    await page.goto("/conta/agendamentos");
    await campoDia(page).fill(DATA);
    await expect(cartao(page, "Diego Cliente")).toContainText("No horário agora");
    await expect(cartao(page, "Carla Cliente")).not.toContainText("No horário agora");
  });
});
