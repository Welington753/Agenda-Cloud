// Teste de navegador da tela de Clientes (`/conta/clientes`) — contra o
// backend real e um PostgreSQL descartável (nunca Neon/produção).
//
// Prova pela TELA: orientação antes da busca, carregamento, nenhum
// resultado, falha de comunicação, resposta antiga descartada, aviso de
// resultado limitado, cadastro com bloqueio de envio repetido, persistência
// após recarregar, duplicidade sem sobrescrever, resultado incerto sem
// reenvio, falha só da leitura após cadastro confirmado, o cliente achado no
// seletor de "Novo agendamento", troca de estabelecimento sem sobra e a
// navegação em computador e celular.
//
// Prova pela API (botão escondido não é controle de acesso): o dono de outro
// estabelecimento não lê nem grava clientes deste.
//
// As requisições retidas com `page.route` continuam indo ao backend real; só
// o ROMPIMENTO de conexão (`route.abort`) é simulado, porque não há outro
// jeito de perder uma resposta de propósito.
//
// Orçamento de POST /auth/register: 2 de 5 (rate limit real por IP). Roda em
// invocação própria do Playwright (`npm run test:browser:clients`).
import { expect, test, type APIRequestContext, type Page, type Route } from "@playwright/test";
import { Client } from "pg";

const BACKEND_URL = "http://localhost:3001";
const SENHA = "senha-de-clientes-e2e-123";
const COMPUTADOR = { width: 1280, height: 720 };
const CELULAR = { width: 390, height: 844 };
const CELULAR_ESTREITO = { width: 360, height: 740 };

/** Fixture direto no banco descartável: recusa qualquer host fora do loopback. */
async function noBancoDescartavel(sql: string, valores: unknown[]): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL ausente: este teste só roda no ambiente descartável.");
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`recusado: ${host} não é o PostgreSQL descartável local`);
  }
  const cliente = new Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
  await cliente.connect();
  try {
    await cliente.query(sql, valores);
  } finally {
    await cliente.end();
  }
}

async function chamar<T>(api: APIRequestContext, metodo: string, caminho: string, corpo?: unknown) {
  const resposta = await api.fetch(`${BACKEND_URL}${caminho}`, { method: metodo, data: corpo });
  const texto = await resposta.text();
  return { status: resposta.status(), corpo: (texto ? JSON.parse(texto) : null) as T };
}

/** Cadastra pela API e deixa `api` autenticado como o novo dono. */
async function cadastrar(api: APIRequestContext, rotulo: string) {
  const sufixo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dados = {
    ownerName: `Dona ${rotulo}`,
    businessName: `Estúdio Clientes ${rotulo} ${sufixo}`,
    email: `clientes-${rotulo.toLowerCase()}-${sufixo}@example.test`,
    phone: "11977772222",
    password: SENHA,
  };
  const r = await api.post(`${BACKEND_URL}/auth/register`, { data: dados });
  expect(r.status(), await r.text()).toBe(201);
  const me = await chamar<{ user: { id: string }; activeContext: { tenantId: string } }>(
    api,
    "GET",
    "/auth/me",
  );
  return { ...dados, userId: me.corpo.user.id, tenantId: me.corpo.activeContext.tenantId };
}

