// Aparência (claro, escuro, seguir aparelho) e o menu da conta com as
// notificações — navegador real, backend real e PostgreSQL descartável.
//
// O QUE ESTE TESTE PROVA:
// - o agendamento público segue SEMPRE o aparelho, sem seletor, mesmo com
//   uma escolha manual salva pelo dono neste navegador — e acompanha a
//   mudança do aparelho com a página aberta;
// - a escolha manual da área privada fica salva, é aplicada ANTES da
//   primeira pintura (sem lampejo, sem erro de hidratação) e continua intacta
//   depois de passar pela página pública;
// - a demonstração não é afetada: continua clara mesmo com "Escuro" salvo;
// - horário escolhido destacado nos dois temas (fundo de destaque, ícone e
//   aria-pressed), foco visível e contraste mínimo do texto;
// - sino com o número REAL de pendentes, levando à análise das solicitações
//   sem gravar nada; menu da conta com pendentes, situação das notificações
//   neste aparelho (verificada ao abrir, sem pedir permissão), som e acesso
//   aos controles existentes — e nenhuma consulta de solicitações a mais;
// - 360, 390 e 1280 px sem rolagem lateral, com nomes longos.
//
// O QUE ELE NÃO PROVA: notificação recebida num celular (nada é enviado;
// as chaves VAPID desta execução só ligam o push no servidor). O teste
// físico no iPhone fica para depois da publicação.
//
// Orçamento: 1 cadastro e 1 login (limites de 5 por IP); 3 pedidos públicos.
// Invocação própria (`npm run test:browser:aparencia`).
import { criarContaDeTeste as contaPorConvite } from "./support/contas-de-teste";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { WEEKDAY_DA_DATA, DATA } from "./data-de-teste";

const BACKEND_URL = "http://localhost:3001";
const SENHA = "senha-da-aparencia-e2e-123";
const LARGURAS = [360, 390, 1280] as const;
/** Mesma chave de lib/aparencia/tema.ts (CHAVE_APARENCIA). */
const CHAVE_APARENCIA = "agenda-cloud:aparencia";
const rotuloDoDia = `dom ${DATA.slice(8, 10)}/${DATA.slice(5, 7)}`;

// Cores de fundo (globals.css): papel claro e papel escuro.
const PAPEL_CLARO = "rgb(250, 247, 242)";
const PAPEL_ESCURO = "rgb(20, 22, 25)";
const DESTAQUE_ESCURO = "rgb(217, 221, 216)";
const DESTAQUE_CLARO = "rgb(154, 84, 23)";

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

const fundo = (p: Page) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);

