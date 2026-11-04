// Comissões de ponta a ponta, pela tela, contra o backend real e o
// PostgreSQL DESCARTÁVEL. Nada sai da máquina e nenhum repasse é feito.
//
// 1. O dono define, em Profissionais → Comissões, percentual num serviço e
//    valor fixo noutro ("Não configurada" é o ponto de partida; zero pede
//    "Sem comissão").
// 2. Uma reserva com os dois serviços é concluída (duas vezes): o relatório
//    mostra a soma calculada no servidor pelo preço de cada item, uma vez só,
//    como comissão APURADA, não paga.
// 3. Mudar a regra depois não muda o que já foi apurado.
// 4. O funcionário só vê as próprias comissões quando o dono libera; nunca o
//    relatório do estabelecimento nem o recebimento do cliente.
// 5. Capturas em claro e escuro, 1280, 390 e 360 px, sem rolagem horizontal.
//
// Invocação própria (`npm run test:browser:comissoes`): 1 aceite de convite e
// nenhum login extra.
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { API_DE_TESTE, conectarBancoDeTeste, criarContaDeTeste } from "./support/contas-de-teste";

const SENHA_DONO = "senha-do-dono-comissoes-1";
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
      await page.screenshot({ path: test.info().outputPath(`comissoes-${nome}-${tema}-${width}.png`), fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 844 });
}

