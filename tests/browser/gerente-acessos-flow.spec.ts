// Gerente de ponta a ponta, pela tela, contra o backend real e o PostgreSQL
// DESCARTÁVEL. Dados fictícios; nada é enviado (este fluxo não usa e-mail).
//
// 1. O dono cria, em "Criar acesso", um GERENTE sem profissional, com login
//    em formato de e-mail, e marca a agenda do estabelecimento e as
//    solicitações. Marcar a agenda traz junto "consultar profissionais", e o
//    resumo mostra exatamente o que será concedido.
// 2. O gerente troca a senha temporária e começa na Agenda. Vê os
//    atendimentos de todos sem telefone nem preço, sem "Novo agendamento" e
//    sem ações; confirma uma solicitação pela aba Solicitações.
// 3. Áreas não concedidas: pelo endereço, levam ao começo dele; pela API,
//    403. Gerente não abre Equipe, Início nem Configurações do
//    estabelecimento.
// 4. O dono retira a agenda com a sessão do gerente aberta: a próxima
//    requisição já é recusada.
// 5. Capturas em claro e escuro, 1280, 390 e 360 px, sem rolagem horizontal.
//
// Invocação própria (`npm run test:browser:gerente`): 1 login.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { API_DE_TESTE, conectarBancoDeTeste, criarContaDeTeste } from "./support/contas-de-teste";

const SENHA_DONO = "senha-do-dono-do-gerente-1";
const SENHA_GERENTE = "senha-escolhida-pelo-gerente-1";
const id = () => randomUUID().replaceAll("-", "").slice(0, 10);

