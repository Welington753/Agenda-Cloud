// Aplicação de comissão em massa de ponta a ponta, pela tela, contra o
// backend real e o PostgreSQL DESCARTÁVEL (dados fictícios; ver
// docs/plans/comissoes-aplicacao-em-massa.md). Nada sai da máquina.
//
// 1. Profissionais → "Aplicar comissão a vários". Prévia em PRESERVAR: só
//    quem recebe sem regra geral muda; quem tem outra regra ou está
//    desligado é preservado; o inativo fica fora. Avisos do que não muda.
// 2. Uma mudança paralela (pela API) depois da prévia: aplicar recebe 409, a
//    tela refaz a prévia e pede nova revisão; depois aplica.
// 3. SUBSTITUIR: o botão só habilita com a confirmação explícita; aplica,
//    liga "Recebe comissão" de quem estava desligado e mostra o resultado.
//    A exceção por serviço continua guardada.
// 4. Capturas em claro e escuro, 1280, 390 e 360 px, sem rolagem horizontal.
//
// Invocação própria (`npm run test:browser:comissoes-em-massa`): 1 aceite de
// convite e nenhum login extra.
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { API_DE_TESTE, conectarBancoDeTeste, criarContaDeTeste } from "./support/contas-de-teste";

const id = () => randomUUID().replaceAll("-", "").slice(0, 10);

async function capturar(page: Page, nome: string) {
  for (const tema of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: tema });
    for (const width of [1280, 390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`comissoes-em-massa-${nome}-${tema}-${width}.png`), fullPage: true });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 844 });
}

