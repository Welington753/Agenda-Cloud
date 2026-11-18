// Estoque v1 pela tela real (API e web reais, PostgreSQL DESCARTÁVEL, só dados
// fictícios). A mesma conta é dona de um estabelecimento e proprietária da
// plataforma (como nas suítes do portal):
// - sem o adicional: nada de Estoque no menu, e o endereço direto mostra o
//   motivo (a API recusa);
// - portal: preço do ESTOQUE no catálogo (se pendente) e contratação em
//   "Plano e adicionais" (conversão para a assinatura modular);
// - dono: categoria e subcategoria, produto com saldo inicial, saída,
//   estorno, perda com motivo, conferência com diferença e estoque baixo,
//   arquivamento sem perder o histórico;
// - rascunho da conferência apagado no logout;
// - gerente só com "Ver estoque": vê, sem botões de operação; funcionário
//   pelo endereço vai para a própria agenda;
// - retirar o adicional bloqueia e preserva; recontratar devolve os dados;
// - celular (390 e 360): a seção fica no menu da conta, sem rolagem lateral.
// Invocação própria (`npm run test:browser:estoque`): 1 aceite e 1 login.
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { conectarBancoDeTeste, criarContaDeTeste, garantirPrecoBaseModular } from "./support/contas-de-teste";
import { entrarPeloFormulario, navConta, semRolagemHorizontal } from "./support/portal";

const SENHA = "senha-do-estoque-123";
const id = () => randomUUID().replaceAll("-", "").slice(0, 10);
const ITENS_DO_ESTOQUE = ["Produtos", "Categorias", "Movimentações", "Conferência de estoque"];

async function confirmarSenhaSePedir(page: Page) {
  const dialogo = page.getByTestId("confirmar-senha");
  const apareceu = await dialogo.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);
  if (apareceu) {
    await page.getByLabel("Sua senha", { exact: true }).fill(SENHA);
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  }
}

