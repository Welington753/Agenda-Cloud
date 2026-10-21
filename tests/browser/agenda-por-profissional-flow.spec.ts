// Teste de navegador da visualização "Por profissional" da agenda real
// (`/conta/agendamentos`) — contra o backend real e um PostgreSQL descartável.
//
// Prova que a alternância Lista ↔ Por profissional é só APRESENTAÇÃO: mesma
// consulta (nenhuma nova leitura ao alternar), mesmas reservas (nada perdido
// nem duplicado), mesmo filtro, mesmas ações e confirmações (com o controle
// de `expectedStartAt`), mesmos estados de vazio, erro e lista incompleta, e
// o destaque de atendimento em andamento e de reserva recém-criada.
//
// Orçamento de POST /auth/register: 1 de 5. Roda pela
// playwright.relogio-de-teste.config.ts (`npm run test:browser:agenda-profissional`):
// o backend sobe às 10:00 de hoje no fuso do estabelecimento e o navegador no
// mesmo instante, então o atendimento em andamento de HOJE sempre existe.
//
// Só a resposta INCOMPLETA é alterada pelo teste (o campo `complete` da
// resposta real vira `false`): não há como obrigar o backend a cortar um dia
// sem criar centenas de reservas. As reservas continuam as reais.
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
import {
  agoraDoTeste,
  conferirRelogioDoBackend,
  conferirRelogioDoNavegador,
  instalarRelogioDeTeste,
} from "./support/relogio-de-teste";

const BACKEND_URL = "http://localhost:3001";
const SENHA = "senha-da-agenda-por-profissional-123";
const COMPUTADOR = { width: 1280, height: 800 };
const CELULAR = { width: 390, height: 844 };

