// Visão geral e listagem comercial do portal da plataforma, contra o backend
// real e o PostgreSQL DESCARTÁVEL, só com dados e preços fictícios. A
// promoção a MASTER_OWNER e os estabelecimentos são fixture de teste.
//
// - Entrada do portal leva à Visão geral; os números da tela são os da API
//   (o banco é compartilhado com as outras suítes, então a conferência é
//   contra `GET /platform/overview`, não contra totais fixos).
// - Carregando e erro são estados distintos; erro nunca mostra zero.
// - Indicadores e "Precisa de atenção" levam à ficha ou à lista filtrada.
// - Listagem: condição contratada mensal e trimestral, catálogo à parte,
//   pendente, situação, modalidade e validade; filtros pela URL e pelo
//   formulário.
// - Celular: seções recolhidas, aparência no menu do usuário, sem rolagem
//   lateral. Sessão expirada volta à entrada do portal e à Visão geral.
// - A operação continua sem atalho para o portal.
//
// Invocação própria (`npm run test:browser:portal-visao-geral`): 1 aceite de
// convite e 3 logins (limite de produção: 5 por 15 minutos por IP).
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { API_DE_TESTE, conectarBancoDeTeste, criarContaDeTeste } from "./support/contas-de-teste";
import {
  LISTA_DO_PORTAL as LISTA,
  VISAO_GERAL_DO_PORTAL as VISAO_GERAL,
  abrirSecoesNoCelular,
  entrarPeloFormulario,
  navPortal,
  sairDoPortal,
  semRolagemHorizontal,
} from "./support/portal";

