// Agendamento público real e solicitações do dono — navegador real, backend
// real e PostgreSQL descartável.
//
// Prova, de ponta a ponta: a página só existe depois de o dono ativar; o
// cliente agenda sem conta, no celular e no computador, pelo percurso
// Serviço → Profissional → Dia e horário → Seus dados → Revisar (voltar
// mantém o que vale; trocar serviço/profissional/dia derruba o horário e
// relê a disponibilidade; profissional único vem pré-selecionado na etapa; preço ausente é
// "Sob consulta"), e recebe "Solicitação enviada — aguardando confirmação";
// o pedido aparece no painel (contador no
// menu e aviso na Visão geral), continua lá depois de recarregar, e só sai
// ao confirmar ou recusar; tela desatualizada é recusada; horário tomado por
// outro cliente, resposta perdida e falha de comunicação têm mensagens
// honestas; "Combinar outro horário" não grava nada.
//
// Nenhum WhatsApp real: wa.me é respondido dentro do navegador do teste.
//
// Orçamento: 1 cadastro e 1 login (limites reais de 5 por IP); 8 pedidos
// públicos (limite de 10 por hora por IP). Invocação própria
// (`npm run test:browser:agendamento-publico`).
import { criarContaDeTeste as contaPorConvite } from "./support/contas-de-teste";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { DATA, WEEKDAY_DA_DATA, instanteLocalDe } from "./data-de-teste";

const BACKEND_URL = "http://localhost:3001";
const SENHA = "senha-do-agendamento-publico-123";
const COMPUTADOR = { width: 1280, height: 800 };
const CELULAR = { width: 390, height: 844 };
const WHATSAPP = /^https:\/\/(wa\.me|api\.whatsapp\.com)\//;
const rotuloDoDia = `dom ${DATA.slice(8, 10)}/${DATA.slice(5, 7)}`;
const dataBr = DATA.split("-").reverse().join("/");

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

async function semRolagemHorizontal(p: Page) {
  const l = await p.evaluate(() => ({ conteudo: document.documentElement.scrollWidth, janela: window.innerWidth }));
  expect(l.conteudo).toBeLessThanOrEqual(l.janela);
}

/** Visitante anônimo: contexto novo, sem cookie nenhum. */
async function visitante(browser: Browser, viewport: { width: number; height: number }) {
  const contexto = await browser.newContext({ viewport });
  return { contexto, pagina: await contexto.newPage() };
}

const servicoPublico = (p: Page, nome: string) =>
  p.getByTestId("lista-servicos-publicos").getByRole("button", { name: new RegExp(nome) });
const horarioPublico = (p: Page, hora: string) =>
  p.getByTestId("lista-horarios-publicos").getByRole("button", { name: hora, exact: true });

/** Serviço → profissional → dia → horário → Continuar.
 * `profissional: null` = o serviço tem um profissional só: a etapa aparece
 * com ele pré-selecionado e a pessoa confirma em "Continuar". */
async function escolherHorario(p: Page, servico: string, profissional: string | null, hora: string) {
  await servicoPublico(p, servico).click();
  if (profissional) {
    await p.getByTestId("lista-profissionais-publicos").getByRole("button", { name: new RegExp(profissional) }).click();
  } else {
    await expect(p.getByTestId("titulo-etapa")).toHaveText("Escolha o profissional");
    await expect(p.getByTestId("profissional-unico")).toBeVisible();
    await expect(p.getByTestId("lista-profissionais-publicos").getByRole("button")).toHaveAttribute("aria-pressed", "true");
    await p.getByTestId("continuar-profissional").click();
  }
  await p.getByTestId("lista-dias").getByRole("button", { name: rotuloDoDia }).click();
  await horarioPublico(p, hora).click();
  await expect(horarioPublico(p, hora)).toHaveAttribute("aria-pressed", "true");
  await p.getByTestId("continuar-horario").click();
}

/** Seus dados → Revisar. */
async function preencher(p: Page, nome: string, whatsapp: string) {
  await p.getByLabel("Nome").fill(nome);
  await p.getByLabel("WhatsApp com DDD").fill(whatsapp);
  await p.getByTestId("revisar-pedido").click();
  await expect(p.getByTestId("resumo-pedido")).toBeVisible();
}