/** Contraste WCAG entre a cor do texto e o fundo efetivo do elemento. */
async function contraste(p: Page, seletor: string) {
  return p.locator(seletor).first().evaluate((el) => {
    const rgb = (c: string) => (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 4).map(Number);
    let fundoEl: Element | null = el;
    let bg = rgb(getComputedStyle(el).backgroundColor);
    while (fundoEl && (bg.length < 3 || bg[3] === 0)) {
      fundoEl = fundoEl.parentElement;
      bg = fundoEl ? rgb(getComputedStyle(fundoEl).backgroundColor) : [255, 255, 255];
    }
    const lum = ([r, g, b]: number[]) =>
      [r, g, b]
        .map((v) => v / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0);
    const [a, b] = [lum(rgb(getComputedStyle(el).color)), lum(bg)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });
}

/** Registra o `data-tema` no instante em que o <body> começa a ser lido —
 * antes de qualquer pintura e antes do React. */
async function vigiarPrimeiraPintura(contexto: BrowserContext) {
  await contexto.addInitScript(() => {
    const w = window as Window & { __temaNaPrimeiraPintura?: string | null };
    const observador = new MutationObserver(() => {
      if (document.body && w.__temaNaPrimeiraPintura === undefined) {
        w.__temaNaPrimeiraPintura = document.documentElement.getAttribute("data-tema");
        observador.disconnect();
      }
    });
    observador.observe(document, { childList: true, subtree: true });
  });
}
const temaNaPrimeiraPintura = (p: Page) =>
  p.evaluate(() => (window as Window & { __temaNaPrimeiraPintura?: string | null }).__temaNaPrimeiraPintura);

function errosDeHidratacao(p: Page) {
  const erros: string[] = [];
  p.on("console", (m) => {
    if (m.type() === "error" && /hydrat|did not match/i.test(m.text())) erros.push(m.text());
  });
  p.on("pageerror", (e) => {
    if (/hydrat/i.test(e.message)) erros.push(e.message);
  });
  return erros;
}

async function escolherAparencia(p: Page, rotulo: "Claro" | "Escuro" | "Seguir aparelho", escopo = p.locator("body")) {
  await escopo.getByTestId("seletor-aparencia").getByText(rotulo, { exact: true }).click();
}

/** Serviço → dia → horário (o informado, ou o primeiro livre). */
async function ateOHorario(p: Page, servico: RegExp, hora?: string) {
  await p.getByTestId("lista-servicos-publicos").getByRole("button", { name: servico }).click();
  // Profissional único: a etapa aparece com ele pré-selecionado.
  await p.getByTestId("continuar-profissional").click();
  await p.getByTestId("lista-dias").getByRole("button", { name: rotuloDoDia }).click();
  const lista = p.getByTestId("lista-horarios-publicos");
  await (hora ? lista.getByRole("button", { name: hora, exact: true }) : lista.getByRole("button").first()).click();
}

async function visitante(browser: Browser, opcoes: { largura: number; esquema: "light" | "dark" }) {
  const contexto = await browser.newContext({
    viewport: { width: opcoes.largura, height: opcoes.largura >= 1000 ? 800 : 780 },
    colorScheme: opcoes.esquema,
  });
  await vigiarPrimeiraPintura(contexto);
  return { contexto, pagina: await contexto.newPage() };
}

test("aparência: aparelho, escolha salva sem lampejo, demonstração clara, destaque e contraste nos dois temas", async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const sufixo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // Nome longo de propósito: não pode empurrar a página para o lado em 360 px.
  const estabelecimento = `Espaço de Bem-Estar e Terapias Integrativas Maria das Graças ${sufixo}`;
  const email = `aparencia-${sufixo}@example.test`;
  await contaPorConvite(request, { ownerName: "Dona Aparência", businessName: estabelecimento, email, phone: "11977770003", password: SENHA });
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/conta\/visao-geral$/);
  const me = await api<{ activeContext: { tenantId: string } }>(page, "/auth/me");
  const base = `/tenants/${me.corpo.activeContext.tenantId}`;
  const longo = await api<{ service: { id: string } }>(page, `${base}/services`, "POST", {
    name: "Massagem relaxante com pedras quentes e aromaterapia para alívio de tensões",
    shortDescription: "Sessão completa com óleos essenciais, pedras vulcânicas aquecidas e alongamento final",
    priceCents: null,
    priceVisible: true,
    durationMinutes: 90,
    bufferAfterMinutes: 0,
    modality: "IN_PERSON",
    activeInPublicBooking: true,
    requiresManualConfirmation: false,
  });
  expect(longo.status).toBe(201);
  const prof = await api<{ professional: { id: string } }>(page, `${base}/professionals`, "POST", {
    name: "Graça Terapeuta",
    serviceIds: [longo.corpo.service.id],
  });
  expect(prof.status).toBe(201);
  expect(
    (await api(page, `${base}/professionals/${prof.corpo.professional.id}/schedule`, "PUT", {
      days: [{ weekday: WEEKDAY_DA_DATA, intervals: [{ start: "09:00", end: "18:00" }] }],
    })).status,
  ).toBe(200);
  const { corpo } = await api<{ settings: { slug: string } }>(page, `${base}/public-booking`, "PUT", { enabled: true });
  const link = `/agendar/${corpo.settings.slug}`;

  // ------------------------------------------- primeira visita segue o aparelho
  for (const esquema of ["light", "dark"] as const) {
    const v = await visitante(browser, { largura: 390, esquema });
    const erros = errosDeHidratacao(v.pagina);
    await v.pagina.goto(link);
    await expect(v.pagina.getByRole("heading", { level: 1 })).toHaveText(estabelecimento);
    expect(await temaNaPrimeiraPintura(v.pagina)).toBe("sistema");
    expect(await fundo(v.pagina)).toBe(esquema === "dark" ? PAPEL_ESCURO : PAPEL_CLARO);
    // Sem seletor de aparência na página do cliente.
    await expect(v.pagina.getByTestId("seletor-aparencia")).toHaveCount(0);
    expect(erros).toEqual([]);
    await v.contexto.close();
  }

  // ------------------------------------------- escolha manual do dono não força o público
  // Mesmo navegador do dono, aparelho CLARO, "Escuro" salvo na área privada
  // (o mesmo valor que o menu da conta grava).
  const cliente = await visitante(browser, { largura: 390, esquema: "light" });
  const p = cliente.pagina;
  const erros = errosDeHidratacao(p);
  await p.goto("/login");
  await p.evaluate((chave) => localStorage.setItem(chave, "escuro"), CHAVE_APARENCIA);
  await p.reload();
  // Área privada: o script do <head> aplicou "escuro" antes de o <body> existir.
  expect(await temaNaPrimeiraPintura(p)).toBe("escuro");
  expect(await fundo(p)).toBe(PAPEL_ESCURO);

  await p.goto(link);
  await expect(p.getByRole("heading", { level: 1 })).toBeVisible();
  // A escolha continua no <html> e no storage, mas o público segue o aparelho.
  expect(await temaNaPrimeiraPintura(p)).toBe("escuro");
  expect(await fundo(p)).toBe(PAPEL_CLARO);
  expect(await p.evaluate((chave) => localStorage.getItem(chave), CHAVE_APARENCIA)).toBe("escuro");
  // Aparelho muda com a página aberta: a página acompanha.
  await p.emulateMedia({ colorScheme: "dark" });
  expect(await fundo(p)).toBe(PAPEL_ESCURO);
  await p.emulateMedia({ colorScheme: "light" });
  expect(await fundo(p)).toBe(PAPEL_CLARO);
  expect(erros, "sem erro de hidratação").toEqual([]);

  // De volta à área privada, a escolha do dono continua valendo.
  await p.goto("/login");
  expect(await fundo(p)).toBe(PAPEL_ESCURO);
  expect(await p.evaluate((chave) => localStorage.getItem(chave), CHAVE_APARENCIA)).toBe("escuro");

  // A demonstração não é afetada pela escolha salva.
  await p.goto("/");
  expect(await fundo(p)).toBe(PAPEL_CLARO);

  // ------------------------------------------- destaque, foco e contraste (aparelho escuro e claro)
  for (const tema of ["Escuro", "Claro"] as const) {
    await p.emulateMedia({ colorScheme: tema === "Escuro" ? "dark" : "light" });
    await p.goto(link);
    // Foco visível pelo teclado no cartão de serviço.
    const cartao = p.getByTestId("lista-servicos-publicos").getByRole("button").first();
    await cartao.focus();
    await p.keyboard.press("Shift+Tab");
    await p.keyboard.press("Tab");
    expect(await cartao.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
    expect(await contraste(p, "h1")).toBeGreaterThanOrEqual(7);
    await ateOHorario(p, /Massagem relaxante/, "09:00");
    const escolhido = p.getByTestId("lista-horarios-publicos").getByRole("button", { name: "09:00", exact: true });
    await expect(escolhido).toHaveAttribute("aria-pressed", "true");
    await expect(escolhido.locator("svg")).toHaveCount(1);
    // `transition-colors`: espera a cor final, não um quadro da transição.
    await expect
      .poll(() => escolhido.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe(tema === "Escuro" ? DESTAQUE_ESCURO : DESTAQUE_CLARO);
    expect(await contraste(p, '[data-testid="lista-horarios-publicos"] [aria-pressed="true"]')).toBeGreaterThanOrEqual(
      tema === "Escuro" ? 7 : 4.5,
    );
    const outro = p.getByTestId("lista-horarios-publicos").getByRole("button", { name: "10:00", exact: true });
    await expect(outro).toHaveAttribute("aria-pressed", "false");
    await expect(outro.locator("svg")).toHaveCount(0);
  }
  await cliente.contexto.close();

  // ------------------------------------------- capturas: etapas × temas × larguras
  for (const tema of ["claro", "escuro"] as const) {
    for (const largura of LARGURAS) {
      const v = await visitante(browser, { largura, esquema: tema === "escuro" ? "dark" : "light" });
      const q = v.pagina;
      await q.goto(link);
      await expect(q.getByRole("heading", { level: 1 })).toBeVisible();
      await semRolagemHorizontal(q);
      await q.screenshot({ path: test.info().outputPath(`aparencia-${tema}-${largura}-1-servico.png`), fullPage: true });
      await q.getByTestId("lista-servicos-publicos").getByRole("button", { name: /Massagem relaxante/ }).click();
      await expect(q.getByTestId("profissional-unico")).toContainText("Graça Terapeuta");
      await semRolagemHorizontal(q);
      await q.screenshot({ path: test.info().outputPath(`aparencia-${tema}-${largura}-1b-profissional.png`), fullPage: true });
      await q.getByTestId("voltar-etapa").click();
      await ateOHorario(q, /Massagem relaxante/);
      await semRolagemHorizontal(q);
      // A barra presa ao fim não cobre o último horário: rolando até o fim, o
      // último botão fica inteiro acima dela.
      await q.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const ultimo = q.getByTestId("lista-horarios-publicos").getByRole("button").last();
      const barra = await q.getByTestId("continuar-horario").boundingBox();
      const caixa = await ultimo.boundingBox();
      expect(caixa!.y + caixa!.height).toBeLessThanOrEqual(barra!.y);
      await q.evaluate(() => window.scrollTo(0, 0));
      await q.screenshot({ path: test.info().outputPath(`aparencia-${tema}-${largura}-2-horario.png`), fullPage: true });
      await q.getByTestId("continuar-horario").click();
      await q.getByLabel("Nome").fill("Maria Aparecida dos Santos Oliveira");
      await q.getByLabel("WhatsApp com DDD").fill("(11) 98888-0101");
      await semRolagemHorizontal(q);
      await q.screenshot({ path: test.info().outputPath(`aparencia-${tema}-${largura}-3-dados.png`), fullPage: true });
      await q.getByTestId("revisar-pedido").click();
      await expect(q.getByTestId("resumo-preco")).toHaveText("Sob consulta");
      await semRolagemHorizontal(q);
      await q.screenshot({ path: test.info().outputPath(`aparencia-${tema}-${largura}-4-revisar.png`), fullPage: true });
      if (largura === 390) {
        // Um pedido por tema, para a captura do resultado.
        await q.getByTestId("voltar-etapa").click();
        await q.getByLabel("WhatsApp com DDD").fill(tema === "claro" ? "(11) 98888-0102" : "(11) 98888-0103");
        await q.getByTestId("revisar-pedido").click();
        await q.getByTestId("enviar-pedido").click();
        await expect(q.getByTestId("recibo-titulo")).toHaveText("Solicitação enviada — aguardando confirmação");
        await semRolagemHorizontal(q);
        await q.screenshot({ path: test.info().outputPath(`aparencia-${tema}-${largura}-5-recibo.png`), fullPage: true });
      }
      await v.contexto.close();
    }
  }
});

test("menu da conta: sino com pendentes reais, notificações deste aparelho, aparência compartilhada e Sair", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);
  const sufixo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `menu-${sufixo}@example.test`;
  const estabelecimento = `Studio Menu ${sufixo}`;
  await contaPorConvite(request, { ownerName: "Dona Menu de Teste", businessName: estabelecimento, email, phone: "11977770004", password: SENHA });
  // A sessão do cadastro (cookie do `request`) vira a do navegador.
  const contexto = await browser.newContext({ storageState: await request.storageState(), viewport: { width: 1280, height: 800 } });
  // Navegador novo: permissão de notificação ainda não decidida (o Chromium
  // de teste começa em "denied"). E um contador: o pedido de permissão nunca
  // acontece sozinho.
  await contexto.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { get: () => "default", configurable: true });
    const w = window as Window & { __pedidosDePermissao?: number };
    w.__pedidosDePermissao = 0;
    const original = Notification.requestPermission.bind(Notification);
    Notification.requestPermission = (...args: Parameters<typeof Notification.requestPermission>) => {
      w.__pedidosDePermissao = (w.__pedidosDePermissao ?? 0) + 1;
      return original(...args);
    };
  });
  const page = await contexto.newPage();
  const leiturasDaLista: string[] = [];
  const escritas: string[] = [];
  const consultasDePush: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith(BACKEND_URL)) return;
    if (r.method() === "GET" && /\/booking-requests(\?|$)/.test(u)) leiturasDaLista.push(u);
    if (u.includes("/push/") || u.includes("push-subscription")) consultasDePush.push(`${r.method()} ${u}`);
    else if (r.method() !== "GET") escritas.push(`${r.method()} ${u}`);
  });

  await page.goto("/conta/visao-geral");
  const me = await api<{ activeContext: { tenantId: string } }>(page, "/auth/me");
  const base = `/tenants/${me.corpo.activeContext.tenantId}`;
  const serv = await api<{ service: { id: string } }>(page, `${base}/services`, "POST", {
    name: "Consulta",
    shortDescription: "",
    priceCents: 8000,
    priceVisible: true,
    durationMinutes: 60,
    bufferAfterMinutes: 0,
    modality: "IN_PERSON",
    activeInPublicBooking: true,
    requiresManualConfirmation: false,
  });
  const prof = await api<{ professional: { id: string } }>(page, `${base}/professionals`, "POST", {
    name: "Profissional Menu",
    serviceIds: [serv.corpo.service.id],
  });
  await api(page, `${base}/professionals/${prof.corpo.professional.id}/schedule`, "PUT", {
    days: [{ weekday: WEEKDAY_DA_DATA, intervals: [{ start: "09:00", end: "12:00" }] }],
  });
  const { corpo } = await api<{ settings: { slug: string } }>(page, `${base}/public-booking`, "PUT", { enabled: true });
  // Um pedido público, feito por um visitante sem sessão.
  const anonimo = await browser.newContext();
  const pa = await anonimo.newPage();
  await pa.goto(`/agendar/${corpo.settings.slug}`);
  const instante = (await pa.evaluate(
    async ({ url }) => (await (await fetch(url)).json()) as { availability: { slots: { startAt: string }[] } },
    { url: `${BACKEND_URL}/public/${corpo.settings.slug}/availability?serviceId=${serv.corpo.service.id}&professionalId=${prof.corpo.professional.id}&date=${DATA}` },
  )).availability.slots[0].startAt;
  const pedido = await pa.evaluate(
    async ({ url, corpo }) =>
      (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) })).status,
    {
      url: `${BACKEND_URL}/public/${corpo.settings.slug}/booking-requests`,
      corpo: {
        serviceId: serv.corpo.service.id,
        professionalId: prof.corpo.professional.id,
        startAt: instante,
        name: "Cliente do Menu",
        whatsapp: "(11) 98888-0201",
        idempotencyKey: `menu-${sufixo}`.padEnd(16, "x"),
      },
    },
  );
  expect(pedido).toBe(201);
  await anonimo.close();

  // ------------------------------------------- sino com o número real
  await page.reload();
  const sino = page.getByTestId("sino-notificacoes");
  await expect(sino.getByTestId("contador-notificacoes")).toHaveText("1");
  await expect(sino).toHaveAccessibleName("Notificações: 1 solicitação pendente");
  escritas.length = 0;

  // ------------------------------------------- menu: abrir não consulta a lista nem pede permissão
  await expect.poll(() => leiturasDaLista.length).toBeGreaterThan(0);
  const leiturasAntes = leiturasDaLista.length;
  consultasDePush.length = 0;
  await page.getByTestId("abrir-menu-conta").click();
  const menu = page.getByTestId("menu-conta");
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("menu-pendentes")).toHaveText("1 solicitação aguardando sua confirmação.");
  // Servidor com push ligado (chaves desta execução), permissão ainda não pedida.
  await expect(menu.getByTestId("menu-push-estado")).toHaveText("Desativadas neste aparelho");
  await expect(menu.getByTestId("menu-som")).toContainText("Desligado");
  expect(leiturasDaLista.length, "abrir o menu não relê as solicitações").toBe(leiturasAntes);
  expect(await page.evaluate(() => (window as Window & { __pedidosDePermissao?: number }).__pedidosDePermissao)).toBe(0);
  expect(consultasDePush.filter((c) => c.startsWith("GET") && c.includes("/push/config"))).toHaveLength(1);
  expect(consultasDePush.filter((c) => !c.startsWith("GET"))).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("menu-conta-claro-1280.png") });

  // Escape fecha e devolve o foco ao botão.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId("abrir-menu-conta")).toBeFocused();

  // ------------------------------------------- aparência pelo menu, compartilhada
  await page.getByTestId("abrir-menu-conta").click();
  await escolherAparencia(page, "Escuro", menu);
  expect(await fundo(page)).toBe(PAPEL_ESCURO);
  expect(await contraste(page, '[data-testid="menu-conta"] [data-testid="menu-pendentes"]')).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: test.info().outputPath("menu-conta-escuro-1280.png") });
  // O link público, aberto pelo dono com "Escuro" salvo e aparelho claro:
  // a página do cliente segue o aparelho; a escolha dele fica intacta.
  await page.goto(`/agendar/${corpo.settings.slug}`);
  await expect(page.getByTestId("lista-servicos-publicos")).toBeVisible();
  expect(await fundo(page)).toBe(PAPEL_CLARO);
  await expect(page.getByTestId("seletor-aparencia")).toHaveCount(0);
  await page.goto("/conta/visao-geral");
  expect(await fundo(page)).toBe(PAPEL_ESCURO);
  await page.getByTestId("abrir-menu-conta").click();
  await expect(menu.getByTestId("seletor-aparencia").getByRole("radio", { name: "Escuro" })).toBeChecked();
  await page.keyboard.press("Escape");

  // ------------------------------------------- "Gerenciar" leva a Configurações → Notificações
  await page.goto("/conta/visao-geral");
  await page.getByTestId("abrir-menu-conta").click();
  await menu.getByTestId("menu-gerenciar-notificacoes").click();
  await expect(page).toHaveURL(/\/conta\/configuracoes\/notificacoes$/);
  // Abrir a página não pede permissão ao navegador: só o toque em "Ativar".
  expect(await page.evaluate(() => (window as Window & { __pedidosDePermissao?: number }).__pedidosDePermissao)).toBe(0);
  await expect(page.locator("#notificacoes").getByTestId("notificacoes-dispositivo")).toBeVisible();
  await expect(page.locator("#notificacoes").getByTestId("preferencias-de-aviso")).toBeVisible();
  await expect(page.getByTestId("ativar-push")).toBeVisible();

  // ------------------------------------------- bloqueado: o menu diz, sem pedir nada
  await page.addInitScript(() => Object.defineProperty(Notification, "permission", { get: () => "denied", configurable: true }));
  await page.goto("/conta/visao-geral");
  await page.getByTestId("abrir-menu-conta").click();
  await expect(menu.getByTestId("menu-push-estado")).toHaveText("Bloqueadas nas configurações do navegador");

  // ------------------------------------------- sino leva à análise, sem gravar nada
  await page.keyboard.press("Escape");
  escritas.length = 0;
  await sino.click();
  await expect(page).toHaveURL(/\/conta\/agendamentos\/solicitacoes$/);
  await expect(page.getByTestId("lista-solicitacoes").getByTestId("solicitacao")).toHaveCount(1);
  // A aba Solicitações da Agenda, com o contador real; os controles de
  // notificação ficam em Configurações.
  await expect(page.getByTestId("abas-da-agenda").getByRole("link", { name: /Solicitações/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByTestId("contador-aba-solicitacoes")).toContainText("1");
  await expect(page.locator("#notificacoes")).toHaveCount(0);
  expect(escritas, "abrir pelo sino não confirma, recusa nem remarca").toEqual([]);

  // ------------------------------------------- celular: tudo na tela, sem rolar para o lado
  for (const largura of [360, 390] as const) {
    await page.setViewportSize({ width: largura, height: 780 });
    await page.goto("/conta/visao-geral");
    await expect(sino).toBeInViewport();
    await page.getByTestId("abrir-menu-conta").click();
    const caixa = await menu.boundingBox();
    expect(caixa!.x).toBeGreaterThanOrEqual(0);
    expect(caixa!.x + caixa!.width).toBeLessThanOrEqual(largura);
    await semRolagemHorizontal(page);
    await page.screenshot({ path: test.info().outputPath(`menu-conta-escuro-${largura}.png`) });
    await escolherAparencia(page, "Claro", menu);
    await page.screenshot({ path: test.info().outputPath(`menu-conta-claro-${largura}.png`) });
    await escolherAparencia(page, "Escuro", menu);
    await page.keyboard.press("Escape");
  }

  // ------------------------------------------- Sair pelo menu; o login segue a escolha
  await page.getByTestId("abrir-menu-conta").click();
  await menu.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await fundo(page)).toBe(PAPEL_ESCURO);
  await page.screenshot({ path: test.info().outputPath("login-escuro-390.png") });
  await contexto.close();
});