test("dono configura e consulta comissões; funcionário vê só as próprias quando liberado", async ({ page }) => {
  test.setTimeout(150_000);
  const marca = `comis-${id()}`;
  const db = await conectarBancoDeTeste();
  try {
    // ------------------------------------------------------------- cenário
    const dono = await criarContaDeTeste(page.request, {
      ownerName: "Dona das Comissões",
      businessName: `${marca} Estúdio`,
      email: `${marca}-dona@example.test`,
      password: SENHA_DONO,
    });
    const tenantId = dono.tenant.id;
    // O catálogo prevê comissões só no plano Rede.
    await db.query(`UPDATE tenants SET plan_id = (SELECT id FROM plans WHERE code = 'pro') WHERE id = $1`, [tenantId]);
    const servico = async (name: string, priceCents: number) => {
      const r = await page.request.post(`${API_DE_TESTE}/tenants/${tenantId}/services`, { data: { name, durationMinutes: 30, priceCents } });
      expect(r.status()).toBe(201);
      return ((await r.json()) as { service: { id: string } }).service.id;
    };
    const corte = await servico("Corte", 5000);
    const barba = await servico("Barba", 2500);
    const r = await page.request.post(`${API_DE_TESTE}/tenants/${tenantId}/professionals`, { data: { name: "Ana Lima", serviceIds: [corte, barba] } });
    expect(r.status()).toBe(201);
    const professionalId = ((await r.json()) as { professional: { id: string } }).professional.id;

    // ------------------------------------------- 1. regras pela tela
    await page.goto("/conta/configuracoes/profissionais");
    await page.getByRole("link", { name: "Comissões de Ana Lima" }).click();
    await expect(page).toHaveURL(new RegExp(`/conta/configuracoes/profissionais/${professionalId}/comissoes$`));
    await expect(page.getByTestId("aviso-apuracao")).toContainText("Não é pagamento ao profissional");
    const regra = (nome: string) => page.getByTestId("regra-de-comissao").filter({ hasText: nome });
    await expect(regra("Corte").getByTestId("regra-atual")).toHaveText("Não configurada");
    await regra("Corte").getByLabel("Comissão").selectOption({ label: "Percentual do preço" });
    await regra("Corte").getByLabel("Percentual (%)").fill("0");
    await regra("Corte").getByRole("button", { name: "Salvar" }).click();
    await expect(regra("Corte").getByRole("alert")).toContainText("Sem comissão");
    await regra("Corte").getByLabel("Percentual (%)").fill("40");
    await regra("Corte").getByRole("button", { name: "Salvar" }).click();
    await expect(regra("Corte").getByTestId("regra-atual")).toHaveText("40%");
    await regra("Barba").getByLabel("Comissão").selectOption({ label: "Valor fixo" });
    await regra("Barba").getByLabel("Valor (R$)").fill("10");
    await regra("Barba").getByRole("button", { name: "Salvar" }).click();
    await expect(regra("Barba").getByTestId("regra-atual")).toHaveText(/R\$\s10,00 fixo/);
    await capturar(page, "regras");

    // ------------------------------------------- 2. conclusão e relatório
    const consumidor = id();
    await db.query(
      `INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ($1, $2, 'Cliente Fiel', '(11) 98888-1111', $3)`,
      [consumidor, tenantId, `5511${Math.floor(Math.random() * 1e9)}`],
    );
    const reserva = id();
    const inicio = new Date(Math.floor((Date.now() - 2 * 3_600_000) / 60_000) * 60_000);
    await db.query(
      `INSERT INTO appointments (id, tenant_id, unit_id, consumer_id, consumer_name_snapshot, consumer_whatsapp_snapshot,
          professional_id, start_at, end_at, status)
       VALUES ($1, $2, $3, $4, 'Cliente Fiel', '(11) 98888-1111', $5, $6, $7, 'IN_PROGRESS')`,
      [reserva, tenantId, dono.unit.id, consumidor, professionalId, inicio, new Date(inicio.getTime() + 60 * 60_000)],
    );
    for (const [position, [serviceId, preco]] of [[corte, 5000], [barba, 2500]].entries()) {
      await db.query(
        `INSERT INTO appointment_items (id, tenant_id, appointment_id, service_id, duration_minutes_snapshot, price_cents_snapshot, position)
         VALUES ($1, $2, $3, $4, 30, $5, $6)`,
        [id(), tenantId, reserva, serviceId, preco, position],
      );
    }
    for (let vez = 0; vez < 2; vez += 1) {
      const concluir = await page.request.post(`${API_DE_TESTE}/tenants/${tenantId}/appointments/${reserva}/complete`, {
        data: { expectedStartAt: inicio.toISOString() },
      });
      expect(concluir.status()).toBe(201);
    }
    const dataLocal = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(inicio);
    await page.goto(`/conta/comissoes?de=${dataLocal}&ate=${dataLocal}`);
    await expect(page.getByTestId("aviso-apuracao")).toBeVisible();
    await expect(page.getByTestId("total-apurado-valor")).toHaveText(/R\$\s30,00/);
    const apurado = page.getByTestId("atendimento-apurado");
    await expect(apurado).toHaveCount(1);
    await expect(apurado).toContainText("Cliente Fiel");
    await expect(apurado).toContainText("40%");
    await expect(apurado).toContainText("Sem recebimento registrado");
    await expect(page.getByTestId("comissoes-por-profissional")).toContainText("Ana Lima");
    await capturar(page, "relatorio");

    // ------------------------------------------- 3. a regra muda; o apurado não
    await page.goto(`/conta/configuracoes/profissionais/${professionalId}/comissoes`);
    await regra("Corte").getByLabel("Percentual (%)").fill("50");
    await regra("Corte").getByRole("button", { name: "Salvar" }).click();
    await expect(regra("Corte").getByTestId("regra-atual")).toHaveText("50%");
    await page.goto(`/conta/comissoes?de=${dataLocal}&ate=${dataLocal}`);
    await expect(page.getByTestId("total-apurado-valor")).toHaveText(/R\$\s30,00/);

    // ------------------------------------------- 4. o funcionário
    // O mesmo login passa a ser funcionário ligado a Ana: o servidor decide
    // pelo papel e pelas concessões lidos a cada requisição.
    await db.query(`UPDATE memberships SET role = 'PROFISSIONAL', professional_id = $2 WHERE tenant_id = $1 AND role = 'DONO'`, [
      tenantId,
      professionalId,
    ]);
    expect((await page.request.get(`${API_DE_TESTE}/tenants/${tenantId}/my-agenda/commissions`)).status()).toBe(403);
    await page.goto("/conta/minha-agenda");
    await expect(page.getByRole("heading", { name: "Minha agenda" })).toBeVisible();
    await expect(page.getByTestId("minhas-comissoes")).toHaveCount(0);
    await db.query(
      `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode)
       SELECT $1, tenant_id, id, 'COMISSOES_PROPRIAS_VISUALIZAR', 'GRANTED' FROM memberships WHERE tenant_id = $2 AND professional_id = $3`,
      [id(), tenantId, professionalId],
    );
    await page.reload();
    await page.getByTestId("minhas-comissoes").click();
    await expect(page).toHaveURL(/\/conta\/minha-agenda\/comissoes$/);
    await page.getByRole("button", { name: "Mês anterior" }).waitFor();
    // O mês corrente pode não conter o atendimento (virada de mês): o
    // relatório do dia, pela API, é o que conta aqui.
    const proprias = await page.request.get(`${API_DE_TESTE}/tenants/${tenantId}/my-agenda/commissions?from=${dataLocal}&to=${dataLocal}`);
    expect(proprias.status()).toBe(200);
    const corpo = (await proprias.json()) as { totalAccruedCents: number };
    expect(corpo.totalAccruedCents).toBe(3000);
    expect(JSON.stringify(corpo)).not.toMatch(/clientPayment|RECEBIDO|SEM_RECEBIMENTO/);
    if (dataLocal.slice(0, 7) === new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 7)) {
      await expect(page.getByTestId("total-apurado-valor")).toHaveText(/R\$\s30,00/);
      await expect(page.getByTestId("atendimento-apurado")).not.toContainText("recebimento");
    }
    await capturar(page, "proprias");
    expect((await page.request.get(`${API_DE_TESTE}/tenants/${tenantId}/commissions`)).status()).toBe(403);
    await page.goto("/conta/comissoes");
    await expect(page).toHaveURL(/\/conta\/minha-agenda$/);
  } finally {
    await db.end();
  }
});
