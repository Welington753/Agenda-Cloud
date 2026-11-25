// Teste de navegador da tela de Clientes (`/conta/clientes`) — contra o
// backend real e um PostgreSQL descartável (nunca Neon/produção).
//
// Prova pela TELA: orientação antes da busca, carregamento, nenhum
// resultado, falha de comunicação, resposta antiga descartada, aviso de
// resultado limitado, cadastro com bloqueio de envio repetido, persistência
// após recarregar, duplicidade sem sobrescrever, resultado incerto sem
// reenvio, falha só da leitura após cadastro confirmado, o cliente achado no
// seletor de "Novo agendamento", troca de estabelecimento sem sobra, a
// navegação em computador e celular, a lista agrupada por telefone, "Cadastrar
// outra pessoa" no mesmo WhatsApp, a ficha com o aviso de histórico
// compartilhado, a edição do WhatsApp, a unificação (prévia, Cancelar,
// prévia desatualizada e confirmação) e o gerente sem "Unificar".
//
// Prova pela API (botão escondido não é controle de acesso): o dono de outro
// estabelecimento não lê nem grava clientes deste.
//
// As requisições retidas com `page.route` continuam indo ao backend real; só
// o ROMPIMENTO de conexão (`route.abort`) é simulado, porque não há outro
// jeito de perder uma resposta de propósito.
//
// Orçamento de POST /invites/accept (fixture de contas): 6 de 10 (rate limit real por IP). Roda em
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

