// Equipe e acessos de ponta a ponta, pela tela, contra o backend real, o
// PostgreSQL DESCARTÁVEL e a caixa de e-mail LOCAL (nada sai da máquina).
//
// 1. O dono cria o acesso da funcionária (perfil Profissional, ligada à
//    profissional Ana) com login e a senha que ele escolhe, sem convite nem
//    e-mail; ela entra com essa senha, sem troca obrigatória, na agenda DELA.
// 2. A funcionária vê só os próprios atendimentos (cliente, serviço,
//    situação), com o menu reduzido; páginas do dono pelo endereço levam à
//    agenda dela; a API recusa a agenda geral, a equipe e a reserva do colega
//    (também de um segundo funcionário, que entra por um convite por e-mail
//    do fluxo anterior: os convites antigos continuam valendo).
// 3. O dono libera "Iniciar" (pede a senha) e a funcionária inicia o próprio
//    atendimento; a permissão retirada vale na próxima ação dela, com a sessão
//    aberta. Suspender corta o acesso; reativar devolve.
// 4. A administração (MASTER_OWNER) vê uso e vagas, suspende e reativa o
//    estabelecimento, e o plano menor aparece como "não comporta" e é
//    recusado pela API.
// 5. Capturas em claro e escuro, 1280, 390 e 360 px, sem rolagem horizontal.
//
// Invocação própria (`npm run test:browser:equipe`): usa 1 aceite de
// convite (limite de 10 por 15 minutos por IP) e 1 login.
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { API_DE_TESTE, conectarBancoDeTeste, criarContaDeTeste } from "./support/contas-de-teste";

const CAIXA = "http://127.0.0.1:3025";
const SENHA_DONO = "senha-do-dono-da-equipe-1";
const SENHA_FUNCIONARIA = "senha-da-funcionaria-ana-1";
const id = () => randomUUID().replaceAll("-", "").slice(0, 10);

