// Recebimentos manuais de ponta a ponta, pela tela, contra o backend real e
// o PostgreSQL DESCARTÁVEL. Nada sai da máquina e nenhuma cobrança é feita.
//
// 1. O Início mostra dinheiro só do que foi registrado: zero e ticket "—"
//    antes de qualquer registro, mesmo com atendimento concluído e preço na
//    reserva.
// 2. Em Recebimentos, o atendimento concluído aguarda quitação; o dono
//    informa o valor pago (o preço da reserva é só sugestão), a forma e a
//    data; clique duplo vira um registro só.
// 3. O Início passa a mostrar o valor recebido e o ticket médio.
// 4. Estorno com motivo e senha do dono: o registro original fica, marcado,
//    e o atendimento volta a aguardar quitação.
// 5. O funcionário não vê dinheiro: a API recusa e a tela leva à agenda dele.
// 6. Capturas em claro e escuro, 1280, 390 e 360 px, sem rolagem horizontal.
//
// Invocação própria (`npm run test:browser:recebimentos`): 1 aceite de
// convite e nenhum login extra.
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { API_DE_TESTE, conectarBancoDeTeste, criarContaDeTeste } from "./support/contas-de-teste";

const SENHA_DONO = "senha-do-dono-recebimentos-1";
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
      await page.screenshot({ path: test.info().outputPath(`recebimentos-${nome}-${tema}-${width}.png`), fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 844 });
}

async function confirmarSenhaSePedir(page: Page, senha: string) {
  const dialogo = page.getByTestId("confirmar-senha");
  const apareceu = await dialogo
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (apareceu) {
    await page.getByLabel("Sua senha", { exact: true }).fill(senha);
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  }
}

