// Teste de navegador do contato pelo WhatsApp na área real — contra o backend
// real e um PostgreSQL descartável.
//
// Prova que os atalhos são só LINKS para o wa.me: o endereço e o texto saem
// certos (telefone internacional, mensagem neutra no fuso do
// estabelecimento, caracteres especiais codificados), e abrir o link não
// chama a API nem muda a reserva — depois de recarregar, tudo continua igual.
//
// NENHUMA mensagem real: qualquer navegação para wa.me / api.whatsapp.com é
// respondida por uma página falsa dentro do próprio navegador do teste. O
// telefone inválido é simulado alterando só o campo `whatsapp` da resposta
// real da busca (o backend recusa gravar um telefone inválido).
//
// Orçamento de POST /invites/accept (fixture de contas): 1 de 10. Invocação própria
// (`npm run test:browser:whatsapp`).
import { criarContaDeTeste as contaPorConvite } from "./support/contas-de-teste";
import { expect, test, type Page } from "@playwright/test";
import { DATA, WEEKDAY_DA_DATA, instanteLocalDe } from "./data-de-teste";

const BACKEND_URL = "http://localhost:3001";
const SENHA = "senha-do-contato-whatsapp-123";
const COMPUTADOR = { width: 1280, height: 800 };
const CELULAR = { width: 390, height: 844 };
const WHATSAPP = /^https:\/\/(wa\.me|api\.whatsapp\.com)\//;

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
  const l = await p.evaluate(() => ({
    conteudo: document.documentElement.scrollWidth,
    janela: window.innerWidth,
  }));
  expect(l.conteudo).toBeLessThanOrEqual(l.janela);
}

/** `dd/mm/aaaa` de uma data `YYYY-MM-DD`. */
const dataBr = (iso: string) => iso.split("-").reverse().join("/");

