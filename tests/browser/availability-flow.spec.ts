// Teste de navegador da consulta real de disponibilidade (Lote 6D.4) —
// contra o backend real e um PostgreSQL descartável, mesmo padrão de
// professional-working-hours-flow.spec.ts.
//
// O FLUXO (configurar jornada → consultar → ver os horários → bloquear parte
// do dia → consultar de novo) roda na tela de verdade. A AUTORIZAÇÃO (acesso
// cruzado entre estabelecimentos) é atacada DIRETAMENTE na API: botão
// escondido não é controle de acesso.
//
// Orçamento de POST /auth/register: o rate limit real é 5 por 15 min por IP e
// este arquivo gasta 2 (fluxo + isolamento). Roda em invocação SEPARADA do
// Playwright, com backend novo e limiter zerado (ver
// .github/workflows/test-frontend-auth.yml).
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const BACKEND_URL = "http://localhost:3001";
const SENHA_TESTE = "senha-de-disponibilidade-e2e-123";

/** Domingo, bem no futuro: nenhum teste depende do dia em que roda. */
const DATA = "2026-09-20";
const WEEKDAY_DA_DATA = 0;

interface ContaCriada {
  email: string;
  senha: string;
}

async function criarConta(request: APIRequestContext, rotulo: string): Promise<ContaCriada> {
  const sufixo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `disponibilidade-${rotulo}-${sufixo}@example.test`;

  const resposta = await request.post(`${BACKEND_URL}/auth/register`, {
    data: {
      ownerName: `Dono ${rotulo}`,
      businessName: `Estabelecimento ${rotulo} ${sufixo}`,
      email,
      phone: "11977776666",
      password: SENHA_TESTE,
    },
  });
  expect(resposta.status(), await resposta.text()).toBe(201);

  return { email, senha: SENHA_TESTE };
}

async function entrar(page: Page, conta: ContaCriada): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(conta.email);
  await page.getByLabel("Senha").fill(conta.senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/conta$/);
}

async function tenantDe(pagina: Page): Promise<string> {
  const corpo = await pagina.evaluate(async () => {
    const r = await fetch("http://localhost:3001/auth/me", { credentials: "include" });
    return (await r.json()) as { activeContext: { tenantId: string } | null };
  });
  expect(corpo.activeContext).not.toBeNull();
  return corpo.activeContext!.tenantId;
}

/** Serviço e profissional pela API — as telas deles já são provadas em
 * services-flow/professionals-flow; aqui são só a fixture. */
async function criarServico(
  pagina: Page,
  tenantId: string,
  nome: string,
  durationMinutes: number,
): Promise<string> {
  return pagina.evaluate(
    async ({ tenantId, nome, durationMinutes }) => {
      const r = await fetch(`http://localhost:3001/tenants/${tenantId}/services`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nome,
          shortDescription: "",
          priceCents: null,
          priceVisible: true,
          durationMinutes,
          bufferAfterMinutes: 0,
          modality: "IN_PERSON",
          activeInPublicBooking: true,
          requiresManualConfirmation: false,
        }),
      });
      const corpo = (await r.json()) as { service: { id: string } };
      return corpo.service.id;
    },
    { tenantId, nome, durationMinutes },
  );
}

async function criarProfissional(
  pagina: Page,
  tenantId: string,
  nome: string,
  serviceIds: string[],
): Promise<string> {
  return pagina.evaluate(
    async ({ tenantId, nome, serviceIds }) => {
      const r = await fetch(`http://localhost:3001/tenants/${tenantId}/professionals`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nome, serviceIds }),
      });
      const corpo = (await r.json()) as { professional: { id: string } };
      return corpo.professional.id;
    },
    { tenantId, nome, serviceIds },
  );
}

async function definirJornada(
  pagina: Page,
  tenantId: string,
  professionalId: string,
  intervals: { start: string; end: string }[],
): Promise<void> {
  const status = await pagina.evaluate(
    async ({ tenantId, professionalId, intervals, weekday }) => {
      const r = await fetch(
        `http://localhost:3001/tenants/${tenantId}/professionals/${professionalId}/schedule`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ days: [{ weekday, intervals }] }),
        },
      );
      return r.status;
    },
    { tenantId, professionalId, intervals, weekday: WEEKDAY_DA_DATA },
  );
  expect(status).toBe(200);
}