async function voltar(p: Page, titulo: string) {
  await p.getByTestId("voltar-etapa").click();
  await expect(p.getByTestId("titulo-etapa")).toHaveText(titulo);
}

test("agendamento público: página ativada, pedido pendente, painel do dono, confirmar e recusar", async ({
  page,
  context,
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(COMPUTADOR);
  await context.route(WHATSAPP, (rota) =>
    rota.fulfill({ contentType: "text/html", body: "<p>WhatsApp (falso, teste)</p>" }),
  );

  const sufixo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `publico-${sufixo}@example.test`;
  const estabelecimento = `Clínica Pública ${sufixo}`;
  await contaPorConvite(request, { ownerName: "Dona Pública", businessName: estabelecimento, email, phone: "11977770002", password: SENHA });
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/conta\/visao-geral$/);

  const me = await api<{ activeContext: { tenantId: string } }>(page, "/auth/me");
  const base = `/tenants/${me.corpo.activeContext.tenantId}`;
  const servico = await api<{ service: { id: string } }>(page, `${base}/services`, "POST", {
    name: "Sessão de fisioterapia",
    shortDescription: "Avaliação e exercícios",
    priceCents: 12000,
    priceVisible: true,
    durationMinutes: 60,
    bufferAfterMinutes: 0,
    modality: "IN_PERSON",
    activeInPublicBooking: true,
    // Sem confirmação manual: o pedido público nasce PENDING mesmo assim.
    requiresManualConfirmation: false,
  });
  expect(servico.status).toBe(201);
  // Segundo serviço: preço AUSENTE (aparece "Sob consulta") e dois
  // profissionais. "Sessão de fisioterapia" continua só com a Ana.
  const avaliacao = await api<{ service: { id: string } }>(page, `${base}/services`, "POST", {
    name: "Avaliação inicial",
    shortDescription: "Primeira conversa",
    priceCents: null,
    priceVisible: true,
    durationMinutes: 30,
    bufferAfterMinutes: 0,
    modality: "IN_PERSON",
    activeInPublicBooking: true,
    requiresManualConfirmation: false,
  });
  expect(avaliacao.status).toBe(201);
  const prof = await api<{ professional: { id: string } }>(page, `${base}/professionals`, "POST", {
    name: "Ana Fisio",
    serviceIds: [servico.corpo.service.id, avaliacao.corpo.service.id],
  });
  expect(prof.status).toBe(201);
  const bruno = await api<{ professional: { id: string } }>(page, `${base}/professionals`, "POST", {
    name: "Bruno Fisio",
    serviceIds: [avaliacao.corpo.service.id],
  });
  expect(bruno.status).toBe(201);
  for (const id of [prof.corpo.professional.id, bruno.corpo.professional.id]) {
    expect(
      (await api(page, `${base}/professionals/${id}/schedule`, "PUT", {
        days: [{ weekday: WEEKDAY_DA_DATA, intervals: [{ start: "09:00", end: "13:00" }] }],
      })).status,
    ).toBe(200);
  }
  const settings = await api<{ settings: { slug: string; enabled: boolean } }>(page, `${base}/public-booking`);
  const slug = settings.corpo.settings.slug;
  expect(settings.corpo.settings.enabled).toBe(false);

  // ------------------------------------------- antes de ativar: não existe
  const anonimo = await visitante(browser, CELULAR);
  await anonimo.pagina.goto(`/agendar/${slug}`);
  await expect(anonimo.pagina.getByTestId("pagina-publica-falha")).toContainText(
    "Esta página de agendamento não está disponível.",
  );

  // ------------------------------------------- dono ativa e copia o link
  // O agendamento online fica em Configurações → Estabelecimento.
  await page.goto("/conta/configuracoes/estabelecimento");
  await expect(page.getByTestId("agendamento-online-estado")).toContainText("Página desativada");
  await page.getByTestId("alternar-agendamento-online").click();
  await expect(page.getByTestId("agendamento-online-estado")).toHaveText("Página ativa");
  const link = await page.getByTestId("link-publico").inputValue();
  expect(link).toBe(`http://localhost:3000/agendar/${slug}`);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByTestId("copiar-link").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  await page.goto("/conta/agendamentos/solicitacoes");
  await expect(page.getByTestId("sem-solicitacoes")).toBeVisible();

  // ------------------------------------------- cliente agenda no celular
  const p = anonimo.pagina;
  const escritasPrivadas: string[] = [];
  p.on("request", (r) => {
    if (r.url().includes("/tenants/") || r.url().includes("/consumers")) escritasPrivadas.push(r.url());
  });
  const consultasDeHorario: string[] = [];
  p.on("request", (r) => {
    if (r.url().includes("/availability?")) consultasDeHorario.push(r.url());
  });
  await p.goto(link);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText(estabelecimento);
  await expect(p.getByTestId("iniciais-estabelecimento")).toBeVisible();
  await expect(p.getByTestId("progresso-agendamento")).toContainText("Etapa 1 de 5");
  await expect(servicoPublico(p, "Sessão de fisioterapia")).toContainText("R$ 120,00");
  await expect(servicoPublico(p, "Sessão de fisioterapia")).toContainText("60 min");
  await expect(servicoPublico(p, "Avaliação inicial")).toContainText("Sob consulta");

  // ---- percurso com dois profissionais, voltar e trocar escolhas
  await servicoPublico(p, "Avaliação inicial").click();
  await expect(p.getByTestId("titulo-etapa")).toHaveText("Escolha o profissional");
  await expect(p.getByTestId("progresso-agendamento")).toContainText("Etapa 2 de 5");
  await expect(p.getByTestId("lista-profissionais-publicos").getByRole("button")).toHaveCount(2);
  await p.getByTestId("lista-profissionais-publicos").getByRole("button", { name: /Bruno Fisio/ }).click();
  await p.getByTestId("lista-dias").getByRole("button", { name: rotuloDoDia }).click();
  await horarioPublico(p, "09:00").click();
  await expect(p.getByTestId("horario-escolhido")).toContainText("09:00");
  const antesDaTroca = consultasDeHorario.length;
  await voltar(p, "Escolha o profissional");
  await expect(p.getByTestId("lista-profissionais-publicos").getByRole("button", { name: /Bruno Fisio/ })).toHaveAttribute("aria-pressed", "true");
  // Outro profissional: o horário escolhido cai e a disponibilidade é relida para ele.
  await p.getByTestId("lista-profissionais-publicos").getByRole("button", { name: /Ana Fisio/ }).click();
  await expect(p.getByTestId("horario-escolhido")).toHaveText("Escolha um horário");
  await expect(p.getByTestId("continuar-horario")).toBeDisabled();
  await expect.poll(() => consultasDeHorario.slice(antesDaTroca).some((u) => u.includes(prof.corpo.professional.id))).toBe(true);
  await expect(horarioPublico(p, "09:00")).toHaveAttribute("aria-pressed", "false");
  await voltar(p, "Escolha o profissional");
  await voltar(p, "Escolha o serviço");
  await expect(servicoPublico(p, "Avaliação inicial")).toHaveAttribute("aria-pressed", "true");

  // ---- serviço com profissional único: etapa mostrada, Ana já escolhida
  await escolherHorario(p, "Sessão de fisioterapia", null, "09:00");
  await expect(p.getByTestId("contexto-escolhas")).toContainText("Sessão de fisioterapia · com Ana Fisio");
  await preencher(p, "Joana Cliente", "(11) 98888-0001");
  await expect(p.getByTestId("titulo-etapa")).toHaveText("Revise e envie");
  await expect(p.getByTestId("resumo-estabelecimento")).toHaveText(estabelecimento);
  await expect(p.getByTestId("resumo-servico")).toHaveText("Sessão de fisioterapia · 60 min");
  await expect(p.getByTestId("resumo-profissional")).toHaveText("Ana Fisio");
  await expect(p.getByTestId("resumo-data")).toHaveText(`domingo, ${dataBr}`);
  await expect(p.getByTestId("resumo-hora")).toContainText("09:00");
  await expect(p.getByTestId("resumo-hora")).toContainText("America/Sao_Paulo");
  await expect(p.getByTestId("resumo-preco")).toHaveText("R$ 120,00");
  await expect(p.getByTestId("resumo-nome")).toHaveText("Joana Cliente");
  await expect(p.getByTestId("resumo-whatsapp")).toHaveText("(11) 98888-0001");
  await expect(p.getByTestId("enviar-pedido")).toHaveText("Solicitar agendamento");

  // Voltar mantém os dados e o horário; trocar o serviço derruba o horário.
  await voltar(p, "Seus dados");
  await expect(p.getByLabel("Nome")).toHaveValue("Joana Cliente");
  await voltar(p, "Escolha o dia e o horário");
  await expect(horarioPublico(p, "09:00")).toHaveAttribute("aria-pressed", "true");
  // Profissional único não é pulado na volta: aparece, ainda escolhido.
  await voltar(p, "Escolha o profissional");
  await expect(p.getByTestId("lista-profissionais-publicos").getByRole("button", { name: /Ana Fisio/ })).toHaveAttribute("aria-pressed", "true");
  await voltar(p, "Escolha o serviço");
  await servicoPublico(p, "Avaliação inicial").click();
  await expect(p.getByTestId("lista-profissionais-publicos").getByRole("button", { name: /Ana Fisio/ })).toHaveAttribute("aria-pressed", "true");
  await p.getByTestId("lista-profissionais-publicos").getByRole("button", { name: /Ana Fisio/ }).click();
  await expect(p.getByTestId("horario-escolhido")).toHaveText("Escolha um horário");
  await horarioPublico(p, "10:00").click();
  await p.getByTestId("continuar-horario").click();
  await expect(p.getByLabel("Nome")).toHaveValue("Joana Cliente");
  await p.getByTestId("revisar-pedido").click();
  await expect(p.getByTestId("resumo-preco")).toHaveText("Sob consulta");
  await expect(p.getByTestId("resumo-servico")).toHaveText("Avaliação inicial · 30 min");
  await semRolagemHorizontal(p);

  // De volta à sessão de fisioterapia, 09:00, e envia.
  await voltar(p, "Seus dados");
  await voltar(p, "Escolha o dia e o horário");
  await voltar(p, "Escolha o profissional");
  await voltar(p, "Escolha o serviço");
  await escolherHorario(p, "Sessão de fisioterapia", null, "09:00");
  await p.getByTestId("revisar-pedido").click();
  await semRolagemHorizontal(p);
  await p.screenshot({ path: test.info().outputPath("publico-formulario-celular.png"), fullPage: true });
  // Clique duplo: um pedido só.
  await p.getByTestId("enviar-pedido").dblclick();
  await expect(p.getByTestId("recibo-titulo")).toHaveText("Solicitação enviada — aguardando confirmação");
  await expect(p.getByTestId("recibo-status")).toHaveText("Aguardando confirmação do estabelecimento");
  await expect(p.getByTestId("recibo-pedido")).not.toContainText(/Confirmado/);
  await expect(p.getByTestId("recibo-data")).toHaveText(`domingo, ${dataBr}`);
  await expect(p.getByTestId("recibo-hora")).toHaveText("09:00");
  await p.screenshot({ path: test.info().outputPath("publico-recibo-celular.png"), fullPage: true });
  expect(escritasPrivadas, "a página pública nunca chama rota privada").toEqual([]);

  // ------------------------------------------- dono vê o aviso persistente
  await page.goto("/conta/visao-geral");
  await expect(page.getByTestId("aviso-solicitacoes")).toContainText("1 solicitação aguardando sua confirmação.");
  await expect(page.getByTestId("contador-solicitacoes")).toContainText("1");
  await expect(page.getByTestId("contador-notificacoes")).toHaveText("1");
  await page.reload();
  await expect(page.getByTestId("contador-solicitacoes")).toContainText("1");
  await page.getByRole("link", { name: /Ver solicitações/ }).click();
  const lista = page.getByTestId("lista-solicitacoes");
  await expect(lista.getByTestId("solicitacao")).toHaveCount(1);
  const joana = lista.getByTestId("solicitacao").filter({ hasText: "Joana Cliente" });
  await expect(joana.getByTestId("solicitacao-origem")).toHaveText("Pedido online");
  await expect(joana.getByTestId("solicitacao-horario")).toHaveText(`${dataBr} às 09:00`);

  // "Combinar outro horário" é só link: nada é gravado, o pedido continua pendente.
  const escritas: string[] = [];
  page.on("request", (r) => {
    if (r.url().startsWith(BACKEND_URL) && r.method() !== "GET") escritas.push(`${r.method()} ${r.url()}`);
  });
  const [aba] = await Promise.all([
    context.waitForEvent("page"),
    joana.getByTestId("combinar-outro-horario").click(),
  ]);
  expect(aba.url()).toMatch(/^https:\/\/wa\.me\/5511988880001\?text=/);
  await aba.close();
  expect(escritas).toEqual([]);
  await page.reload();
  await expect(page.getByTestId("lista-solicitacoes").getByTestId("solicitacao")).toHaveCount(1);

  // ------------------------------------------- tela desatualizada
  const [pendente] = (await api<{ requests: { id: string; startAt: string }[] }>(page, `${base}/booking-requests`)).corpo.requests;
  // Outra aba remarca para 10:00 depois de esta tela carregar.
  expect(
    (await api(page, `${base}/appointments/${pendente.id}/reschedule`, "POST", {
      startAt: instanteLocalDe("10:00"),
      expectedStartAt: pendente.startAt,
    })).status,
  ).toBe(201);
  await page.getByTestId("lista-solicitacoes").getByTestId("confirmar-solicitacao").click();
  await expect(page.getByTestId("solicitacao-erro")).toContainText(/mudou|alterada/);
  await expect(page.getByTestId("lista-solicitacoes").getByTestId("solicitacao-horario")).toHaveText(`${dataBr} às 10:00`);
  // Nada foi confirmado pela tela desatualizada.
  expect((await api<{ appointment: { status: string } }>(page, `${base}/appointments/${pendente.id}`)).corpo.appointment.status).toBe("PENDING");

  // ------------------------------------------- confirmar, recarregar
  await page.getByTestId("lista-solicitacoes").getByTestId("confirmar-solicitacao").click();
  await expect(page.getByTestId("sem-solicitacoes")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("sem-solicitacoes")).toBeVisible();
  await expect(page.getByTestId("contador-solicitacoes")).toHaveCount(0);
  expect((await api<{ appointment: { status: string } }>(page, `${base}/appointments/${pendente.id}`)).corpo.appointment.status).toBe("CONFIRMED");

  // ------------------------------------------- dois clientes, mesmo horário
  const outro = await visitante(browser, COMPUTADOR);
  await outro.pagina.goto(link);
  await escolherHorario(outro.pagina, "Sessão de fisioterapia", null, "11:00");
  await preencher(outro.pagina, "Bruno Atrasado", "(11) 98888-0002");
  // Enquanto Bruno preenchia, Carla pediu o mesmo horário.
  const carla = await outro.pagina.evaluate(
    async ({ url, corpo }) => (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) })).status,
    {
      url: `${BACKEND_URL}/public/${slug}/booking-requests`,
      corpo: {
        serviceId: servico.corpo.service.id,
        professionalId: prof.corpo.professional.id,
        startAt: instanteLocalDe("11:00"),
        name: "Carla Rápida",
        whatsapp: "(11) 98888-0003",
        idempotencyKey: `carla-${sufixo}`.padEnd(16, "x"),
      },
    },
  );
  expect(carla).toBe(201);
  await outro.pagina.getByTestId("enviar-pedido").click();
  // O conflito leva de volta à escolha do horário, com a lista relida.
  await expect(outro.pagina.getByTestId("titulo-etapa")).toHaveText("Escolha o dia e o horário");
  await expect(outro.pagina.getByTestId("envio-falha")).toContainText("Este horário acabou de ser ocupado");
  await expect(horarioPublico(outro.pagina, "12:00")).toBeVisible();
  await expect(horarioPublico(outro.pagina, "11:00")).toHaveCount(0);

  // ------------------------------------------- resposta perdida → verificar envio
  // Serviço, profissional, dia e dados continuam; só o horário é escolhido de novo.
  await horarioPublico(outro.pagina, "12:00").click();
  await outro.pagina.getByTestId("continuar-horario").click();
  await expect(outro.pagina.getByLabel("Nome")).toHaveValue("Bruno Atrasado");
  await outro.pagina.getByTestId("revisar-pedido").click();
  await outro.pagina.route("**/public/*/booking-requests", async (rota) => {
    await rota.fetch(); // o servidor grava...
    await rota.abort("connectionreset"); // ...e a resposta se perde.
  });
  await outro.pagina.getByTestId("enviar-pedido").click();
  await expect(outro.pagina.getByTestId("envio-incerto")).toContainText("pode ter sido registrado");
  await expect(outro.pagina.getByTestId("enviar-pedido")).toHaveCount(0);
  await outro.pagina.unroute("**/public/*/booking-requests");
  await outro.pagina.screenshot({ path: test.info().outputPath("publico-incerto-computador.png"), fullPage: true });
  await outro.pagina.getByTestId("verificar-envio").click();
  await expect(outro.pagina.getByTestId("recibo-titulo")).toHaveText("Solicitação enviada — aguardando confirmação");
  await expect(outro.pagina.getByTestId("recibo-repetido")).toContainText("já tinha sido recebido");
  await expect(outro.pagina.getByTestId("recibo-status")).toHaveText("Aguardando confirmação do estabelecimento");

  // ------------------------------------------- falha de comunicação na leitura
  // A leitura de horários se repete sozinha enquanto a API não responde
  // (recuperação comum, ver lib/api/leitura-com-recuperacao.ts); o relógio da
  // página anda até o prazo total acabar e a falha aparecer.
  const terceiro = await visitante(browser, CELULAR);
  await terceiro.pagina.clock.install();
  await terceiro.pagina.route("**/public/*/availability**", (rota) => rota.abort("internetdisconnected"));
  await terceiro.pagina.goto(link);
  await terceiro.pagina.getByTestId("lista-servicos-publicos").getByRole("button").first().click();
  await terceiro.pagina.getByTestId("lista-profissionais-publicos").getByRole("button").first().click();
  const falhaHorarios = terceiro.pagina.getByTestId("horarios-falha");
  await expect
    .poll(
      async () => {
        if ((await falhaHorarios.count()) === 0) await terceiro.pagina.clock.runFor(5_000);
        return falhaHorarios.count();
      },
      { timeout: 50_000, intervals: [50] },
    )
    .toBe(1);
  await expect(falhaHorarios).toContainText("Verifique sua conexão");
  await terceiro.pagina.unroute("**/public/*/availability**");
  await terceiro.pagina.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(terceiro.pagina.getByTestId("lista-horarios-publicos").or(terceiro.pagina.getByTestId("sem-horarios"))).toBeVisible();
  await terceiro.contexto.close();

  // ------------------------------------------- dono recusa, no celular
  await page.setViewportSize(CELULAR);
  await page.goto("/conta/agendamentos/solicitacoes");
  const cartoes = page.getByTestId("lista-solicitacoes").getByTestId("solicitacao");
  await expect(cartoes).toHaveCount(2);
  await expect(page.getByRole("navigation", { name: "Áreas da conta" }).getByTestId("contador-solicitacoes")).toBeVisible();
  await semRolagemHorizontal(page);
  await page.screenshot({ path: test.info().outputPath("solicitacoes-celular.png"), fullPage: true });
  const daCarla = cartoes.filter({ hasText: "Carla Rápida" });
  await daCarla.getByTestId("recusar-solicitacao").click();
  await daCarla.getByTestId("confirmar-recusa-botao").click();
  await expect(cartoes).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId("lista-solicitacoes").getByTestId("solicitacao")).toHaveCount(1);
  await expect(page.getByTestId("lista-solicitacoes")).not.toContainText("Carla Rápida");
  // O horário recusado volta a aparecer para o público.
  await outro.pagina.goto(link);
  await escolherHorario(outro.pagina, "Sessão de fisioterapia", null, "11:00");
  await page.setViewportSize(COMPUTADOR);
  await page.screenshot({ path: test.info().outputPath("solicitacoes-computador.png"), fullPage: true });

  // ------------------------------------------- desativar esconde de novo
  await page.goto("/conta/configuracoes/estabelecimento");
  await page.getByTestId("alternar-agendamento-online").click();
  await expect(page.getByTestId("agendamento-online-estado")).toContainText("Página desativada");
  await outro.pagina.goto(link);
  await expect(outro.pagina.getByTestId("pagina-publica-falha")).toBeVisible();
  await outro.contexto.close();
  await anonimo.contexto.close();
});
