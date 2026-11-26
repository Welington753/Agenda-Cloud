// Vendas v1 (adicional VENDAS, docs/plans/vendas-v1.md) pela tela real (API e
// web reais, PostgreSQL DESCARTÁVEL, só dados fictícios). VENDAS e ESTOQUE
// ligados como a assinatura liga (override do recurso; o preço do adicional
// continua pendente e não é definido aqui).
//
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
// Capturas (1280 e 390 px) em PLAYWRIGHT_OUTPUT_DIR; sem rolagem lateral
// também em 360 px. Invocação própria (`npm run test:browser:vendas`): 1
// aceite de convite e 2 logins.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { API_DE_TESTE, conectarBancoDeTeste, criarContaDeTeste } from "./support/contas-de-teste";
import { entrarPeloFormulario, navConta, semRolagemHorizontal } from "./support/portal";

const SENHA = "senha-do-dono-das-vendas-1";
const SENHA_RECEPCAO = "senha-da-recepcionista-1";
const SENHA_GERENTE = "senha-do-gerente-vendas-1";
const id = () => randomUUID().replaceAll("-", "").slice(0, 24);
const chave = () => randomUUID().replaceAll("-", "");
/** Valor em reais como `formatarMoeda` escreve (espaço inseparável). */
const reais = (valor: string) => new RegExp(`R\\$\\s${valor}$`);

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

test("vendas: dono, recepcionista, gerente e adicional retirado com a manutenção ativa", async ({ page, browser }) => {
  test.setTimeout(360_000);
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(e.message));
  const marca = `vendas-${id().slice(0, 10)}`;
  const db = await conectarBancoDeTeste();
  const abertos: { contexto: { close: () => Promise<void> } }[] = [];
  try {
    // ------------------------------------------------------------- cenário
    const dono = await criarContaDeTeste(page.request, {
      ownerName: "Dona Fictícia das Vendas",
      businessName: `${marca} Barbearia`,
      email: `${marca}@example.test`,
      password: SENHA,
    });
    const tenantId = dono.tenant.id;
    for (const recurso of ["feat_estoque", "feat_vendas"]) {
      await db.query(`INSERT INTO tenant_feature_overrides (id, tenant_id, feature_id, enabled) VALUES ($1, $2, $3, true)`, [id(), tenantId, recurso]);
    }
    const api = (caminho: string) => `${API_DE_TESTE}/tenants/${tenantId}${caminho}`;
    const categoria = await page.request.post(api("/stock/categories"), { data: { name: "Cabelo" } });
    expect(categoria.status(), await categoria.text()).toBe(200);
    const categoryId = ((await categoria.json()) as { id: string }).id;
    const produto = async (name: string, purpose: string, saldo: number | null, preco: number | null) => {
      const r = await page.request.post(api("/stock/products"), {
        data: {
          requestKey: chave(),
          name,
          description: null,
          internalCode: null,
          categoryId,
          purpose,
          unit: "UN",
          minQuantityMilli: 1000,
          initialQuantityMilli: saldo,
          salePriceCents: preco,
        },
      });
      expect(r.status(), await r.text()).toBe(200);
      return ((await r.json()) as { product: { id: string } }).product.id;
    };
    const pomada = await produto("Pomada modeladora", "VENDA", 10_000, 2500);
    await produto("Óleo para barba", "VENDA", null, null);
    await produto("Álcool 70", "CONSUMO_INTERNO", 5_000, null);
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
    const saldo = async () => Number((await db.query("SELECT balance_milli FROM stock_products WHERE id = $1", [pomada])).rows[0].balance_milli);
    const vendasNoBanco = async () => (await db.query("SELECT count(*)::int AS n FROM sales WHERE tenant_id = $1", [tenantId])).rows[0].n as number;

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
    await page.getByTestId("modo-cliente").check();
    await page.getByLabel("Procurar cliente").fill("Maria");
    const resultados = page.getByTestId("resultado-cliente");
    await expect(resultados).toHaveCount(2);
    for (const final of ["1111", "2222"]) await expect(resultados.filter({ hasText: `Maria Souza · final ${final}` })).toHaveCount(1);
    await expect(page.getByTestId("aviso-nomes-iguais")).toBeVisible();
    await expect(page.getByTestId("cliente-escolhido")).toHaveCount(0);
    await capturar(page, "cliente-ambiguo");
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
    await page.getByRole("button", { name: "Remover Óleo para barba" }).click();
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
    await expect(page.getByTestId("cancelar-venda")).toHaveCount(0);
    await expect(page.getByTestId("cancelar-depende-de-estorno")).toBeVisible();
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
    const movimentos = async () => (await db.query("SELECT count(*)::int AS n FROM stock_movements WHERE tenant_id = $1", [tenantId])).rows[0].n as number;
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