async function horariosNaTela(pagina: Page): Promise<string[]> {
  return pagina.locator('[data-testid="horario"] .font-semibold').allTextContents();
}

test.describe("consulta real de disponibilidade", () => {
  test("jornada configurada vira horários reais na tela, no fuso do estabelecimento", async ({
    page,
    request,
  }) => {
    const conta = await criarConta(request, "fluxo");
    await entrar(page, conta);
    const tenantId = await tenantDe(page);

    const servicoId = await criarServico(page, tenantId, "Corte", 60);
    const profissionalId = await criarProfissional(page, tenantId, "Ana Souza", [servicoId]);

    // Sem jornada nenhuma: a tela precisa dizer POR QUE está vazio.
    await page.goto("/conta/profissionais");
    await page.getByRole("link", { name: "Disponibilidade de Ana Souza" }).click();
    await expect(page).toHaveURL(/\/conta\/profissionais\/[^/]+\/disponibilidade$/);

    // A tela afirma que consultar não reserva.
    await expect(page.getByText("não reserva horário")).toBeVisible();

    await page.getByLabel("Data").fill(DATA);
    await page.getByRole("button", { name: "Consultar horários" }).click();
    await expect(page.getByTestId("sem-horarios")).toContainText("não atende neste dia");

    // Agora com jornada: 09:00–12:00, serviço de 60 min, grade de 15 min.
    await definirJornada(page, tenantId, profissionalId, [{ start: "09:00", end: "12:00" }]);
    await page.getByRole("button", { name: "Consultar horários" }).click();

    // `expect.poll` (não uma leitura síncrona única): o container de
    // horários já existia visível de uma consulta anterior em outros pontos
    // deste teste, então `toBeVisible()` sozinho passaria mesmo antes do
    // clique terminar de buscar os dados NOVOS — só o poll espera o conteúdo
    // de verdade convergir para o que a nova consulta devolveu.
    await expect.poll(() => horariosNaTela(page)).toEqual([
      "09:00",
      "09:15",
      "09:30",
      "09:45",
      "10:00",
      "10:15",
      "10:30",
      "10:45",
      "11:00",
    ]);
    // O fuso vem do estabelecimento e é dito na tela, nunca o do navegador.
    await expect(page.getByText("America/Sao_Paulo")).toBeVisible();
    // As regras aplicadas são as que o servidor devolveu.
    await expect(page.getByText("Horários de 15 em 15 minutos")).toBeVisible();

    // O efeito de agendamentos e bloqueios JÁ GRAVADOS sobre a lista é
    // provado contra PostgreSQL real em
    // backend/test/availability-postgres.db-e2e-spec.ts. Aqui não é: este
    // lote não tem rota de gravação, e nenhuma seria inventada só para um
    // teste de navegador poder criar o conflito.

    // Mudar a seleção invalida o resultado na tela: ele é de outra consulta.
    await page.getByLabel("Data").fill("2026-09-21");
    await expect(page.getByTestId("horarios")).toHaveCount(0);

    // Consultar de novo a data original reproduz o mesmo resultado (consulta
    // é repetível e não muda nada no servidor).
    await page.getByLabel("Data").fill(DATA);
    await page.getByRole("button", { name: "Consultar horários" }).click();
    await expect.poll(() => horariosNaTela(page)).toHaveLength(9);

    // Jornada reduzida pela metade muda a lista — a tela lê o estado real.
    await definirJornada(page, tenantId, profissionalId, [{ start: "09:00", end: "10:00" }]);
    await page.getByRole("button", { name: "Consultar horários" }).click();
    await expect.poll(() => horariosNaTela(page)).toEqual(["09:00"]);

    // Data de calendário inexistente é recusada antes de virar consulta útil:
    // o backend responde 400 e a tela mostra a orientação dele.
    const resposta400 = await page.evaluate(
      async ({ tenantId, professionalId, servicoId }) => {
        const r = await fetch(
          `http://localhost:3001/tenants/${tenantId}/professionals/${professionalId}/availability?serviceId=${servicoId}&date=2026-02-30`,
          { credentials: "include" },
        );
        return r.status;
      },
      { tenantId, professionalId: profissionalId, servicoId },
    );
    expect(resposta400).toBe(400);
  });

  test("isolamento entre estabelecimentos, atacado direto na API com sessão válida", async ({
    browser,
    request,
  }) => {
    const contaA = await criarConta(request, "iso-a");
    const contaB = await criarConta(request, "iso-b");

    const contextoA = await browser.newContext();
    const contextoB = await browser.newContext();
    const paginaA = await contextoA.newPage();
    const paginaB = await contextoB.newPage();

    await entrar(paginaA, contaA);
    await entrar(paginaB, contaB);

    const tenantA = await tenantDe(paginaA);
    const tenantB = await tenantDe(paginaB);

    const servicoDeA = await criarServico(paginaA, tenantA, "Corte de A", 60);
    const profissionalDeA = await criarProfissional(paginaA, tenantA, "Profissional de A", [
      servicoDeA,
    ]);
    await definirJornada(paginaA, tenantA, profissionalDeA, [{ start: "09:00", end: "12:00" }]);

    const servicoDeB = await criarServico(paginaB, tenantB, "Corte de B", 60);
    const profissionalDeB = await criarProfissional(paginaB, tenantB, "Profissional de B", [
      servicoDeB,
    ]);

    // A consulta pela tela funciona para o dono.
    await paginaA.goto(`/conta/profissionais/${profissionalDeA}/disponibilidade`);
    await paginaA.getByLabel("Data").fill(DATA);
    await paginaA.getByRole("button", { name: "Consultar horários" }).click();
    await expect(paginaA.getByTestId("horarios")).toBeVisible();

    const comoB = async (caminho: string) =>
      paginaB.evaluate(
        async ({ caminho }) => {
          const r = await fetch(`http://localhost:3001${caminho}`, { credentials: "include" });
          return { status: r.status, texto: await r.text() };
        },
        { caminho },
      );

    const consulta = (tenantId: string, professionalId: string, serviceId: string, date = DATA) =>
      `/tenants/${tenantId}/professionals/${professionalId}/availability?serviceId=${serviceId}&date=${date}`;

    // 1. Consultar o profissional de A, pelo tenant de A: sem vínculo, 404 —
    // e nenhum horário de A vaza no corpo.
    const cruzada = await comoB(consulta(tenantA, profissionalDeA, servicoDeA));
    expect(cruzada.status).toBe(404);
    expect(cruzada.texto).not.toContain("09:00");

    // 2. Pelo PRÓPRIO tenant de B (vínculo existe, profissional é de outro).
    expect((await comoB(consulta(tenantB, profissionalDeA, servicoDeB))).status).toBe(404);

    // 3. Profissional de B com serviço de A: o serviço é de outro tenant.
    expect((await comoB(consulta(tenantB, profissionalDeB, servicoDeA))).status).toBe(404);

    // 4. Parâmetro desconhecido (tentativa de forjar o tenant na query) é
    // recusado pelo contrato `.strict()`, nunca ignorado em silêncio.
    expect(
      (await comoB(`${consulta(tenantB, profissionalDeB, servicoDeB)}&tenantId=${tenantA}`)).status,
    ).toBe(400);

    // 5. Nenhuma rota de gravação existe neste lote.
    const gravacao = await paginaB.evaluate(
      async ({ caminho }) => {
        const r = await fetch(`http://localhost:3001${caminho}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        return r.status;
      },
      { caminho: `/tenants/${tenantB}/professionals/${profissionalDeB}/availability` },
    );
    expect(gravacao).toBe(404);

    // A consulta de A continua funcionando e inalterada.
    await paginaA.reload();
    await paginaA.getByLabel("Data").fill(DATA);
    await paginaA.getByRole("button", { name: "Consultar horários" }).click();
    await expect(paginaA.getByTestId("horarios")).toBeVisible();

    // Sem sessão nenhuma, a API recusa antes de qualquer consulta.
    const semSessao = await browser.newContext();
    const paginaAnonima = await semSessao.newPage();
    await paginaAnonima.goto("/login");
    const anonimo = await paginaAnonima.evaluate(
      async ({ caminho }) => {
        const r = await fetch(`http://localhost:3001${caminho}`, { credentials: "include" });
        return r.status;
      },
      { caminho: consulta(tenantA, profissionalDeA, servicoDeA) },
    );
    expect(anonimo).toBe(401);

    await semSessao.close();
    await contextoA.close();
    await contextoB.close();
  });
});