/** Leitura da lista agrupada da tela de Clientes (com ou sem filtro). */
const ehBusca = (url: URL) => /\/tenants\/[^/]+\/consumers\/groups$/.test(url.pathname);
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
    await expect(page.getByTestId("clientes-total")).toHaveText("1 cliente ou grupo");
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
    // Os cadastros desse WhatsApp aparecem, com "Usar este" (a ficha).
    await expect(page.getByTestId("cadastros-do-whatsapp")).toContainText(nomeMaria);
    await expect(page.getByTestId("usar-este-cadastro")).toHaveCount(1);
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
    await expect(page.getByTestId("clientes-total")).toHaveText(`21 clientes ou grupos para “${prefixo}”`);
    await expect(page.getByTestId("clientes-mostrando")).toHaveText("Mostrando 20 de 21, em ordem alfabética.");
    await page.getByTestId("clientes-carregar-mais").click();
    await expect(page.getByTestId("lista-clientes").getByRole("listitem")).toHaveCount(21);
    await expect(page.getByTestId("clientes-carregar-mais")).toHaveCount(0);
    // Ordem estável: a segunda página continua de onde a primeira parou.
    const nomes = await page.getByTestId("lista-clientes").getByTestId("cliente-ficha-link").allTextContents();
    expect(nomes).toEqual(Array.from({ length: 21 }, (_, i) => `${prefixo} ${String(i).padStart(2, "0")}`));
    // Sem filtro, todos os clientes do estabelecimento, também paginados.
    await page.getByTestId("clientes-limpar-busca").click();
    await expect(page.getByTestId("clientes-total")).toHaveText("23 clientes ou grupos");
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

    // Escolhido: a lista recolhe; ficam nome, telefone e "Trocar", com o foco.
    const resultadosSeletor = painel.getByTestId("resultados-clientes");
    const cartaoEscolhido = painel.getByTestId("cliente-escolhido");
    const telefoneEscolhido = painel.getByTestId("telefone-cliente-escolhido");
    const trocar = painel.getByRole("button", { name: /^Trocar cliente / });
    const campoSeletor = painel.getByLabel("Buscar cliente por nome ou telefone");
    await expect(resultadosSeletor).toHaveCount(0);
    await expect(campoSeletor).toHaveCount(0);
    await expect(cartaoEscolhido).toContainText(nomeMaria);
    await expect(telefoneEscolhido).not.toBeEmpty();
    await expect(trocar).toBeFocused();
    await cartaoEscolhido.screenshot({ path: test.info().outputPath("cliente-escolhido-computador.png") });

    // Homônimos com telefones diferentes: a escolha e a marcação vão pelo id.
    const nomeDora = `Dora Seletor ${marca}`;
    for (const tel of [`(41) 97${sufixo.slice(0, 3)}-0404`, `(51) 96${sufixo.slice(0, 3)}-0505`]) {
      expect((await chamar(request, "POST", `/tenants/${a.tenantId}/consumers`, { name: nomeDora, whatsapp: tel })).status).toBe(201);
    }
    // "Trocar" reabre a busca de antes, com o escolhido ainda marcado.
    await trocar.click();
    await expect(campoSeletor).toBeFocused();
    await expect(campoSeletor).toHaveValue(nomeMaria);
    await expect(resultadosSeletor.getByRole("button", { name: new RegExp(nomeMaria) })).toHaveAttribute("aria-pressed", "true");
    await expect(painel.getByText("Cliente selecionado:")).toContainText(nomeMaria);
    await campoSeletor.fill(nomeDora);
    await campoSeletor.press("Enter");
    const doras = resultadosSeletor.getByRole("button", { name: new RegExp(nomeDora) });
    await expect(doras).toHaveCount(2);
    const telefoneDe = async (i: number) => (await doras.nth(i).locator("span").nth(1).textContent())!.trim();
    const [telPrimeira, telSegunda] = [await telefoneDe(0), await telefoneDe(1)];
    expect(telPrimeira).not.toBe(telSegunda);
    await doras.nth(1).click();
    await expect(resultadosSeletor).toHaveCount(0);
    await expect(cartaoEscolhido).toContainText(nomeDora);
    await expect(telefoneEscolhido).toHaveText(telSegunda);
    await painel.getByRole("button", { name: /^Trocar cliente / }).click();
    await expect(doras.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(doras.nth(0)).toHaveAttribute("aria-pressed", "false");
    await painel.getByTestId("resultados-clientes").screenshot({ path: test.info().outputPath("busca-reaberta-computador.png") });
    await doras.nth(0).click();
    await expect(telefoneEscolhido).toHaveText(telPrimeira);

    // Celular: alvos de 44 px no escolhido e na busca reaberta.
    await page.setViewportSize(CELULAR);
    expect((await trocar.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await cartaoEscolhido.screenshot({ path: test.info().outputPath("cliente-escolhido-celular.png") });
    await trocar.click();
    expect((await doras.nth(0).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await painel.screenshot({ path: test.info().outputPath("busca-reaberta-celular.png") });
    await doras.nth(0).click();
    await page.setViewportSize(COMPUTADOR);

    // "Cadastrar novo" segue disponível; voltar à busca mostra o escolhido.
    await painel.getByRole("button", { name: "Cadastrar novo" }).click();
    await expect(painel.getByLabel("Nome do cliente")).toBeVisible();
    await painel.getByRole("button", { name: "Buscar cliente", exact: true }).click();
    await expect(cartaoEscolhido).toContainText(nomeDora);
    await expect(telefoneEscolhido).toHaveText(telPrimeira);
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
    // Menu agrupado por assunto em qualquer tema.
    expect(await nav(page).getByRole("link").allTextContents()).toEqual([
      "Visão geral",
      "Agenda",
      "Clientes",
      "Profissionais",
      "Serviços",
      "Comissões",
      "Equipe e acessos",
      "Configurações",
    ]);
    await expect(nav(page).getByRole("button", { name: "Mais" })).toHaveCount(0);

    // ------------------------------------------------ navegação: celular
    for (const viewport of [CELULAR, CELULAR_ESTREITO]) {
      await page.setViewportSize(viewport);
      await page.goto("/conta/clientes");
      await buscar(page, clienteDeA);
      await expect(page.getByTestId("lista-clientes")).toContainText(clienteDeA);
      // Todas as áreas na faixa inferior, que rola só por dentro.
      for (const rotulo of ["Visão geral", "Agenda", "Clientes", "Profissionais", "Serviços", "Comissões", "Equipe e acessos", "Configurações"]) {
        const link = nav(page).getByRole("link", { name: rotulo, exact: true });
        await link.scrollIntoViewIfNeeded();
        await expect(link).toBeInViewport();
        const caixa = (await link.boundingBox())!;
        expect(caixa.height).toBeGreaterThanOrEqual(44);
        expect(caixa.width).toBeGreaterThanOrEqual(64);
        // Rótulo inteiro (até duas linhas), sem reticências.
        expect(await link.locator("span").first().evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true);
        await semRolagemHorizontal(page);
      }
      await expect(nav(page).getByRole("button", { name: "Mais" })).toHaveCount(0);
      await nav(page).getByRole("link", { name: "Profissionais" }).click();
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
  test("telefone compartilhado, ficha, edição, unificação e gerente sem Unificar", async ({ page, request, playwright }) => {
    test.setTimeout(150_000);
    await page.setViewportSize(COMPUTADOR);
    const u = await cadastrar(request, "Unif");
    const sufixo = Date.now().toString().slice(-4);
    const marca = sufixo.replace(/\d/g, (d) => "abcdefghij"[Number(d)]);
    const post = (corpo: Record<string, unknown>) => chamar<{ consumer: { id: string } }>(request, "POST", `/tenants/${u.tenantId}/consumers`, corpo);
    const chave = () => `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

    // Bia e o filho no mesmo WhatsApp; a forma antiga do número (sem o 9);
    // duas Doras com telefones diferentes ("Mesmo nome — confira").
    const telBia = `(11) 98${sufixo.slice(0, 3)}-0101`;
    const bia = await post({ name: `Bia ${marca}`, whatsapp: telBia });
    expect(bia.status).toBe(201);
    const emUso = await post({ name: `Caio ${marca}`, whatsapp: telBia });
    expect(emUso.status).toBe(409);
    expect((await post({ name: `Caio ${marca}`, whatsapp: telBia, requestKey: chave(), outraPessoa: true })).status).toBe(201);
    expect((await post({ name: `Bia Antiga ${marca}`, whatsapp: `(11) 8${sufixo.slice(0, 3)}-0101` })).status).toBe(201);
    const dora = await post({ name: `Dora ${marca}`, whatsapp: `(21) 97${sufixo.slice(0, 3)}-0202` });
    const doraDois = await post({ name: `Dora ${marca}`, whatsapp: `(31) 96${sufixo.slice(0, 3)}-0303` });
    expect([dora.status, doraDois.status]).toEqual([201, 201]);

    await entrar(page, u.email);
    await expect(page).toHaveURL(/\/conta\/visao-geral$/);
    await page.goto("/conta/clientes");

    // ------------------------------------------------ lista agrupada
    const grupo = page.getByTestId("grupo-clientes");
    await expect(grupo).toHaveCount(1);
    await grupo.locator("summary").click();
    const secoes = grupo.getByTestId("secao-grupo");
    await expect(secoes).toHaveCount(2);
    await expect(secoes.nth(0)).toContainText("Mesmo WhatsApp");
    await expect(secoes.nth(0)).toContainText(`Bia ${marca}`);
    await expect(secoes.nth(0)).toContainText(`Caio ${marca}`);
    await expect(secoes.nth(1)).toContainText("Número parecido (9º dígito ou DDD) — confira");
    await expect(secoes.nth(1)).toContainText(`Bia Antiga ${marca}`);
    await expect(page.getByTestId("aviso-mesmo-nome")).toHaveCount(2);
    await expect(page.getByTestId("aviso-mesmo-nome").first()).toHaveText("Mesmo nome em outro cadastro — confira");

    // ------------------------------------------------ "Cadastrar outra pessoa" com nome igual
    await page.getByRole("button", { name: "Novo cliente" }).click();
    await page.getByLabel("Nome do cliente").fill(`Bia ${marca}`);
    await page.getByLabel("WhatsApp").fill(telBia);
    await page.getByRole("button", { name: "Cadastrar cliente" }).click();
    await expect(page.getByTestId("cadastros-do-whatsapp")).toContainText(`Caio ${marca}`);
    await page.getByTestId("cadastrar-outra-pessoa").click();
    await expect(page.getByTestId("cliente-cadastrado")).toContainText(`Cliente Bia ${marca} cadastrado.`);

    // ------------------------------------------------ ficha com histórico de nomes diferentes
    const profissional = await chamar<{ professional: { id: string } }>(request, "POST", `/tenants/${u.tenantId}/professionals`, { name: "Ana Unif" });
    expect(profissional.status).toBe(201);
    for (const [i, nome] of [`Dora ${marca}`, "Outra Pessoa"].entries()) {
      await noBancoDescartavel(
        `INSERT INTO appointments (id, tenant_id, unit_id, consumer_id, consumer_name_snapshot, consumer_whatsapp_snapshot, professional_id, start_at, end_at, status)
         VALUES ($1, $2::varchar, (SELECT id FROM units WHERE tenant_id = $2::varchar ORDER BY is_primary DESC LIMIT 1), $3, $4, 'x', $5, $6::timestamptz, $6::timestamptz + interval '30 minutes', 'COMPLETED')`,
        [`e2eh${i}${Date.now().toString(36)}`.slice(0, 30), u.tenantId, dora.corpo.consumer.id, nome, profissional.corpo.professional.id, `2026-0${i + 1}-10T13:00:00Z`],
      );
    }
    await page.getByRole("button", { name: "Fechar aviso" }).click();
    // Depois do cadastro a lista fica filtrada pelo WhatsApp: volta a todos.
    await page.getByTestId("clientes-limpar-busca").click();
    await page.getByTestId("cliente-ficha-link").filter({ hasText: `Dora ${marca}` }).first().click();
    await expect(page).toHaveURL(new RegExp(`/conta/clientes/${dora.corpo.consumer.id}$`));
    await expect(nav(page).getByRole("link", { name: "Clientes" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("ficha-resumo")).toContainText("2 agendamentos");
    await expect(page.getByTestId("aviso-historico-compartilhado")).toContainText("o histórico pode ser de mais de uma pessoa");
    await expect(page.getByTestId("ficha-historico").getByRole("listitem")).toHaveCount(2);
    await expect(page.getByTestId("outros-cadastros")).toContainText("Mesmo nome — confira");

    // ------------------------------------------------ edição do WhatsApp mantém o histórico
    await page.getByTestId("ficha-editar").click();
    await page.getByLabel("WhatsApp").fill(`(21) 95${sufixo.slice(0, 3)}-0909`);
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByTestId("ficha-aviso")).toContainText("Cadastro atualizado");
    await expect(page.getByTestId("ficha-dados")).toContainText(`(21) 95${sufixo.slice(0, 3)}-0909`);
    await expect(page.getByTestId("ficha-historico").getByRole("listitem")).toHaveCount(2);

    // ------------------------------------------------ unificação: prévia e Cancelar não gravam
    await page.getByTestId("unificar-com").click();
    await page.getByTestId("unificar-revisar").click();
    await expect(page.getByTestId("unificar-previa")).toContainText("Fica com o histórico (principal)");
    await expect(page.getByTestId("unificar-transferir")).toContainText("0 agendamentos");
    await page.getByTestId("unificar-cancelar").click();
    await expect(page.getByTestId("unificar-cadastros")).toHaveCount(0);
    await expect(page.getByTestId("outro-cadastro")).toHaveCount(1);

    // Prévia desatualizada: um agendamento entra no secundário antes de confirmar.
    await page.getByTestId("unificar-com").click();
    await page.getByTestId("unificar-revisar").click();
    await expect(page.getByTestId("unificar-previa")).toBeVisible();
    await noBancoDescartavel(
      `INSERT INTO appointments (id, tenant_id, unit_id, consumer_id, consumer_name_snapshot, consumer_whatsapp_snapshot, professional_id, start_at, end_at, status)
       VALUES ($1, $2::varchar, (SELECT id FROM units WHERE tenant_id = $2::varchar ORDER BY is_primary DESC LIMIT 1), $3, $4, 'x', $5, '2026-03-10T13:00:00Z', '2026-03-10T13:30:00Z', 'CANCELED')`,
      [`e2ed${Date.now().toString(36)}`.slice(0, 30), u.tenantId, doraDois.corpo.consumer.id, `Dora ${marca}`, profissional.corpo.professional.id],
    );
    await page.getByTestId("unificar-confirmar").click();
    await expect(page.getByTestId("unificar-previa-desatualizada")).toContainText("mudaram desde a prévia");
    await expect(page.getByTestId("unificar-transferir")).toContainText("1 agendamento (0 concluídos, 1 cancelado");
    await page.getByTestId("unificar-confirmar").click();
    await expect(page.getByTestId("ficha-aviso")).toContainText("Cadastros unificados");
    await expect(page.getByTestId("ficha-resumo")).toContainText("3 agendamentos");
    await expect(page.getByTestId("outros-cadastros")).toHaveCount(0);
    // A lápide some da lista e a ficha dela leva ao principal.
    await page.goto(`/conta/clientes/${doraDois.corpo.consumer.id}`);
    await expect(page.getByTestId("ficha-falha")).toContainText("foi unificado");
    await page.getByTestId("abrir-principal").click();
    await expect(page).toHaveURL(new RegExp(`/conta/clientes/${dora.corpo.consumer.id}$`));

    // ------------------------------------------------ celular: a ficha cabe na tela
    for (const viewport of [CELULAR, CELULAR_ESTREITO]) {
      await page.setViewportSize(viewport);
      await page.goto(`/conta/clientes/${bia.corpo.consumer.id}`);
      await expect(page.getByTestId("outros-cadastros")).toBeVisible();
      await semRolagemHorizontal(page);
      await page.screenshot({ path: test.info().outputPath(`ficha-${viewport.width}.png`), fullPage: true });
    }

    // ------------------------------------------------ gerente: edita, mas não unifica
    const apiG = await playwright.request.newContext();
    const g = await cadastrar(apiG, "Ger");
    await apiG.dispose();
    const vinculo = `e2eg${Date.now().toString(36)}`.slice(0, 30);
    await noBancoDescartavel(
      `INSERT INTO memberships (id, user_id, tenant_id, role, permissions_confirmed_at) VALUES ($1, $2, $3, 'GERENTE', now())`,
      [vinculo, g.userId, u.tenantId],
    );
    for (const [i, permissao] of ["CONSUMIDORES_VISUALIZAR", "CONSUMIDORES_GERENCIAR"].entries()) {
      await noBancoDescartavel(
        `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode) VALUES ($1, $2, $3, $4::permission, 'GRANTED')`,
        [`${vinculo}${i}`.slice(0, 30), u.tenantId, vinculo, permissao],
      );
    }
    await page.setViewportSize(COMPUTADOR);
    await page.context().clearCookies();
    await entrar(page, g.email);
    await expect(page).toHaveURL(/\/conta\/selecionar-estabelecimento$/);
    await page.getByRole("button", { name: new RegExp(u.businessName) }).click();
    await page.goto(`/conta/clientes/${bia.corpo.consumer.id}`);
    await expect(page.getByTestId("outros-cadastros")).toBeVisible();
    await expect(page.getByTestId("ficha-editar")).toBeVisible();
    await expect(page.getByTestId("unificar-com")).toHaveCount(0);
  });
});
