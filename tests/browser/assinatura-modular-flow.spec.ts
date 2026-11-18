// Assinatura modular pela tela real (API e web reais, banco descartável):
// preço de adicional no catálogo, criação com limite explícito e adicional,
// aba "Plano e adicionais" com revisão antes de salvar, histórico. Capturas
// em computador e celular, claro e escuro, sem rolagem horizontal. Preços
// são exemplos (R$ 29,90 / 9,90), nunca preços aprovados.
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { conectarBancoDeTeste, criarContaDeTeste, garantirPrecoBaseModular } from "./support/contas-de-teste";
import { navPortal } from "./support/portal";

const SENHA = "senha-assinatura-123";
const id = () => randomUUID().replaceAll("-", "").slice(0, 10);

async function confirmarSenhaSePedir(page: Page) {
  const dialogo = page.getByTestId("confirmar-senha");
  const apareceu = await dialogo
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (apareceu) {
    await page.getByLabel("Sua senha", { exact: true }).fill(SENHA);
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  }
}

async function capturar(page: Page, nome: string, pasta: (f: string) => string) {
  for (const tema of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: tema });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: pasta(`assinatura-${nome}-${tema}-${width}.png`), fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 844 });
}

test("assinatura modular: catálogo, criação com limite, revisão e histórico", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const marca = `assin-${id()}`;
  const db = await conectarBancoDeTeste();
  try {
    const conta = await criarContaDeTeste(page.request, {
      ownerName: "Pessoa da Plataforma",
      businessName: `${marca} Sede`,
      email: `${marca}@example.test`,
      password: SENHA,
    });
    await db.query("UPDATE users SET platform_role = 'MASTER_OWNER' WHERE id = $1", [conta.user.id]);
    await garantirPrecoBaseModular(db, conta.user.id);

    // Catálogo: define o preço de Indicadores (se ainda não houver).
    await page.goto("/portal/planos");
    await expect(page.getByTestId("catalogo-modular")).toContainText("Planejado");
    if (await page.getByTestId("preco-modular-INDICADORES").getByText("A definir").isVisible()) {
      await page.getByTestId("editar-INDICADORES").click();
      await page.getByRole("dialog").getByLabel("Preço mensal padrão (R$)").fill("9,90");
      await page.getByRole("dialog").getByRole("button", { name: "Salvar", exact: true }).click();
      await confirmarSenhaSePedir(page);
    }
    await expect(page.getByTestId("preco-modular-INDICADORES")).not.toContainText("A definir");
    await capturar(page, "catalogo", (f) => testInfo.outputPath(f));

    // Criação: limite obrigatório, planejados desativados, resumo antes de criar.
    await navPortal(page).getByRole("link", { name: "Estabelecimentos" }).click();
    await page.getByRole("link", { name: "Novo estabelecimento" }).click();
    await page.getByLabel("Nome do estabelecimento").fill(`${marca} Barbearia Aurora`);
    await page.getByLabel("Segmento").selectOption("BARBERSHOP");
    await expect(page.getByRole("button", { name: "Revisar e criar" })).toBeDisabled();
    await page.getByLabel("Limite de usuários da equipe").fill("2");
    await page.getByTestId("adicional-INDICADORES").getByRole("checkbox").check();
    await expect(page.getByTestId("futuro-WHATSAPP").getByRole("checkbox")).toBeDisabled();
    await page.getByLabel("Nome", { exact: true }).fill("Dona Aurora");
    await page.getByLabel("E-mail").fill(`${marca}-dona@example.test`);
    await expect(page.getByTestId("resumo-assinatura")).toContainText("Indicadores avançados");
    await capturar(page, "criacao", (f) => testInfo.outputPath(f));
    await page.getByRole("button", { name: "Revisar e criar" }).click();
    const revisaoCriacao = page.getByTestId("revisao-criacao");
    await expect(revisaoCriacao).toContainText("Novo valor recorrente");
    await expect(revisaoCriacao).toContainText("Limite de usuários da equipe: 2");
    await expect(revisaoCriacao).toContainText("Não há cobrança retroativa nem proporcional");
    await page.getByRole("dialog").getByRole("button", { name: "Criar e convidar" }).click();
    await expect(page.getByTestId("resultado-envio")).toContainText("Estabelecimento criado e convite registrado.");
    await page.getByRole("link", { name: "Abrir a ficha" }).click();

    // Aba "Plano e adicionais": uso, limite, revisão e nova versão.
    await expect(page.getByTestId("plano-e-adicionais")).toBeVisible();
    await expect(page.getByTestId("uso-limite")).toHaveText("0 de 2 acessos utilizados");
    await expect(page.getByTestId("adicional-INDICADORES").getByRole("checkbox")).toBeChecked();
    await capturar(page, "plano-e-adicionais", (f) => testInfo.outputPath(f));
    await page.getByTestId("campo-limite").fill("4");
    await page.getByRole("button", { name: "Ajustar valor contratado" }).click();
    await page.getByLabel("Valor mensal contratado (R$)").fill("35,00");
    await expect(page.getByRole("button", { name: "Revisar assinatura" })).toBeDisabled();
    await page.getByLabel("Motivo do valor negociado").fill("Desconto de lançamento");
    await page.getByRole("button", { name: "Revisar assinatura" }).click();
    const revisao = page.getByTestId("revisao-assinatura");
    await expect(revisao).toContainText("Novo valor recorrente: R$ 35,00/mês");
    await expect(revisao).toContainText("(hoje 2)");
    await expect(revisao).toContainText("Não há cobrança retroativa nem proporcional");
    await capturar(page, "revisao", (f) => testInfo.outputPath(f));
    await page.getByRole("dialog").getByRole("button", { name: "Salvar assinatura" }).click();
    await confirmarSenhaSePedir(page);
    await expect(page.getByTestId("uso-limite")).toHaveText("0 de 4 acessos utilizados");

    // Histórico: duas versões, com o valor negociado e o motivo.
    await page.getByRole("navigation", { name: "Seções do estabelecimento" }).getByRole("link", { name: "Histórico" }).click();
    const historico = page.getByTestId("historico-assinatura");
    await expect(historico).toContainText("Versão 2");
    await expect(historico).toContainText("Desconto de lançamento");
    await expect(historico).toContainText("Versão 1");
    await capturar(page, "historico", (f) => testInfo.outputPath(f));
  } finally {
    await db.end();
  }
});
