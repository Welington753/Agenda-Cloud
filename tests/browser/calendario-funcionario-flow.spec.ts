// Calendário individual do funcionário (Minha agenda → Calendário), de ponta
// a ponta, contra o backend real e o PostgreSQL DESCARTÁVEL, com dados
// fictícios. Nada é enviado.
//
// Dois profissionais com reservas no MESMO dia (amanhã, no fuso do
// estabelecimento): Alfa com quatro (três na célula do mês e "+1 mais"),
// Beta com duas. Cada um entra com o login e a senha definidos pelo dono e
// confere, em Mês, Semana e Dia (computador e celular), que eventos,
// contagens, detalhes e o "mais" trazem só os próprios atendimentos; pelas
// chamadas diretas à API, o mesmo recorte, a agenda do estabelecimento
// recusada e nenhum profissional escolhido pelo navegador. O dono continua
// vendo a agenda do estabelecimento com os dois, e o link público é o mesmo
// do estabelecimento, sem profissional.
//
// Invocação própria (`npm run test:browser:calendario-funcionario`): 1 aceite
// de convite e 2 logins.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { API_DE_TESTE, conectarBancoDeTeste, criarContaDeTeste } from "./support/contas-de-teste";

const SENHA_DONO = "senha-do-dono-calendario-1";
const SENHA_ALFA = "senha-da-alfa-definida-1";
const SENHA_BETA = "senha-do-beta-definida-1";
const FUSO = "America/Sao_Paulo";
const id = () => randomUUID().replaceAll("-", "").slice(0, 10);

