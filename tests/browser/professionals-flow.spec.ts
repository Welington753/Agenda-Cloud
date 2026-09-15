// Teste de navegador da gestão real de profissionais (Lote 6D.2) — contra o
// backend real e um PostgreSQL descartável, mesmo padrão de
// services-flow.spec.ts.
//
// O que é provado pela UI e o que é provado pela API, deliberadamente
// separados:
//  - o FLUXO (criar serviço → cadastrar profissional → vincular serviço →
//    reload → editar vínculos → desativar → reativar → reload) roda na tela
//    real, preenchendo formulários de verdade e clicando nos botões reais;
//  - a AUTORIZAÇÃO (acesso cruzado entre estabelecimentos, vincular serviço
//    de outro tenant) é atacada DIRETAMENTE na API, nunca só pela UI.
//
// Invocação SEPARADA do Playwright (mesmo motivo de services-flow.spec.ts):
// orçamento de POST /auth/register é 5 por 15 min por IP, e este arquivo
// gasta 3 (fluxo principal + os dois estabelecimentos do teste de
// isolamento) — rodar junto de outra suíte de registro estouraria o limite.
// Ver .github/workflows/test-frontend-auth.yml.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const BACKEND_URL = "http://localhost:3001";
const SENHA_TESTE = "senha-de-profissionais-e2e-123";

interface ContaCriada {
  email: string;
  senha: string;
}

async function criarConta(request: APIRequestContext, rotulo: string): Promise<ContaCriada> {
  const sufixo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `profissionais-${rotulo}-${sufixo}@example.test`;

  const resposta = await request.post(`${BACKEND_URL}/auth/register`, {
    data: {
      ownerName: `Dono ${rotulo}`,
      businessName: `Estabelecimento ${rotulo} ${sufixo}`,
      email,
      phone: "11977776666",
      password: SENHA_TESTE,
    },
  });
  expect(resposta.status(), await resposta.text()).toBe(201);

  return { email, senha: SENHA_TESTE };
}

async function entrar(page: Page, conta: ContaCriada): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(conta.email);
  await page.getByLabel("Senha").fill(conta.senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/conta$/);
}

async function tenantDe(pagina: Page): Promise<string> {
  const corpo = await pagina.evaluate(async () => {
    const r = await fetch("http://localhost:3001/auth/me", { credentials: "include" });
    return (await r.json()) as { activeContext: { tenantId: string } | null };
  });
  expect(corpo.activeContext).not.toBeNull();
  return corpo.activeContext!.tenantId;
}

/** Cria um serviço direto pela API — a tela de serviços já é provada em
 * services-flow.spec.ts; aqui ele é só a fixture para haver algo elegível
 * no seletor de vínculos do profissional. */
async function criarServico(
  pagina: Page,
  tenantId: string,
  nome: string,
): Promise<{ id: string; name: string }> {
  return pagina.evaluate(
    async ({ tenantId, nome }) => {
      const r = await fetch(`http://localhost:3001/tenants/${tenantId}/services`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nome, durationMinutes: 30 }),
      });
      const corpo = (await r.json()) as { service: { id: string; name: string } };
      return corpo.service;
    },
    { tenantId, nome },
  );
}

