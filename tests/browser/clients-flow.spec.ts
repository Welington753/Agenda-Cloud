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
// Orçamento de POST /invites/accept (fixture de contas): 4 de 10 (rate limit real por IP). Roda em
// invocação própria do Playwright (`npm run test:browser:clients`).
import { criarContaDeTeste as contaPorConvite } from "./support/contas-de-teste";
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
  await contaPorConvite(api, dados);
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

/** Leitura da listagem da tela de Clientes (com ou sem filtro). */
const ehBusca = (url: URL) => /\/tenants\/[^/]+\/consumers\/page$/.test(url.pathname);
/** Busca do seletor de cliente da Agenda (rota de busca, no máximo 20). */
const ehBuscaDoSeletor = (url: URL) => /consumers$/.test(url.pathname) && url.searchParams.has("q");
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
    // Nos NOMES, a marca é feita só de letras: a busca também compara os
    // dígitos do termo com o telefone, e dígitos do relógio no nome podiam
    // casar por acaso com o WhatsApp de outro cliente do teste.
    const marca = sufixo.replace(/\d/g, (d) => "abcdefghij"[Number(d)]);
    const nomeMaria = `Maria Teste ${marca}`;
    const whatsMaria = `(11) 9${sufixo.slice(0, 4)}-${sufixo.slice(2, 6)}`;

    await entrar(page, a.email);
    await expect(page).toHaveURL(/\/conta\/visao-geral$/);
    await nav(page).getByRole("link", { name: "Clientes" }).click();
    await expect(page).toHaveURL(/\/conta\/clientes$/);
    await expect(nav(page).getByRole("link", { name: "Clientes" })).toHaveAttribute("aria-current", "page");

    // Ao abrir, a listagem carrega sozinha: sem clientes, diz que não há
    // nenhum cadastrado (diferente de "nenhum resultado" de uma busca).
    await expect(page.getByTestId("clientes-vazio")).toContainText("Nenhum cliente cadastrado ainda");
    // Um caractere ainda não filtra.
    await page.getByLabel("Buscar cliente").fill("M");
    await expect(page.getByRole("search").getByRole("button", { name: "Buscar" })).toBeDisabled();

    // Nenhum resultado.
    await buscar(page, "Ninguém Existe");
    await expect(page.getByTestId("clientes-nenhum")).toContainText("Nenhum cliente encontrado");
    await page.getByTestId("clientes-limpar-busca").click();
    await expect(page.getByTestId("clientes-vazio")).toBeVisible();

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
    // A primeira página mostra o cliente sem busca nenhuma.
    await expect(page.getByTestId("lista-clientes")).toContainText(nomeMaria);
    await expect(page.getByTestId("clientes-total")).toHaveText("1 cliente cadastrado");
    await buscar(page, `Teste ${marca}`);
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
    const nomeJoao = `João Leitura ${marca}`;
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

    // ------------------------------------------------ paginação no servidor
    const prefixo = `Lote ${marca}`;
    for (let i = 0; i < 21; i += 1) {
      const r = await chamar(request, "POST", `/tenants/${a.tenantId}/consumers`, {
        name: `${prefixo} ${String(i).padStart(2, "0")}`,
        whatsapp: `(31) 9${sufixo.slice(0, 2)}${String(i).padStart(2, "0")}-${sufixo.slice(2, 6)}`,
      });
      expect(r.status).toBe(201);
    }
    await buscar(page, prefixo);
    await expect(page.getByTestId("lista-clientes").getByRole("listitem")).toHaveCount(20);
    await expect(page.getByTestId("clientes-total")).toHaveText(`21 clientes encontrados para “${prefixo}”`);
    await expect(page.getByTestId("clientes-mostrando")).toHaveText("Mostrando 20 de 21, em ordem alfabética.");
    await page.getByTestId("clientes-carregar-mais").click();
    await expect(page.getByTestId("lista-clientes").getByRole("listitem")).toHaveCount(21);
    await expect(page.getByTestId("clientes-carregar-mais")).toHaveCount(0);
    // Ordem estável: a segunda página continua de onde a primeira parou.
    const nomes = await page.getByTestId("lista-clientes").getByRole("listitem").locator("p.font-semibold").allTextContents();
    expect(nomes).toEqual(Array.from({ length: 21 }, (_, i) => `${prefixo} ${String(i).padStart(2, "0")}`));
    // Sem filtro, todos os clientes do estabelecimento, também paginados.
    await page.getByTestId("clientes-limpar-busca").click();
    await expect(page.getByTestId("clientes-total")).toHaveText("23 clientes cadastrados");
    await expect(page.getByTestId("lista-clientes").getByRole("listitem")).toHaveCount(20);

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

    // Troca para B: nada de A sobra na tela. RECEPCIONISTA não tem área
    // liberada: o menu fica só com Configurações (as pessoais), a tela de
    // Clientes aberta pelo endereço leva a elas, e a falta de permissão é real
    // (403).
    await page.getByRole("link", { name: "Trocar de estabelecimento" }).click();
    await page.getByRole("button", { name: new RegExp(b.businessName) }).click();
    await expect(page.getByTestId("estabelecimento-ativo")).toHaveText(b.businessName);
    await page.goto("/conta/clientes");
    await expect(page).toHaveURL(/\/conta\/configuracoes$/);
    await expect(page.getByText(clienteDeA)).toHaveCount(0);
    expect(await nav(page).getByRole("link").allTextContents()).toEqual(["Configurações"]);
    await expect(page.getByRole("main")).toContainText("Este papel não tem área liberada neste estabelecimento.");
    expect(
      await page.getByTestId("secoes-configuracoes").getByRole("link").evaluateAll((l) => l.map((a) => a.getAttribute("href"))),
    ).toEqual(["/conta/configuracoes/aparencia", "/conta/configuracoes/perfil"]);
    const lista403 = await page.request.get(`http://localhost:3001/tenants/${b.tenantId}/consumers/page`);
    expect(lista403.status()).toBe(403);
    const busca403 = await page.request.get(
      `http://localhost:3001/tenants/${b.tenantId}/consumers?q=${encodeURIComponent(clienteDeA)}`,
    );
    expect(busca403.status()).toBe(403);

    // Volta para A.
    await page.getByRole("link", { name: "Trocar de estabelecimento" }).click();
    await page.getByRole("button", { name: new RegExp(a.businessName) }).click();
    await expect(page.getByTestId("estabelecimento-ativo")).toHaveText(a.businessName);

    // ------------------------------------------------ navegação: computador
    expect(await nav(page).getByRole("link").allTextContents()).toEqual([
      "Início",
      "Agenda",
      "Clientes",
      "Serviços",
      "Profissionais",
      "Configurações",
    ]);
    await expect(nav(page).getByRole("button", { name: "Mais" })).toHaveCount(0);

    // ------------------------------------------------ navegação: celular
    for (const viewport of [CELULAR, CELULAR_ESTREITO]) {
      await page.setViewportSize(viewport);
      await page.goto("/conta/clientes");
      await buscar(page, clienteDeA);
      await expect(page.getByTestId("lista-clientes")).toContainText(clienteDeA);
      for (const rotulo of ["Início", "Agenda", "Clientes", "Configurações"]) {
        const link = nav(page).getByRole("link", { name: rotulo });
        await expect(link).toBeInViewport();
        const caixa = (await link.boundingBox())!;
        expect(caixa.height).toBeGreaterThanOrEqual(44);
        expect(caixa.width).toBeGreaterThanOrEqual(64);
        // Rótulo inteiro, sem reticências.
        expect(await link.locator("span").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      }
      await expect(nav(page).getByRole("button", { name: "Mais" })).toHaveCount(0);
      // Serviços e Profissionais não cabem na barra: ficam no menu da conta.
      await expect(nav(page).getByRole("link", { name: "Profissionais" })).toBeHidden();
      await page.getByTestId("abrir-menu-conta").click();
      await page.getByTestId("menu-mais-areas").getByRole("link", { name: "Profissionais" }).click();
      await expect(page).toHaveURL(/\/conta\/configuracoes\/profissionais$/);
      await semRolagemHorizontal(page);
      await page.goto("/conta/clientes");
      await page.getByRole("button", { name: "Novo cliente" }).click();
      await expect(page.getByLabel("Nome do cliente")).toBeVisible();
      await semRolagemHorizontal(page);
      await page.screenshot({ path: test.info().outputPath(`clientes-${viewport.width}.png`), fullPage: true });
    }
  });

  // Seletor de cliente de "Novo agendamento": uma busca antiga, terminando
  // depois, nunca altera resultado, erro ou carregamento da busca atual.
  // Cada busca retida só segue quando o PRÓPRIO teste libera; a liberação
  // fica em `finally` e as rotas só saem depois de o handler terminar.
  test("seletor da agenda: busca antiga nunca vence a atual", async ({ page, request, playwright }) => {
    await page.setViewportSize(COMPUTADOR);
    const sufixo = Date.now().toString().slice(-6);
    const alfa = `Alfa Seletor ${sufixo}`;
    const beta = `Beta Seletor ${sufixo}`;
    const gama = `Gama Seletor ${sufixo}`;

    async function prepararAgenda(api: APIRequestContext, tenantId: string) {
      const servico = await chamar<{ service: { id: string } }>(api, "POST", `/tenants/${tenantId}/services`, {
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
      const profissional = await chamar(api, "POST", `/tenants/${tenantId}/professionals`, {
        name: "Ana Souza",
        serviceIds: [servico.corpo.service.id],
      });
      expect(profissional.status).toBe(201);
    }
    async function cliente(api: APIRequestContext, tenantId: string, name: string, whatsapp: string) {
      expect((await chamar(api, "POST", `/tenants/${tenantId}/consumers`, { name, whatsapp })).status).toBe(201);
    }

    const a = await cadastrar(request, "SelA");
    await prepararAgenda(request, a.tenantId);
    await cliente(request, a.tenantId, alfa, `(11) 93${sufixo.slice(0, 3)}-${sufixo.slice(2, 6)}`);
    await cliente(request, a.tenantId, beta, `(11) 94${sufixo.slice(0, 3)}-${sufixo.slice(2, 6)}`);

    const apiB = await playwright.request.newContext();
    const b = await cadastrar(apiB, "SelB");
    await prepararAgenda(apiB, b.tenantId);
    await cliente(apiB, b.tenantId, gama, `(11) 95${sufixo.slice(0, 3)}-${sufixo.slice(2, 6)}`);
    await apiB.dispose();
    await noBancoDescartavel(
      `INSERT INTO memberships (id, user_id, tenant_id, role) VALUES ($1, $2, $3, 'DONO')`,
      [`e2es${Date.now().toString(36)}`.slice(0, 30), a.userId, b.tenantId],
    );

    /** Retém as buscas por `termo` até `liberar`; `concluida` resolve depois
     * que o handler entregou (ou não conseguiu entregar) a requisição. */
    async function reter(termo: string, desfecho: "continuar" | "falhar") {
      const retida = Promise.withResolvers<void>();
      const liberar = Promise.withResolvers<void>();
      const concluida = Promise.withResolvers<void>();
      await page.route(
        (url) => ehBuscaDoSeletor(url) && url.searchParams.get("q") === termo,
        async (rota) => {
          retida.resolve();
          try {
            await liberar.promise;
            await (desfecho === "falhar" ? rota.abort("connectionreset") : rota.continue());
          } catch {
            // A tela já abortou a requisição: não há mais a quem entregar.
          } finally {
            concluida.resolve();
          }
        },
      );
      return { retida: retida.promise, liberar: () => liberar.resolve(), concluida: concluida.promise };
    }

    await entrar(page, a.email);
    await expect(page).toHaveURL(/\/conta\/selecionar-estabelecimento$/);
    await page.getByRole("button", { name: new RegExp(a.businessName) }).click();
    await expect(page).toHaveURL(/\/conta\/visao-geral$/);
    await nav(page).getByRole("link", { name: "Agenda" }).click();
    await page.getByTestId("novo-agendamento").click();
    const painel = page.getByTestId("painel-novo-agendamento");
    const campo = painel.getByLabel("Buscar cliente por nome ou telefone");
    const resultados = painel.getByTestId("resultados-clientes");
    const botaoBuscar = painel.getByRole("button", { name: /^(Buscar|Buscando\.\.\.)$/ });
    const semResiduos = async () => {
      await expect(painel.getByRole("button", { name: "Buscando..." })).toHaveCount(0);
      await expect(painel.getByRole("alert")).toHaveCount(0);
    };

    // 1. A começa, B começa depois e termina primeiro, A chega por último.
    const buscaA = await reter("Alfa", "continuar");
    try {
      await campo.fill("Alfa");
      await botaoBuscar.click();
      await buscaA.retida;
      await campo.fill("Beta");
      await campo.press("Enter");
      await expect(resultados).toContainText(beta);
    } finally {
      buscaA.liberar();
    }
    await buscaA.concluida;
    await page.unrouteAll({ behavior: "wait" });
    await expect(resultados).toContainText(beta);
    await expect(resultados).not.toContainText(alfa);
    await semResiduos();

    // 2. Resposta antiga depois de limpar a busca: nada volta a aparecer.
    const buscaLimpa = await reter("Alfa", "continuar");
    try {
      await campo.fill("Alfa");
      await campo.press("Enter");
      await buscaLimpa.retida;
      await campo.fill("");
      await expect(resultados).toHaveCount(0);
    } finally {
      buscaLimpa.liberar();
    }
    await buscaLimpa.concluida;
    await page.unrouteAll({ behavior: "wait" });
    await expect(resultados).toHaveCount(0);
    await expect(painel.getByText("Nenhum cliente encontrado")).toHaveCount(0);
    await semResiduos();

    // 3. Erro de uma busca antiga não substitui o resultado atual.
    const buscaComErro = await reter("Alfa", "falhar");
    try {
      await campo.fill("Alfa");
      await campo.press("Enter");
      await buscaComErro.retida;
      await campo.fill("Beta");
      await campo.press("Enter");
      await expect(resultados).toContainText(beta);
    } finally {
      buscaComErro.liberar();
    }
    await buscaComErro.concluida;
    await page.unrouteAll({ behavior: "wait" });
    await expect(resultados).toContainText(beta);
    await semResiduos();

    // 4. Troca de estabelecimento com busca de A em voo: nada de A em B.
    const buscaDeA = await reter("Alfa", "continuar");
    try {
      await campo.fill("Alfa");
      await campo.press("Enter");
      await buscaDeA.retida;
      await painel.getByRole("button", { name: "Fechar", exact: true }).click();
      await page.getByRole("link", { name: "Trocar de estabelecimento" }).click();
      await page.getByRole("button", { name: new RegExp(b.businessName) }).click();
      await expect(page.getByTestId("estabelecimento-ativo")).toHaveText(b.businessName);
      await nav(page).getByRole("link", { name: "Agenda" }).click();
      await page.getByTestId("novo-agendamento").click();
      await expect(campo).toHaveValue("");
    } finally {
      buscaDeA.liberar();
    }
    await buscaDeA.concluida;
    await page.unrouteAll({ behavior: "wait" });
    await expect(resultados).toHaveCount(0);
    await semResiduos();
    await campo.fill("Gama");
    await campo.press("Enter");
    await expect(resultados).toContainText(gama);
    await expect(resultados).not.toContainText(alfa);

    // A seleção do cliente segue como antes.
    await resultados.getByRole("button", { name: new RegExp(gama) }).click();
    await expect(painel.getByText("Cliente selecionado:")).toContainText(gama);
  });
});