async function entrar(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Áreas da conta" });

async function semRolagemHorizontal(page: Page) {
  const larguras = await page.evaluate(() => ({
    conteudo: document.documentElement.scrollWidth,
    tela: window.innerWidth,
  }));
  expect(larguras.conteudo).toBeLessThanOrEqual(larguras.tela);
}

async function buscar(page: Page, termo: string) {
  await page.getByLabel("Buscar cliente").fill(termo);
  await page.getByRole("search").getByRole("button", { name: "Buscar" }).click();
}

const ehBusca = (url: URL) => /\/tenants\/[^/]+\/consumers$/.test(url.pathname) && url.searchParams.has("q");
const ehCadastro = (route: Route) =>
  route.request().method() === "POST" && /\/tenants\/[^/]+\/consumers$/.test(new URL(route.request().url()).pathname);

test.describe("clientes do estabelecimento", () => {
  test("buscar, cadastrar, duplicidade, incerteza e o cliente no seletor da agenda", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(COMPUTADOR);
    const a = await cadastrar(request, "A");
    const sufixo = Date.now().toString().slice(-6);
    const nomeMaria = `Maria Teste ${sufixo}`;
    const whatsMaria = `(11) 9${sufixo.slice(0, 4)}-${sufixo.slice(2, 6)}`;

    await entrar(page, a.email);
    await expect(page).toHaveURL(/\/conta\/visao-geral$/);
    await nav(page).getByRole("link", { name: "Clientes" }).click();
    await expect(page).toHaveURL(/\/conta\/clientes$/);
    await expect(nav(page).getByRole("link", { name: "Clientes" })).toHaveAttribute("aria-current", "page");

    // Orientação antes de pesquisar — nunca uma "lista de todos".
    await expect(page.getByText("Pesquise para encontrar um cliente")).toBeVisible();
    await expect(page.getByText(/A lista completa não é exibida/)).toBeVisible();
    await expect(page.getByRole("search").getByRole("button", { name: "Buscar" })).toBeDisabled();

    // Nenhum resultado.
    await buscar(page, "Ninguém Existe");
    await expect(page.getByTestId("clientes-nenhum")).toContainText("Nenhum cliente encontrado");

    // ------------------------------------------------ validação no cliente
    let posts = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && /\/consumers$/.test(new URL(req.url()).pathname)) posts += 1;
    });
    await page.getByRole("button", { name: "Novo cliente" }).click();
    await page.getByRole("button", { name: "Cadastrar cliente" }).click();
    await expect(page.getByText("Informe o nome do cliente.")).toBeVisible();
    await expect(page.getByText("Informe o WhatsApp do cliente.")).toBeVisible();
    await page.getByLabel("WhatsApp").fill("123");
    await page.getByLabel("E-mail (opcional)").fill("maria@");
    await page.getByRole("button", { name: "Cadastrar cliente" }).click();
    await expect(page.getByText("Informe um telefone válido com DDD.")).toBeVisible();
    await expect(page.getByText("Informe um e-mail válido.")).toBeVisible();
    expect(posts, "formulário inválido nunca chega na API").toBe(0);

    // ------------------------------------------------ cadastro com envio retido: um POST só
    await page.getByLabel("Nome do cliente").fill(nomeMaria);
    await page.getByLabel("WhatsApp").fill(whatsMaria);
    await page.getByLabel("E-mail (opcional)").fill("maria@example.test");
    const postRetido = Promise.withResolvers<void>();
    const liberarPost = Promise.withResolvers<void>();
    await page.route(
      (url) => /\/consumers$/.test(url.pathname),
      async (rota) => {
        if (ehCadastro(rota)) {
          postRetido.resolve();
          await liberarPost.promise;
        }
        await rota.continue();
      },
    );
    const enviar = page.getByRole("button", { name: "Cadastrar cliente" });
    await enviar.click();
    await postRetido.promise;
    await expect(page.getByRole("button", { name: "Cadastrando..." })).toBeDisabled();
    await page.getByRole("button", { name: "Cadastrando..." }).click({ force: true });
    liberarPost.resolve();
    await expect(page.getByTestId("cliente-cadastrado")).toContainText(`Cliente ${nomeMaria} cadastrado.`);
    await page.unrouteAll({ behavior: "wait" });
    expect(posts, "dois cliques com envio em voo viram um POST só").toBe(1);
    // Depois do cadastro, a busca pelo WhatsApp mostra o cliente.
    await expect(page.getByTestId("lista-clientes")).toContainText(nomeMaria);
    await expect(page.getByTestId("lista-clientes")).toContainText("maria@example.test");

    // ------------------------------------------------ persistido: recarregar e pesquisar
    await page.reload();
    await expect(page.getByText("Pesquise para encontrar um cliente")).toBeVisible();
    await buscar(page, `Teste ${sufixo}`);
    await expect(page.getByTestId("lista-clientes").getByRole("listitem")).toHaveCount(1);
    await expect(page.getByTestId("lista-clientes")).toContainText(nomeMaria);
    // Pelo telefone normalizado, digitado de outro jeito.
    await buscar(page, whatsMaria.replace(/\D/g, ""));
    await expect(page.getByTestId("lista-clientes")).toContainText(nomeMaria);

    // ------------------------------------------------ duplicidade: nada sobrescrito
    await page.getByRole("button", { name: "Novo cliente" }).click();
    await page.getByLabel("Nome do cliente").fill("Nome Sobrescrito");
    await page.getByLabel("WhatsApp").fill(`+55 ${whatsMaria}`);
    await page.getByRole("button", { name: "Cadastrar cliente" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Já existe um cliente com este WhatsApp");
    expect(posts).toBe(2);
    await expect(page.getByLabel("Nome do cliente")).toHaveValue("Nome Sobrescrito");
    await page.getByRole("button", { name: "Pesquisar este WhatsApp" }).click();
    await expect(page.getByTestId("lista-clientes")).toContainText(nomeMaria);
    await expect(page.getByTestId("lista-clientes")).not.toContainText("Nome Sobrescrito");

    // ------------------------------------------------ resposta perdida: incerto, sem reenvio
    await page.route(
      (url) => /\/consumers$/.test(url.pathname),
      async (rota) => (ehCadastro(rota) ? rota.abort("connectionreset") : rota.continue()),
    );
    await page.getByLabel("Nome do cliente").fill("Cliente Incerto");
    await page.getByLabel("WhatsApp").fill("(11) 98888-7777");
    await page.getByRole("button", { name: "Cadastrar cliente" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("O cliente pode ter sido cadastrado");
    await page.unrouteAll({ behavior: "wait" });
    await expect(page.getByRole("button", { name: "Pesquisar este WhatsApp" })).toBeVisible();
    expect(posts, "nenhum reenvio automático").toBe(3);
    await page.getByRole("button", { name: "Pesquisar este WhatsApp" }).click();
    await expect(page.getByTestId("clientes-nenhum")).toBeVisible();
    await page.getByRole("button", { name: "Cancelar" }).click();

    // ------------------------------------------------ cadastro ok, leitura falha: só a leitura repete
    const nomeJoao = `João Leitura ${sufixo}`;
    let leituraFalhou = false;
    await page.route(
      (url) => ehBusca(url),
      async (rota) => {
        if (!leituraFalhou) {
          leituraFalhou = true;
          return rota.abort("connectionreset");
        }
        return rota.continue();
      },
    );
    await page.getByRole("button", { name: "Novo cliente" }).click();
    await page.getByLabel("Nome do cliente").fill(nomeJoao);
    await page.getByLabel("WhatsApp").fill("(21) 97777-6666");
    await page.getByRole("button", { name: "Cadastrar cliente" }).click();
    await expect(page.getByTestId("cliente-cadastrado")).toContainText(`Cliente ${nomeJoao} cadastrado.`);
    await expect(page.getByTestId("clientes-falha")).toContainText("Não foi possível falar com o servidor");
    await page.getByRole("button", { name: "Tentar novamente" }).click();
    await expect(page.getByTestId("lista-clientes")).toContainText(nomeJoao);
    await expect(page.getByTestId("cliente-cadastrado")).toBeVisible();
    await page.unrouteAll({ behavior: "wait" });
    expect(posts, "Tentar novamente repete a leitura, nunca o cadastro").toBe(4);

    // ------------------------------------------------ carregando + resposta antiga descartada
    // A busca antiga fica retida até a nova terminar; depois segue ao backend
    // real. A tela aborta a antiga ao pesquisar de novo, então a entrega pode
    // falhar — o que importa é que ela nunca troque o resultado da nova.
    const antigaRetida = Promise.withResolvers<void>();
    const liberarAntiga = Promise.withResolvers<void>();
    const antigaEntregue = Promise.withResolvers<void>();
    await page.route(
      (url) => ehBusca(url) && url.searchParams.get("q") === nomeMaria,
      async (rota) => {
        antigaRetida.resolve();
        await liberarAntiga.promise;
        await rota.continue().catch(() => undefined);
        antigaEntregue.resolve();
      },
    );
    await buscar(page, nomeMaria);
    await antigaRetida.promise;
    await expect(page.getByTestId("clientes-buscando")).toContainText(`Buscando “${nomeMaria}”`);
    await buscar(page, nomeJoao);
    await expect(page.getByTestId("lista-clientes")).toContainText(nomeJoao);
    liberarAntiga.resolve();
    await antigaEntregue.promise;
    await page.unrouteAll({ behavior: "wait" });
    await expect(page.getByTestId("lista-clientes")).toContainText(nomeJoao);
    await expect(page.getByTestId("lista-clientes")).not.toContainText(nomeMaria);

    // ------------------------------------------------ teto da busca é anunciado
    const prefixo = `Lote ${sufixo}`;
    for (let i = 0; i < 21; i += 1) {
      const r = await chamar(request, "POST", `/tenants/${a.tenantId}/consumers`, {
        name: `${prefixo} ${String(i).padStart(2, "0")}`,
        whatsapp: `(31) 9${sufixo.slice(0, 2)}${String(i).padStart(2, "0")}-${sufixo.slice(2, 6)}`,
      });
      expect(r.status).toBe(201);
    }
    await buscar(page, prefixo);
    await expect(page.getByTestId("lista-clientes").getByRole("listitem")).toHaveCount(20);
    await expect(page.getByTestId("clientes-limite")).toContainText("Mostrando os primeiros 20");
    await expect(page.getByText("20 clientes encontrados")).toBeVisible();

    // ------------------------------------------------ o cliente aparece no seletor da agenda
    const servico = await chamar<{ service: { id: string } }>(request, "POST", `/tenants/${a.tenantId}/services`, {
      name: "Corte",
      shortDescription: "",
      priceCents: 5000,
      priceVisible: true,
      durationMinutes: 30,
      bufferAfterMinutes: 0,
      modality: "IN_PERSON",
      activeInPublicBooking: true,
      requiresManualConfirmation: false,
    });
    expect(servico.status).toBe(201);
    const profissional = await chamar(request, "POST", `/tenants/${a.tenantId}/professionals`, {
      name: "Ana Souza",
      serviceIds: [servico.corpo.service.id],
    });
    expect(profissional.status).toBe(201);
    await nav(page).getByRole("link", { name: "Agenda" }).click();
    await page.getByTestId("novo-agendamento").click();
    const painel = page.getByTestId("painel-novo-agendamento");
    await painel.getByLabel("Buscar cliente por nome ou telefone").fill(nomeMaria);
    await painel.getByRole("button", { name: "Buscar", exact: true }).click();
    await expect(painel.getByTestId("resultados-clientes")).toContainText(nomeMaria);
    await painel.getByTestId("resultados-clientes").getByRole("button", { name: new RegExp(nomeMaria) }).click();
    await expect(painel.getByText("Cliente selecionado:")).toContainText(nomeMaria);
    await page.keyboard.press("Escape");
  });

  test("isolamento, sem permissão, troca de estabelecimento e celular", async ({
    page,
    request,
    playwright,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(COMPUTADOR);
    const a = await cadastrar(request, "IsoA");
    const clienteDeA = `Cliente Só De A ${Date.now().toString().slice(-6)}`;
    expect(
      (await chamar(request, "POST", `/tenants/${a.tenantId}/consumers`, { name: clienteDeA, whatsapp: "11966665555" }))
        .status,
    ).toBe(201);

    // B é outro dono, em outra sessão de API.
    const apiB = await playwright.request.newContext();
    const b = await cadastrar(apiB, "IsoB");
    expect(
      (await chamar(apiB, "GET", `/tenants/${a.tenantId}/consumers?q=${encodeURIComponent(clienteDeA)}`)).status,
      "B não lê clientes de A",
    ).toBe(404);
    expect(
      (await chamar(apiB, "POST", `/tenants/${a.tenantId}/consumers`, { name: "Invasor", whatsapp: "11955554444" }))
        .status,
      "B não grava em A",
    ).toBe(404);
    // Na própria base, B não acha o cliente de A (mesmo termo).
    const deB = await chamar<{ consumers: unknown[] }>(
      apiB,
      "GET",
      `/tenants/${b.tenantId}/consumers?q=${encodeURIComponent(clienteDeA)}`,
    );
    expect(deB.status).toBe(200);
    expect(deB.corpo.consumers).toEqual([]);
    await apiB.dispose();

    // A ganha vínculo de RECEPCIONISTA em B: a política real só libera DONO.
    await noBancoDescartavel(
      `INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'RECEPCIONISTA')`,
      [`e2ec${Date.now().toString(36)}`.slice(0, 30), a.userId, b.tenantId],
    );

    await entrar(page, a.email);
    await expect(page).toHaveURL(/\/conta\/selecionar-estabelecimento$/);
    await page.getByRole("button", { name: new RegExp(a.businessName) }).click();
    await expect(page).toHaveURL(/\/conta\/visao-geral$/);
    await page.goto("/conta/clientes");
    await buscar(page, clienteDeA);
    await expect(page.getByTestId("lista-clientes")).toContainText(clienteDeA);

    // Troca para B: nada de A sobra na tela, e a falta de permissão é real (403).
    await page.getByRole("link", { name: "Trocar de estabelecimento" }).click();
    await page.getByRole("button", { name: new RegExp(b.businessName) }).click();
    await expect(page.getByTestId("estabelecimento-ativo")).toHaveText(b.businessName);
    await page.goto("/conta/clientes");
    await expect(page.getByText("Pesquise para encontrar um cliente")).toBeVisible();
    await expect(page.getByText(clienteDeA)).toHaveCount(0);
    await expect(page.getByLabel("Buscar cliente")).toHaveValue("");
    const resposta403 = page.waitForResponse((r) => ehBusca(new URL(r.url())));
    await buscar(page, clienteDeA);
    expect((await resposta403).status()).toBe(403);
    await expect(page.getByTestId("clientes-sem-permissao")).toContainText(
      "Você não tem permissão para ver os clientes deste estabelecimento.",
    );
    await expect(page.getByRole("button", { name: "Tentar novamente" })).toHaveCount(0);

    // Volta para A.
    await page.getByRole("link", { name: "Trocar de estabelecimento" }).click();
    await page.getByRole("button", { name: new RegExp(a.businessName) }).click();
    await expect(page.getByTestId("estabelecimento-ativo")).toHaveText(a.businessName);

    // ------------------------------------------------ navegação: computador
    expect(await nav(page).getByRole("link").allTextContents()).toEqual([
      "Visão geral",
      "Agenda",
      "Clientes",
      "Serviços",
      "Profissionais",
      "Minha conta",
    ]);
    await expect(nav(page).getByRole("button", { name: "Mais" })).toHaveCount(0);

    // ------------------------------------------------ navegação: celular
    for (const viewport of [CELULAR, CELULAR_ESTREITO]) {
      await page.setViewportSize(viewport);
      await page.goto("/conta/clientes");
      await buscar(page, clienteDeA);
      await expect(page.getByTestId("lista-clientes")).toContainText(clienteDeA);
      for (const rotulo of ["Visão geral", "Agenda", "Clientes", "Serviços"]) {
        const link = nav(page).getByRole("link", { name: rotulo });
        await expect(link).toBeInViewport();
        const caixa = (await link.boundingBox())!;
        expect(caixa.height).toBeGreaterThanOrEqual(44);
        expect(caixa.width).toBeGreaterThanOrEqual(64);
        // Rótulo inteiro, sem reticências.
        expect(await link.locator("span").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      }
      await expect(nav(page).getByRole("link", { name: "Profissionais" })).toHaveCount(0);
      const mais = nav(page).getByRole("button", { name: "Mais" });
      await expect(mais).toHaveAttribute("aria-expanded", "false");
      await mais.click();
      await expect(mais).toHaveAttribute("aria-expanded", "true");
      await expect(nav(page).getByRole("link", { name: "Profissionais" })).toBeInViewport();
      await page.keyboard.press("Escape");
      await expect(nav(page).getByRole("link", { name: "Profissionais" })).toHaveCount(0);
      await mais.click();
      await nav(page).getByRole("link", { name: "Minha conta" }).click();
      await expect(page).toHaveURL(/\/conta$/);
      await expect(nav(page).getByRole("link", { name: "Minha conta" })).toHaveCount(0);
      await page.goto("/conta/clientes");
      await page.getByRole("button", { name: "Novo cliente" }).click();
      await expect(page.getByLabel("Nome do cliente")).toBeVisible();
      await semRolagemHorizontal(page);
      await page.screenshot({ path: test.info().outputPath(`clientes-${viewport.width}.png`), fullPage: true });
    }
  });
});
