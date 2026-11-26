// Vendas v1 (adicional VENDAS, docs/plans/vendas-v1.md) pela tela real (API e
// web reais, PostgreSQL DESCARTÁVEL, só dados fictícios). VENDAS e ESTOQUE
// ligados como a assinatura liga (override do recurso; o preço do adicional
// continua pendente e não é definido aqui).
//
// Fluxo completo:
// - dono: catálogo com saldo numérico, sem produto de consumo interno; cliente
//   ambíguo (dois cadastros com o mesmo nome lado a lado, nada escolhido sem
//   toque); produto sem saldo recusa a venda inteira sem gravar; venda
//   confirmada pelo servidor; recebimento à parte; estorno e cancelamento com
//   motivo e senha, devolvendo o estoque; compras na ficha do cliente;
//   "Recebido em atendimentos" no Início;
// - estoque com VENDAS: baixa de venda sem "Estornar" e a saída por venda
//   manual recusada com o aviso USE_VENDAS;
// - recepcionista criada em Equipe e acessos (registrar e receber): só Vendas
//   no menu, disponibilidade sem saldo numérico, sem alterar preço, sem
//   cancelar nem estornar, sem consulta geral nem estoque pela API;
// - gerente com "Cancelar vendas" (traz "Consultar todas as vendas"): vê todas,
//   sem nova venda, e não cancela venda recebida sem quem estorne;
// - VENDAS retirado: a nova venda some (e a API recusa) e a manutenção segue:
//   o dono estorna e cancela, a recepcionista consulta as próprias operações.
//
// Falhas de rede (cada caso com o próprio estabelecimento):
// - A: venda gravada e recebimento que falha antes de chegar à API: a tela
//   mantém a venda e repete só o recebimento;
// - B: a criação da venda chega à API e é gravada, e só a resposta se perde:
//   "Enviar de novo" repete a mesma chave e o mesmo corpo e recebe a mesma
//   venda, sem baixa duplicada;
// - C: o mesmo com o recebimento: mesmo recebimento, nenhum lançamento a mais.
// Nos casos B e C a requisição vai à API real (`route.fetch`), a gravação é
// conferida no banco e só então a resposta é bloqueada (`route.abort`).
//
// Capturas (1280 e 390 px) em PLAYWRIGHT_OUTPUT_DIR; sem rolagem lateral
// também em 360 px. No celular (360 e 390 px, com a área visível do
// navegador) a seleção de cliente, a confirmação e "Estornar recebimento"
// ficam acionáveis depois de rolar, e o fim da página fica acima da barra
// inferior. Duas capturas só da área visível (sem fullPage): o bloqueio do
// cliente não escolhido e o detalhe rolado até o estorno. Invocação própria (`npm run test:browser:vendas`): 4
// aceites de convite e 2 logins.
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { API_DE_TESTE, conectarBancoDeTeste, criarContaDeTeste } from "./support/contas-de-teste";
import { entrarPeloFormulario, navConta, semRolagemHorizontal } from "./support/portal";

const SENHA = "senha-do-dono-das-vendas-1";
const SENHA_RECEPCAO = "senha-da-recepcionista-1";
const SENHA_GERENTE = "senha-do-gerente-vendas-1";
const id = () => randomUUID().replaceAll("-", "").slice(0, 24);
const chave = () => randomUUID().replaceAll("-", "");
/** Valor em reais como `formatarMoeda` escreve (espaço inseparável). */
const reais = (valor: string) => new RegExp(`R\\$\\s${valor}$`);

/** Estabelecimentos criados por esta suíte. O banco descartável é o mesmo das
 * suítes do backend que rodam depois no CI, e o levantamento de
 * `pilot-team-manager-check` lista só os primeiros estabelecimentos com
 * gerente ativo: o `afterEach` suspende os gerentes destes estabelecimentos
 * (e só destes), também quando o teste falha ou estoura o tempo. Um
 * encerramento forçado do processo continua sem garantia de limpeza. */
const estabelecimentosDaSuite: string[] = [];

test.afterEach(async () => {
  if (estabelecimentosDaSuite.length === 0) return;
  const db = await conectarBancoDeTeste();
  try {
    await db.query("UPDATE memberships SET status = 'SUSPENDED' WHERE tenant_id = ANY($1::text[]) AND role = 'GERENTE' AND status = 'ACTIVE'", [
      estabelecimentosDaSuite,
    ]);
  } finally {
    estabelecimentosDaSuite.length = 0;
    await db.end();
  }
});

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

