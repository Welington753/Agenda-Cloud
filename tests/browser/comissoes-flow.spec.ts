// Comissões de ponta a ponta, pela tela, contra o backend real e o
// PostgreSQL DESCARTÁVEL. Nada sai da máquina e nenhum repasse é feito.
//
// 0. No Básico (código `essencial`) não há comissões, nem na tela nem no
//    servidor. O resto roda no Pro (código `equipe`).
// 1. Profissional novo começa sem receber comissão. O dono define, em
//    Profissionais → Comissões, exceções (percentual num serviço, valor fixo
//    noutro; zero pede "Sem comissão"); desligado, a tela avisa que elas não
//    geram comissão, e um atendimento concluído assim não apura nada.
// 2. O dono liga "Recebe comissão" com regra geral fixa por serviço. Uma
//    reserva com os três serviços é concluída (duas vezes): o relatório mostra
//    a soma calculada no servidor item a item (exceção > regra geral), uma vez
//    só, como comissão APURADA, não paga. Repetir a conclusão do atendimento
//    feito com ela desligada continua sem comissão.
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
    const plano = (codigo: string) =>
      db.query(`UPDATE tenants SET plan_id = (SELECT id FROM plans WHERE code = $2) WHERE id = $1`, [tenantId, codigo]);
    await plano("essencial");
    const servico = async (name: string, priceCents: number) => {
      const r = await page.request.post(`${API_DE_TESTE}/tenants/${tenantId}/services`, { data: { name, durationMinutes: 30, priceCents } });
      expect(r.status()).toBe(201);
      return ((await r.json()) as { service: { id: string } }).service.id;
    };
    const corte = await servico("Corte", 5000);
    const barba = await servico("Barba", 2500);
    const sobrancelha = await servico("Sobrancelha", 2000);
    const r = await page.request.post(`${API_DE_TESTE}/tenants/${tenantId}/professionals`, {
      data: { name: "Ana Lima", serviceIds: [corte, barba, sobrancelha] },
    });
    expect(r.status()).toBe(201);
    const professionalId = ((await r.json()) as { professional: { id: string } }).professional.id;

    // ------------------------------------------- 0. Básico: sem comissões
    // Nem na tela nem no servidor; o resto da conta segue igual.
    expect((await page.request.get(`${API_DE_TESTE}/tenants/${tenantId}/commissions`)).status()).toBe(403);
    await page.goto("/conta/configuracoes/profissionais");
    await expect(page.getByRole("link", { name: "Horários de Ana Lima" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Comissões de Ana Lima" })).toHaveCount(0);
    await page.goto("/conta/visao-geral");
    await expect(page.getByTestId("ver-recebimentos")).toBeVisible();
    await expect(page.getByTestId("ver-comissoes")).toHaveCount(0);
    await page.goto("/conta/comissoes");
    await expect(page.getByText(/o plano não inclui comissões/)).toBeVisible();
    // O Pro (código `equipe`) inclui comissões, como o Max (código `pro`).
    await plano("equipe");

    // ------------------------------------------- 1. regras pela tela
    await page.goto("/conta/configuracoes/profissionais");
    await expect(page.getByRole("article", { name: "Ana Lima" }).getByTestId("recebe-comissao")).toHaveText("Não recebe comissão");
    await page.getByRole("link", { name: "Comissões de Ana Lima" }).click();
    await expect(page).toHaveURL(new RegExp(`/conta/configuracoes/profissionais/${professionalId}/comissoes$`));
    await expect(page.getByTestId("aviso-apuracao")).toContainText("Não é pagamento ao profissional");
    const regra = (nome: string) => page.getByTestId("regra-de-comissao").filter({ hasText: nome });
    const configuracao = page.getByTestId("configuracao-comissao");
    await expect(configuracao.getByTestId("estado-recebe-comissao")).toHaveText("Não recebe comissão");
    await expect(page.getByTestId("aviso-nao-recebe")).toContainText("ficam guardadas, mas não geram comissão");
    await expect(regra("Corte").getByTestId("regra-atual")).toHaveText("Não configurada");
    await regra("Corte").getByLabel("Comissão neste serviço").selectOption({ label: "Percentual do preço" });
    await regra("Corte").getByLabel("Percentual (%)").fill("0");
    await regra("Corte").getByRole("button", { name: "Salvar" }).click();
    await expect(regra("Corte").getByRole("alert")).toContainText("Sem comissão");
    await regra("Corte").getByLabel("Percentual (%)").fill("40");
    await regra("Corte").getByRole("button", { name: "Salvar" }).click();
    await expect(regra("Corte").getByTestId("regra-atual")).toHaveText("Exceção · 40%");
    await regra("Barba").getByLabel("Comissão neste serviço").selectOption({ label: "Valor fixo" });
    await regra("Barba").getByLabel("Valor (R$)").fill("10");
    await regra("Barba").getByRole("button", { name: "Salvar" }).click();
    await expect(regra("Barba").getByTestId("regra-atual")).toHaveText(/Exceção · R\$\s10,00 fixo/);
    await capturar(page, "regras-desligado");

    // Atendimentos fictícios em andamento, concluídos pela API.
    const consumidor = id();
    await db.query(
      `INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ($1, $2, 'Cliente Fiel', '(11) 98888-1111', $3)`,
      [consumidor, tenantId, `5511${Math.floor(Math.random() * 1e9)}`],
    );
    const emAndamento = async (horasAtras: number) => {
      const reservaId = id();
      const comeco = new Date(Math.floor((Date.now() - horasAtras * 3_600_000) / 60_000) * 60_000);
      await db.query(
        `INSERT INTO appointments (id, tenant_id, unit_id, consumer_id, consumer_name_snapshot, consumer_whatsapp_snapshot,
            professional_id, start_at, end_at, status)
         VALUES ($1, $2, $3, $4, 'Cliente Fiel', '(11) 98888-1111', $5, $6, $7, 'IN_PROGRESS')`,
        [reservaId, tenantId, dono.unit.id, consumidor, professionalId, comeco, new Date(comeco.getTime() + 90 * 60_000)],
      );
      for (const [position, [serviceId, preco]] of [[corte, 5000], [barba, 2500], [sobrancelha, 2000]].entries()) {
        await db.query(
          `INSERT INTO appointment_items (id, tenant_id, appointment_id, service_id, duration_minutes_snapshot, price_cents_snapshot, position)
           VALUES ($1, $2, $3, $4, 30, $5, $6)`,
          [id(), tenantId, reservaId, serviceId, preco, position],
        );
      }
      return { reservaId, comeco };
    };
    const concluirPelaApi = async ({ reservaId, comeco }: { reservaId: string; comeco: Date }) => {
      const concluir = await page.request.post(`${API_DE_TESTE}/tenants/${tenantId}/appointments/${reservaId}/complete`, {
        data: { expectedStartAt: comeco.toISOString() },
      });
      expect(concluir.status()).toBe(201);
    };
    const apuracoes = async (reservaId: string) =>
      Number((await db.query("SELECT count(*) AS n FROM commission_entries WHERE appointment_id = $1", [reservaId])).rows[0].n);
    // Desligada: concluir não apura, mesmo com exceções guardadas.
    const desligada = await emAndamento(4);
    await concluirPelaApi(desligada);
    expect(await apuracoes(desligada.reservaId)).toBe(0);

    // ------------------------------------------- 2. liga, conclui e consulta
    await configuracao.getByLabel("Recebe comissão").check();
    await configuracao.getByLabel("Regra geral").selectOption({ label: "Valor fixo por serviço realizado" });
    await configuracao.getByLabel("Valor por serviço (R$)").fill("5");
    await configuracao.getByRole("button", { name: "Salvar comissão do profissional" }).click();
    await expect(configuracao.getByTestId("estado-recebe-comissao")).toHaveText("Recebe comissão");
    await expect(page.getByTestId("aviso-nao-recebe")).toHaveCount(0);
    await expect(regra("Sobrancelha").getByTestId("regra-atual")).toHaveText(/Regra geral · R\$\s5,00 fixo/);
    await expect(regra("Corte").getByTestId("regra-atual")).toHaveText("Exceção · 40%");
    await capturar(page, "regras");
    // Repetir a conclusão do atendimento feito com ela desligada: nada.
    await concluirPelaApi(desligada);
    expect(await apuracoes(desligada.reservaId)).toBe(0);

    const reserva = await emAndamento(2);
    const inicio = reserva.comeco;
    for (let vez = 0; vez < 2; vez += 1) await concluirPelaApi(reserva);
    const dataLocal = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(inicio);
    await page.goto(`/conta/comissoes?de=${dataLocal}&ate=${dataLocal}`);
    await expect(page.getByTestId("aviso-apuracao")).toBeVisible();
    // 40% de R$ 50 + R$ 10 fixos (exceções) + R$ 5 (regra geral).
    await expect(page.getByTestId("total-apurado-valor")).toHaveText(/R\$\s35,00/);
    const apurado = page.getByTestId("atendimento-apurado");
    await expect(apurado).toHaveCount(1);
    await expect(apurado).toContainText("Cliente Fiel");
    await expect(apurado).toContainText("40% (exceção do serviço)");
    await expect(apurado).toContainText("(regra geral)");
    await expect(apurado).toContainText("Sem recebimento registrado");
    await expect(page.getByTestId("comissoes-por-profissional")).toContainText("Ana Lima");
    await capturar(page, "relatorio");

    // ------------------------------------------- 3. a regra muda; o apurado não
    await page.goto(`/conta/configuracoes/profissionais/${professionalId}/comissoes`);
    await regra("Corte").getByLabel("Percentual (%)").fill("50");
    await regra("Corte").getByRole("button", { name: "Salvar" }).click();
    await expect(regra("Corte").getByTestId("regra-atual")).toHaveText("Exceção · 50%");
    await page.goto(`/conta/comissoes?de=${dataLocal}&ate=${dataLocal}`);
    await expect(page.getByTestId("total-apurado-valor")).toHaveText(/R\$\s35,00/);

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
    expect(corpo.totalAccruedCents).toBe(3500);
    expect(JSON.stringify(corpo)).not.toMatch(/clientPayment|RECEBIDO|SEM_RECEBIMENTO/);
    if (dataLocal.slice(0, 7) === new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 7)) {
      await expect(page.getByTestId("total-apurado-valor")).toHaveText(/R\$\s35,00/);
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