const SENHA = "senha-do-proprietario-vg-1";
const TZ = "America/Sao_Paulo";
const id = () => randomUUID().replaceAll("-", "").slice(0, 24);
const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const antesDoMes = () =>
  new Date(Date.UTC(Number(hoje().slice(0, 4)), Number(hoje().slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
const reais = (centavos: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(centavos / 100);
const sem = (texto: string) => texto.replace(/\s/g, " ");

interface Visao {
  establishments: Record<string, number>;
  payments: { totalCents: number; count: number };
  attention: { total: number; items: { tenant: { id: string; name: string } }[] };
}

const item = (page: Page, nome: string) => page.getByTestId("item-estabelecimento").filter({ hasText: nome });

test("visão geral, listagem comercial, filtros, celular e sessão expirada", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const db = await conectarBancoDeTeste();
  try {
    const marca = `portal-vg-${id().slice(0, 10)}`;
    const email = `${marca}@example.test`;
    const conta = await criarContaDeTeste(page.request, {
      ownerName: "Proprietária Fictícia",
      businessName: `${marca} Cadastro`,
      email,
      password: SENHA,
    });
    await db.query("DELETE FROM memberships WHERE user_id = $1", [conta.user.id]);
    await db.query("UPDATE users SET platform_role = 'MASTER_OWNER' WHERE id = $1", [conta.user.id]);
    await page.context().clearCookies();

    // Plano e preços fictícios: catálogo só no mensal.
    const plano = `pl-${id().slice(0, 20)}`;
    await db.query(
      "INSERT INTO plans (id, code, name, short_description, max_professionals, max_units) VALUES ($1, $1, 'Plano fictício VG', '', 5, 1)",
      [plano],
    );
    await db.query(
      "INSERT INTO plan_prices (id, plan_id, billing_cycle, amount_cents, recorded_by_user_id, request_key) VALUES ($1, $2, 'MONTHLY', 9900, $3, $4)",
      [id(), plano, conta.user.id, `chave-${id()}`],
    );
    const ids: Record<string, string> = {};
    async function loja(nome: string, status: string, legado: boolean) {
      const tenantId = id();
      await db.query(
        `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, created_at, access_legacy_since)
         VALUES ($1, $2, 'OTHER', $3, $4, $5::tenant_status, now() - interval '200 days', CASE WHEN $6::boolean THEN now() END)`,
        [tenantId, `${marca}-${nome.toLowerCase()}`, TZ, plano, status, legado],
      );
      await db.query("INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, $3, '', $4, true)", [
        id(),
        tenantId,
        `${marca} Loja ${nome}`,
        TZ,
      ]);
      ids[nome] = tenantId;
      return tenantId;
    }
    async function periodo(tenantId: string, kind: "TRIAL" | "PAID", inicio: number, fim: number, cents = 0, recebidoEm = hoje()) {
      const pago = kind === "PAID";
      await db.query(
        `INSERT INTO tenant_access_periods (id, tenant_id, kind, plan_id, starts_at, ends_at, anchor_day, billing_cycle,
           contracted_price_cents, currency, payment_method, payment_received_on, confirmation_source, recorded_by_user_id, request_key)
         VALUES ($2, $3, $4::access_period_kind, $5, (($1::date + ${inicio})::timestamp AT TIME ZONE '${TZ}'),
           (($1::date + ${fim})::timestamp AT TIME ZONE '${TZ}'), $6, $7::billing_cycle, $8, $9, $10, $11::date, $12, $13, $14)`,
        [
          hoje(),
          id(),
          tenantId,
          kind,
          plano,
          pago ? 1 : null,
          pago ? "MONTHLY" : null,
          pago ? cents : null,
          pago ? "BRL" : null,
          pago ? "PIX" : null,
          pago ? recebidoEm : null,
          pago ? "MANUAL" : null,
          conta.user.id,
          pago ? `chave-${id()}` : null,
        ],
      );
    }
    await periodo(await loja("Vence", "TRIAL", false), "TRIAL", -12, 3);
    await periodo(await loja("Vencido", "ACTIVE", false), "PAID", -40, -10, 3000, antesDoMes());
    const contrato = await loja("Contrato", "ACTIVE", true);
    for (const [ciclo, cents, minutos] of [
      ["MONTHLY", 8900, 30],
      ["QUARTERLY", 24900, 10],
    ] as const) {
      await db.query(
        `INSERT INTO tenant_contract_prices (id, tenant_id, plan_id, billing_cycle, amount_cents, reason, recorded_at, recorded_by_user_id, request_key)
         VALUES ($1, $2, $3, $4::billing_cycle, $5, 'condição fictícia', now() - make_interval(mins => $6), $7, $8)`,
        [id(), contrato, plano, ciclo, cents, minutos, conta.user.id, `chave-${id()}`],
      );
    }
    await loja("Suspenso", "SUSPENDED", true);
    const renovado = await loja("Renovado", "ACTIVE", false);
    await periodo(renovado, "PAID", -27, 3, 5000);
    await periodo(renovado, "PAID", 3, 33, 7000);
    // Interno/teste: fora da lista padrão e dos números de clientes.
    const interna = await loja("Interna", "ACTIVE", true);
    await db.query("UPDATE tenants SET is_test = true WHERE id = $1", [interna]);

    // Entrada do portal: destino padrão é a Visão geral.
    await page.goto("/portal");
    await expect(page.getByRole("heading", { name: "Entrar no portal" })).toBeVisible();
    await entrarPeloFormulario(page, email, SENHA);
    await expect(page).toHaveURL(VISAO_GERAL);
    await expect(page.getByRole("heading", { name: "Visão geral", exact: true })).toBeVisible();
    await expect(navPortal(page).getByRole("link", { name: "Visão geral" })).toHaveAttribute("aria-current", "page");

    // Os números da tela são os da API, sobre o conjunto completo.
    const api = (await (await page.request.get(`${API_DE_TESTE}/platform/overview`)).json()) as Visao & { scope?: string };
    expect(api.scope).toBe("CLIENTS");
    for (const [testId, chave] of [
      ["indicador-total", "total"],
      ["indicador-liberados", "allowed"],
      ["indicador-bloqueados", "blocked"],
      ["indicador-vencendo", "expiringSoon"],
      ["indicador-suspensos", "suspended"],
      ["indicador-contrato-pendente", "contractPending"],
    ] as const) {
      await expect(page.getByTestId(`${testId}-valor`)).toHaveText(String(api.establishments[chave]));
    }
    expect(api.establishments.total).toBeGreaterThanOrEqual(6);
    expect(api.payments.count).toBeGreaterThanOrEqual(2);
    expect(sem(await page.getByTestId("pagamentos-do-mes-total").innerText())).toBe(sem(reais(api.payments.totalCents)));
    await expect(page.getByTestId("pagamentos-do-mes")).toContainText("não anulados");
    await expect(page.getByTestId("pagamentos-do-mes")).toContainText("data de recebimento registrada");
    // Alcance confirmado pela API: só clientes; o extrato de pagamentos é completo.
    await expect(page.getByTestId("alcance-dos-numeros")).toHaveAttribute("data-alcance", "CLIENTS");
    await expect(page.getByTestId("alcance-dos-numeros")).toContainText("Somente clientes");
    await expect(page.getByTestId("indicador-total")).toContainText("Clientes");
    await expect(page.getByTestId("pagamentos-alcance")).toContainText("mesmos filtros");
    await expect(page.getByRole("button", { name: "Clientes", exact: true })).toHaveAttribute("aria-pressed", "true");
    // Internos/teste: números da API no mesmo alcance, links levam o alcance.
    await page.getByRole("button", { name: "Internos/teste", exact: true }).click();
    await expect(page).toHaveURL(`${VISAO_GERAL}?alcance=INTERNAL`);
    await expect(page.getByTestId("alcance-dos-numeros")).toHaveAttribute("data-alcance", "INTERNAL");
    const apiInternos = (await (await page.request.get(`${API_DE_TESTE}/platform/overview?scope=INTERNAL`)).json()) as Visao;
    expect(apiInternos.establishments.total).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId("indicador-total-valor")).toHaveText(String(apiInternos.establishments.total));
    await expect(page.getByTestId("indicador-total")).toHaveAttribute("href", `${LISTA}?alcance=INTERNAL`);
    await page.getByRole("button", { name: "Clientes", exact: true }).click();
    await expect(page).toHaveURL(VISAO_GERAL);
    await expect(page.getByTestId("indicador-total-valor")).toHaveText(String(api.establishments.total));
    // "Precisa de atenção": cada item leva à ficha.
    const atencao = page.getByTestId("lista-atencao");
    if (api.attention.items.length) {
      const primeiro = api.attention.items[0].tenant;
      await expect(atencao.getByRole("link").first()).toHaveAttribute("href", `${LISTA}/${primeiro.id}`);
      if (api.attention.total <= 20) {
        await expect(atencao.getByRole("link", { name: `${marca} Loja Vence` })).toBeVisible();
        await expect(atencao.getByRole("link", { name: `${marca} Loja Vencido` })).toBeVisible();
        await expect(atencao.getByRole("link", { name: `${marca} Loja Suspenso` })).toHaveCount(0);
      }
    }
    await page.screenshot({ path: testInfo.outputPath("visao-geral-1280.png"), fullPage: true });

    // Indicador leva à lista filtrada (filtro pela URL, explicado na tela).
    await page.getByTestId("indicador-vencendo").click();
    await expect(page).toHaveURL(`${LISTA}?filtro=EXPIRING_SOON`);
    await expect(page.getByTestId("filtro-aplicado")).toContainText("Validade termina em até 7 dias");
    await page.getByLabel("Buscar estabelecimento ou responsável").fill(marca);
    await page.getByRole("button", { name: "Pesquisar", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`filtro=EXPIRING_SOON`));
    await expect(item(page, `${marca} Loja Vence`)).toHaveCount(1);
    await expect(item(page, `${marca} Loja Renovado`)).toHaveCount(0);
    await expect(item(page, `${marca} Loja Contrato`)).toHaveCount(0);

    // Listagem completa da marca: condição, situação, modalidade e validade.
    await page.getByLabel("Acesso e condição").selectOption("");
    await page.getByRole("button", { name: "Pesquisar", exact: true }).click();
    await expect(page.getByRole("main").getByRole("status")).toHaveText("6 estabelecimento(s) encontrado(s)");
    const condicao = item(page, `${marca} Loja Contrato`).getByTestId("condicao-contratada");
    expect(sem(await condicao.innerText())).toContain("Mensal: R$ 89,00");
    expect(sem(await condicao.innerText())).toContain("Trimestral: R$ 249,00 (total de 3 meses)");
    expect(sem(await condicao.innerText())).toContain("Catálogo: mensal R$ 99,00 · trimestral pendente");
    await expect(item(page, `${marca} Loja Contrato`).getByTestId("situacao-e-acesso")).toContainText("Validade ainda não definida");
    const vence = item(page, `${marca} Loja Vence`);
    await expect(vence.getByTestId("condicao-contratada")).toContainText("Pendente: sem valor contratado");
    await expect(vence.getByTestId("situacao-e-acesso")).toContainText("Em operação");
    await expect(vence.getByTestId("situacao-e-acesso")).toContainText("Teste gratuito");
    await expect(vence.getByTestId("situacao-e-acesso")).toContainText("faltam 2 dias");
    await expect(item(page, `${marca} Loja Vencido`).getByTestId("situacao-e-acesso")).toContainText("Bloqueado pela validade");
    await expect(item(page, `${marca} Loja Vencido`).getByTestId("situacao-e-acesso")).toContainText("Vencido (último: período pago)");
    await expect(item(page, `${marca} Loja Suspenso`).getByTestId("situacao-e-acesso")).toContainText("Bloqueado pela situação");
    await expect(item(page, `${marca} Loja Renovado`).getByTestId("situacao-e-acesso")).toContainText("faltam 32 dias");
    // Pagamentos registrados não viram condição contratada.
    await expect(item(page, `${marca} Loja Renovado`).getByTestId("condicao-contratada")).toContainText("Pendente");
    await page.screenshot({ path: testInfo.outputPath("lista-1280.png"), fullPage: true });

    // Filtros do formulário e situação.
    await page.getByLabel("Acesso e condição").selectOption("CONTRACT_PENDING");
    await page.getByRole("button", { name: "Pesquisar", exact: true }).click();
    await expect(page.getByTestId("filtro-aplicado")).toContainText("Seguir o preço do catálogo não conta como contrato");
    await expect(item(page, `${marca} Loja Contrato`)).toHaveCount(0);
    await expect(item(page, `${marca} Loja Vence`)).toHaveCount(1);
    await page.getByLabel("Acesso e condição").selectOption("VALIDITY_BLOCKED");
    await page.getByRole("button", { name: "Pesquisar", exact: true }).click();
    await expect(page.getByRole("main").getByRole("status")).toHaveText("1 estabelecimento(s) encontrado(s)");
    await expect(item(page, `${marca} Loja Vencido`)).toHaveCount(1);
    await page.getByRole("button", { name: "Limpar filtros" }).click();
    await expect(page).toHaveURL(LISTA);
    await page.goto(`${LISTA}?situacao=SUSPENDED&q=${marca}`);
    await expect(page.getByRole("main").getByRole("status")).toHaveText("1 estabelecimento(s) encontrado(s)");
    await expect(page.getByLabel("Situação do estabelecimento")).toHaveValue("SUSPENDED");

    // Alcance na lista: clientes por padrão (a interna fora), internos/teste
    // com o selo, todos com as duas; total e paginação acompanham.
    await page.goto(`${LISTA}?q=${marca}`);
    await expect(page.getByRole("main").getByRole("status")).toHaveText("6 estabelecimento(s) encontrado(s)");
    await expect(page.getByTestId("alcance-dos-numeros")).toHaveAttribute("data-alcance", "CLIENTS");
    await expect(item(page, `${marca} Loja Interna`)).toHaveCount(0);
    await page.getByTestId("seletor-de-alcance").getByRole("button", { name: "Internos/teste" }).click();
    await expect(page).toHaveURL(`${LISTA}?alcance=INTERNAL&q=${marca}`);
    await expect(page.getByRole("main").getByRole("status")).toHaveText("1 estabelecimento(s) encontrado(s)");
    await expect(item(page, `${marca} Loja Interna`).getByTestId("selo-interno-teste")).toHaveText("Interno/teste");
    await page.getByTestId("seletor-de-alcance").getByRole("button", { name: "Todos" }).click();
    await expect(page.getByRole("main").getByRole("status")).toHaveText("7 estabelecimento(s) encontrado(s)");
    await expect(page.getByTestId("selo-interno-teste")).toHaveCount(1);
    await page.getByRole("button", { name: "Limpar filtros" }).click();
    await expect(page).toHaveURL(LISTA);

    // API anterior ao alcance (sem `scope`): a tela não afirma "só clientes".
    const rotaAntiga = `${API_DE_TESTE}/platform/overview`;
    await page.route(rotaAntiga, async (r) => {
      const resposta = await r.fetch();
      const corpo = (await resposta.json()) as Record<string, unknown>;
      delete corpo.scope;
      await r.fulfill({ response: resposta, json: corpo });
    });
    await page.goto(VISAO_GERAL);
    await expect(page.getByTestId("alcance-dos-numeros")).toHaveAttribute("data-alcance", "nao-confirmado");
    await expect(page.getByTestId("alcance-dos-numeros")).toContainText("não indicam que todos são clientes");
    await expect(page.getByTestId("indicador-total")).toContainText("Estabelecimentos cadastrados");
    await page.unroute(rotaAntiga);

    // Carregando e erro são estados distintos; erro nunca mostra zero.
    const rota = `${API_DE_TESTE}/platform/overview`;
    const pendentes: (() => void)[] = [];
    let segurar = true;
    await page.route(rota, async (r) => {
      if (segurar) await new Promise<void>((resolve) => pendentes.push(resolve));
      await r.continue();
    });
    await page.goto(VISAO_GERAL);
    await expect(page.getByRole("main").getByRole("status")).toHaveText("Carregando o portal…");
    await expect(page.getByTestId("indicador-total")).toHaveCount(0);
    await expect.poll(() => pendentes.length).toBeGreaterThan(0);
    await expect(page.getByRole("main").getByRole("status")).toHaveText("Carregando o portal…");
    segurar = false;
    for (const liberar of pendentes.splice(0)) liberar();
    await expect(page.getByTestId("indicador-total")).toBeVisible();
    await page.unroute(rota);
    await page.route(rota, (r) => r.abort("failed"));
    await page.getByRole("button", { name: "Atualizar" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Não foi possível conectar ao servidor");
    await expect(page.getByTestId("indicador-total")).toHaveCount(0);
    await expect(page.getByTestId("pagamentos-do-mes")).toHaveCount(0);
    await page.unroute(rota);
    await page.getByRole("button", { name: "Tentar novamente" }).click();
    await expect(page.getByTestId("indicador-total")).toBeVisible();

    // Celular: seções recolhidas, fecham ao navegar; aparência no menu do usuário.
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(VISAO_GERAL);
      await expect(page.getByTestId("indicador-total")).toBeVisible();
      await expect(navPortal(page)).toHaveCount(0);
      await semRolagemHorizontal(page);
      await abrirSecoesNoCelular(page);
      await page.screenshot({ path: testInfo.outputPath(`visao-geral-menu-${width}.png`), fullPage: true });
      await navPortal(page).getByRole("link", { name: "Estabelecimentos" }).click();
      await expect(page).toHaveURL(LISTA);
      await expect(navPortal(page)).toHaveCount(0);
      await semRolagemHorizontal(page);
    }
    await page.getByTestId("abrir-menu-usuario").click();
    const menu = page.getByTestId("menu-usuario");
    await menu.getByTestId("seletor-aparencia").getByText("Escuro", { exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-tema", "escuro");
    await expect(menu.getByRole("radio", { name: "Escuro" })).toBeChecked();
    await page.screenshot({ path: testInfo.outputPath("lista-escuro-360.png"), fullPage: true });
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(page.getByTestId("abrir-menu-usuario")).toBeFocused();
    await page.setViewportSize({ width: 1280, height: 844 });

    await relatoriosPorPeriodo(page, db, { loja, plano, userId: conta.user.id, marca });

    // Sessão expirada: volta à entrada do portal e, depois, à Visão geral.
    await page.goto(VISAO_GERAL);
    await expect(page.getByTestId("indicador-total")).toBeVisible();
    await db.query(
      "UPDATE sessions SET created_at = now() - interval '1 day', expires_at = now() - interval '1 minute' WHERE user_id = $1",
      [conta.user.id],
    );
    await page.reload();
    await expect(page).toHaveURL(`/portal?next=${encodeURIComponent(VISAO_GERAL)}`);
    await entrarPeloFormulario(page, email, SENHA);
    await expect(page).toHaveURL(VISAO_GERAL);
    await expect(page.getByTestId("indicador-total")).toBeVisible();

    // "Sair" pelo menu do usuário; a operação continua sem atalho para o portal.
    await sairDoPortal(page);
    await expect(page).toHaveURL("/portal");
    await page.goto("/login");
    await entrarPeloFormulario(page, email, SENHA);
    await expect(page).toHaveURL(/\/conta\/configuracoes$/);
    await expect(page.locator('a[href^="/portal"]')).toHaveCount(0);
    await page.setViewportSize({ width: 360, height: 844 });
    await page.getByTestId("abrir-menu-conta").click();
    await expect(page.locator('a[href^="/portal"]')).toHaveCount(0);
  } finally {
    await db.end();
  }
});

/**
 * Relatórios por período (mesma sessão, sem login novo). Dados fictícios em
 * 2002, fora do alcance das outras suítes: cadastros às 23:59:59.999 de 31/10
 * e às 00:00 de 01/11 em São Paulo (hora local, com o horário de verão da
 * época), recebidos nas duas pontas do mês, um anulado e um interno/teste.
 */
async function relatoriosPorPeriodo(
  page: Page,
  db: Awaited<ReturnType<typeof conectarBancoDeTeste>>,
  f: { loja: (nome: string, status: string, legado: boolean) => Promise<string>; plano: string; userId: string; marca: string },
) {
  const RELATORIOS = "/portal/relatorios";
  const criadoEm = async (tenantId: string, local: string) =>
    db.query(`UPDATE tenants SET created_at = ($2::timestamp AT TIME ZONE '${TZ}') WHERE id = $1`, [tenantId, local]);
  const pago = async (tenantId: string, inicio: string, fim: string, recebido: string, cents: number, ciclo = "MONTHLY", anulado = false) =>
    db.query(
      `INSERT INTO tenant_access_periods (id, tenant_id, kind, plan_id, starts_at, ends_at, anchor_day, billing_cycle,
         contracted_price_cents, currency, payment_method, payment_received_on, confirmation_source, recorded_by_user_id, request_key,
         canceled_at, canceled_by_user_id, cancel_reason, cancel_request_key)
       VALUES ($1, $2, 'PAID', $3, ($4::date)::timestamp AT TIME ZONE '${TZ}', ($5::date)::timestamp AT TIME ZONE '${TZ}', 1,
         $6::billing_cycle, $7, 'BRL', 'PIX', $8::date, 'MANUAL', $9, $10, $11, $12, $13, $14)`,
      [
        id(),
        tenantId,
        f.plano,
        inicio,
        fim,
        ciclo,
        cents,
        recebido,
        f.userId,
        `chave-${id()}`,
        anulado ? new Date() : null,
        anulado ? f.userId : null,
        anulado ? "registro fictício anulado" : null,
        anulado ? `anula-${id()}` : null,
      ],
    );
  const relA = await f.loja("RelA", "ACTIVE", true);
  await criadoEm(relA, "2002-10-31 23:59:59.999");
  await pago(relA, "2002-10-01", "2002-11-01", "2002-10-31", 5000);
  await pago(relA, "2002-11-01", "2003-02-01", "2002-11-01", 15000, "QUARTERLY");
  const relB = await f.loja("RelB", "ACTIVE", true);
  await criadoEm(relB, "2002-11-01 00:00:00");
  await pago(relB, "2002-09-01", "2002-10-01", "2002-10-01", 7000);
  await pago(relB, "2002-10-01", "2002-11-01", "2002-10-15", 9000, "MONTHLY", true);
  const relI = await f.loja("RelI", "ACTIVE", true);
  await db.query("UPDATE tenants SET is_test = true WHERE id = $1", [relI]);
  await criadoEm(relI, "2002-10-10 12:00:00");
  await pago(relI, "2002-10-01", "2002-11-01", "2002-10-20", 11000);

  const total = async () => sem(await page.getByTestId("relatorio-recebidos-total").innerText());
  const relatorio = page.getByTestId("relatorio-do-periodo");

  // Menu: mês atual decidido pelo servidor, números iguais aos da API.
  await navPortal(page).getByRole("link", { name: "Relatórios" }).click();
  await expect(page).toHaveURL(RELATORIOS);
  const atual = (await (await page.request.get(`${API_DE_TESTE}/platform/reports`)).json()) as {
    period: { from: string; to: string };
    payments: { totalCents: number };
  };
  await expect(relatorio).toHaveAttribute("data-de", atual.period.from);
  await expect(relatorio).toHaveAttribute("data-ate", atual.period.to);
  expect(await total()).toBe(sem(reais(atual.payments.totalCents)));
  await expect(page.getByTestId("alcance-dos-numeros")).toHaveAttribute("data-alcance", "CLIENTS");
  await expect(page.getByTestId("aviso-classificacao-atual")).toContainText("classificação de agora");

  // Mês fechado, virada do mês e navegação: tudo na URL.
  await page.goto(`${RELATORIOS}?mes=2002-10`);
  await expect(page.getByTestId("periodo-aplicado")).toContainText("outubro de 2002");
  expect(await total()).toBe(sem(reais(12000)));
  await expect(page.getByTestId("relatorio-anulados-quantidade")).toHaveText("1");
  await expect(page.getByTestId("relatorio-cadastros-quantidade")).toHaveText("1");
  await expect(page.getByTestId("linha-plano-ciclo")).toHaveCount(1);
  await page.getByRole("button", { name: "Mês seguinte" }).click();
  await expect(page).toHaveURL(`${RELATORIOS}?mes=2002-11`);
  await expect(page.getByTestId("periodo-aplicado")).toContainText("novembro de 2002");
  expect(await total()).toBe(sem(reais(15000)));
  await expect(page.getByTestId("relatorio-cadastros-quantidade")).toHaveText("1");
  await page.getByRole("button", { name: "Mês anterior" }).click();
  await expect(page).toHaveURL(`${RELATORIOS}?mes=2002-10`);

  // Internos/teste: alcance na URL e nos links; o link abre exatamente os recebidos.
  await page.getByRole("button", { name: "Internos/teste", exact: true }).click();
  await expect(page).toHaveURL(`${RELATORIOS}?mes=2002-10&alcance=INTERNAL`);
  await expect(relatorio).toHaveAttribute("data-alcance", "INTERNAL");
  expect(await total()).toBe(sem(reais(11000)));
  await page.getByTestId("link-recebidos").click();
  await expect(page).toHaveURL("/portal/pagamentos?de=2002-10-01&ate=2002-10-31&alcance=INTERNAL&situacao=recebidos");
  await expect(page.getByTestId("total-do-extrato")).toContainText("1 registro(s) recebidos em outubro de 2002");
  await expect(page.getByTestId("lista-pagamentos-assinaturas").getByRole("listitem")).toHaveCount(1);
  await expect(page.getByTestId("alcance-dos-numeros")).toHaveAttribute("data-alcance", "INTERNAL");

  // Clientes: anulados abrem só os anulados; cadastros abrem a lista filtrada.
  await page.goto(`${RELATORIOS}?mes=2002-10`);
  await page.getByTestId("link-anulados").click();
  await expect(page).toHaveURL("/portal/pagamentos?de=2002-10-01&ate=2002-10-31&situacao=anulados");
  const anulados = page.getByTestId("lista-pagamentos-assinaturas").getByRole("listitem");
  await expect(anulados).toHaveCount(1);
  await expect(anulados).toContainText("Anulado por correção");
  await expect(anulados).toContainText(`${f.marca} Loja RelB`);
  await page.goto(`${RELATORIOS}?mes=2002-10`);
  await page.getByTestId("link-cadastros").click();
  await expect(page).toHaveURL(`${LISTA}?cadastroDe=2002-10-01&cadastroAte=2002-10-31`);
  await expect(page.getByTestId("filtro-cadastro")).toContainText("outubro de 2002");
  await expect(item(page, `${f.marca} Loja RelA`)).toHaveCount(1);
  await expect(item(page, `${f.marca} Loja RelB`)).toHaveCount(0);
  await expect(page.getByTestId("total-da-lista")).toHaveText("1 estabelecimento(s) encontrado(s)");

  // Período personalizado de dois dias; inválido é recusado na tela.
  await page.goto(`${RELATORIOS}?mes=2002-10`);
  await expect(relatorio).toBeVisible();
  const form = page.getByTestId("periodo-personalizado");
  await form.getByLabel("Período personalizado: de").fill("2002-11-01");
  await form.getByLabel("até (inclusive)").fill("2002-10-31");
  await form.getByRole("button", { name: "Aplicar período" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "anterior ou igual" })).toBeVisible();
  await expect(page).toHaveURL(`${RELATORIOS}?mes=2002-10`);
  await form.getByLabel("Período personalizado: de").fill("2002-10-31");
  await form.getByLabel("até (inclusive)").fill("2002-11-01");
  await form.getByRole("button", { name: "Aplicar período" }).click();
  await expect(page).toHaveURL(`${RELATORIOS}?de=2002-10-31&ate=2002-11-01`);
  await expect(page.getByTestId("periodo-aplicado")).toContainText("31/10/2002 a 01/11/2002");
  expect(await total()).toBe(sem(reais(20000)));
  await expect(page.getByTestId("relatorio-cadastros-quantidade")).toHaveText("2");
  await expect(page.getByTestId("linha-plano-ciclo")).toHaveCount(2);

  // Período vazio: zero explícito, sem grupos.
  await page.goto(`${RELATORIOS}?mes=2002-08`);
  await expect(page.getByTestId("relatorio-recebidos-quantidade")).toHaveText("Nenhum pagamento recebido neste período.");
  expect(await total()).toBe(sem(reais(0)));
  await expect(page.getByTestId("linha-plano-ciclo")).toHaveCount(0);

  // Extrato aberto direto: todo o histórico, as duas situações, Clientes.
  await page.goto("/portal/pagamentos");
  await expect(page.getByTestId("total-do-extrato")).toContainText("em todo o histórico");
  await expect(page.getByTestId("alcance-dos-numeros")).toHaveAttribute("data-alcance", "CLIENTS");

  // API anterior (sem a rota): mensagem própria, nunca zero.
  await page.route("**/platform/reports**", (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.goto(`${RELATORIOS}?mes=2002-10`);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("ainda não estão disponíveis neste servidor");
  await expect(relatorio).toHaveCount(0);
  await page.unroute("**/platform/reports**");

  // Celular: sem rolagem lateral.
  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto(`${RELATORIOS}?mes=2002-10`);
  await expect(relatorio).toBeVisible();
  await semRolagemHorizontal(page);
  await page.setViewportSize({ width: 1280, height: 844 });
}