async function capturar(page: Page, nome: string) {
  for (const width of [1280, 390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await semRolagemHorizontal(page);
    if (width !== 360) await page.screenshot({ path: test.info().outputPath(`vendas-${nome}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

/** Uma captura numa largura só. */
async function capturarEm(page: Page, nome: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await semRolagemHorizontal(page);
  await page.screenshot({ path: test.info().outputPath(`vendas-${nome}-${width}.png`), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
}

/** Captura só da área visível, com o alvo rolado até o meio da tela. */
async function capturarAreaVisivel(page: Page, nome: string, alvo: Locator) {
  await page.setViewportSize({ width: 390, height: 664 });
  await alvo.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.screenshot({ path: test.info().outputPath(`vendas-${nome}-390-visivel.png`) });
  await page.setViewportSize({ width: 1280, height: 900 });
}

/**
 * Celular com a área visível do navegador (barras do navegador descontadas):
 * cada alvo, rolado até o meio da tela, é o elemento que recebe o toque (nem
 * o cabeçalho nem o menu inferior por cima), e o fim do conteúdo, com a
 * página rolada até o fim, fica acima do menu inferior.
 */
async function alcancavelNoCelular(page: Page, alvos: Locator[]) {
  for (const [width, height] of [
    [360, 640],
    [390, 664],
  ]) {
    await page.setViewportSize({ width, height });
    for (const alvo of alvos) {
      await alvo.evaluate((el) => el.scrollIntoView({ block: "center" }));
      const livre = await alvo.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const topo = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!topo && (topo === el || el.contains(topo));
      });
      expect(livre, `${alvo} coberto em ${width} px`).toBe(true);
    }
    const folga = await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      const menu = document.querySelector("nav[aria-label=\"Áreas da conta\"]")!.getBoundingClientRect();
      const fim = document.querySelector("main")!.lastElementChild!.getBoundingClientRect();
      return menu.top - fim.bottom;
    });
    expect(folga, `fim do conteúdo sob o menu em ${width} px`).toBeGreaterThanOrEqual(16);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function novaPagina(browser: Browser) {
  const contexto = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  return { contexto, page: await contexto.newPage() };
}

/** Estorno do recebimento ou cancelamento pela janela do detalhe. */
async function corrigir(page: Page, botao: "estornar-recebimento-venda" | "cancelar-venda", motivo: string, senha: string) {
  await page.getByTestId(botao).click();
  const janela = page.getByRole("dialog");
  await janela.getByTestId("motivo-correcao").fill("ab");
  await expect(janela.getByTestId("confirmar-correcao")).toBeDisabled();
  await janela.getByTestId("motivo-correcao").fill(motivo);
  await janela.getByTestId("confirmar-correcao").click();
  await confirmarSenhaSePedir(page, senha);
  await expect(page.getByTestId("motivo-correcao")).toHaveCount(0);
}

/** Dono novo com VENDAS e ESTOQUE ligados e uma categoria; `page.request`
 * fica com a sessão do dono. */
async function prepararLoja(page: Page, db: Client, nomeDoDono: string) {
  const marca = `vendas-${id().slice(0, 10)}`;
  const dono = await criarContaDeTeste(page.request, {
    ownerName: nomeDoDono,
    businessName: `${marca} Barbearia`,
    email: `${marca}@example.test`,
    password: SENHA,
  });
  const tenantId = dono.tenant.id;
  estabelecimentosDaSuite.push(tenantId);
  for (const recurso of ["feat_estoque", "feat_vendas"]) {
    await db.query(`INSERT INTO tenant_feature_overrides (id, tenant_id, feature_id, enabled) VALUES ($1, $2, $3, true)`, [id(), tenantId, recurso]);
  }
  const api = (caminho: string) => `${API_DE_TESTE}/tenants/${tenantId}${caminho}`;
  const categoria = await page.request.post(api("/stock/categories"), { data: { name: "Cabelo" } });
  expect(categoria.status(), await categoria.text()).toBe(200);
  const categoryId = ((await categoria.json()) as { id: string }).id;
  const produto = async (name: string, purpose: string, saldo: number | null, preco: number | null) => {
    const r = await page.request.post(api("/stock/products"), {
      data: { requestKey: chave(), name, description: null, internalCode: null, categoryId, purpose, unit: "UN", minQuantityMilli: 1000, initialQuantityMilli: saldo, salePriceCents: preco },
    });
    expect(r.status(), await r.text()).toBe(200);
    return ((await r.json()) as { product: { id: string } }).product.id;
  };
  const contar = async (sql: string, params: unknown[] = [tenantId]) => (await db.query(sql, params)).rows[0].n as number;
  const saldo = async (productId: string) => Number((await db.query("SELECT balance_milli FROM stock_products WHERE id = $1", [productId])).rows[0].balance_milli);
  return { marca, tenantId, api, produto, contar, saldo };
}

/** Os POST de criação de venda que a página enviou (corpo de cada um). */
function criacoesDeVenda(page: Page, tenantId: string): string[] {
  const corpos: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === `/tenants/${tenantId}/sales`) corpos.push(r.postData() ?? "");
  });
  return corpos;
}

const ehCriacaoDeVenda = (tenantId: string) => (url: URL) => url.pathname === `/tenants/${tenantId}/sales`;
const ehRecebimento = (tenantId: string) => (url: URL) => new RegExp(`^/tenants/${tenantId}/sales/[^/]+/payments$`).test(url.pathname);

/** Venda de balcão pela tela, com Pomada (2) e Shampoo (1): R$ 80,00. */
async function montarVendaDeBalcao(page: Page) {
  await page.goto("/conta/vendas");
  await expect(page.getByTestId("catalogo").getByTestId("produto-venda")).toHaveCount(2);
  await page.getByRole("button", { name: "Adicionar Pomada modeladora" }).click();
  await page.getByTestId("linha-venda").filter({ hasText: "Pomada modeladora" }).getByTestId("quantidade-linha").fill("2");
  await page.getByRole("button", { name: "Adicionar Shampoo" }).click();
  await expect(page.getByTestId("total-previa")).toHaveText(reais("80,00"));
}

/** Contagens de uma loja dos casos de rede, direto no banco. */
async function retrato(loja: Awaited<ReturnType<typeof prepararLoja>>, pomada: string, shampoo: string) {
  return {
    vendas: await loja.contar("SELECT count(*)::int AS n FROM sales WHERE tenant_id = $1"),
    baixas: await loja.contar("SELECT count(*)::int AS n FROM stock_movements WHERE tenant_id = $1 AND kind = 'SAIDA_VENDA' AND sale_id IS NOT NULL"),
    itens: await loja.contar("SELECT count(*)::int AS n FROM sale_items WHERE tenant_id = $1"),
    recebimentos: await loja.contar("SELECT count(*)::int AS n FROM sale_payments WHERE tenant_id = $1"),
    auditoriaDoRecebimento: await loja.contar("SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND action::text = 'SALE_PAYMENT_RECORDED'"),
    saldoPomada: await loja.saldo(pomada),
    saldoShampoo: await loja.saldo(shampoo),
  };
}

test("vendas: dono, recepcionista, gerente e adicional retirado com a manutenção ativa", async ({ page, browser }) => {
  test.setTimeout(360_000);
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(e.message));
  const db = await conectarBancoDeTeste();
  const abertos: { contexto: { close: () => Promise<void> } }[] = [];
  try {
    // ------------------------------------------------------------- cenário
    const loja = await prepararLoja(page, db, "Dona Fictícia das Vendas");
    const { marca, tenantId, api } = loja;
    const pomada = await loja.produto("Pomada modeladora", "VENDA", 10_000, 2500);
    await loja.produto("Óleo para barba", "VENDA", null, null);
    await loja.produto("Álcool 70", "CONSUMO_INTERNO", 5_000, null);
    const maria1 = id();
    const maria2 = id();
    for (const [consumerId, telefone] of [
      [maria1, "(11) 90000-1111"],
      [maria2, "(11) 90000-2222"],
    ]) {
      await db.query(`INSERT INTO consumers (id, tenant_id, name, whatsapp, whatsapp_normalized) VALUES ($1, $2, 'Maria Souza', $3, $4)`, [
        consumerId,
        tenantId,
        telefone,
        `55${telefone.replace(/\D/g, "")}`,
      ]);
    }
    const saldo = () => loja.saldo(pomada);
    const vendasNoBanco = () => loja.contar("SELECT count(*)::int AS n FROM sales WHERE tenant_id = $1");
    const postsDeVenda = criacoesDeVenda(page, tenantId);

    // ------------------------------------------- dono: nova venda
    await page.goto("/conta/visao-geral");
    await navConta(page).getByRole("link", { name: "Vendas", exact: true }).click();
    await expect(page).toHaveURL(/\/conta\/vendas$/);
    await expect(page.getByRole("heading", { level: 1, name: "Vendas" })).toBeVisible();
    for (const aba of ["nova", "minhas", "todas", "recebimentos"]) await expect(page.getByTestId(`aba-${aba}`)).toBeVisible();
    const catalogo = page.getByTestId("catalogo");
    await expect(catalogo.getByTestId("produto-venda")).toHaveCount(2);
    await expect(catalogo).not.toContainText("Álcool 70");
    const noCatalogo = (nome: string) => catalogo.getByTestId("produto-venda").filter({ hasText: nome });
    await expect(noCatalogo("Pomada modeladora")).toContainText("Disponível: 10 UN");
    await expect(noCatalogo("Óleo para barba")).toContainText("Sem saldo");
    await expect(noCatalogo("Óleo para barba")).toContainText("Sem preço sugerido");

    await page.getByRole("button", { name: "Adicionar Pomada modeladora" }).click();
    const linha = (nome: string) => page.getByTestId("linha-venda").filter({ hasText: nome });
    await linha("Pomada modeladora").getByTestId("quantidade-linha").fill("2");
    await expect(linha("Pomada modeladora").getByTestId("total-linha")).toHaveText(reais("50,00"));
    await expect(page.getByTestId("total-previa")).toHaveText(reais("50,00"));

    // Cliente ambíguo: os dois cadastros lado a lado, nada escolhido sozinho.
    // Com "Cliente cadastrado" marcado e nada tocado, a venda não confirma
    // (nem vira balcão sozinha).
    const confirmarVenda = page.getByTestId("confirmar-venda");
    await expect(page.getByTestId("resumo-cliente")).toHaveText("Venda de balcão, sem cliente.");
    await page.getByTestId("modo-cliente").check();
    await expect(page.getByTestId("cliente-pendente")).toHaveText("Selecione um cliente.");
    await expect(page.getByTestId("resumo-cliente")).toHaveCount(0);
    await expect(confirmarVenda).toBeDisabled();
    await page.getByLabel("Procurar cliente").fill("Maria");
    const resultados = page.getByTestId("resultado-cliente");
    await expect(resultados).toHaveCount(2);
    for (const final of ["1111", "2222"]) await expect(resultados.filter({ hasText: `Maria Souza · final ${final}` })).toHaveCount(1);
    await expect(page.getByTestId("aviso-nomes-iguais")).toBeVisible();
    await expect(page.getByTestId("cliente-escolhido")).toHaveCount(0);
    await expect(page.getByTestId("cliente-pendente")).toBeVisible();
    await expect(confirmarVenda).toBeDisabled();
    await confirmarVenda.click({ force: true });
    await page.getByLabel("Procurar cliente").press("Enter");
    expect(postsDeVenda).toHaveLength(0);
    await alcancavelNoCelular(page, [page.getByTestId("modo-cliente"), resultados.first(), confirmarVenda]);
    await capturar(page, "cliente-ambiguo");
    await capturarAreaVisivel(page, "cliente-sem-selecao", page.getByTestId("cliente-pendente"));

    // Escolha pelo ID do resultado tocado; "Trocar cliente" volta ao bloqueio;
    // balcão só quando marcado.
    await resultados.filter({ hasText: "final 1111" }).click();
    await expect(page.getByTestId("cliente-escolhido")).toContainText("Maria Souza · final 1111");
    await expect(page.getByTestId("resumo-cliente")).toHaveText("Cliente: Maria Souza · final 1111.");
    await expect(confirmarVenda).toBeEnabled();
    await page.getByRole("button", { name: "Trocar cliente" }).click();
    await expect(page.getByTestId("cliente-escolhido")).toHaveCount(0);
    await expect(page.getByTestId("cliente-pendente")).toBeVisible();
    await expect(confirmarVenda).toBeDisabled();
    await page.getByTestId("modo-balcao").check();
    await expect(page.getByTestId("resumo-cliente")).toHaveText("Venda de balcão, sem cliente.");
    await expect(confirmarVenda).toBeEnabled();
    await page.getByTestId("modo-cliente").check();
    await expect(confirmarVenda).toBeDisabled();
    await expect(resultados).toHaveCount(2);
    await resultados.filter({ hasText: "final 2222" }).click();
    await expect(page.getByTestId("cliente-escolhido")).toContainText("Maria Souza · final 2222");

    // Sem saldo: a venda inteira é recusada, nada é gravado.
    await page.getByRole("button", { name: "Adicionar Óleo para barba" }).click();
    await linha("Óleo para barba").getByTestId("preco-linha").fill("12,00");
    await expect(page.getByTestId("total-previa")).toHaveText(reais("62,00"));
    await page.getByTestId("confirmar-venda").click();
    await expect(page.getByTestId("erro-venda")).toContainText("Nada foi gravado.");
    await expect(linha("Óleo para barba").getByTestId("aviso-linha")).toBeVisible();
    expect(await vendasNoBanco()).toBe(0);
    expect(await saldo()).toBe(10_000);
    // Tirar o produto recusado apaga a mensagem daquela tentativa.
    await page.getByRole("button", { name: "Remover Óleo para barba" }).click();
    await expect(page.getByTestId("erro-venda")).toHaveCount(0);
    await expect(page.getByTestId("aviso-linha")).toHaveCount(0);
    await capturar(page, "nova-venda");
    await page.getByTestId("confirmar-venda").click();
    const concluida = page.getByTestId("venda-concluida");
    await expect(concluida.getByTestId("total-confirmado")).toHaveText(reais("50,00"));
    await expect(concluida.getByTestId("situacao-recebimento-concluida")).toHaveText("A receber");
    expect(await vendasNoBanco()).toBe(1);
    expect(await saldo()).toBe(8_000);
    const [venda] = (await db.query("SELECT id, consumer_id, total_cents::int AS total FROM sales WHERE tenant_id = $1", [tenantId])).rows;
    expect(venda).toMatchObject({ consumer_id: maria2, total: 5000 });

    // Recebimento: operação separada, depois da venda confirmada.
    await concluida.getByTestId("forma-recebimento-venda").selectOption("PIX");
    await concluida.getByTestId("confirmar-recebimento-venda").click();
    await expect(concluida.getByTestId("recebimento-registrado")).toContainText("R$");
    await capturar(page, "concluida");

    // ------------------------------------------- dono: detalhe, estorno e cancelamento
    await concluida.getByRole("link", { name: "Ver detalhe da venda" }).click();
    await expect(page).toHaveURL(new RegExp(`/conta/vendas/${venda.id}$`));
    await expect(page.getByTestId("detalhe-total")).toHaveText(reais("50,00"));
    await expect(page.getByTestId("detalhe-recebido")).toHaveText(reais("50,00"));
    await expect(page.getByTestId("situacao-recebimento")).toHaveText("Recebida");
    await expect(page.getByTestId("recebimento-da-venda")).toContainText("Recebido");
    await expect(page.getByTestId("cancelar-venda")).toHaveCount(0);
    await expect(page.getByTestId("cancelar-depende-de-estorno")).toBeVisible();
    await capturarEm(page, "detalhe-recebida", 390);
    await alcancavelNoCelular(page, [page.getByTestId("estornar-recebimento-venda")]);
    await capturarAreaVisivel(page, "detalhe-estornar", page.getByTestId("estornar-recebimento-venda"));
    await corrigir(page, "estornar-recebimento-venda", "Cliente desistiu da compra", SENHA);
    await expect(page.getByTestId("situacao-recebimento")).toHaveText("Recebimento estornado");
    await expect(page.getByTestId("detalhe-recebido")).toHaveText(reais("0,00"));
    await corrigir(page, "cancelar-venda", "Produto devolvido na loja", SENHA);
    await expect(page.getByTestId("situacao-venda")).toHaveText("Venda cancelada");
    await expect(page.getByTestId("cancelamento")).toContainText("Produto devolvido na loja");
    await expect(page.getByTestId("receber-venda-detalhe")).toHaveCount(0);
    expect(await saldo()).toBe(10_000);
    await capturar(page, "detalhe");

    // Recebimentos de vendas: recebido, estornado e líquido do período.
    await page.goto("/conta/vendas?aba=recebimentos");
    await expect(page.getByTestId("resumo-recebido-vendas-valor")).toHaveText(reais("50,00"));
    await expect(page.getByTestId("resumo-estornado-vendas-valor")).toHaveText(reais("50,00"));
    await expect(page.getByTestId("resumo-liquido-vendas-valor")).toHaveText(reais("0,00"));

    // Compras na ficha: só no cadastro escolhido por toque.
    await page.goto(`/conta/clientes/${maria2}`);
    const compras = page.getByTestId("ficha-compras");
    await expect(compras.getByTestId("compra")).toHaveCount(1);
    await expect(compras).toContainText("Pomada modeladora");
    await expect(compras).toContainText("Venda cancelada");
    await page.goto(`/conta/clientes/${maria1}`);
    await expect(page.getByTestId("ficha-compras")).toContainText("Nenhuma compra registrada neste cadastro.");

    // Início: o recebido é de atendimentos.
    await page.goto("/conta/visao-geral");
    await expect(page.getByTestId("indicador-recebido").getByText("Recebido em atendimentos", { exact: true })).toBeVisible();

    // ------------------------------------------- estoque com VENDAS
    await page.goto("/conta/estoque/movimentacoes");
    const historico = page.getByRole("table", { name: "Histórico de movimentações" });
    const baixa = historico.locator("tbody tr").filter({ hasText: "Saída por venda" }).first();
    await expect(baixa.getByText("Venda", { exact: true })).toBeVisible();
    await expect(baixa.getByRole("button", { name: /^Ações da movimentação/ })).toHaveCount(0);
    const movimentos = () => loja.contar("SELECT count(*)::int AS n FROM stock_movements WHERE tenant_id = $1");
    const antes = await movimentos();
    await page.getByRole("button", { name: "Registrar movimentação" }).click();
    const form = page.getByTestId("painel-movimentacao");
    await form.getByLabel("Produto").selectOption({ label: "Pomada modeladora (10 UN)" });
    await form.getByLabel("Tipo").selectOption("SAIDA_VENDA");
    await form.getByLabel(/^Quantidade/).fill("1");
    await form.getByRole("button", { name: "Registrar", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("a saída por venda é registrada em Vendas");
    expect(await movimentos()).toBe(antes);
    await form.getByRole("button", { name: "Cancelar" }).click();

    // ------------------------------------------- equipe: recepcionista e gerente
    const criarAcesso = async (perfil: RegExp, nome: string, login: string, senha: string, permissoes: string[]) => {
      await page.goto("/conta/configuracoes/equipe");
      await page.getByRole("main").getByRole("button", { name: "Criar acesso", exact: true }).click();
      const formulario = page.getByTestId("criar-acesso");
      await formulario.getByLabel(perfil).check();
      if (perfil.source.includes("Gerente")) {
        await formulario.getByLabel("Profissional vinculado").selectOption({ label: "Nenhum: não atende clientes" });
      }
      await formulario.getByLabel("Nome da pessoa").fill(nome);
      await formulario.getByLabel("Login").fill(login);
      for (const p of permissoes) await formulario.getByLabel(p, { exact: true }).check();
      await formulario.getByLabel("Senha", { exact: true }).fill(senha);
      await formulario.getByLabel("Confirmar senha").fill(senha);
      return formulario;
    };
    const loginRecepcao = `caixa@${marca}.loja`;
    const formRecepcao = await criarAcesso(/^Recepcionista/, "Recepcionista Fictícia", loginRecepcao, SENHA_RECEPCAO, ["Registrar vendas", "Receber vendas"]);
    // Só as três concessões da recepcionista; nada de agenda, estoque ou consulta geral.
    await expect(formRecepcao.getByLabel("Profissional vinculado")).toHaveCount(0);
    await expect(formRecepcao.getByLabel("Consultar todas as vendas", { exact: true })).toHaveCount(0);
    await expect(formRecepcao.getByLabel("Alterar o preço numa venda nova", { exact: true })).not.toBeChecked();
    await expect(formRecepcao.getByTestId("limites-recepcionista")).toBeVisible();
    await formRecepcao.getByRole("button", { name: "Criar acesso" }).click();
    await confirmarSenhaSePedir(page, SENHA);
    await page.getByTestId("acesso-criado").getByRole("button", { name: "Concluir" }).click();
    await expect(page.getByTestId("acesso-equipe").filter({ hasText: "Recepcionista Fictícia" }).getByTestId("perfil-acesso")).toHaveText("Recepcionista");

    const loginGerente = `gerente@${marca}.loja`;
    const formGerente = await criarAcesso(/^Gerente/, "Gerente Fictício das Vendas", loginGerente, SENHA_GERENTE, ["Cancelar vendas"]);
    await expect(formGerente.getByLabel("Consultar todas as vendas", { exact: true })).toBeChecked();
    await formGerente.getByRole("button", { name: "Criar acesso" }).click();
    await confirmarSenhaSePedir(page, SENHA);
    await page.getByTestId("acesso-criado").getByRole("button", { name: "Concluir" }).click();

    // ------------------------------------------- recepcionista
    const r = await novaPagina(browser);
    abertos.push(r);
    const rp = r.page;
    rp.on("pageerror", (e) => erros.push(e.message));
    await rp.goto("/login");
    await entrarPeloFormulario(rp, loginRecepcao, SENHA_RECEPCAO);
    await expect(rp).toHaveURL(/\/conta\/vendas/);
    await expect(navConta(rp).getByRole("link")).toHaveText(["Vendas", "Configurações"]);
    await expect(rp.getByTestId("aba-nova")).toBeVisible();
    await expect(rp.getByTestId("aba-minhas")).toBeVisible();
    await expect(rp.getByTestId("aba-todas")).toHaveCount(0);
    const catalogoR = rp.getByTestId("catalogo");
    // Disponibilidade sem saldo numérico.
    await expect(catalogoR.getByTestId("produto-venda").filter({ hasText: "Pomada modeladora" }).getByText("Disponível", { exact: true })).toBeVisible();
    await expect(catalogoR).not.toContainText("10 UN");
    await rp.getByRole("button", { name: "Adicionar Pomada modeladora" }).click();
    await expect(rp.getByTestId("preco-linha")).toHaveCount(0);
    // Produto sem preço sugerido: sem "alterar preço", a venda não segue.
    await rp.getByRole("button", { name: "Adicionar Óleo para barba" }).click();
    await expect(rp.getByTestId("confirmar-venda")).toBeDisabled();
    await rp.getByRole("button", { name: "Remover Óleo para barba" }).click();
    await expect(rp.getByTestId("total-previa")).toHaveText(reais("25,00"));
    await rp.getByTestId("confirmar-venda").click();
    const concluidaR = rp.getByTestId("venda-concluida");
    await expect(concluidaR.getByTestId("total-confirmado")).toHaveText(reais("25,00"));
    await concluidaR.getByTestId("forma-recebimento-venda").selectOption("DINHEIRO");
    await concluidaR.getByTestId("confirmar-recebimento-venda").click();
    await expect(concluidaR.getByTestId("recebimento-registrado")).toBeVisible();
    await capturar(rp, "recepcionista");
    await concluidaR.getByRole("link", { name: "Ver detalhe da venda" }).click();
    await expect(rp.getByTestId("situacao-recebimento")).toHaveText("Recebida");
    await expect(rp.getByTestId("estornar-recebimento-venda")).toHaveCount(0);
    await expect(rp.getByTestId("cancelar-venda")).toHaveCount(0);
    // A API recusa a consulta geral e o estoque.
    expect((await rp.request.get(api("/sales?scope=all"))).status()).toBe(403);
    expect((await rp.request.get(api("/stock/products"))).status()).toBe(403);
    expect(await saldo()).toBe(9_000);
    const [vendaR] = (await db.query("SELECT id FROM sales WHERE tenant_id = $1 AND status = 'ATIVA'", [tenantId])).rows;

    // Recebimentos de vendas com dados: o recebimento estornado do dono e o
    // ativo da recepcionista, com os totais do período.
    await page.goto("/conta/vendas?aba=recebimentos");
    await expect(page.getByTestId("lista-recebimentos-vendas").getByTestId("recebimento-venda")).toHaveCount(2);
    await expect(page.getByTestId("resumo-recebido-vendas-valor")).toHaveText(reais("75,00"));
    await expect(page.getByTestId("resumo-estornado-vendas-valor")).toHaveText(reais("50,00"));
    await expect(page.getByTestId("resumo-liquido-vendas-valor")).toHaveText(reais("25,00"));
    await capturarEm(page, "recebimentos-de-vendas", 1280);

    // ------------------------------------------- gerente
    const g = await novaPagina(browser);
    abertos.push(g);
    const gp = g.page;
    gp.on("pageerror", (e) => erros.push(e.message));
    await gp.goto("/login");
    await entrarPeloFormulario(gp, loginGerente, SENHA_GERENTE);
    await expect(gp).toHaveURL(/\/conta\/vendas/);
    await expect(gp.getByTestId("aba-nova")).toHaveCount(0);
    await gp.getByTestId("aba-todas").click();
    await expect(gp.getByTestId("lista-vendas").getByTestId("venda")).toHaveCount(2);
    await gp.goto(`/conta/vendas/${vendaR.id}`);
    await expect(gp.getByTestId("situacao-recebimento")).toHaveText("Recebida");
    await expect(gp.getByTestId("estornar-recebimento-venda")).toHaveCount(0);
    await expect(gp.getByTestId("cancelar-depende-de-estorno")).toBeVisible();

    // ------------------------------------------- VENDAS retirado: manutenção continua
    await db.query("UPDATE tenant_feature_overrides SET enabled = false WHERE tenant_id = $1 AND feature_id = 'feat_vendas'", [tenantId]);
    expect((await page.request.get(api("/sales/catalog"))).status()).toBe(403);
    await page.goto("/conta/vendas");
    await expect(page.getByTestId("aba-minhas")).toBeVisible();
    await expect(page.getByTestId("aba-nova")).toHaveCount(0);
    await expect(navConta(page).getByRole("link", { name: "Vendas", exact: true })).toBeVisible();
    await page.goto(`/conta/vendas/${vendaR.id}`);
    await corrigir(page, "estornar-recebimento-venda", "Troco conferido errado", SENHA);
    await expect(page.getByTestId("situacao-recebimento")).toHaveText("Recebimento estornado");
    await corrigir(page, "cancelar-venda", "Venda desfeita após a retirada", SENHA);
    await expect(page.getByTestId("situacao-venda")).toHaveText("Venda cancelada");
    expect(await saldo()).toBe(10_000);

    await rp.goto("/conta/vendas");
    await expect(rp.getByRole("heading", { name: "Vendas que você registrou" })).toBeVisible();
    await expect(rp.getByTestId("aba-nova")).toHaveCount(0);
    await expect(rp.getByTestId("vendas-mine").getByTestId("venda")).toHaveCount(1);
    await expect(rp.getByTestId("vendas-mine").getByTestId("situacao-venda")).toHaveText("Venda cancelada");

    expect(erros).toEqual([]);
  } finally {
    for (const a of abertos) await a.contexto.close();
    await db.end();
  }
});

test("A: venda gravada e recebimento que falha antes de chegar à API: a tela repete só o recebimento", async ({ page }) => {
  test.setTimeout(120_000);
  const db = await conectarBancoDeTeste();
  try {
    const loja = await prepararLoja(page, db, "Dona Fictícia do Recebimento que Falha");
    const pomada = await loja.produto("Pomada modeladora", "VENDA", 10_000, 2500);
    const shampoo = await loja.produto("Shampoo", "VENDA", 5_000, 3000);
    const criacoes = criacoesDeVenda(page, loja.tenantId);
    await montarVendaDeBalcao(page);
    await page.getByTestId("confirmar-venda").click();
    const concluida = page.getByTestId("venda-concluida");
    await expect(concluida.getByTestId("total-confirmado")).toHaveText(reais("80,00"));

    // A primeira tentativa de recebimento cai na rede: não chega à API.
    let tentativas = 0;
    await page.route(ehRecebimento(loja.tenantId), async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      tentativas += 1;
      return tentativas === 1 ? route.abort("failed") : route.continue();
    });
    await concluida.getByTestId("forma-recebimento-venda").selectOption("PIX");
    await concluida.getByTestId("confirmar-recebimento-venda").click();
    await expect(concluida.getByTestId("recebimento-incerto")).toBeVisible();
    // A venda continua na tela, confirmada e a receber; só o recebimento se repete.
    await expect(concluida.getByTestId("total-confirmado")).toHaveText(reais("80,00"));
    await expect(concluida.getByTestId("situacao-recebimento-concluida")).toHaveText("A receber");
    await expect(page.getByTestId("confirmar-venda")).toHaveCount(0);
    await expect(concluida.getByTestId("confirmar-recebimento-venda")).toHaveText("Enviar de novo");
    expect(await retrato(loja, pomada, shampoo)).toMatchObject({ vendas: 1, recebimentos: 0 });

    await concluida.getByTestId("confirmar-recebimento-venda").click();
    await expect(concluida.getByTestId("recebimento-registrado")).toContainText("80,00");
    expect(tentativas).toBe(2);
    expect(criacoes).toHaveLength(1);
    expect(await retrato(loja, pomada, shampoo)).toEqual({
      vendas: 1,
      baixas: 2,
      itens: 2,
      recebimentos: 1,
      auditoriaDoRecebimento: 1,
      saldoPomada: 8_000,
      saldoShampoo: 4_000,
    });
  } finally {
    await db.end();
  }
});

test("B: resposta da criação da venda perdida depois de gravada: mesma chave, mesmo corpo, mesma venda", async ({ page }) => {
  test.setTimeout(120_000);
  const db = await conectarBancoDeTeste();
  try {
    const loja = await prepararLoja(page, db, "Dona Fictícia da Venda sem Resposta");
    const pomada = await loja.produto("Pomada modeladora", "VENDA", 10_000, 2500);
    const shampoo = await loja.produto("Shampoo", "VENDA", 5_000, 3000);
    const criacoes = criacoesDeVenda(page, loja.tenantId);
    await montarVendaDeBalcao(page);

    // A primeira criação vai à API real e é gravada; só então a resposta é
    // bloqueada antes de chegar ao navegador.
    const primeira: { gravada: { sale: { id: string }; created: boolean } | null; vendasAoBloquear: number } = { gravada: null, vendasAoBloquear: -1 };
    await page.route(ehCriacaoDeVenda(loja.tenantId), async (route) => {
      if (route.request().method() !== "POST" || primeira.gravada) return route.continue();
      const resposta = await route.fetch();
      expect(resposta.status()).toBe(200);
      primeira.gravada = (await resposta.json()) as { sale: { id: string }; created: boolean };
      primeira.vendasAoBloquear = await loja.contar("SELECT count(*)::int AS n FROM sales WHERE tenant_id = $1");
      return route.abort("failed");
    });
    await page.getByTestId("confirmar-venda").click();
    await expect(page.getByTestId("venda-incerta")).toBeVisible();
    expect(primeira.gravada?.created).toBe(true);
    expect(primeira.vendasAoBloquear).toBe(1);
    await expect(page.getByTestId("confirmar-venda")).toHaveText("Enviar de novo");
    // O formulário fica travado: nada muda o pedido repetido.
    await expect(page.getByRole("button", { name: "Remover Shampoo" })).toBeDisabled();

    const segunda = page.waitForResponse((r) => r.request().method() === "POST" && ehCriacaoDeVenda(loja.tenantId)(new URL(r.url())));
    await page.getByTestId("confirmar-venda").click();
    const repetida = (await (await segunda).json()) as { sale: { id: string }; created: boolean };
    await expect(page.getByTestId("venda-concluida")).toContainText("Esta venda já estava registrada");
    await expect(page.getByTestId("total-confirmado")).toHaveText(reais("80,00"));

    expect(criacoes).toHaveLength(2);
    expect(criacoes[1]).toBe(criacoes[0]);
    const [primeiroCorpo, segundoCorpo] = criacoes.map((c) => JSON.parse(c) as { requestKey: string });
    expect(segundoCorpo.requestKey).toBe(primeiroCorpo.requestKey);
    expect(repetida).toMatchObject({ created: false, sale: { id: primeira.gravada?.sale.id } });
    expect(await retrato(loja, pomada, shampoo)).toMatchObject({ vendas: 1, baixas: 2, itens: 2, recebimentos: 0, saldoPomada: 8_000, saldoShampoo: 4_000 });
  } finally {
    await db.end();
  }
});

test("C: resposta do recebimento perdida depois de gravado: mesma chave, mesmo corpo, mesmo recebimento", async ({ page }) => {
  test.setTimeout(120_000);
  const db = await conectarBancoDeTeste();
  try {
    const loja = await prepararLoja(page, db, "Dona Fictícia do Recebimento sem Resposta");
    const pomada = await loja.produto("Pomada modeladora", "VENDA", 10_000, 2500);
    const shampoo = await loja.produto("Shampoo", "VENDA", 5_000, 3000);
    const criacoes = criacoesDeVenda(page, loja.tenantId);
    await montarVendaDeBalcao(page);
    await page.getByTestId("confirmar-venda").click();
    const concluida = page.getByTestId("venda-concluida");
    await expect(concluida.getByTestId("total-confirmado")).toHaveText(reais("80,00"));

    const corpos: string[] = [];
    const primeiro: { gravado: { payment: { id: string }; created: boolean } | null; recebimentosAoBloquear: number } = {
      gravado: null,
      recebimentosAoBloquear: -1,
    };
    await page.route(ehRecebimento(loja.tenantId), async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      corpos.push(route.request().postData() ?? "");
      if (primeiro.gravado) return route.continue();
      const resposta = await route.fetch();
      expect(resposta.status()).toBe(200);
      primeiro.gravado = (await resposta.json()) as { payment: { id: string }; created: boolean };
      primeiro.recebimentosAoBloquear = await loja.contar("SELECT count(*)::int AS n FROM sale_payments WHERE tenant_id = $1");
      return route.abort("failed");
    });
    await concluida.getByTestId("forma-recebimento-venda").selectOption("CARTAO_DEBITO");
    await concluida.getByTestId("confirmar-recebimento-venda").click();
    await expect(concluida.getByTestId("recebimento-incerto")).toBeVisible();
    expect(primeiro.gravado?.created).toBe(true);
    expect(primeiro.recebimentosAoBloquear).toBe(1);
    await expect(concluida.getByTestId("forma-recebimento-venda")).toBeDisabled();

    const segunda = page.waitForResponse((r) => r.request().method() === "POST" && ehRecebimento(loja.tenantId)(new URL(r.url())));
    await concluida.getByTestId("confirmar-recebimento-venda").click();
    const repetido = (await (await segunda).json()) as { payment: { id: string }; created: boolean };
    await expect(concluida.getByTestId("recebimento-registrado")).toContainText("80,00");

    expect(corpos).toHaveLength(2);
    expect(corpos[1]).toBe(corpos[0]);
    const [primeiroCorpo, segundoCorpo] = corpos.map((c) => JSON.parse(c) as { requestKey: string });
    expect(segundoCorpo.requestKey).toBe(primeiroCorpo.requestKey);
    expect(repetido).toMatchObject({ created: false, payment: { id: primeiro.gravado?.payment.id } });
    expect(criacoes).toHaveLength(1);
    expect(await retrato(loja, pomada, shampoo)).toEqual({
      vendas: 1,
      baixas: 2,
      itens: 2,
      recebimentos: 1,
      auditoriaDoRecebimento: 1,
      saldoPomada: 8_000,
      saldoShampoo: 4_000,
    });
  } finally {
    await db.end();
  }
});