test("dono registra e estorna recebimentos; o Início mostra só o que foi registrado", async ({ page }) => {
  test.setTimeout(150_000);
  const marca = `receb-${id()}`;
  const db = await conectarBancoDeTeste();
  try {
    // ------------------------------------------------------------- cenário
    const dono = await criarContaDeTeste(page.request, {
      ownerName: "Dona dos Recebimentos",
      businessName: `${marca} Estúdio`,
      email: `${marca}-dona@example.test`,
      password: SENHA_DONO,
    });
    const tenantId = dono.tenant.id;
    const r = await page.request.post(`${API_DE_TESTE}/tenants/${tenantId}/professionals`, { data: { name: "Ana Lima", serviceIds: [] } });
    expect(r.status()).toBe(201);
    const professionalId = ((await r.json()) as { professional: { id: string } }).professional.id;
    const ids = { service: id(), consumer: id(), appointment: id() };
    await db.query(
      `INSERT INTO services (id, tenant_id, name, short_description, duration_minutes, price_cents) VALUES ($1, $2, 'Corte', '', 30, 5000)`,
      [ids.service, tenantId],
    );
    await db.query(
      `INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ($1, $2, 'Cliente Pagante', '(11) 98888-7777', $3)`,
      [ids.consumer, tenantId, `5511${Math.floor(Math.random() * 1e9)}`],
    );
    // Concluído duas horas atrás (hoje ou ontem, no fuso do estabelecimento).
    const inicio = new Date(Date.now() - 2 * 3_600_000);
    await db.query(
      `INSERT INTO appointments (id, tenant_id, unit_id, consumer_id, consumer_name_snapshot, consumer_whatsapp_snapshot,
          professional_id, start_at, end_at, status)
       VALUES ($1, $2, $3, $4, 'Cliente Pagante', '(11) 98888-7777', $5, $6, $7, 'COMPLETED')`,
      [ids.appointment, tenantId, dono.unit.id, ids.consumer, professionalId, inicio, new Date(inicio.getTime() + 30 * 60_000)],
    );
    await db.query(
      `INSERT INTO appointment_items (id, tenant_id, appointment_id, service_id, duration_minutes_snapshot, price_cents_snapshot)
       VALUES ($1, $2, $3, $4, 30, 5000)`,
      [id(), tenantId, ids.appointment, ids.service],
    );
    const dataLocal = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(inicio);
    const periodo = `de=${dataLocal.slice(0, 8)}01&ate=${dataLocal}`;

    // ------------------------------------------- 1. Início sem registro: zero
    await page.goto("/conta/visao-geral");
    await page.getByRole("group", { name: "Período dos indicadores" }).getByRole("button", { name: "Personalizado" }).click();
    await page.getByLabel("De", { exact: true }).fill(`${dataLocal.slice(0, 8)}01`);
    await page.getByLabel("Até", { exact: true }).fill(dataLocal);
    await page.getByRole("button", { name: "Aplicar" }).click();
    await expect(page.getByTestId("indicador-recebido-valor")).toHaveText(/R\$\s0,00/);
    await expect(page.getByTestId("indicador-ticket-valor")).toHaveText("—");

    // ------------------------------------------- 2. registrar
    await page.getByTestId("ver-recebimentos").click();
    await expect(page).toHaveURL(new RegExp(`/conta/recebimentos\\?${periodo}$`));
    const item = page.getByTestId("atendimento-a-quitar").filter({ hasText: "Cliente Pagante" });
    await item.getByRole("button", { name: "Registrar recebimento" }).click();
    const formulario = item.getByTestId("registrar-recebimento");
    await expect(formulario).toContainText("Preço da reserva: R$");
    await expect(formulario).toContainText("Pagamento parcial ainda não existe");
    await formulario.getByLabel("Valor pago (R$)").fill("0");
    await expect(formulario.getByTestId("erro-recebimento")).toContainText("maior que zero");
    await formulario.getByLabel("Valor pago (R$)").fill("42,5");
    await formulario.getByLabel("Forma de pagamento").selectOption({ label: "Dinheiro" });
    await formulario.getByLabel("Data do recebimento").fill(dataLocal);
    let posts = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && new URL(req.url()).pathname.endsWith("/payments")) posts += 1;
    });
    await formulario.getByTestId("confirmar-recebimento").dblclick();
    await expect(page.getByTestId("lista-recebimentos").getByTestId("recebimento")).toHaveCount(1);
    expect(posts, "clique duplo vira um registro só").toBe(1);
    const recebimento = page.getByTestId("recebimento").first();
    await expect(recebimento).toContainText("R$ 42,50");
    await expect(recebimento).toContainText("Dinheiro");
    await expect(page.getByTestId("nada-a-quitar")).toBeVisible();
    await expect(page.getByTestId("resumo-recebido-valor")).toHaveText(/R\$\s42,50/);
    await expect(page.getByTestId("resumo-ticket-valor")).toHaveText(/R\$\s42,50/);
    // Mudar o preço do serviço não mexe no registro.
    await db.query(`UPDATE services SET price_cents = 9900 WHERE id = $1`, [ids.service]);
    await page.reload();
    await expect(page.getByTestId("recebimento").first()).toContainText("R$ 42,50");
    await capturar(page, "registrado");

    // ------------------------------------------- 3. o Início usa o registro
    await page.goto("/conta/visao-geral");
    await expect(page.getByTestId("indicador-recebido-valor")).toHaveText(/R\$\s42,50/);
    await expect(page.getByTestId("indicador-ticket-valor")).toHaveText(/R\$\s42,50/);
    await capturar(page, "inicio");

    // ------------------------------------------- 4. estorno
    await page.goto(`/conta/recebimentos?${periodo}`);
    await page.getByTestId("recebimento").first().getByRole("button", { name: "Estornar" }).click();
    await expect(page.getByTestId("confirmar-estorno")).toBeDisabled();
    await page.getByRole("dialog").getByLabel("Motivo").fill("Valor lançado errado");
    await page.getByTestId("confirmar-estorno").click();
    await confirmarSenhaSePedir(page, SENHA_DONO);
    await expect(page.getByTestId("recebimento-estorno")).toContainText("Valor lançado errado");
    await expect(page.getByTestId("recebimento")).toHaveCount(1);
    await expect(page.getByTestId("resumo-liquido-valor")).toHaveText(/R\$\s0,00/);
    await expect(page.getByTestId("resumo-ticket-valor")).toHaveText("—");
    await expect(page.getByTestId("atendimento-a-quitar")).toHaveCount(1);
    await capturar(page, "estornado");

    // ------------------------------------------- isolamento entre estabelecimentos
    // Outro estabelecimento (só no banco, sem conta nova): a sessão do dono
    // não lê os recebimentos dele nem quita um atendimento dele pelo daqui.
    const outro = { tenant: id(), unit: id(), professional: id(), consumer: id(), appointment: id() };
    await db.query(
      `INSERT INTO tenants (id, slug, category, timezone, plan_id, status)
       SELECT $1, $2, 'OTHER', 'America/Sao_Paulo', plan_id, 'ACTIVE' FROM tenants WHERE id = $3`,
      [outro.tenant, `${marca}-outro`, tenantId],
    );
    await db.query(
      `INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, 'Outro', '', 'America/Sao_Paulo', true)`,
      [outro.unit, outro.tenant],
    );
    await db.query(
      `INSERT INTO professionals (id, tenant_id, name, avatar_initials, avatar_color) VALUES ($1, $2, 'Bia', 'BI', '#000000')`,
      [outro.professional, outro.tenant],
    );
    await db.query(
      `INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ($1, $2, 'Cliente de Outro', '(11) 97777-6666', $3)`,
      [outro.consumer, outro.tenant, `5511${Math.floor(Math.random() * 1e9)}`],
    );
    await db.query(
      `INSERT INTO appointments (id, tenant_id, unit_id, consumer_id, consumer_name_snapshot, consumer_whatsapp_snapshot,
          professional_id, start_at, end_at, status)
       VALUES ($1, $2, $3, $4, 'Cliente de Outro', '(11) 97777-6666', $5, $6, $7, 'COMPLETED')`,
      [outro.appointment, outro.tenant, outro.unit, outro.consumer, outro.professional, inicio, new Date(inicio.getTime() + 30 * 60_000)],
    );
    expect((await page.request.get(`${API_DE_TESTE}/tenants/${outro.tenant}/payments`)).status()).toBe(404);
    const quitarDeOutro = await page.request.post(`${API_DE_TESTE}/tenants/${tenantId}/payments`, {
      data: { requestKey: `chave-${id()}`, appointmentId: outro.appointment, amountCents: 100, method: "PIX", receivedOn: dataLocal },
    });
    expect(quitarDeOutro.status()).toBe(404);
    const semRegistro = await db.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM appointment_payments WHERE appointment_id = $1`,
      [outro.appointment],
    );
    expect(semRegistro.rows[0]?.total).toBe(0);

    // ------------------------------------------- 5. funcionário não vê dinheiro
    // O mesmo login passa a ser funcionário deste estabelecimento: o servidor
    // decide pelo papel lido a cada requisição, não pela tela.
    await db.query(`UPDATE memberships SET role = 'PROFISSIONAL' WHERE tenant_id = $1 AND role = 'DONO'`, [tenantId]);
    const recusa = await page.request.get(`${API_DE_TESTE}/tenants/${tenantId}/payments?from=${dataLocal}&to=${dataLocal}`);
    expect(recusa.status()).toBe(403);
    expect((await page.request.get(`${API_DE_TESTE}/tenants/${tenantId}/dashboard`)).status()).toBe(403);
    await page.goto("/conta/recebimentos");
    await expect(page).toHaveURL(/\/conta\/minha-agenda$/);
  } finally {
    await db.end();
  }
});