async function semRolagemHorizontal(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function capturar(page: Page, nome: string) {
  for (const tema of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: tema });
    for (const width of [1280, 390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await semRolagemHorizontal(page);
      await page.screenshot({ path: test.info().outputPath(`gerente-${nome}-${tema}-${width}.png`), fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 844 });
}

async function confirmarSenhaSePedir(page: Page, senha: string) {
  const apareceu = await page
    .getByTestId("confirmar-senha")
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (apareceu) {
    await page.getByLabel("Sua senha", { exact: true }).fill(senha);
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  }
}

async function novaPagina(browser: Browser) {
  const contexto = await browser.newContext();
  return { contexto, page: await contexto.newPage() };
}

test("gerente sem profissional: só as áreas concedidas, sem contato nem preço; retirada vale na hora", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const marca = `gerente-${id()}`;
  const login = `recepcao@${marca}.salao`;
  const db = await conectarBancoDeTeste();
  const main = page.getByRole("main");
  try {
    // ------------------------------------------------------------- cenário
    const dono = await criarContaDeTeste(page.request, {
      ownerName: "Dona do Gerente",
      businessName: `${marca} Estúdio`,
      email: `${marca}-dona@example.test`,
      password: SENHA_DONO,
    });
    const tenantId = dono.tenant.id;
    const profissionais: string[] = [];
    for (const nome of ["Ana Lima", "Bruno Reis"]) {
      const r = await page.request.post(`${API_DE_TESTE}/tenants/${tenantId}/professionals`, { data: { name: nome, serviceIds: [] } });
      expect(r.status(), await r.text()).toBe(201);
      profissionais.push(((await r.json()) as { professional: { id: string } }).professional.id);
    }
    const ids = { service: id(), consumer: id(), confirmada: id(), pedido: id() };
    await db.query(
      `INSERT INTO services (id, tenant_id, name, short_description, duration_minutes, price_cents) VALUES ($1, $2, 'Corte de cabelo', '', 30, 4500)`,
      [ids.service, tenantId],
    );
    await db.query(
      `INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ($1, $2, 'Cliente Fictícia', '(11) 97777-6666', $3)`,
      [ids.consumer, tenantId, `5511${Math.floor(Math.random() * 1e9)}`],
    );
    // Amanhã, no meio do dia local: confirmada com a Ana, pedido com o Bruno.
    const amanha = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(Date.now() + 24 * 3_600_000);
    const as = (hora: string) => new Date(`${amanha}T${hora}:00-03:00`);
    for (const [appointment, professional, inicio, status] of [
      [ids.confirmada, profissionais[0], as("10:00"), "CONFIRMED"],
      [ids.pedido, profissionais[1], as("11:00"), "PENDING"],
    ] as const) {
      await db.query(
        `INSERT INTO appointments (id, tenant_id, unit_id, consumer_id, consumer_name_snapshot, consumer_whatsapp_snapshot,
            professional_id, start_at, end_at, status, notes)
         VALUES ($1, $2, $3, $4, 'Cliente Fictícia', '(11) 97777-6666', $5, $6, $7, $8::appointment_status, 'observação só do dono')`,
        [appointment, tenantId, dono.unit.id, ids.consumer, professional, inicio, new Date(inicio.getTime() + 30 * 60_000), status],
      );
      await db.query(
        `INSERT INTO appointment_items (id, tenant_id, appointment_id, service_id, duration_minutes_snapshot, price_cents_snapshot)
         VALUES ($1, $2, $3, $4, 30, 4500)`,
        [id(), tenantId, appointment, ids.service],
      );
    }

    // ------------------------------------------ 1. dono cria o gerente
    await page.goto("/conta/configuracoes/equipe");
    await main.getByRole("button", { name: "Criar acesso", exact: true }).click();
    const formulario = page.getByTestId("criar-acesso");
    await formulario.getByLabel(/^Gerente/).check();
    await formulario.getByLabel("Profissional vinculado").selectOption({ label: "Nenhum: não atende clientes" });
    await formulario.getByLabel("Nome da pessoa").fill("Gerente Fictício");
    await formulario.getByLabel("Login").fill(login);
    await expect(formulario.getByLabel("Iniciar os próprios atendimentos")).toHaveCount(0);
    await formulario.getByLabel("Consultar a agenda de todos os profissionais", { exact: true }).check();
    // A dependência entra junto, e não sai sozinha.
    await expect(formulario.getByLabel("Consultar profissionais", { exact: true })).toBeChecked();
    await expect(formulario.getByLabel("Consultar profissionais", { exact: true })).toBeDisabled();
    await formulario.getByLabel("Aceitar e recusar solicitações", { exact: true }).check();
    await expect(formulario.getByLabel("Consultar solicitações", { exact: true })).toBeChecked();
    const resumo = formulario.getByTestId("resumo-permissoes");
    await expect(resumo.getByRole("listitem")).toHaveText([
      "Agenda do estabelecimento: consultar a agenda de todos os profissionais",
      "Solicitações: consultar solicitações; aceitar e recusar solicitações",
      "Profissionais: consultar profissionais",
    ]);
    await capturar(page, "criar");
    await formulario.getByRole("button", { name: "Criar acesso" }).click();
    await confirmarSenhaSePedir(page, SENHA_DONO);
    const temporaria = (await page.getByTestId("senha-temporaria-valor").textContent())!.trim();
    await page.getByRole("button", { name: "Já entreguei" }).click();
    const cartao = page.getByTestId("acesso-equipe").filter({ hasText: "Gerente Fictício" });
    await expect(cartao.getByTestId("perfil-acesso")).toHaveText("Gerente");
    await expect(cartao.getByTestId("profissional-vinculado")).toHaveText("Nenhum: não atende clientes");
    await expect(cartao.getByTestId("permissoes-efetivas")).toContainText("Solicitações");
    // Ocupa vaga; nenhum profissional foi criado.
    await expect(page.getByTestId("vagas-equipe")).toHaveText("1 de 5 em uso (1 ativo)");
    const [{ total }] = (await db.query("SELECT count(*)::int AS total FROM professionals WHERE tenant_id = $1", [tenantId])).rows;
    expect(total).toBe(2);
    const [conta] = (await db.query("SELECT email, email_verified FROM users WHERE username = $1", [login])).rows;
    expect(conta).toEqual({ email: null, email_verified: false });
    await capturar(page, "lista");

    // ------------------------------------------ 2. gerente entra
    const g = await novaPagina(browser);
    const gp = g.page;
    try {
      await gp.goto("/login");
      await gp.getByLabel("E-mail ou login").fill(login.toUpperCase());
      await gp.getByLabel("Senha", { exact: true }).fill(temporaria);
      await gp.getByRole("button", { name: "Entrar" }).click();
      await expect(gp).toHaveURL(/\/conta\/configuracoes\/perfil$/);
      await gp.getByLabel("Senha temporária").fill(temporaria);
      await gp.getByLabel("Senha nova", { exact: true }).fill(SENHA_GERENTE);
      await gp.getByLabel("Confirme a senha nova").fill(SENHA_GERENTE);
      await gp.getByTestId("trocar-senha").click();
      await expect(gp).toHaveURL(/\/conta\/agendamentos$/);
      const nav = gp.getByRole("navigation", { name: "Áreas da conta" });
      await expect(nav.getByRole("link")).toHaveText(["Agenda", "Profissionais", "Configurações"]);

      const gmain = gp.getByRole("main");
      await gp.getByRole("button", { name: "Próximo dia" }).first().click();
      await expect(gmain).toContainText("Cliente Fictícia");
      await expect(gmain).not.toContainText("97777");
      await expect(gmain).not.toContainText("45,00");
      await expect(gmain).not.toContainText("observação só do dono");
      await expect(gp.getByTestId("novo-agendamento")).toHaveCount(0);
      await expect(gmain.getByRole("button", { name: /Cancelar|Iniciar|Remarcar/ })).toHaveCount(0);
      await capturar(gp, "agenda");

      await gp.getByRole("link", { name: /Solicitações/ }).first().click();
      await expect(gp).toHaveURL(/\/conta\/agendamentos\/solicitacoes$/);
      await gp.getByTestId("confirmar-solicitacao").click();
      await expect
        .poll(async () => (await db.query("SELECT status::text FROM appointments WHERE id = $1", [ids.pedido])).rows[0].status)
        .toBe("CONFIRMED");
      await capturar(gp, "solicitacoes");

      // ---------------------------------- 3. o que não foi concedido
      for (const caminho of ["/conta/clientes", "/conta/visao-geral", "/conta/recebimentos", "/conta/configuracoes/equipe", "/conta/configuracoes/estabelecimento"]) {
        await gp.goto(caminho);
        await expect(gp, caminho).toHaveURL(/\/conta\/agendamentos$/);
      }
      const api = gp.request;
      for (const caminho of ["consumers/page", "payments", "dashboard", "team", "public-booking/settings"]) {
        const r = await api.get(`${API_DE_TESTE}/tenants/${tenantId}/${caminho}`);
        expect([403, 404], caminho).toContain(r.status());
      }
      const criar = await api.post(`${API_DE_TESTE}/tenants/${tenantId}/appointments`, {
        data: { professionalId: profissionais[0], serviceId: ids.service, startAt: as("15:00").toISOString(), consumerId: ids.consumer },
      });
      expect([400, 403]).toContain(criar.status());
      const lista = (await (await api.get(`${API_DE_TESTE}/tenants/${tenantId}/appointments?date=${amanha}`)).json()) as {
        appointments: { consumer: { whatsapp: string | null }; priceCents: number | null; hidden?: string[] }[];
      };
      expect(lista.appointments.every((a) => a.consumer.whatsapp === null && a.priceCents === null)).toBe(true);
      expect(lista.appointments[0].hidden).toEqual(["price", "contact"]);

      // ---------------------------------- 4. retirada com a sessão aberta
      await page.goto("/conta/configuracoes/equipe");
      await cartao.getByRole("button", { name: "Editar permissões" }).click();
      await cartao.getByLabel("Consultar a agenda de todos os profissionais", { exact: true }).uncheck();
      await cartao.getByRole("button", { name: "Salvar permissões" }).click();
      await confirmarSenhaSePedir(page, SENHA_DONO);
      await expect(cartao.getByTestId("permissoes-efetivas")).not.toContainText("Agenda do estabelecimento");
      expect((await api.get(`${API_DE_TESTE}/tenants/${tenantId}/appointments?date=${amanha}`)).status()).toBe(403);
      expect((await api.get(`${API_DE_TESTE}/tenants/${tenantId}/booking-requests`)).status()).toBe(200);
    } finally {
      await g.contexto.close();
    }
  } finally {
    await db.end();
  }
});
