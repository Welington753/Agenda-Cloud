// Identidade visual da área real (tema escuro quase monocromático e o claro
// que continua valendo) — navegador real, backend real e PostgreSQL
// descartável, com dados fictícios.
//
// Prova o que unit test não prova:
//  - no escuro, as cores são as da paleta (fundo, menu lateral, cartões,
//    item ativo com a linha de 3 px, botão principal claro) e nenhum acento
//    laranja sobra no menu ou no botão principal;
//  - contraste: texto principal, secundário e discreto, rótulo do botão
//    principal, item ativo do menu, borda de campo (3:1) e indicador de foco;
//  - a agenda em lista mostra horário, cliente e status com rótulo, com
//    separadores entre os atendimentos e uma só ação principal na tela;
//  - Início, Agenda, índice e seção de Configurações, submenu, painel de
//    novo agendamento e confirmação de cancelamento em 360, 390, 1280 e
//    1440 px, claro e escuro, sem rolagem horizontal (capturas no relatório).
//
// Orçamento de POST /invites/accept: 1 (roda na invocação de
// test:browser:services, ver services-flow.spec.ts — total 6 de 10). Nenhum
// login pela tela: a sessão vem do aceite do convite.
import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { criarContaDeTeste, API_DE_TESTE } from "./support/contas-de-teste";
import { DATA, WEEKDAY_DA_DATA, instanteLocalDe } from "./data-de-teste";

const SENHA = "senha-da-identidade-e2e-1";
const LARGURAS = [360, 390, 1280, 1440] as const;

/** Paleta do tema escuro (globals.css), como o navegador a devolve. */
const ESCURO = {
  fundo: "rgb(20, 22, 25)",
  menu: "rgb(13, 15, 17)",
  cartao: "rgb(26, 29, 33)",
  selecionado: "rgb(34, 38, 43)",
  texto: "rgb(236, 238, 235)",
  botaoPrincipal: "rgb(236, 238, 235)",
  textoDoBotao: "rgb(20, 22, 25)",
  foco: "rgb(191, 197, 204)",
};

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
    { url: `${API_DE_TESTE}${caminho}`, method, body },
  );
}