test("WhatsApp: links certos, texto codificado e nenhuma mudança na reserva", async ({
  page,
  context,
  request,
}) => {
  await page.setViewportSize(COMPUTADOR);
  // Qualquer ida ao WhatsApp para dentro do navegador do teste.
  const abertos: string[] = [];
  await context.route(WHATSAPP, async (rota) => {
    abertos.push(rota.request().url());
    await rota.fulfill({ contentType: "text/html", body: "<p>WhatsApp (falso, teste)</p>" });
  });

  const sufixo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `whatsapp-${sufixo}@example.test`;
  const estabelecimento = `Estúdio Ana & Bia ${sufixo}`;
  await contaPorConvite(request, { ownerName: "Dona Contato", businessName: estabelecimento, email, phone: "11977770001", password: SENHA });
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/conta\/visao-geral$/);

  const me = await api<{ activeContext: { tenantId: string } }>(page, "/auth/me");
  const base = `/tenants/${me.corpo.activeContext.tenantId}`;
  const servico = await api<{ service: { id: string } }>(page, `${base}/services`, "POST", {
    name: "Consulta de retorno",
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
  const prof = await api<{ professional: { id: string } }>(page, `${base}/professionals`, "POST", {
    name: "Ana Souza",
    serviceIds: [servico.corpo.service.id],
  });
  expect(prof.status).toBe(201);
  const profissionalId = prof.corpo.professional.id;
  expect(
    (await api(page, `${base}/professionals/${profissionalId}/schedule`, "PUT", {
      days: [{ weekday: WEEKDAY_DA_DATA, intervals: [{ start: "09:00", end: "12:00" }] }],
    })).status,
  ).toBe(200);
  const reservar = async (hora: string, name: string, whatsapp: string) => {
    const r = await api<{ appointment: { id: string; startAt: string } }>(page, `${base}/appointments`, "POST", {
      professionalId: profissionalId,
      serviceId: servico.corpo.service.id,
      startAt: instanteLocalDe(hora),
      consumer: { mode: "new", data: { name, whatsapp } },
    });
    expect(r.status, JSON.stringify(r.corpo)).toBe(201);
    return r.corpo.appointment;
  };
  await reservar("09:00", "José D'Ávila & Filhos", "(11) 98765-4321");
  const cancelada = await reservar("10:00", "Rita Cancelada", "+55 21 99876-5432");
  expect(
    (await api(page, `${base}/appointments/${cancelada.id}/cancel`, "POST", {
      expectedStartAt: cancelada.startAt,
    })).status,
  ).toBeLessThan(300);

  // ------------------------------------------------------------- agenda
  await page.goto("/conta/agendamentos");
  await page.getByLabel("Dia", { exact: true }).fill(DATA);
  const jose = page.getByTestId("agenda-do-dia").locator("li").filter({ hasText: "José D'Ávila" });
  await expect(jose.getByTestId("abrir-whatsapp")).toHaveAttribute("href", "https://wa.me/5511987654321");
  const hrefCombinar = (await jose.getByTestId("combinar-outro-horario").getAttribute("href"))!;
  const url = new URL(hrefCombinar);
  expect(url.origin + url.pathname).toBe("https://wa.me/5511987654321");
  const esperado =
    `Olá, José. Aqui é do ${estabelecimento}. Sobre seu agendamento em ${dataBr(DATA)} às 09:00, ` +
    "precisamos combinar outro horário. Podemos conversar?";
  expect(url.searchParams.get("text")).toBe(esperado);
  // Nada do serviço na mensagem; "&" do nome do estabelecimento codificado.
  expect(esperado).not.toContain("Consulta");
  expect(hrefCombinar).toContain("%26");
  await expect(jose.getByTestId("combinar-outro-horario")).toHaveAttribute("target", "_blank");
  await expect(jose.getByTestId("combinar-outro-horario")).toHaveAttribute("rel", /noopener/);

  // Reserva cancelada: conversa sim, "combinar outro horário" não.
  const rita = page.getByTestId("agenda-do-dia").locator("li").filter({ hasText: "Rita Cancelada" });
  await expect(rita.getByTestId("abrir-whatsapp")).toHaveAttribute("href", "https://wa.me/5521998765432");
  await expect(rita.getByTestId("combinar-outro-horario")).toHaveCount(0);

  // Abrir o link: nenhuma escrita na API, e a reserva fica como estava.
  const escritas: string[] = [];
  page.on("request", (r) => {
    if (r.url().startsWith(BACKEND_URL) && r.method() !== "GET") escritas.push(`${r.method()} ${r.url()}`);
  });
  const [aba] = await Promise.all([
    context.waitForEvent("page"),
    jose.getByTestId("combinar-outro-horario").click(),
  ]);
  await aba.waitForLoadState();
  expect(aba.url()).toBe(hrefCombinar);
  await aba.close();
  expect(abertos).toEqual([hrefCombinar]);
  expect(escritas, "abrir o WhatsApp nunca chama a API").toEqual([]);
  await page.reload();
  await page.getByLabel("Dia", { exact: true }).fill(DATA);
  await expect(jose.getByTestId("status-agendado")).toHaveText("Confirmado");
  await expect(jose.getByTestId("horario-agendado")).toContainText("09:00");
  await expect(rita.getByTestId("status-agendado")).toHaveText("Cancelado");

  // Por profissional: os mesmos atalhos.
  await page.getByRole("button", { name: "Por profissional" }).click();
  await expect(
    page.getByTestId("grupo-profissional").getByTestId("combinar-outro-horario"),
  ).toHaveAttribute("href", hrefCombinar);
  await page.screenshot({ path: test.info().outputPath("whatsapp-agenda-computador.png"), fullPage: true });
  await page.setViewportSize(CELULAR);
  await semRolagemHorizontal(page);
  const combinarCelular = page.getByTestId("grupo-profissional").getByTestId("combinar-outro-horario");
  expect((await combinarCelular.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: test.info().outputPath("whatsapp-agenda-celular.png"), fullPage: true });
  await page.setViewportSize(COMPUTADOR);

  // ------------------------------------------------------------- clientes
  await page.goto("/conta/clientes");
  await page.getByLabel("Buscar cliente").fill("José");
  await page.getByRole("search").getByRole("button", { name: "Buscar" }).click();
  const lista = page.getByTestId("lista-clientes");
  await expect(lista.getByTestId("abrir-whatsapp")).toHaveAttribute("href", "https://wa.me/5511987654321");
  await expect(lista.getByTestId("abrir-whatsapp")).toHaveAccessibleName(/WhatsApp de José D'Ávila & Filhos/);
  await page.screenshot({ path: test.info().outputPath("whatsapp-clientes-computador.png"), fullPage: true });
  await page.setViewportSize(CELULAR);
  await semRolagemHorizontal(page);
  await page.screenshot({ path: test.info().outputPath("whatsapp-clientes-celular.png"), fullPage: true });
  await page.setViewportSize(COMPUTADOR);

  // Telefone inválido (só o campo da resposta real é trocado): sem link.
  await page.route(
    (u) => u.pathname.endsWith("/consumers") && u.searchParams.has("q"),
    async (rota) => {
      const resposta = await rota.fetch();
      const corpo = (await resposta.json()) as { consumers: { whatsapp: string }[] };
      await rota.fulfill({
        response: resposta,
        json: { consumers: corpo.consumers.map((c) => ({ ...c, whatsapp: "123" })) },
      });
    },
  );
  try {
    await page.getByRole("search").getByRole("button", { name: "Buscar" }).click();
    await expect(lista.getByTestId("whatsapp-indisponivel")).toBeVisible();
    await expect(lista.getByTestId("abrir-whatsapp")).toHaveCount(0);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
  }
  expect(escritas).toEqual([]);
});