const hojeNoFuso = () => new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(new Date());
const somarDia = (data: string) => new Date(Date.parse(`${data}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

async function semRolagemHorizontal(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function capturar(page: Page, nome: string) {
  for (const tema of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: tema });
    for (const width of [1280, 390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await semRolagemHorizontal(page);
      await page.screenshot({ path: test.info().outputPath(`calendario-${nome}-${tema}-${width}.png`), fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 844 });
}

async function entrar(page: Page, identificador: string, senha: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail ou login").fill(identificador);
  await page.getByLabel("Senha", { exact: true }).fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
}

async function novaPagina(browser: Browser) {
  const contexto = await browser.newContext({ viewport: { width: 1280, height: 844 } });
  return { contexto, page: await contexto.newPage() };
}

interface Proprio {
  nome: string;
  login: string;
  senha: string;
  clientes: string[];
  ids: string[];
  /** Clientes do colega: nunca podem aparecer. */
  alheios: string[];
}

/** Confere o calendário de UM funcionário em Mês, Semana e Dia. */
async function conferirCalendario(page: Page, dia: string, eu: Proprio, tenantId: string, slug: string) {
  const main = page.getByRole("main");
  await expect(page).toHaveURL(/\/conta\/minha-agenda$/);
  // O link público é o do estabelecimento, sem profissional.
  await expect(page.getByTestId("link-agendamento-endereco")).toHaveText(new RegExp(`/agendar/${slug}$`));

  await page.getByRole("group", { name: "Visualização da agenda" }).getByRole("button", { name: "Calendário" }).click();
  const calendario = page.getByTestId("calendario");
  const periodo = calendario.getByRole("group", { name: "Período do calendário" });
  await expect(calendario).toHaveAttribute("data-visao", "mes");
  if (dia.slice(0, 7) !== hojeNoFuso().slice(0, 7)) await calendario.getByRole("button", { name: "Próximo período" }).click();

  // ------------------------------------------------------------ Mês
  const celula = calendario.locator(`[data-testid="calendario-dia"][data-dia="${dia}"]`);
  const quantos = eu.clientes.length;
  await expect(celula.getByRole("button", { name: new RegExp(`^Abrir o dia: .*, ${quantos} atendimentos`) })).toBeVisible();
  await expect(celula.getByTestId("calendario-item")).toHaveCount(Math.min(quantos, 3));
  if (quantos > 3) await expect(celula.getByRole("button", { name: `+${quantos - 3} mais` })).toBeVisible();
  else await expect(celula.getByRole("button", { name: /mais$/ })).toHaveCount(0);
  for (const alheio of eu.alheios) await expect(main).not.toContainText(alheio);
  await capturar(page, `${eu.nome}-mes`);

  // Celular: a contagem na célula e a lista do dia tocado.
  await page.setViewportSize({ width: 390, height: 844 });
  await celula.getByRole("button", { name: new RegExp(`^(?!Abrir o dia).*, ${quantos} atendimentos`) }).click();
  const tocado = calendario.getByTestId("calendario-dia-tocado");
  await expect(tocado.getByTestId("calendario-item")).toHaveCount(quantos);
  for (const cliente of eu.clientes) await expect(tocado).toContainText(cliente);
  for (const alheio of eu.alheios) await expect(main).not.toContainText(alheio);
  await page.setViewportSize({ width: 1280, height: 844 });

  // ------------------------------------------------------------ Dia (pelo "mais" ou pelo número)
  if (quantos > 3) await celula.getByRole("button", { name: `+${quantos - 3} mais` }).click();
  else await celula.getByRole("button", { name: /^Abrir o dia: / }).click();
  await expect(calendario).toHaveAttribute("data-visao", "dia");
  const lista = calendario.getByTestId("calendario-lista-do-dia");
  await expect(lista.getByTestId("calendario-item")).toHaveCount(quantos);
  for (const cliente of eu.clientes) await expect(lista).toContainText(cliente);
  for (const alheio of eu.alheios) await expect(main).not.toContainText(alheio);
  await capturar(page, `${eu.nome}-dia`);

  // ------------------------------------------------------------ Semana
  await periodo.getByRole("button", { name: "Semana" }).click();
  await expect(calendario).toHaveAttribute("data-visao", "semana");
  const naSemana = calendario.locator(`[data-testid="calendario-dia"][data-dia="${dia}"]`);
  await expect(naSemana.getByTestId("calendario-item")).toHaveCount(quantos);
  for (const alheio of eu.alheios) await expect(main).not.toContainText(alheio);
  await capturar(page, `${eu.nome}-semana`);

  // Detalhe: tocar no atendimento abre o dia dele na lista, só com os próprios.
  await naSemana.getByTestId("calendario-item").first().click();
  const doDia = page.getByTestId("minha-agenda");
  await expect(doDia.getByTestId("atendimento-proprio")).toHaveCount(quantos);
  for (const alheio of eu.alheios) await expect(main).not.toContainText(alheio);

  // ------------------------------------------------------------ API direta
  const api = page.request;
  const base = `${API_DE_TESTE}/tenants/${tenantId}`;
  for (const [from, to] of [
    [dia, dia],
    [`${dia.slice(0, 8)}01`, somarDia(somarDia(dia))],
  ]) {
    const r = await api.get(`${base}/my-agenda/range?from=${from}&to=${to}`);
    expect(r.status()).toBe(200);
    const corpo = (await r.json()) as { appointments: { id: string; consumer: { name: string } }[] };
    expect(corpo.appointments.map((a) => a.id).sort()).toEqual([...eu.ids].sort());
    for (const alheio of eu.alheios) expect(JSON.stringify(corpo)).not.toContain(alheio);
  }
  const doDiaApi = (await (await api.get(`${base}/my-agenda?date=${dia}`)).json()) as { appointments: { id: string }[] };
  expect(doDiaApi.appointments.map((a) => a.id).sort()).toEqual([...eu.ids].sort());
  // O navegador não escolhe profissional, e a agenda do estabelecimento não abre.
  expect((await api.get(`${base}/my-agenda/range?from=${dia}&to=${dia}&professionalId=x`)).status()).toBe(400);
  expect((await api.get(`${base}/appointments/range?from=${dia}&to=${dia}`)).status()).toBe(403);
  expect((await api.get(`${base}/appointments?date=${dia}`)).status()).toBe(403);
}

test("calendário do funcionário: dois profissionais no mesmo dia, cada um só com os próprios em Mês, Semana e Dia", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const marca = `calendario-${id()}`;
  const db = await conectarBancoDeTeste();
  try {
    // ------------------------------------------------------------- cenário
    const dono = await criarContaDeTeste(page.request, {
      ownerName: "Dona do Calendário",
      businessName: `${marca} Estúdio`,
      email: `${marca}-dona@example.test`,
      password: SENHA_DONO,
    });
    const tenantId = dono.tenant.id;
    const profissionais: Record<string, string> = {};
    for (const nome of ["Alfa Prado", "Beta Rocha"]) {
      const r = await page.request.post(`${API_DE_TESTE}/tenants/${tenantId}/professionals`, { data: { name: nome, serviceIds: [] } });
      expect(r.status(), await r.text()).toBe(201);
      profissionais[nome] = ((await r.json()) as { professional: { id: string } }).professional.id;
    }
    // Acessos com a senha definida pelo dono (senha do dono confirmada antes).
    expect((await page.request.post(`${API_DE_TESTE}/platform/reauth`, { data: { password: SENHA_DONO } })).status()).toBe(204);
    for (const [nome, login, senha] of [
      ["Alfa Prado", `alfa@${marca}`, SENHA_ALFA],
      ["Beta Rocha", `beta@${marca}`, SENHA_BETA],
    ]) {
      const r = await page.request.post(`${API_DE_TESTE}/tenants/${tenantId}/team/staff-accounts`, {
        data: {
          requestKey: `chave-${id()}`,
          role: "PROFISSIONAL",
          professionalId: profissionais[nome],
          name: nome,
          username: login,
          permissions: [],
          password: senha,
        },
      });
      expect(r.status(), await r.text()).toBe(200);
      expect(await r.text()).not.toContain(senha);
    }

    const service = id();
    await db.query(
      `INSERT INTO services (id, tenant_id, name, short_description, duration_minutes, price_cents) VALUES ($1, $2, 'Corte de cabelo', '', 30, 4500)`,
      [service, tenantId],
    );
    const dia = somarDia(hojeNoFuso());
    const reservas: Record<string, { cliente: string; hora: string }[]> = {
      "Alfa Prado": [
        { cliente: "Cliente Alfa Um", hora: "09:00" },
        { cliente: "Cliente Alfa Dois", hora: "10:00" },
        { cliente: "Cliente Alfa Três", hora: "11:00" },
        { cliente: "Cliente Alfa Quatro", hora: "15:00" },
      ],
      "Beta Rocha": [
        { cliente: "Cliente Beta Um", hora: "09:30" },
        { cliente: "Cliente Beta Dois", hora: "14:00" },
      ],
    };
    const ids: Record<string, string[]> = { "Alfa Prado": [], "Beta Rocha": [] };
    for (const [nome, lista] of Object.entries(reservas)) {
      for (const { cliente, hora } of lista) {
        const [consumer, appointment] = [id(), id()];
        // São Paulo, sem horário de verão: UTC−3.
        const inicio = new Date(`${dia}T${hora}:00-03:00`);
        await db.query(
          `INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ($1, $2, $3, '(11) 98888-7777', $4)`,
          [consumer, tenantId, cliente, `5511${Math.floor(Math.random() * 1e9)}`],
        );
        await db.query(
          `INSERT INTO appointments (id, tenant_id, unit_id, consumer_id, consumer_name_snapshot, consumer_whatsapp_snapshot,
              professional_id, start_at, end_at, status)
           VALUES ($1, $2, $3, $4, $5, '(11) 98888-7777', $6, $7, $8, 'CONFIRMED')`,
          [appointment, tenantId, dono.unit.id, consumer, cliente, profissionais[nome], inicio, new Date(inicio.getTime() + 30 * 60_000)],
        );
        await db.query(
          `INSERT INTO appointment_items (id, tenant_id, appointment_id, service_id, duration_minutes_snapshot, price_cents_snapshot)
           VALUES ($1, $2, $3, $4, 30, 4500)`,
          [id(), tenantId, appointment, service],
        );
        ids[nome].push(appointment);
      }
    }
    const clientes = (nome: string) => reservas[nome].map((r) => r.cliente);

    // O dono continua com a agenda do estabelecimento: os seis.
    const doDono = await page.request.get(`${API_DE_TESTE}/tenants/${tenantId}/appointments/range?from=${dia}&to=${dia}`);
    expect(doDono.status()).toBe(200);
    expect(((await doDono.json()) as { appointments: unknown[] }).appointments).toHaveLength(6);

    // ------------------------------------------------------------- Alfa
    const alfa = await novaPagina(browser);
    try {
      await entrar(alfa.page, `alfa@${marca}`, SENHA_ALFA);
      await conferirCalendario(
        alfa.page,
        dia,
        {
          nome: "alfa",
          login: `alfa@${marca}`,
          senha: SENHA_ALFA,
          clientes: clientes("Alfa Prado"),
          ids: ids["Alfa Prado"],
          alheios: [...clientes("Beta Rocha"), "Beta Rocha"],
        },
        tenantId,
        dono.tenant.slug,
      );
    } finally {
      await alfa.contexto.close();
    }

    // ------------------------------------------------------------- Beta
    const beta = await novaPagina(browser);
    try {
      await entrar(beta.page, `beta@${marca}`, SENHA_BETA);
      await conferirCalendario(
        beta.page,
        dia,
        {
          nome: "beta",
          login: `beta@${marca}`,
          senha: SENHA_BETA,
          clientes: clientes("Beta Rocha"),
          ids: ids["Beta Rocha"],
          alheios: [...clientes("Alfa Prado"), "Alfa Prado"],
        },
        tenantId,
        dono.tenant.slug,
      );
    } finally {
      await beta.contexto.close();
    }
  } finally {
    await db.end();
  }
});