/** Contraste WCAG entre duas cores `rgb(...)`. */
function razao(a: string, b: string) {
  const lum = (c: string) =>
    (c.match(/\d+(\.\d+)?/g) ?? [])
      .slice(0, 3)
      .map((v) => Number(v) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0);
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Cor do texto e fundo efetivo (o primeiro ancestral com fundo opaco). */
async function cores(p: Page, seletor: string) {
  return p.locator(seletor).first().evaluate((el) => {
    let fundoEl: Element | null = el;
    let bg = getComputedStyle(el).backgroundColor;
    while (fundoEl && (bg === "rgba(0, 0, 0, 0)" || bg === "transparent")) {
      fundoEl = fundoEl.parentElement;
      bg = fundoEl ? getComputedStyle(fundoEl).backgroundColor : "rgb(255, 255, 255)";
    }
    const estilo = getComputedStyle(el);
    return { texto: estilo.color, fundo: bg, borda: estilo.borderTopColor, sombra: estilo.boxShadow };
  });
}

async function semRolagemHorizontal(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

/** Captura nos dois temas e nas quatro larguras, conferindo a rolagem. Com
 * `alvo`, rola até ele antes de cada captura. */
async function capturar(page: Page, nome: string, larguras: readonly number[] = LARGURAS, alvo?: Locator) {
  for (const tema of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: tema });
    for (const width of larguras) {
      await page.setViewportSize({ width, height: width >= 1000 ? 900 : 844 });
      await semRolagemHorizontal(page);
      if (alvo) await alvo.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.screenshot({ path: test.info().outputPath(`identidade-${nome}-${tema}-${width}.png`) });
    }
  }
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("identidade visual: paleta escura, contraste, agenda em lista e capturas", async ({ page }) => {
  test.setTimeout(240_000);
  const marca = `identidade-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  await criarContaDeTeste(page.request, {
    ownerName: "Marina Prado",
    businessName: `Estúdio Aurora ${marca.slice(-4)}`,
    email: `${marca}@example.test`,
    password: SENHA,
  });

  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/conta/visao-geral");
  await expect(page.getByRole("navigation", { name: "Áreas da conta" })).toBeVisible();

  // ------------------------------------------------------------ dados fictícios
  const me = await api<{ activeContext: { tenantId: string } }>(page, "/auth/me");
  const base = `/tenants/${me.corpo.activeContext.tenantId}`;
  const servico = async (name: string, durationMinutes: number, priceCents: number) => {
    const r = await api<{ service: { id: string } }>(page, `${base}/services`, "POST", {
      name,
      shortDescription: "",
      priceCents,
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
  const corte = await servico("Corte feminino", 60, 12000);
  const escova = await servico("Escova modelada", 45, 8000);
  const profissional = async (name: string) => {
    const r = await api<{ professional: { id: string } }>(page, `${base}/professionals`, "POST", {
      name,
      serviceIds: [corte, escova],
    });
    expect(r.status).toBe(201);
    const id = r.corpo.professional.id;
    const jornada = await api(page, `${base}/professionals/${id}/schedule`, "PUT", {
      days: [{ weekday: WEEKDAY_DA_DATA, intervals: [{ start: "08:00", end: "18:00" }] }],
    });
    expect(jornada.status).toBe(200);
    return id;
  };
  const lia = await profissional("Lia Ramos");
  const teo = await profissional("Téo Martins");
  const reservar = async (professionalId: string, serviceId: string, hora: string, name: string, whatsapp: string) => {
    const r = await api<{ appointment: { id: string; startAt: string } }>(page, `${base}/appointments`, "POST", {
      professionalId,
      serviceId,
      startAt: instanteLocalDe(hora),
      consumer: { mode: "new", data: { name, whatsapp } },
    });
    expect(r.status).toBe(201);
    return r.corpo.appointment;
  };
  await reservar(lia, corte, "09:00", "Helena Duarte", "(11) 98123-4501");
  await reservar(teo, escova, "09:30", "Rafael Nogueira", "(11) 98123-4502");
  await reservar(lia, escova, "10:30", "Beatriz Lemos", "(11) 98123-4503");
  const cancelada = await reservar(teo, corte, "11:00", "Otávio Siqueira", "(11) 98123-4504");
  await reservar(lia, corte, "14:00", "Camila Torres Albuquerque de Vasconcelos", "(11) 98123-4505");
  const cancelamento = await api(page, `${base}/appointments/${cancelada.id}/cancel`, "POST", {
    expectedStartAt: cancelada.startAt,
  });
  expect(cancelamento.status).toBe(201);

  // ------------------------------------------------------------ Início
  await page.reload();
  await expect(page.getByTestId("indicador-agendamentos")).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(ESCURO.fundo);
  const menu = await cores(page, "aside");
  expect(menu.fundo).toBe(ESCURO.menu);
  const ativo = await cores(page, 'nav[aria-label="Áreas da conta"] a[aria-current="page"]');
  expect(ativo.fundo).toBe(ESCURO.selecionado);
  expect(ativo.texto).toBe(ESCURO.texto);
  // Linha de 3 px à esquerda, na cor do texto principal — nada de laranja.
  expect(ativo.sombra).toContain("rgb(236, 238, 235)");
  expect(ativo.sombra).toContain("3px 0px 0px 0px");
  expect(razao(ativo.texto, ativo.fundo)).toBeGreaterThanOrEqual(7);
  const cartao = await cores(page, '[data-testid="indicador-agendamentos"]');
  expect(cartao.fundo).toBe(ESCURO.cartao);
  // Texto principal, secundário e o rótulo do indicador sobre o cartão.
  expect(razao((await cores(page, "main h1")).texto, ESCURO.fundo)).toBeGreaterThanOrEqual(7);
  expect(
    razao((await cores(page, '[data-testid="indicador-agendamentos"] p')).texto, ESCURO.cartao),
  ).toBeGreaterThanOrEqual(4.5);
  await capturar(page, "inicio");

  // ------------------------------------------------------------ Agenda em lista
  await page.goto("/conta/agendamentos");
  await page.locator("#data").fill(DATA);
  const lista = page.getByTestId("agenda-do-dia");
  await expect(lista.getByTestId("cliente-agendado")).toHaveText([
    "Helena Duarte",
    "Rafael Nogueira",
    "Beatriz Lemos",
    "Otávio Siqueira",
    "Camila Torres Albuquerque de Vasconcelos",
  ]);
  await expect(lista.getByTestId("horario-agendado").first()).toContainText("09:00");
  await expect(lista.locator("li").nth(3).getByTestId("status-agendado")).toHaveText("Cancelado");
  // Horário em números alinhados e com peso.
  const horario = page.getByTestId("horario-agendado").first();
  expect(await horario.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain("tabular-nums");
  expect(
    Number(await horario.locator("span").first().evaluate((el) => getComputedStyle(el).fontWeight)),
  ).toBeGreaterThanOrEqual(600);
  // Separador entre atendimentos (Tailwind 4: borda de baixo, menos na última).
  expect(
    await lista.locator("li").first().evaluate((el) => getComputedStyle(el).borderBottomWidth),
  ).toBe("1px");
  // Uma só ação principal clara na tela: "Novo agendamento".
  const principal = await cores(page, '[data-testid="novo-agendamento"]');
  expect(principal.fundo).toBe(ESCURO.botaoPrincipal);
  expect(principal.texto).toBe(ESCURO.textoDoBotao);
  expect(razao(principal.texto, principal.fundo)).toBeGreaterThanOrEqual(7);
  const botoesClaros = await page
    .locator("main button")
    .evaluateAll(
      (bs, cor) => bs.filter((b) => getComputedStyle(b).backgroundColor === cor && b.checkVisibility()).length,
      ESCURO.botaoPrincipal,
    );
  expect(botoesClaros).toBe(1);
  // Campo: borda com 3:1 sobre o fundo; foco do teclado na cor da paleta.
  const campo = await cores(page, "#filtro-profissional");
  expect(razao(campo.borda, ESCURO.fundo)).toBeGreaterThanOrEqual(3);
  await page.locator("#filtro-profissional").focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  expect(await page.locator("#filtro-profissional").evaluate((el) => getComputedStyle(el).outlineColor)).toBe(
    ESCURO.foco,
  );
  await capturar(page, "agenda-lista");

  await page.getByRole("button", { name: "Por profissional" }).click();
  await expect(page.getByTestId("grupo-profissional")).toHaveCount(2);
  await capturar(page, "agenda-por-profissional", [390, 1440]);
  await page.getByRole("button", { name: "Lista" }).click();

  // Confirmação de cancelamento (ação destrutiva continua inequívoca).
  await lista.locator("li").first().getByTestId("abrir-cancelamento").click();
  await expect(page.getByTestId("confirmar-cancelamento")).toBeVisible();
  await capturar(page, "agenda-cancelamento", [390, 1280], page.getByTestId("confirmar-cancelamento"));
  await page.getByRole("button", { name: "Manter reserva" }).click();

  // Painel de novo agendamento (formulário sobreposto).
  await page.getByTestId("novo-agendamento").click();
  await expect(page.getByTestId("painel-novo-agendamento")).toBeVisible();
  await capturar(page, "novo-agendamento");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("painel-novo-agendamento")).toHaveCount(0);

  // ------------------------------------------------------------ Configurações
  await page.goto("/conta/configuracoes");
  await expect(page.getByTestId("secoes-configuracoes")).toBeVisible();
  await capturar(page, "configuracoes-indice");

  await page.goto("/conta/configuracoes/estabelecimento");
  await expect(page.getByTestId("voltar-configuracoes")).toBeVisible();
  await capturar(page, "configuracoes-estabelecimento");

  // Submenu aberto (só existe no computador).
  for (const width of [1280, 1440]) {
    for (const tema of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: tema });
      await page.setViewportSize({ width, height: 900 });
      await page.mouse.move(width - 10, 10);
      await page.getByRole("navigation", { name: "Áreas da conta" }).getByRole("link", { name: "Configurações" }).hover();
      await expect(page.getByTestId("submenu-configuracoes")).toBeVisible();
      await semRolagemHorizontal(page);
      await page.screenshot({ path: test.info().outputPath(`identidade-submenu-${tema}-${width}.png`) });
    }
  }
  await page.emulateMedia({ colorScheme: "dark" });
  const opcaoAtual = await cores(page, '[data-testid="submenu-configuracoes"] a[aria-current="page"]');
  expect(opcaoAtual.fundo).toBe(ESCURO.selecionado);
  expect(razao(opcaoAtual.texto, opcaoAtual.fundo)).toBeGreaterThanOrEqual(7);

  // Celular: menu da conta com "Mais áreas", avatar neutro.
  await page.mouse.move(5, 5);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("abrir-menu-conta").click();
  await expect(page.getByTestId("menu-mais-areas")).toBeVisible();
  await capturar(page, "menu-conta", [360, 390]);
});
