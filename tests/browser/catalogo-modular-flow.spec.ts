// Edição do catálogo modular pela tela real (API e web reais, banco
// descartável). Prova:
// - "Editar" em cada cartão de Planos e adicionais (essencial, disponíveis,
//   em desenvolvimento e planejados), com Salvar, Cancelar, validação e o
//   aviso de que o preço padrão não reajusta assinaturas existentes;
// - nome repetido volta ao formulário com a mensagem do servidor;
// - o planejado continua sem poder ser contratado;
// - a criação do estabelecimento e a aba "Plano e adicionais" da ficha
//   mostram os nomes atuais e não têm campo nem ação de editar o catálogo;
// - o mesmo formulário em todos os temas, no computador e no celular, sem
//   rolagem horizontal.
// Preços são exemplos, nunca preços aprovados. Os specs dividem o banco: o
// fim do teste devolve nomes, descrições e preços que ele mudou.
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { conectarBancoDeTeste, criarContaDeTeste, garantirPrecoBaseModular } from "./support/contas-de-teste";
import { navPortal } from "./support/portal";

const SENHA = "senha-catalogo-modular-1";
const id = () => randomUUID().replaceAll("-", "").slice(0, 6);
const TEMAS = ["claro", "escuro", "sistema", "azul"] as const;

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

interface Original {
  code: string;
  name: string;
  description: string;
  priceCents: number | null;
}

async function guardarOriginais(db: Client): Promise<Original[]> {
  const { rows } = await db.query<Original>(
    `SELECT m.code, m.name, m.description,
            (SELECT amount_cents FROM addon_module_prices p WHERE p.module_code = m.code ORDER BY recorded_at DESC, id DESC LIMIT 1) AS "priceCents"
       FROM addon_modules m
     UNION ALL
     SELECT p.id, p.name, p.short_description,
            (SELECT amount_cents FROM plan_prices pp WHERE pp.plan_id = p.id AND pp.billing_cycle = 'MONTHLY' ORDER BY recorded_at DESC, id DESC LIMIT 1)
       FROM plans p WHERE p.id = 'plan_modular'`,
  );
  return rows;
}

async function devolverOriginais(db: Client, originais: Original[], gravadoPor: string) {
  const atuais = new Map((await guardarOriginais(db)).map((o) => [o.code, o]));
  for (const o of originais) {
    const essencial = o.code === "plan_modular";
    await db.query(
      essencial
        ? "UPDATE plans SET name = $2, short_description = $3 WHERE id = $1"
        : "UPDATE addon_modules SET name = $2, description = $3 WHERE code = $1",
      [o.code, o.name, o.description],
    );
    if (o.priceCents !== null && atuais.get(o.code)?.priceCents !== o.priceCents) {
      await db.query(
        essencial
          ? `INSERT INTO plan_prices (id, plan_id, billing_cycle, amount_cents, recorded_at, recorded_by_user_id, request_key)
             VALUES (substr(md5(random()::text), 1, 24), $1, 'MONTHLY', $2, now(), $3, 'browser-volta-' || md5(random()::text))`
          : `INSERT INTO addon_module_prices (id, module_code, amount_cents, recorded_at, recorded_by_user_id, request_key)
             VALUES (substr(md5(random()::text), 1, 24), $1, $2, now(), $3, 'browser-volta-' || md5(random()::text))`,
        [o.code, o.priceCents, gravadoPor],
      );
    }
  }
}

async function editarItem(page: Page, code: string, campos: { nome?: string; descricao?: string; preco?: string; motivo?: string }) {
  await page.getByTestId(`editar-${code}`).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByTestId("aviso-preco-padrao")).toContainText("Não reajusta assinaturas existentes");
  if (campos.nome !== undefined) await dialogo.getByLabel("Nome", { exact: true }).fill(campos.nome);
  if (campos.descricao !== undefined) await dialogo.getByLabel("Descrição").fill(campos.descricao);
  if (campos.preco !== undefined) await dialogo.getByLabel("Preço mensal padrão (R$)").fill(campos.preco);
  if (campos.motivo !== undefined) await dialogo.getByLabel("Motivo (opcional, fica no histórico)").fill(campos.motivo);
  await dialogo.getByRole("button", { name: "Salvar", exact: true }).click();
  await confirmarSenhaSePedir(page);
}