async function capturar(page: Page, nome: string) {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await semRolagemHorizontal(page);
    await page.screenshot({ path: test.info().outputPath(`estoque-${nome}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

/** Contrata (true) ou retira (false) o ESTOQUE na aba "Plano e adicionais". */
async function mudarEstoqueNoPortal(page: Page, tenantId: string, contratar: boolean) {
  await page.goto(`/portal/estabelecimentos/${tenantId}?aba=plano`);
  await expect(page.getByTestId("plano-e-adicionais")).toBeVisible();
  const converter = page.getByRole("button", { name: "Converter para assinatura modular" });
  if (await converter.isVisible().catch(() => false)) {
    await converter.click();
    await page.getByTestId("campo-limite").fill("3");
    // A conversão parte dos recursos do plano anterior; sem preço definido
    // eles impediriam a revisão. Só o ESTOQUE interessa aqui.
    for (const outro of ["INDICADORES", "COMISSOES"]) {
      const caixaOutro = page.getByTestId(`adicional-${outro}`).getByRole("checkbox");
      if (await caixaOutro.isChecked().catch(() => false)) await caixaOutro.uncheck();
    }
  }
  const caixa = page.getByTestId("adicional-ESTOQUE").getByRole("checkbox");
  await expect(caixa).toBeEnabled();
  if (contratar) await caixa.check();
  else await caixa.uncheck();
  await page.getByRole("button", { name: "Revisar assinatura" }).click();
  const retirada = page.getByTestId("revisao-assinatura").getByText(/Confirmo a retirada/);
  if (await retirada.isVisible().catch(() => false)) await retirada.click();
  await page.getByRole("dialog").getByRole("button", { name: "Salvar assinatura" }).click();
  await confirmarSenhaSePedir(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  if (contratar) await expect(page.getByTestId("adicional-ESTOQUE").getByRole("checkbox")).toBeChecked();
  else await expect(page.getByTestId("adicional-ESTOQUE").getByRole("checkbox")).not.toBeChecked();
}

async function abrirNoMenu(page: Page, rotulo: string) {
  await navConta(page).getByRole("link", { name: rotulo, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: rotulo })).toBeVisible();
}

test("estoque: contratação no portal, operação do dono, papéis, retirada e recontratação", async ({ page }) => {
  test.setTimeout(300_000);
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(e.message));
  const marca = `estoque-${id()}`;
  const db = await conectarBancoDeTeste();
  try {
    const conta = await criarContaDeTeste(page.request, {
      ownerName: "Dona Fictícia do Estoque",
      businessName: `${marca} Barbearia`,
      email: `${marca}@example.test`,
      password: SENHA,
    });
    const tenantId = conta.tenant.id;
    await db.query("UPDATE users SET platform_role = 'MASTER_OWNER' WHERE id = $1", [conta.user.id]);
    await garantirPrecoBaseModular(db, conta.user.id);

    // ------------------------------------------- sem o adicional
    await page.goto("/conta/visao-geral");
    await expect(navConta(page).getByRole("link", { name: "Agenda", exact: true })).toBeVisible();
    await expect(navConta(page).getByText("Estoque", { exact: true })).toHaveCount(0);
    await page.goto("/conta/estoque/produtos");
    await expect(page.getByTestId("estoque-falha-nao_contratado")).toBeVisible();

    // ------------------------------------------- portal: preço (se pendente) e contratação
    await page.goto("/portal/planos");
    await expect(page.getByTestId("preco-modular-ESTOQUE")).toBeVisible();
    if (await page.getByTestId("preco-modular-ESTOQUE").getByText("A definir").isVisible()) {
      await page.getByTestId("editar-ESTOQUE").click();
      await page.getByRole("dialog").getByLabel("Preço mensal padrão (R$)").fill("19,90");
      await page.getByRole("dialog").getByRole("button", { name: "Salvar", exact: true }).click();
      await confirmarSenhaSePedir(page);
    }
    await expect(page.getByTestId("preco-modular-ESTOQUE")).not.toContainText("A definir");
    await mudarEstoqueNoPortal(page, tenantId, true);

    // ------------------------------------------- dono: menu e categorias
    await page.goto("/conta/visao-geral");
    await expect(navConta(page).getByText("Estoque", { exact: true })).toBeVisible();
    for (const rotulo of ITENS_DO_ESTOQUE) await expect(navConta(page).getByRole("link", { name: rotulo, exact: true })).toBeVisible();
    await abrirNoMenu(page, "Categorias");
    await page.getByLabel("Nome da nova categoria").fill("Cabelo");
    await page.getByRole("button", { name: "Criar categoria" }).click();
    await expect(page.getByRole("heading", { name: "Cabelo" })).toBeVisible();
    await page.getByRole("button", { name: "Nova subcategoria" }).click();
    await page.getByLabel("Nome da nova subcategoria").fill("Pomadas");
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByRole("list", { name: "Subcategorias de Cabelo" })).toContainText("Pomadas");
    await capturar(page, "categorias");

    // ------------------------------------------- produto com saldo inicial
    await abrirNoMenu(page, "Produtos");
    await page.getByRole("button", { name: "Novo produto" }).click();
    const painel = page.getByTestId("painel-produto");
    await painel.getByLabel("Nome", { exact: true }).fill("Pomada modeladora");
    await painel.getByLabel("Categoria", { exact: true }).selectOption({ label: "Cabelo" });
    await painel.getByLabel("Subcategoria (opcional)").selectOption({ label: "Pomadas" });
    await painel.getByLabel("Finalidade").selectOption("VENDA");
    await painel.getByLabel("Estoque mínimo").fill("2");
    await painel.getByLabel("Saldo inicial (opcional)").fill("10");
    await capturar(page, "novo-produto");
    await painel.getByRole("button", { name: "Cadastrar produto" }).click();
    const linha = page.locator("[data-testid^='produto-']").filter({ hasText: "Pomada modeladora" });
    await expect(linha.getByTestId("saldo")).toHaveText("10 UN");

    // ------------------------------------------- saída, estorno e perda
    await abrirNoMenu(page, "Movimentações");
    await expect(page.getByRole("list", { name: "Histórico de movimentações" })).toContainText("Saldo inicial");
    const registrar = async (tipo: string, quantidade: string, motivo?: string) => {
      await page.getByRole("button", { name: "Nova movimentação" }).click();
      const form = page.getByTestId("painel-movimentacao");
      await form.getByLabel("Produto").selectOption({ label: "Pomada modeladora (10 UN)" }).catch(async () => {
        await form.getByLabel("Produto").selectOption({ index: 1 });
      });
      await form.getByLabel("Tipo").selectOption(tipo);
      await form.getByLabel(/^Quantidade/).fill(quantidade);
      if (motivo) await form.getByLabel(/^Motivo|^Observação/).fill(motivo);
      await form.getByRole("button", { name: "Registrar" }).click();
      await expect(form).toHaveCount(0);
    };
    await registrar("SAIDA_VENDA", "3");
    const historico = page.getByRole("list", { name: "Histórico de movimentações" });
    await expect(historico.locator("li").first()).toContainText("Saída por venda");
    await expect(historico.locator("li").first()).toContainText("10 UN → 7 UN");
    await historico.locator("li").first().getByRole("button", { name: "Estornar" }).click();
    await historico.locator("li").first().getByLabel("Motivo do estorno").fill("Venda lançada em duplicidade");
    await historico.locator("li").first().getByRole("button", { name: "Confirmar estorno" }).click();
    await expect(historico.locator("li").first()).toContainText("Estorno");
    await expect(historico.locator("li").first()).toContainText("7 UN → 10 UN");
    await expect(historico).toContainText("Estornada");
    await registrar("SAIDA_PERDA", "1", "Embalagem rasgada");
    await expect(historico.locator("li").first()).toContainText("Motivo: Embalagem rasgada");
    await capturar(page, "movimentacoes");

    // ------------------------------------------- conferência com diferença; estoque baixo
    await abrirNoMenu(page, "Conferência de estoque");
    await page.getByRole("button", { name: "Começar contagem" }).click();
    await page.getByLabel("Quantidade encontrada de Pomada modeladora (UN)").fill("2");
    await capturar(page, "contagem");
    // Rascunho guardado só para esta pessoa e este estabelecimento.
    const chaves = () => page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("timvix:estoque:conferencia:")));
    expect(await chaves()).toEqual([`timvix:estoque:conferencia:v1:${conta.user.id}:${tenantId}`]);
    await page.getByRole("button", { name: "Revisar diferenças" }).click();
    await expect(page.getByTestId("revisao")).toContainText("9 UN → 2 UN");
    await expect(page.getByTestId("revisao")).toContainText("(-7 UN)");
    await capturar(page, "revisao");
    await page.getByRole("button", { name: "Confirmar ajustes" }).click();
    await expect(page.getByText("1 conferidos, 1 com ajuste")).toBeVisible();
    expect(await chaves()).toEqual([]);
    await abrirNoMenu(page, "Produtos");
    await expect(linha.getByTestId("saldo")).toHaveText("2 UN");
    await expect(linha.getByTestId("estoque-baixo")).toBeVisible();

    // Rascunho em andamento some no logout.
    await abrirNoMenu(page, "Conferência de estoque");
    await page.getByRole("button", { name: "Começar contagem" }).click();
    await page.getByLabel("Quantidade encontrada de Pomada modeladora (UN)").fill("5");
    expect(await chaves()).toHaveLength(1);
    await page.getByTestId("abrir-menu-conta").click();
    await page.getByTestId("menu-conta").getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await chaves()).toEqual([]);
    await entrarPeloFormulario(page, `${marca}@example.test`, SENHA);
    await expect(page).toHaveURL(/\/conta/);

    // ------------------------------------------- celular: a seção no menu da conta
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/conta/estoque/produtos");
      await expect(page.getByRole("heading", { level: 1, name: "Produtos" })).toBeVisible();
      await page.getByTestId("abrir-menu-conta").click();
      const mais = page.getByTestId("menu-mais-areas");
      for (const rotulo of ITENS_DO_ESTOQUE) await expect(mais.getByRole("link", { name: rotulo, exact: true })).toBeVisible();
      await semRolagemHorizontal(page);
      await page.screenshot({ path: test.info().outputPath(`estoque-menu-celular-${width}.png`) });
      await page.keyboard.press("Escape");
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    // ------------------------------------------- arquivar sem perder o histórico
    await page.goto("/conta/estoque/produtos");
    await linha.getByRole("button", { name: "Arquivar" }).click();
    await expect(linha).toContainText("O saldo de 2 UN e o histórico ficam preservados");
    await linha.getByRole("button", { name: "Arquivar" }).click();
    await expect(linha.getByText("Arquivado")).toBeVisible();
    await page.getByLabel("Situação").selectOption("ARCHIVED");
    await expect(linha).toBeVisible();
    await linha.getByRole("button", { name: "Reativar" }).click();
    await expect(linha.getByText("Arquivado")).toHaveCount(0);

    // ------------------------------------------- gerente só com "Ver estoque"
    await db.query("UPDATE memberships SET role = 'GERENTE', permissions_confirmed_at = now() WHERE tenant_id = $1 AND user_id = $2", [tenantId, conta.user.id]);
    await db.query(
      `INSERT INTO membership_permission_overrides (id, tenant_id, membership_id, permission, mode)
       SELECT $1, tenant_id, id, 'ESTOQUE_VISUALIZAR', 'GRANTED' FROM memberships WHERE tenant_id = $2 AND user_id = $3`,
      [id(), tenantId, conta.user.id],
    );
    await page.goto("/conta/estoque/produtos");
    await expect(page.getByRole("heading", { level: 1, name: "Produtos" })).toBeVisible();
    expect(await navConta(page).getByRole("link").allTextContents()).toEqual([...ITENS_DO_ESTOQUE, "Configurações"]);
    await expect(linha).toBeVisible();
    await expect(page.getByRole("button", { name: "Novo produto" })).toHaveCount(0);
    await expect(linha.getByRole("button", { name: "Editar" })).toHaveCount(0);
    await page.goto("/conta/estoque/movimentacoes");
    await expect(page.getByRole("button", { name: "Nova movimentação" })).toHaveCount(0);

    // ------------------------------------------- funcionário: pelo endereço vai para a própria agenda
    const professionalId = id();
    await db.query(`INSERT INTO professionals (id, tenant_id, name, avatar_initials, avatar_color) VALUES ($1, $2, 'Profissional Fictícia', 'PF', '#000000')`, [professionalId, tenantId]);
    await db.query("UPDATE memberships SET role = 'PROFISSIONAL', professional_id = $3 WHERE tenant_id = $1 AND user_id = $2", [tenantId, conta.user.id, professionalId]);
    await page.goto("/conta/estoque/produtos");
    await expect(page).toHaveURL(/\/conta\/minha-agenda$/);
    await expect(navConta(page).getByText("Produtos", { exact: true })).toHaveCount(0);
    await db.query("DELETE FROM membership_permission_overrides WHERE tenant_id = $1", [tenantId]);
    await db.query("UPDATE memberships SET role = 'DONO', professional_id = NULL WHERE tenant_id = $1 AND user_id = $2", [tenantId, conta.user.id]);

    // ------------------------------------------- retirar bloqueia e preserva; recontratar devolve
    await mudarEstoqueNoPortal(page, tenantId, false);
    await page.goto("/conta/visao-geral");
    await expect(navConta(page).getByRole("link", { name: "Agenda", exact: true })).toBeVisible();
    await expect(navConta(page).getByText("Estoque", { exact: true })).toHaveCount(0);
    await page.goto("/conta/estoque/produtos");
    await expect(page.getByTestId("estoque-falha-nao_contratado")).toBeVisible();
    await mudarEstoqueNoPortal(page, tenantId, true);
    await page.goto("/conta/estoque/produtos");
    await expect(linha.getByTestId("saldo")).toHaveText("2 UN");
    await page.goto("/conta/estoque/movimentacoes");
    await expect(page.getByRole("list", { name: "Histórico de movimentações" })).toContainText("Ajuste de conferência");

    expect(erros).toEqual([]);
  } finally {
    await db.end();
  }
});