test.describe("gestão real de profissionais", () => {
  test("criar serviço → cadastrar profissional → vincular → reload → editar vínculos → desativar → reativar, tudo persistido de verdade", async ({
    page,
    request,
  }) => {
    const conta = await criarConta(request, "fluxo");
    await entrar(page, conta);
    const tenantId = await tenantDe(page);
    const servico = await criarServico(page, tenantId, "Corte");

    await page.getByRole("button", { name: "Gerenciar profissionais" }).click();
    await expect(page).toHaveURL(/\/conta\/profissionais$/);

    await expect(page.getByText("Nenhum profissional cadastrado")).toBeVisible();

    // Envio duplicado: o botão fica desabilitado enquanto a criação está em
    // voo, então dois cliques nunca viram dois POST.
    let criacoes = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && /\/professionals$/.test(req.url())) criacoes += 1;
    });
    await page.route("**/tenants/*/professionals", async (rota) => {
      if (rota.request().method() === "POST") {
        await new Promise((resolver) => setTimeout(resolver, 1_500));
      }
      await rota.continue();
    });

    await page.getByRole("button", { name: "Cadastrar profissional" }).click();
    await page.getByLabel("Nome do profissional").fill("João Silva");
    await page.getByLabel("Corte").check();

    const salvar = page.locator('form button[type="submit"]');
    await salvar.click();
    await expect(salvar).toBeDisabled();
    await salvar.click({ force: true });
    await page.unroute("**/tenants/*/professionals");

    await expect(page.getByText("João Silva")).toBeVisible();
    await expect(page.getByText("Corte", { exact: true })).toBeVisible();
    expect(criacoes, "um envio só, mesmo com dois cliques").toBe(1);

    // Persistência real: o reload relê tudo do banco via API.
    await page.reload();
    await expect(page.getByText("João Silva")).toBeVisible();
    await expect(page.getByText("Corte", { exact: true })).toBeVisible();

    // Desativa o SERVIÇO (não o profissional) direto na API — o vínculo
    // precisa continuar existindo e a UI precisa marcar o serviço vinculado
    // como inativo, sem escondê-lo.
    await page.evaluate(
      async ({ tenantId, serviceId }) => {
        await fetch(`http://localhost:3001/tenants/${tenantId}/services/${serviceId}/deactivate`, {
          method: "POST",
          credentials: "include",
        });
      },
      { tenantId, serviceId: servico.id },
    );
    await page.reload();
    await expect(page.getByText("Corte (inativo)")).toBeVisible();

    // Edição: troca o nome e desmarca o vínculo de serviço no mesmo submit
    // (dois endpoints reais — PATCH do nome e PUT dos vínculos — atrás de um
    // botão só).
    await page.getByRole("button", { name: "Editar João Silva" }).click();
    await page.getByLabel("Nome do profissional").fill("João S. Silva");
    await page.getByLabel("Corte").uncheck();
    await page.getByRole("button", { name: "Salvar alterações" }).click();

    await expect(page.getByText("João S. Silva")).toBeVisible();
    await expect(page.getByText("Nenhum serviço vinculado.")).toBeVisible();

    await page.reload();
    await expect(page.getByText("João S. Silva")).toBeVisible();
    await expect(page.getByText("Nenhum serviço vinculado.")).toBeVisible();

    // Desativação, com confirmação.
    await page.getByRole("button", { name: "Desativar João S. Silva" }).click();
    await expect(page.getByText(/continua salvo e os serviços vinculados são preservados/)).toBeVisible();
    await page.getByRole("button", { name: "Confirmar desativação" }).click();

    await expect(page.getByText("Inativo")).toBeVisible();
    await expect(page.getByText("João S. Silva")).toBeVisible();

    await page.reload();
    await expect(page.getByText("Inativo")).toBeVisible();

    // Reativação, com a mesma proteção contra envio duplicado.
    let reativacoes = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && /\/reactivate$/.test(req.url())) reativacoes += 1;
    });
    await page.route("**/tenants/*/professionals/*/reactivate", async (rota) => {
      await new Promise((resolver) => setTimeout(resolver, 1_500));
      await rota.continue();
    });

    const reativar = page.getByRole("button", { name: "Reativar João S. Silva" });
    await reativar.click();
    await expect(reativar).toBeDisabled();
    await reativar.click({ force: true });
    await page.unroute("**/tenants/*/professionals/*/reactivate");

    await expect(page.getByText("Inativo")).toHaveCount(0);
    expect(reativacoes, "um envio só, mesmo com dois cliques").toBe(1);

    // Persistência real: reload confirma que a reativação gravou no banco.
    await page.reload();
    await expect(page.getByText("Inativo")).toHaveCount(0);
    await expect(page.getByText("João S. Silva")).toBeVisible();
    await expect(servico.name).toBe("Corte");
  });

  test("estado sem serviço elegível orienta a cadastrar serviços, mas permite salvar sem vínculo", async ({
    page,
    request,
  }) => {
    const conta = await criarConta(request, "sem-servico");
    await entrar(page, conta);

    await page.goto("/conta/profissionais");
    await page.getByRole("button", { name: "Cadastrar profissional" }).click();
    await expect(page.getByText(/ainda não tem serviços cadastrados/)).toBeVisible();
    await expect(page.getByRole("link", { name: "cadastrar serviços primeiro" })).toHaveAttribute(
      "href",
      "/conta/servicos",
    );

    await page.getByLabel("Nome do profissional").fill("Sem Serviços");
    await page.locator('form button[type="submit"]').click();

    await expect(page.getByText("Sem Serviços")).toBeVisible();
    await expect(page.getByText("Nenhum serviço vinculado.")).toBeVisible();
  });

  test("isolamento entre estabelecimentos, atacado direto na API com sessão válida", async ({
    browser,
    request,
  }) => {
    const contaA = await criarConta(request, "iso-a");
    const contaB = await criarConta(request, "iso-b");

    const contextoA = await browser.newContext();
    const contextoB = await browser.newContext();
    const paginaA = await contextoA.newPage();
    const paginaB = await contextoB.newPage();

    await entrar(paginaA, contaA);
    await entrar(paginaB, contaB);

    const tenantA = await tenantDe(paginaA);
    const tenantB = await tenantDe(paginaB);
    expect(tenantA).not.toBe(tenantB);

    const servicoDeA = await criarServico(paginaA, tenantA, "Serviço exclusivo do A");

    await paginaA.goto("/conta/profissionais");
    await paginaA.getByRole("button", { name: "Cadastrar profissional" }).click();
    await paginaA.getByLabel("Nome do profissional").fill("Profissional exclusivo do A");
    await paginaA.getByLabel("Serviço exclusivo do A").check();
    await paginaA.locator('form button[type="submit"]').click();
    await expect(paginaA.getByText("Profissional exclusivo do A")).toBeVisible();

    const profissionalDeA = await paginaA.evaluate(async (tenantId) => {
      const r = await fetch(`http://localhost:3001/tenants/${tenantId}/professionals`, {
        credentials: "include",
      });
      const corpo = (await r.json()) as { professionals: { id: string; name: string }[] };
      return corpo.professionals[0];
    }, tenantA);
    expect(profissionalDeA.name).toBe("Profissional exclusivo do A");

    const comoB = async (caminho: string, method = "GET", body?: unknown) =>
      paginaB.evaluate(
        async ({ caminho, method, body }) => {
          const r = await fetch(`http://localhost:3001${caminho}`, {
            method,
            credentials: "include",
            headers: body ? { "Content-Type": "application/json" } : undefined,
            body: body ? JSON.stringify(body) : undefined,
          });
          return { status: r.status, texto: await r.text() };
        },
        { caminho, method, body },
      );

    // 1. Listar os profissionais do tenant de A.
    const listaCruzada = await comoB(`/tenants/${tenantA}/professionals`);
    expect(listaCruzada.status).toBe(404);
    expect(listaCruzada.texto).not.toContain("Profissional exclusivo do A");

    // 2. Editar o profissional de A pelo id real, usando o PRÓPRIO tenant de B.
    expect(
      (await comoB(`/tenants/${tenantB}/professionals/${profissionalDeA.id}`, "PATCH", {
        name: "Invadido",
      })).status,
    ).toBe(404);

    // 3. Desativar o profissional de A.
    expect(
      (await comoB(`/tenants/${tenantB}/professionals/${profissionalDeA.id}/deactivate`, "POST")).status,
    ).toBe(404);

    // 4. Criar no tenant de A.
    expect((await comoB(`/tenants/${tenantA}/professionals`, "POST", { name: "Plantado" })).status).toBe(
      404,
    );

    // 5. Vincular o serviço de A a um profissional (inexistente) do próprio
    //    tenant de B — cross-tenant no NÍVEL DO SERVIÇO, não só do profissional.
    const profissionalDeB = await paginaB.evaluate(async (tenantId) => {
      const r = await fetch(`http://localhost:3001/tenants/${tenantId}/professionals`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Profissional de B" }),
      });
      const corpo = (await r.json()) as { professional: { id: string } };
      return corpo.professional;
    }, tenantB);

    const vinculoCruzado = await comoB(
      `/tenants/${tenantB}/professionals/${profissionalDeB.id}/services`,
      "PUT",
      { serviceIds: [servicoDeA.id] },
    );
    expect(vinculoCruzado.status).toBe(400);

    // 6. Forjar tenantId no corpo de uma criação no próprio tenant de B.
    expect(
      (await comoB(`/tenants/${tenantB}/professionals`, "POST", {
        name: "Forjado",
        tenantId: tenantA,
      })).status,
    ).toBe(400);

    // Nada disso alterou o profissional de A nem seu vínculo.
    await paginaA.reload();
    await expect(paginaA.getByText("Profissional exclusivo do A")).toBeVisible();
    await expect(paginaA.getByText("Serviço exclusivo do A", { exact: true })).toBeVisible();
    await expect(paginaA.getByText("Inativo")).toHaveCount(0);
    await expect(paginaA.getByText("Plantado")).toHaveCount(0);
    await expect(paginaA.getByText("Forjado")).toHaveCount(0);

    // Sem sessão nenhuma, a API recusa antes de qualquer consulta.
    const semSessao = await browser.newContext();
    const paginaAnonima = await semSessao.newPage();
    await paginaAnonima.goto("/login");
    const anonimo = await paginaAnonima.evaluate(async (tenantId) => {
      const r = await fetch(`http://localhost:3001/tenants/${tenantId}/professionals`, {
        credentials: "include",
      });
      return r.status;
    }, tenantA);
    expect(anonimo).toBe(401);

    await semSessao.close();
    await contextoA.close();
    await contextoB.close();
  });
});