test("catálogo modular: editar nome, descrição e preço só em Planos e adicionais", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const marca = `catal-${id()}`;
  const db = await conectarBancoDeTeste();
  let originais: Original[] = [];
  let gravadoPor = "";
  try {
    const conta = await criarContaDeTeste(page.request, {
      ownerName: "Pessoa da Plataforma",
      businessName: `${marca} Sede`,
      email: `${marca}@example.test`,
      password: SENHA,
    });
    gravadoPor = conta.user.id;
    await db.query("UPDATE users SET platform_role = 'MASTER_OWNER' WHERE id = $1", [conta.user.id]);
    await garantirPrecoBaseModular(db, conta.user.id);
    originais = await guardarOriginais(db);
    const nomeComissoes = `Comissões ${marca}`;
    const nomeMarketing = `Marketing ${marca}`;
    const nomeEssencial = `Agenda ${marca}`;

    await page.goto("/portal/planos");
    const catalogo = page.getByTestId("catalogo-modular");
    await expect(catalogo.getByRole("button", { name: /^Editar / })).toHaveCount(originais.length);

    // Cancelar não grava; validação aparece no formulário.
    await page.getByTestId("editar-COMISSOES").click();
    const dialogo = page.getByRole("dialog");
    await dialogo.getByLabel("Nome", { exact: true }).fill("x");
    await dialogo.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(dialogo).toContainText("Informe um nome com pelo menos 2 caracteres.");
    await dialogo.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialogo).toHaveCount(0);
    await expect(page.getByTestId("item-catalogo-COMISSOES")).toContainText(originais.find((o) => o.code === "COMISSOES")!.name);

    // Adicional disponível: nome, descrição e preço juntos.
    await editarItem(page, "COMISSOES", {
      nome: nomeComissoes,
      descricao: "Comissão por profissional e serviço, por item concluído.",
      preco: "15,90",
      motivo: "Teste de navegador",
    });
    const cartaoComissoes = page.getByTestId("item-catalogo-COMISSOES");
    await expect(cartaoComissoes).toContainText(nomeComissoes);
    await expect(cartaoComissoes).toContainText("Comissão por profissional e serviço, por item concluído.");
    await expect(page.getByTestId("preco-modular-COMISSOES")).toHaveText("R$ 15,90 / mês");

    // Planejado: editável, e continua não contratável.
    await editarItem(page, "MARKETING", { nome: nomeMarketing, preco: "19,90" });
    const cartaoMarketing = page.getByTestId("item-catalogo-MARKETING");
    await expect(cartaoMarketing).toContainText(nomeMarketing);
    await expect(cartaoMarketing).toContainText("Planejado");
    await expect(cartaoMarketing).toContainText("Não pode ser contratado enquanto estiver planejado.");

    // Essencial: renomeado, continua sempre incluído.
    await editarItem(page, "plan_modular", { nome: nomeEssencial });
    await expect(page.getByTestId("item-catalogo-plan_modular")).toContainText(nomeEssencial);
    await expect(page.getByTestId("item-catalogo-plan_modular")).toContainText("Sempre incluído");

    // Nome de outro item: o servidor recusa e o formulário volta com o texto digitado.
    await editarItem(page, "INDICADORES", { nome: nomeComissoes.toUpperCase() });
    await expect(page.getByRole("dialog")).toContainText("Já existe um item do catálogo chamado");
    await expect(page.getByRole("dialog").getByLabel("Nome", { exact: true })).toHaveValue(nomeComissoes.toUpperCase());
    await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();

    // Mesmo formulário em todos os temas, computador e celular.
    for (const tema of TEMAS) {
      await page.evaluate(([chave, valor]) => localStorage.setItem(chave, valor), ["agenda-cloud:aparencia", tema]);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-tema", tema);
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await page.getByTestId("editar-COMISSOES").click();
        const form = page.getByRole("dialog");
        for (const rotulo of ["Nome", "Descrição", "Preço mensal padrão (R$)", "Motivo (opcional, fica no histórico)"]) {
          await expect(form.getByLabel(rotulo).first()).toBeVisible();
        }
        await expect(form.getByRole("button", { name: "Salvar", exact: true })).toBeVisible();
        await expect(form.getByRole("button", { name: "Cancelar" })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`catalogo-editar-${tema}-${width}.png`), fullPage: true });
        await form.getByRole("button", { name: "Cancelar" }).click();
      }
    }
    await page.evaluate((chave) => localStorage.removeItem(chave), "agenda-cloud:aparencia");
    await page.setViewportSize({ width: 1280, height: 844 });

    // Criação: nomes atuais, só leitura; planejado desativado.
    await page.goto("/portal/planos");
    await navPortal(page).getByRole("link", { name: "Estabelecimentos" }).click();
    await page.getByRole("link", { name: "Novo estabelecimento" }).click();
    await expect(page.getByTestId("essencial")).toContainText(nomeEssencial);
    await expect(page.getByTestId("adicional-COMISSOES")).toContainText(nomeComissoes);
    await expect(page.getByTestId("adicional-COMISSOES")).toContainText("R$ 15,90");
    await expect(page.getByTestId("futuro-MARKETING")).toContainText(nomeMarketing);
    await expect(page.getByTestId("futuro-MARKETING").getByRole("checkbox")).toBeDisabled();
    await expect(page.getByRole("button", { name: /^Editar/ })).toHaveCount(0);
    await expect(page.locator(`input[value="${nomeComissoes}"]`)).toHaveCount(0);
    await page.getByLabel("Nome do estabelecimento").fill(`${marca} Barbearia`);
    await page.getByLabel("Segmento").selectOption("BARBERSHOP");
    await page.getByLabel("Limite de usuários da equipe").fill("2");
    await page.getByTestId("adicional-COMISSOES").getByRole("checkbox").check();
    await page.getByLabel("Nome", { exact: true }).fill("Dona do Teste");
    await page.getByLabel("E-mail").fill(`${marca}-dona@example.test`);
    await expect(page.getByTestId("resumo-assinatura")).toContainText(nomeEssencial);
    await expect(page.getByTestId("resumo-assinatura")).toContainText(nomeComissoes);
    await page.getByRole("button", { name: "Revisar e criar" }).click();
    await expect(page.getByTestId("revisao-criacao")).toContainText(`${nomeEssencial} + ${nomeComissoes}.`);
    await page.getByRole("dialog").getByRole("button", { name: "Criar e convidar" }).click();
    await expect(page.getByTestId("resultado-envio")).toContainText("Estabelecimento criado e convite registrado.");
    await page.getByRole("link", { name: "Abrir a ficha" }).click();

    // Ficha, aba "Plano e adicionais": nomes atuais, sem editar o catálogo.
    await expect(page.getByTestId("plano-e-adicionais")).toBeVisible();
    await expect(page.getByTestId("essencial")).toContainText(nomeEssencial);
    await expect(page.getByTestId("adicional-COMISSOES")).toContainText(nomeComissoes);
    await expect(page.getByTestId("adicional-COMISSOES").getByRole("checkbox")).toBeChecked();
    await expect(page.getByRole("button", { name: /^Editar/ })).toHaveCount(0);
    await expect(page.locator(`input[value="${nomeComissoes}"]`)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("catalogo-ficha-plano.png"), fullPage: true });
  } finally {
    if (originais.length) await devolverOriginais(db, originais, gravadoPor);
    await db.end();
  }
});