test("dono aplica comissão a vários profissionais com prévia, 409 por mudança paralela e substituição confirmada", async ({ page }) => {
  test.setTimeout(150_000);
  const marca = `massa-${id()}`;
  const db = await conectarBancoDeTeste();
  try {
    // ------------------------------------------------------------- cenário
    const dono = await criarContaDeTeste(page.request, {
      ownerName: "Dona da Aplicação em Massa",
      businessName: `${marca} Estúdio`,
      email: `${marca}-dona@example.test`,
      password: "senha-da-dona-massa-1",
    });
    const tenantId = dono.tenant.id;
    await db.query(`UPDATE tenants SET plan_id = (SELECT id FROM plans WHERE code = 'equipe') WHERE id = $1`, [tenantId]);
    const api = `${API_DE_TESTE}/tenants/${tenantId}`;
    const r = await page.request.post(`${api}/services`, { data: { name: "Corte", durationMinutes: 30, priceCents: 5000 } });
    expect(r.status()).toBe(201);
    const corte = ((await r.json()) as { service: { id: string } }).service.id;
    const profissional = async (name: string) => {
      const criado = await page.request.post(`${api}/professionals`, { data: { name, serviceIds: [corte] } });
      expect(criado.status()).toBe(201);
      return ((await criado.json()) as { professional: { id: string } }).professional.id;
    };
    const configurar = async (professionalId: string, corpo: object) =>
      expect((await page.request.put(`${api}/commissions/settings/${professionalId}`, { data: corpo })).status()).toBe(200);
    const ana = await profissional("Ana Lima");
    const bia = await profissional("Bia Souza");
    const carla = await profissional("Carla Dias");
    const davi = await profissional("Davi Rocha");
    // Ana recebe, sem regra geral, com uma exceção no Corte; Bia recebe 15,00
    // fixo; Carla é nova (desligada); Davi está inativo.
    await configurar(ana, { receivesCommission: true, defaultRule: null });
    expect((await page.request.put(`${api}/commissions/rules/${ana}/${corte}`, { data: { kind: "PERCENTAGE", value: 4000 } })).status()).toBe(200);
    await configurar(bia, { receivesCommission: true, defaultRule: { kind: "FIXED", value: 1500 } });
    expect((await page.request.post(`${api}/professionals/${davi}/deactivate`)).status()).toBe(200);

    // ---------------------------------------- 1. prévia em PRESERVAR
    await page.goto("/conta/configuracoes/profissionais");
    await page.getByRole("link", { name: "Aplicar comissão a vários" }).click();
    await expect(page).toHaveURL(/\/conta\/configuracoes\/profissionais\/comissao-em-massa$/);
    await expect(page.getByTestId("aviso-o-que-nao-muda")).toContainText("Exceções por serviço");
    await expect(page.getByTestId("aviso-o-que-nao-muda")).toContainText("comissões já apuradas");
    await expect(page.getByText("Todos os profissionais ativos (3)")).toBeVisible();
    await expect(page.getByLabel("Preservar configurações existentes")).toBeChecked();
    await page.getByRole("button", { name: "Ver prévia" }).click();
    await expect(page.getByTestId("formulario-em-massa").getByRole("alert")).toHaveText("Informe o percentual.");
    await page.getByLabel("Percentual (%)").fill("10");
    await page.getByRole("button", { name: "Ver prévia" }).click();
    const previa = page.getByTestId("previa-em-massa");
    const linha = (nome: string) => previa.getByRole("listitem", { name: nome });
    await expect(previa.getByTestId("contador-alterados")).toContainText("1");
    await expect(previa.getByTestId("contador-preservados")).toContainText("2");
    await expect(previa.getByTestId("contador-sem-mudanca")).toContainText("0");
    await expect(previa.getByTestId("profissional-em-massa")).toHaveCount(3);
    await expect(linha("Davi Rocha")).toHaveCount(0);
    await expect(linha("Ana Lima")).toContainText("Recebe · sem regra geral");
    await expect(linha("Ana Lima")).toContainText("Recebe · 10%");
    await expect(linha("Ana Lima").getByTestId("resultado-do-profissional")).toHaveText("Será alterado");
    await expect(linha("Bia Souza").getByTestId("resultado-do-profissional")).toHaveText("Preservado");
    await expect(linha("Carla Dias")).toContainText("Não recebe comissão");
    await expect(linha("Carla Dias").getByTestId("resultado-do-profissional")).toHaveText("Preservado");
    await capturar(page, "previa-preservar");

    // -------------------------- 2. mudança paralela: 409 e prévia refeita
    await configurar(bia, { receivesCommission: true, defaultRule: null });
    await previa.getByRole("button", { name: "Aplicar a 1 profissional" }).click();
    await expect(page.getByTestId("aviso-previa-atualizada")).toContainText("mudaram desde a prévia");
    await expect(previa.getByTestId("contador-alterados")).toContainText("2");
    await expect(linha("Bia Souza").getByTestId("resultado-do-profissional")).toHaveText("Será alterado");
    await previa.getByRole("button", { name: "Aplicar a 2 profissionais" }).click();
    const resultado = page.getByTestId("resultado-em-massa");
    await expect(resultado).toContainText("Comissão aplicada");
    await expect(resultado.getByRole("listitem", { name: "Ana Lima" }).getByTestId("resultado-do-profissional")).toHaveText("Alterado");
    await expect(resultado.getByRole("listitem", { name: "Carla Dias" }).getByTestId("resultado-do-profissional")).toHaveText("Preservado");
    await expect(page.getByTestId("previa-em-massa")).toHaveCount(0);

    // --------------------------------- 3. SUBSTITUIR com confirmação
    await page.getByLabel("Substituir configurações gerais").check();
    await expect(resultado).toHaveCount(0);
    await page.getByLabel("Tipo").selectOption({ label: "Valor fixo por serviço realizado" });
    await page.getByLabel("Valor por serviço (R$)").fill("12");
    await page.getByRole("button", { name: "Ver prévia" }).click();
    await expect(previa.getByTestId("contador-alterados")).toContainText("3");
    await expect(linha("Carla Dias")).toContainText(/Recebe · R\$\s12,00 fixo/);
    const aplicar = previa.getByRole("button", { name: "Aplicar a 3 profissionais" });
    await expect(previa.getByTestId("aviso-substituicao")).toContainText("serão trocadas por esta regra");
    await expect(aplicar).toBeDisabled();
    await capturar(page, "previa-substituir");
    await previa.getByTestId("confirmar-substituicao").check();
    await expect(aplicar).toBeEnabled();
    await aplicar.click();
    await expect(resultado.getByTestId("contador-alterados")).toContainText("3");
    await expect(resultado.getByRole("listitem", { name: "Carla Dias" }).getByTestId("resultado-do-profissional")).toHaveText("Alterado");
    await capturar(page, "resultado-substituir");

    // O servidor guardou: Carla ligada com a regra nova; a exceção da Ana
    // continua valendo no Corte; Davi (inativo) intocado.
    const regras = async (professionalId: string) =>
      (await (await page.request.get(`${api}/commissions/rules/${professionalId}`)).json()) as {
        settings: { receivesCommission: boolean; defaultRule: { kind: string; value: number } | null };
        services: { service: { id: string }; effective: { source: string | null } }[];
      };
    expect((await regras(carla)).settings).toEqual({ receivesCommission: true, defaultRule: { kind: "FIXED", value: 1200 } });
    expect((await regras(ana)).services.find((s) => s.service.id === corte)?.effective.source).toBe("SERVICE");
    expect((await regras(davi)).settings).toEqual({ receivesCommission: false, defaultRule: null });
    await page.goto("/conta/configuracoes/profissionais");
    await expect(page.getByRole("article", { name: "Carla Dias" }).getByTestId("recebe-comissao")).toHaveText("Recebe comissão");
  } finally {
    await db.end();
  }
});