async function api<T>(pagina: Page, caminho: string, method = "GET", body?: unknown) {
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

const ehListaDoDia = (url: URL) =>
  url.pathname.endsWith("/appointments") && url.searchParams.has("date");
const campoDia = (p: Page) => p.getByLabel("Dia", { exact: true });
const filtro = (p: Page) => p.getByLabel("Filtrar por profissional");
const alternar = (p: Page, rotulo: "Lista" | "Por profissional") =>
  p.getByRole("group", { name: "Visualização da agenda" }).getByRole("button", { name: rotulo });
const grupos = (p: Page) => p.getByTestId("grupo-profissional");
const grupo = (p: Page, nome: string) =>
  grupos(p).filter({ has: p.getByRole("heading", { name: new RegExp(`^${nome}`) }) });
const nomesDosGrupos = (p: Page) => grupos(p).getByRole("heading").allTextContents();
const clientesDe = (escopo: ReturnType<typeof grupos>) =>
  escopo.getByTestId("cliente-agendado").allTextContents();

async function semRolagemHorizontal(p: Page) {
  const l = await p.evaluate(() => ({
    conteudo: document.documentElement.scrollWidth,
    janela: window.innerWidth,
  }));
  expect(l.conteudo).toBeLessThanOrEqual(l.janela);
}

async function fotografar(p: Page, nome: string) {
  for (const [dispositivo, viewport] of [
    ["computador", COMPUTADOR],
    ["celular", CELULAR],
  ] as const) {
    await p.setViewportSize(viewport);
    if (dispositivo === "celular") {
      await semRolagemHorizontal(p);
      await expect(filtro(p)).toBeVisible();
    }
    await p.screenshot({
      path: test.info().outputPath(`agenda-profissional-${nome}-${dispositivo}.png`),
      fullPage: true,
    });
  }
  await p.setViewportSize(COMPUTADOR);
}

test("agenda por profissional: grupos, ordem, alternância, filtro, estados e ações", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize(COMPUTADOR);
  const agora = await instalarRelogioDeTeste(page);

  // ------------------------------------------------------------- fixture
  const sufixo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `agenda-prof-${sufixo}@example.test`;
  const cadastro = await request.post(`${BACKEND_URL}/auth/register`, {
    data: {
      ownerName: "Dona dos Grupos",
      businessName: `Estúdio Grupos ${sufixo}`,
      email,
      phone: "11977771111",
      password: SENHA,
    },
  });
  expect(cadastro.status(), await cadastro.text()).toBe(201);
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/conta\/visao-geral$/);

  const me = await api<{ activeContext: { tenantId: string; trial: { trialStartAt: string } } }>(
    page,
    "/auth/me",
  );
  conferirRelogioDoBackend(me.corpo.activeContext.trial.trialStartAt);
  await conferirRelogioDoNavegador(page);
  const base = `/tenants/${me.corpo.activeContext.tenantId}`;

  const servico = await api<{ service: { id: string } }>(page, `${base}/services`, "POST", {
    name: "Corte",
    shortDescription: "",
    priceCents: 5000,
    priceVisible: true,
    durationMinutes: 60,
    bufferAfterMinutes: 0,
    modality: "IN_PERSON",
    activeInPublicBooking: true,
    requiresManualConfirmation: false,
  });
  expect(servico.status).toBe(201);
  const corte = servico.corpo.service.id;
  const profissional = async (name: string) => {
    const r = await api<{ professional: { id: string } }>(page, `${base}/professionals`, "POST", {
      name,
      serviceIds: [corte],
    });
    expect(r.status).toBe(201);
    return r.corpo.professional.id;
  };
  const ana = await profissional("Ana Souza");
  const bruno = await profissional("Bruno Lima");
  await profissional("Caio Reis");
  const davi = await profissional("Davi Rocha");

  const hoje = hojeNoFusoDoTenant(agora);
  const weekdayHoje = weekdayDe(hoje);
  for (const id of [ana, bruno, davi]) {
    const dias =
      id === ana && weekdayHoje !== WEEKDAY_DA_DATA
        ? [
            { weekday: WEEKDAY_DA_DATA, intervals: [{ start: "09:00", end: "12:00" }] },
            { weekday: weekdayHoje, intervals: [{ start: "00:00", end: "23:45" }] },
          ]
        : id === ana
          ? [{ weekday: WEEKDAY_DA_DATA, intervals: [{ start: "00:00", end: "23:45" }] }]
          : [{ weekday: WEEKDAY_DA_DATA, intervals: [{ start: "09:00", end: "12:00" }] }];
    expect((await api(page, `${base}/professionals/${id}/schedule`, "PUT", { days: dias })).status).toBe(200);
  }

  const reservar = async (professionalId: string, startAt: string, name: string, whatsapp: string) => {
    const r = await api<{ appointment: { id: string; startAt: string } }>(page, `${base}/appointments`, "POST", {
      professionalId,
      serviceId: corte,
      startAt,
      consumer: { mode: "new", data: { name, whatsapp } },
    });
    expect(r.status, JSON.stringify(r.corpo)).toBe(201);
    return r.corpo.appointment;
  };
  // Criadas FORA da ordem cronológica, em três profissionais.
  await reservar(bruno, instanteLocalDe("11:00"), "Bia Onze", "(11) 91111-0011");
  await reservar(ana, instanteLocalDe("10:00"), "Ana Dez", "(11) 91111-0010");
  await reservar(davi, instanteLocalDe("09:00"), "Davi Nove", "(11) 91111-0009");
  await reservar(bruno, instanteLocalDe("09:00"), "Bia Nove", "(11) 91111-0109");
  await reservar(ana, instanteLocalDe("09:00"), "Ana Nove", "(11) 91111-0209");
  // Davi fica inativo DEPOIS de ter reserva: ela não pode sumir.
  expect((await api(page, `${base}/professionals/${davi}/deactivate`, "POST")).status).toBe(200);

  // ------------------------------------------------- Lista é a inicial
  let leituras = 0;
  page.on("request", (r) => {
    if (r.method() === "GET" && ehListaDoDia(new URL(r.url()))) leituras += 1;
  });
  await page.goto("/conta/agendamentos");
  await expect(alternar(page, "Lista")).toHaveAttribute("aria-pressed", "true");
  await campoDia(page).fill(DATA);
  await expect(page.getByTestId("agenda-do-dia").getByTestId("cliente-agendado")).toHaveCount(5);
  const naLista = (await page.getByTestId("cliente-agendado").allTextContents()).sort();
  await expect(page.getByTestId("resumo-do-dia")).toHaveText("5 atendimentos");

  // ------------------------------------- Por profissional: grupos e ordem
  const leiturasAntes = leituras;
  await alternar(page, "Por profissional").click();
  await expect(alternar(page, "Por profissional")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("agenda-do-dia")).toHaveCount(0);
  await expect.poll(() => nomesDosGrupos(page)).toEqual([
    "Ana Souza",
    "Bruno Lima",
    "Caio Reis",
    "Davi Rocha(inativo)",
  ]);
  expect(await clientesDe(grupo(page, "Ana Souza"))).toEqual(["Ana Nove", "Ana Dez"]);
  expect(await clientesDe(grupo(page, "Bruno Lima"))).toEqual(["Bia Nove", "Bia Onze"]);
  expect(await clientesDe(grupo(page, "Davi Rocha"))).toEqual(["Davi Nove"]);
  await expect(grupo(page, "Caio Reis").getByTestId("grupo-sem-agendamentos")).toContainText(
    "Sem agendamentos neste dia",
  );
  await expect(grupo(page, "Ana Souza").getByTestId("contagem-do-grupo")).toHaveText("2 agendamentos");
  // Mesmas reservas, nenhuma a mais ou a menos, e nenhuma leitura nova.
  expect((await page.getByTestId("cliente-agendado").allTextContents()).sort()).toEqual(naLista);
  await expect(page.getByTestId("resumo-do-dia")).toHaveText("5 atendimentos");
  expect(leituras, "alternar não refaz a consulta").toBe(leiturasAntes);
  await fotografar(page, "varios");

  await alternar(page, "Lista").click();
  expect((await page.getByTestId("agenda-do-dia").getByTestId("cliente-agendado").allTextContents()).sort()).toEqual(naLista);
  await alternar(page, "Por profissional").click();
  expect(leituras).toBe(leiturasAntes);

  // ------------------------------------------------------------- filtro
  await filtro(page).selectOption({ label: "Bruno Lima" });
  await expect.poll(() => nomesDosGrupos(page)).toEqual(["Bruno Lima"]);
  expect(await clientesDe(grupo(page, "Bruno Lima"))).toEqual(["Bia Nove", "Bia Onze"]);
  await filtro(page).selectOption({ label: "Davi Rocha (inativo)" });
  await expect.poll(() => nomesDosGrupos(page)).toEqual(["Davi Rocha(inativo)"]);
  await filtro(page).selectOption({ label: "Caio Reis" });
  await expect(page.getByTestId("agenda-vazia-filtro")).toBeVisible();
  await page.getByRole("button", { name: "Ver todos os profissionais" }).click();
  await expect(grupos(page)).toHaveCount(4);

  // -------------------------------------------- lista incompleta (complete=false)
  await page.route(ehListaDoDia, async (rota) => {
    const resposta = await rota.fetch();
    const corpo = await resposta.json();
    await rota.fulfill({ response: resposta, json: { ...corpo, complete: false } });
  });
  try {
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await expect(page.getByTestId("agenda-incompleta")).toBeVisible();
    // Nada de total nem de "sem agendamentos" quando a lista veio cortada.
    await expect(page.getByTestId("resumo-do-dia")).toHaveCount(0);
    await expect(grupo(page, "Ana Souza").getByTestId("contagem-do-grupo")).toHaveText("2 carregados");
    await expect(page.getByTestId("grupo-sem-agendamentos")).toHaveCount(0);
    await expect.poll(() => nomesDosGrupos(page)).toEqual([
      "Ana Souza",
      "Bruno Lima",
      "Davi Rocha(inativo)",
    ]);
    await fotografar(page, "incompleta");
  } finally {
    await page.unrouteAll({ behavior: "wait" });
  }

  // ------------------------------------------------------------- erro
  await page.route(ehListaDoDia, (rota) => rota.abort("failed"));
  try {
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await expect(page.getByTestId("erro-agenda")).toContainText("carregar a agenda");
    await expect(grupos(page)).toHaveCount(0);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
  }
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(grupos(page)).toHaveCount(4);
  await expect(alternar(page, "Por profissional")).toHaveAttribute("aria-pressed", "true");

  // ------------------------------------------------------------- dia vazio
  await page.getByRole("button", { name: "Próximo dia" }).click();
  await expect(campoDia(page)).toHaveValue(DATA_SEGUINTE);
  await expect(page.getByTestId("agenda-vazia")).toBeVisible();
  await expect(grupos(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Dia anterior" }).click();
  await expect(grupos(page)).toHaveCount(4);

  // ------------------- cancelar no grupo: confirmação, expectedStartAt, um envio
  const cartaoBia = grupo(page, "Bruno Lima").locator("li").filter({ hasText: "Bia Onze" });
  await cartaoBia.getByTestId("abrir-cancelamento").click();
  await expect(page.getByTestId("reserva-a-cancelar")).toContainText("11:00–12:00");
  // Outra sessão move a reserva de 11:00 para 10:00 com a confirmação aberta.
  const lista = await api<{ appointments: { id: string; consumer: { name: string }; startAt: string }[] }>(
    page,
    `${base}/appointments?date=${DATA}`,
  );
  const bia = lista.corpo.appointments.find((a) => a.consumer.name === "Bia Onze")!;
  expect(
    (await api(page, `${base}/appointments/${bia.id}/reschedule`, "POST", {
      startAt: instanteLocalDe("10:00"),
      expectedStartAt: bia.startAt,
    })).status,
  ).toBe(201);
  let cancelamentos = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/cancel")) cancelamentos += 1;
  });
  await page.getByTestId("confirmar-cancelamento-botao").click();
  // 409: a tela avisa que a reserva mudou e mostra o horário novo; nada reenviado.
  await expect(page.getByTestId("reserva-alterada")).toBeVisible();
  await expect(page.getByTestId("reserva-a-cancelar")).toContainText("10:00–11:00");
  expect(cancelamentos).toBe(1);
  await page.getByTestId("confirmar-cancelamento-botao").dblclick();
  await expect(
    grupo(page, "Bruno Lima").locator("li").filter({ hasText: "Bia Onze" }).getByTestId("status-agendado"),
  ).toHaveText("Cancelado");
  expect(cancelamentos, "duplo clique com envio em voo vira um envio só").toBe(2);
  expect(await clientesDe(grupo(page, "Bruno Lima"))).toEqual(["Bia Nove", "Bia Onze"]);

  // ---------------------- nova reserva: marcada no grupo certo, sem formulário novo
  await page.getByTestId("novo-agendamento").click();
  await page.getByLabel("Profissional", { exact: true }).selectOption(bruno);
  await page.getByRole("button", { name: "Cadastrar novo" }).click();
  await page.getByLabel("Nome do cliente").fill("Caco Novo");
  await page.getByLabel("WhatsApp").fill("(11) 91111-0999");
  await page.getByRole("button", { name: "Ver horários livres" }).click();
  await page.locator(`[data-testid="horario-livre"][data-inicio="${instanteLocalDe("11:00")}"]`).click();
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByTestId("painel-novo-agendamento")).toHaveCount(0);
  await expect(alternar(page, "Por profissional")).toHaveAttribute("aria-pressed", "true");
  await expect(grupo(page, "Bruno Lima").locator("[data-recem-criada]")).toContainText("Caco Novo");
  expect(await clientesDe(grupo(page, "Bruno Lima"))).toEqual(["Bia Nove", "Bia Onze", "Caco Novo"]);

  // ----------------------------- atendimento em andamento HOJE (relógio de teste)
  const inicio = proximoInicioDeHoje(agoraDoTeste(), 3);
  expect(inicio, `sem horário hoje às ${agoraDoTeste().toISOString()}`).not.toBeNull();
  await reservar(ana, inicio!.startAt, "Gabi Agora", "(11) 91111-0777");
  await page.getByRole("button", { name: "Hoje", exact: true }).click();
  await expect(campoDia(page)).toHaveValue(hoje);
  const gabi = grupo(page, "Ana Souza").locator("li").filter({ hasText: "Gabi Agora" });
  await gabi.getByTestId("iniciar-atendimento").click();
  await expect(gabi.getByTestId("status-agendado")).toHaveText("Em atendimento");
  await expect(grupo(page, "Ana Souza").locator("[data-em-atendimento]")).toContainText("Gabi Agora");
});