async function linkDoConvite(api: APIRequestContext, email: string): Promise<string> {
  let link = "";
  await expect
    .poll(async () => {
      const mensagens = (await (await api.get(`${CAIXA}/mensagens?para=${encodeURIComponent(email)}`)).json()) as {
        texto: string;
      }[];
      link = /(http:\/\/localhost:3000\/convite#t=[0-9a-f]{64})/.exec(mensagens.at(-1)?.texto ?? "")?.[1] ?? "";
      return link !== "";
    })
    .toBe(true);
  return link;
}

async function semRolagemHorizontal(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function capturar(page: Page, nome: string) {
  for (const tema of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: tema });
    for (const width of [1280, 390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await semRolagemHorizontal(page);
      await page.screenshot({ path: test.info().outputPath(`equipe-${nome}-${tema}-${width}.png`), fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 844 });
}

/** O pedido de senha só aparece depois da resposta do servidor (403
 * REAUTENTICACAO_NECESSARIA): espera um pouco por ele antes de seguir. */
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

/** Início de uma reserva "hoje" no fuso do estabelecimento que já pode ser
 * iniciada (a partir de 30 minutos antes), sem cruzar a meia-noite local. */
function inicioDeHoje(): Date {
  const agora = Date.now();
  const horaLocal = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(agora),
  );
  return new Date(horaLocal >= 23 ? agora - 30 * 60_000 : agora + 20 * 60_000);
}

async function novaPagina(browser: Browser) {
  const contexto = await browser.newContext();
  return { contexto, page: await contexto.newPage() };
}

test("dono cria acesso, funcionária vê só a própria agenda, permissões e suspensão valem na hora; administração do plano", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  const marca = `equipe-${id()}`;
  const db = await conectarBancoDeTeste();
  const main = page.getByRole("main");
  try {
    // ------------------------------------------------------------- cenário
    const dono = await criarContaDeTeste(page.request, {
      ownerName: "Dona da Equipe",
      businessName: `${marca} Estúdio`,
      email: `${marca}-dona@example.test`,
      password: SENHA_DONO,
    });
    const tenantId = dono.tenant.id;
    const profissionais: Record<string, string> = {};
    for (const nome of ["Ana Lima", "Bruno Reis"]) {
      const r = await page.request.post(`${API_DE_TESTE}/tenants/${tenantId}/professionals`, {
        data: { name: nome, serviceIds: [] },
      });
      expect(r.status(), await r.text()).toBe(201);
      profissionais[nome] = ((await r.json()) as { professional: { id: string } }).professional.id;
    }
    const ids = { service: id(), consumer: id(), consumer2: id(), daAna: id(), doBruno: id() };
    await db.query(
      `INSERT INTO services (id, tenant_id, name, short_description, duration_minutes, price_cents) VALUES ($1, $2, 'Corte de cabelo', '', 30, 4500)`,
      [ids.service, tenantId],
    );
    for (const [consumer, nome] of [
      [ids.consumer, "Cliente da Ana"],
      [ids.consumer2, "Cliente do Bruno"],
    ]) {
      await db.query(
        `INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ($1, $2, $3, '(11) 98888-7777', $4)`,
        [consumer, tenantId, nome, `5511${Math.floor(Math.random() * 1e9)}`],
      );
    }
    const inicio = inicioDeHoje();
    for (const [appointment, professional, consumer, nome] of [
      [ids.daAna, profissionais["Ana Lima"], ids.consumer, "Cliente da Ana"],
      [ids.doBruno, profissionais["Bruno Reis"], ids.consumer2, "Cliente do Bruno"],
    ]) {
      await db.query(
        `INSERT INTO appointments (id, tenant_id, unit_id, consumer_id, consumer_name_snapshot, consumer_whatsapp_snapshot,
            professional_id, start_at, end_at, status, notes)
         VALUES ($1, $2, $3, $4, $5, '(11) 98888-7777', $6, $7, $8, 'CONFIRMED', 'observação só do dono')`,
        [appointment, tenantId, dono.unit.id, consumer, nome, professional, inicio, new Date(inicio.getTime() + 30 * 60_000)],
      );
      await db.query(
        `INSERT INTO appointment_items (id, tenant_id, appointment_id, service_id, duration_minutes_snapshot, price_cents_snapshot)
         VALUES ($1, $2, $3, $4, 30, 4500)`,
        [id(), tenantId, appointment, ids.service],
      );
    }

    // ------------------------------------- 1. acesso criado pela equipe
    await page.goto("/conta/configuracoes/equipe");
    await expect(main.getByRole("heading", { name: "Equipe e acessos" })).toBeVisible();
    await expect(page.getByTestId("vagas-equipe")).toHaveText("0 de 5 em uso (0 ativos)");
    // O fluxo principal não convida por e-mail.
    await expect(main.getByRole("button", { name: /Convidar/ })).toHaveCount(0);
    await page.getByTestId("profissional-sem-acesso").filter({ hasText: "Ana Lima" }).getByRole("button", { name: /Criar acesso/ }).click();
    const formulario = page.getByTestId("criar-acesso");
    await formulario.getByLabel("Login").fill(`ana@${marca}`);
    await formulario.getByLabel("Senha", { exact: true }).fill(SENHA_FUNCIONARIA);
    await formulario.getByLabel("Confirmar senha").fill(SENHA_FUNCIONARIA);
    await capturar(page, "criar-acesso-profissional");
    await formulario.getByRole("button", { name: "Criar acesso" }).click();
    await confirmarSenhaSePedir(page, SENHA_DONO);
    await page.getByTestId("acesso-criado").getByRole("button", { name: "Concluir" }).click();
    const ana = page.getByTestId("acesso-equipe").filter({ hasText: "Ana Lima" });
    await expect(ana.getByTestId("situacao-acesso")).toHaveText("Acesso ativo");
    await expect(page.getByTestId("vagas-equipe")).toHaveText("1 de 5 em uso (1 ativo)");

    const funcionaria = await novaPagina(browser);
    const fp = funcionaria.page;
    await fp.goto("/login");
    await fp.getByLabel("E-mail ou login").fill(`ana@${marca}`);
    await fp.getByLabel("Senha", { exact: true }).fill(SENHA_FUNCIONARIA);
    await fp.getByRole("button", { name: "Entrar" }).click();
    // Senha definida pelo dono: direto na agenda, sem troca obrigatória.
    await expect(fp).toHaveURL(/\/conta\/minha-agenda$/);

    // --------------------------------- 2. só a própria agenda, menu reduzido
    const lista = fp.getByTestId("minha-agenda");
    await expect(lista.getByTestId("atendimento-proprio")).toHaveCount(1);
    await expect(lista).toContainText("Cliente da Ana");
    await expect(lista).toContainText("Corte de cabelo");
    await expect(lista).toContainText("Confirmado");
    await expect(fp.getByRole("main")).not.toContainText("Cliente do Bruno");
    await expect(fp.getByRole("main")).not.toContainText("observação só do dono");
    await expect(fp.getByRole("main")).not.toContainText("98888");
    await expect(lista.getByRole("button")).toHaveCount(0);
    const navFuncionaria = fp.getByRole("navigation", { name: "Áreas da conta" });
    await expect(navFuncionaria.getByRole("link")).toHaveText(["Minha agenda", "Configurações"]);
    await expect(fp.getByTestId("sino-notificacoes")).toHaveCount(0);
    await capturar(fp, "minha-agenda");
    for (const caminho of ["/conta/agendamentos", "/conta/agendamentos/solicitacoes", "/conta/clientes", "/conta/visao-geral"]) {
      await fp.goto(caminho);
      await expect(fp).toHaveURL(/\/conta\/minha-agenda$/);
    }
    // Configurações do estabelecimento levam às pessoais; só Aparência e
    // Perfil e segurança aparecem para o funcionário.
    for (const caminho of [
      "/conta/configuracoes/equipe",
      "/conta/configuracoes/servicos",
      "/conta/configuracoes/profissionais",
      "/conta/configuracoes/notificacoes",
    ]) {
      await fp.goto(caminho);
      await expect(fp).toHaveURL(/\/conta\/configuracoes$/);
    }
    expect(
      await fp.getByTestId("secoes-configuracoes").getByRole("link").evaluateAll((l) => l.map((a) => a.getAttribute("href"))),
    ).toEqual(["/conta/configuracoes/aparencia", "/conta/configuracoes/perfil"]);
    // O submenu de Configurações (computador) mostra só as mesmas duas.
    await navFuncionaria.getByRole("link", { name: "Configurações" }).hover();
    await expect(fp.getByTestId("submenu-configuracoes").getByRole("link")).toHaveText(["Aparência", "Perfil e segurança"]);
    await fp.mouse.move(900, 600);
    await fp.goto("/conta/minha-agenda");
    const data = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(inicio);
    const api = fp.request;
    expect((await api.get(`${API_DE_TESTE}/tenants/${tenantId}/appointments?date=${data}`)).status()).toBe(403);
    expect((await api.get(`${API_DE_TESTE}/tenants/${tenantId}/team`)).status()).toBe(403);
    expect((await api.get(`${API_DE_TESTE}/tenants/${tenantId}/booking-requests`)).status()).toBe(403);
    expect((await api.get(`${API_DE_TESTE}/tenants/${tenantId}/consumers?q=Cliente`)).status()).toBeGreaterThanOrEqual(400);
    // Rotas novas da operação do dono também recusam o funcionário; o
    // calendário dele traz só os próprios atendimentos.
    expect((await api.get(`${API_DE_TESTE}/tenants/${tenantId}/consumers/page`)).status()).toBe(403);
    expect((await api.get(`${API_DE_TESTE}/tenants/${tenantId}/dashboard`)).status()).toBe(403);
    expect((await api.get(`${API_DE_TESTE}/tenants/${tenantId}/appointments/range?from=${data}&to=${data}`)).status()).toBe(
      403,
    );
    const periodoProprio = await api.get(`${API_DE_TESTE}/tenants/${tenantId}/my-agenda/range?from=${data}&to=${data}`);
    expect(periodoProprio.status()).toBe(200);
    const corpoProprio = (await periodoProprio.json()) as { appointments: { consumer: { name: string } }[] };
    expect(corpoProprio.appointments.map((a) => a.consumer.name)).toEqual(["Cliente da Ana"]);
    expect(
      (
        await api.get(
          `${API_DE_TESTE}/tenants/${tenantId}/my-agenda?date=${data}&professionalId=${profissionais["Bruno Reis"]}`,
        )
      ).status(),
    ).toBe(400);
    expect(
      (await api.post(`${API_DE_TESTE}/tenants/${tenantId}/my-agenda/${ids.doBruno}/start`, {
        data: { expectedStartAt: inicio.toISOString() },
      })).status(),
    ).toBe(403);

    // Segundo funcionário (Bruno), por um convite por e-mail do fluxo
    // anterior, aceito pela API: o convite antigo aparece, ocupa vaga e
    // continua valendo; cada um só alcança o seu.
    const conviteBruno = await page.request.post(`${API_DE_TESTE}/tenants/${tenantId}/team/invites`, {
      data: { requestKey: `chave-${id()}-bruno`, professionalId: profissionais["Bruno Reis"], name: "Bruno Reis", email: `${marca}-bruno@example.test` },
    });
    expect(conviteBruno.status(), await conviteBruno.text()).toBe(200);
    await page.goto("/conta/configuracoes/equipe");
    await expect(page.getByTestId("convite-antigo").filter({ hasText: "Bruno Reis" })).toContainText("Convite pendente");
    await expect(page.getByTestId("vagas-equipe")).toHaveText("2 de 5 em uso (1 ativo, 1 convite pendente)");
    const bruno = await novaPagina(browser);
    const token = /#t=([0-9a-f]{64})/.exec(await linkDoConvite(request, `${marca}-bruno@example.test`))![1];
    expect((await bruno.page.request.post(`${API_DE_TESTE}/invites/accept`, { data: { token, password: "senha-do-bruno-12" } })).status()).toBe(200);
    const agendaBruno = (await (await bruno.page.request.get(`${API_DE_TESTE}/tenants/${tenantId}/my-agenda?date=${data}`)).json()) as {
      appointments: { id: string }[];
    };
    expect(agendaBruno.appointments.map((a) => a.id)).toEqual([ids.doBruno]);
    await db.query(
      `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode)
       SELECT $1, m.tenant_id, m.id, 'ATENDIMENTO_PROPRIO_CONCLUIR', 'GRANTED' FROM memberships m
        JOIN users u ON u.id = m.user_id WHERE u.email = $2`,
      [id(), `${marca}-bruno@example.test`],
    );
    expect(
      (await bruno.page.request.post(`${API_DE_TESTE}/tenants/${tenantId}/my-agenda/${ids.daAna}/complete`, {
        data: { expectedStartAt: inicio.toISOString() },
      })).status(),
    ).toBe(404);
    await bruno.contexto.close();

    // ------------------- 3. permissão liberada, retirada e acesso suspenso
    await page.goto("/conta/configuracoes/equipe");
    await expect(page.getByTestId("vagas-equipe")).toHaveText("2 de 5 em uso (2 ativos)");
    await expect(page.getByTestId("convite-antigo")).toHaveCount(0);
    await expect(ana.getByTestId("situacao-acesso")).toHaveText("Acesso ativo");
    await ana.getByRole("button", { name: "Editar permissões" }).click();
    await ana.getByLabel("Iniciar os próprios atendimentos").check();
    await ana.getByRole("button", { name: "Salvar permissões" }).click();
    // A senha do dono foi confirmada há pouco, na criação do acesso.
    await confirmarSenhaSePedir(page, SENHA_DONO);
    await expect(ana.getByTestId("permissoes-efetivas")).toContainText("iniciar os próprios atendimentos");
    await capturar(page, "lista");

    await fp.goto("/conta/minha-agenda");
    await expect(fp.getByTestId("minhas-permissoes")).toContainText("Iniciar os seus atendimentos.");
    await lista.getByRole("button", { name: "Iniciar atendimento" }).click();
    await fp.getByRole("button", { name: "Confirmar" }).click();
    await expect(lista).toContainText("Em atendimento");
    const [estado] = (await db.query("SELECT status::text FROM appointments WHERE id = $1", [ids.daAna])).rows;
    expect(estado.status).toBe("IN_PROGRESS");

    // Retirada com a sessão dela aberta: a próxima ação já é recusada.
    await ana.getByRole("button", { name: "Editar permissões" }).click();
    await ana.getByLabel("Iniciar os próprios atendimentos").uncheck();
    await ana.getByRole("button", { name: "Salvar permissões" }).click();
    await confirmarSenhaSePedir(page, SENHA_DONO);
    await expect(ana.getByTestId("permissoes-efetivas")).toHaveText("Ver a própria agenda.");
    expect(
      (await api.post(`${API_DE_TESTE}/tenants/${tenantId}/my-agenda/${ids.daAna}/complete`, {
        data: { expectedStartAt: inicio.toISOString() },
      })).status(),
    ).toBe(403);

    await ana.getByRole("button", { name: "Suspender acesso" }).click();
    await expect(page.getByRole("dialog")).toContainText("acesso a outros estabelecimentos continuam");
    await page.getByRole("dialog").getByRole("button", { name: "Suspender acesso" }).click();
    await confirmarSenhaSePedir(page, SENHA_DONO);
    await expect(ana.getByTestId("situacao-acesso")).toHaveText("Acesso suspenso");
    await expect(page.getByTestId("vagas-equipe")).toHaveText("1 de 5 em uso (1 ativo)");
    await fp.getByRole("button", { name: "Atualizar" }).click();
    await expect(fp.getByRole("main").getByRole("alert")).toContainText("não está disponível agora");
    await fp.reload();
    // Sem estabelecimento ativo, a funcionária fica nas configurações
    // pessoais, com o aviso.
    await expect(fp).toHaveURL(/\/conta\/configuracoes$/);
    await expect(fp.getByRole("main")).toContainText("não tem acesso ativo a um estabelecimento");

    await ana.getByRole("button", { name: "Reativar acesso" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reativar acesso" }).click();
    await confirmarSenhaSePedir(page, SENHA_DONO);
    await expect(ana.getByTestId("situacao-acesso")).toHaveText("Acesso ativo");
    await fp.goto("/conta/minha-agenda");
    await expect(lista).toContainText("Cliente da Ana");
    await funcionaria.contexto.close();

    // ------------------------------------- 4. administração da plataforma
    const admin = await novaPagina(browser);
    const ap = admin.page;
    const conta = await criarContaDeTeste(ap.request, {
      ownerName: "Pessoa da Plataforma",
      businessName: `${marca} Sede da Plataforma`,
      email: `${marca}-master@example.test`,
      password: "senha-da-plataforma-123",
    });
    await db.query("UPDATE users SET platform_role = 'MASTER_OWNER' WHERE id = $1", [conta.user.id]);
    await ap.goto(`/conta/administracao/estabelecimentos/${tenantId}`);
    await expect(ap.getByTestId("uso-vagas")).toContainText("2 de 5");
    // Um terceiro profissional ativo: o plano Essencial (2) não comporta.
    await db.query(
      `INSERT INTO professionals (id, tenant_id, name, avatar_initials, avatar_color) VALUES ($1, $2, 'Carla Dias', 'CD', '#000000')`,
      [id(), tenantId],
    );
    await ap.reload();
    const essencial = ap.getByTestId("plano-estabelecimento").getByRole("listitem").filter({ hasText: "Essencial" });
    await expect(essencial).toContainText("Não comporta o uso atual");
    await essencial.getByRole("radio").check();
    await expect(ap.getByRole("button", { name: "Trocar para Essencial" })).toBeDisabled();
    const ficha = (await (await ap.request.get(`${API_DE_TESTE}/platform/establishments/${tenantId}`)).json()) as {
      updatedAt: string;
      planOptions: { id: string; code: string }[];
    };
    const recusa = await ap.request.put(`${API_DE_TESTE}/platform/establishments/${tenantId}/plan`, {
      data: { expectedUpdatedAt: ficha.updatedAt, planId: ficha.planOptions.find((p) => p.code === "essencial")!.id },
    });
    expect([403, 409]).toContain(recusa.status()); // sem reautenticação: 403; com ela, o excesso: 409
    await capturar(ap, "ficha-administracao");

    await ap.getByRole("button", { name: "Suspender", exact: true }).click();
    await expect(ap.getByRole("dialog")).toContainText("Nada é apagado");
    await ap.getByLabel("Motivo (fica no histórico)").fill("Pedido do responsável");
    await ap.getByRole("dialog").getByRole("button", { name: "Suspender" }).click();
    await expect(ap.getByTestId("confirmar-senha")).toBeVisible();
    await ap.getByLabel("Sua senha", { exact: true }).fill("senha-da-plataforma-123");
    await ap.getByRole("button", { name: "Confirmar", exact: true }).click();
    await expect(ap.getByTestId("situacao-estabelecimento")).toContainText("Suspenso");
    await expect(ap.getByTestId("situacao-estabelecimento")).toContainText("Pedido do responsável");
    // Com o estabelecimento suspenso, a operação do dono para.
    expect((await page.request.get(`${API_DE_TESTE}/tenants/${tenantId}/team`)).status()).toBe(404);
    const comExcesso = await ap.request.put(`${API_DE_TESTE}/platform/establishments/${tenantId}/plan`, {
      data: {
        expectedUpdatedAt: ((await (await ap.request.get(`${API_DE_TESTE}/platform/establishments/${tenantId}`)).json()) as { updatedAt: string }).updatedAt,
        planId: ficha.planOptions.find((p) => p.code === "essencial")!.id,
      },
    });
    expect(comExcesso.status()).toBe(409);
    expect(((await comExcesso.json()) as { code: string }).code).toBe("PLANO_EXCEDIDO");

    await ap.getByRole("button", { name: "Reativar", exact: true }).click();
    await ap.getByRole("dialog").getByRole("button", { name: "Reativar" }).click();
    await confirmarSenhaSePedir(ap, "senha-da-plataforma-123");
    await expect(ap.getByTestId("situacao-estabelecimento")).toContainText("Em teste");
    expect((await page.request.get(`${API_DE_TESTE}/tenants/${tenantId}/team`)).status()).toBe(200);
    const historico = (
      await db.query(`SELECT action::text FROM audit_logs WHERE tenant_id = $1 ORDER BY occurred_at`, [tenantId])
    ).rows.map((r: { action: string }) => r.action);
    expect(historico).toEqual(
      expect.arrayContaining([
        "STAFF_ACCESS_CREATED",
        "USER_INVITED",
        "INVITE_ACCEPTED",
        "USER_PERMISSION_CHANGED",
        "MEMBERSHIP_SUSPENDED",
        "MEMBERSHIP_REACTIVATED",
        "TENANT_SUSPENDED",
        "TENANT_REACTIVATED",
      ]),
    );
    await admin.contexto.close();
  } finally {
    await db.end();
  }
});
