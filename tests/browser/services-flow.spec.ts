// Teste de navegador da gestão real de serviços (Lote 6D.1) — contra o
// backend real e um PostgreSQL descartável (nunca Neon/produção, ver
// .github/workflows/test-frontend-auth.yml).
//
// O que é provado pela UI e o que é provado pela API, deliberadamente
// separados:
//  - o FLUXO (cadastro/login → criar → listar → reload → editar → desativar →
//    reativar → reload) roda na tela real, preenchendo formulários de
//    verdade e clicando nos botões reais — nunca chamando a API direto para
//    simular a ação de uma pessoa;
//  - a AUTORIZAÇÃO (acesso cruzado entre estabelecimentos, incluindo
//    reativação) é atacada DIRETAMENTE na API, nunca só pela UI: um botão
//    escondido não é controle de acesso, e um teste que só olhasse a tela
//    não provaria nada sobre o servidor.
//
// Orçamento de POST /auth/register: o rate limit real é de 5 por 15 min por IP
// (backend/src/auth/register-rate-limit.ts, MemoryStore no processo do
// backend) e todos os testes saem do mesmo IP. Este arquivo gasta 3 (o fluxo
// principal + os dois estabelecimentos do teste de isolamento). As suítes de
// autenticação gastam outros 4, o que estouraria o limite numa execução única
// — por isso o CI roda ESTA suíte numa invocação separada do Playwright, que
// sobe um backend novo e portanto um rate limiter zerado (ver
// .github/workflows/test-frontend-auth.yml). Nenhuma infraestrutura é
// duplicada: é o mesmo Postgres descartável, só uma segunda invocação.
// Conferir esta conta antes de acrescentar qualquer caso que cadastre.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const BACKEND_URL = "http://localhost:3001";
const SENHA_TESTE = "senha-de-servicos-e2e-123";

interface ContaCriada {
  email: string;
  senha: string;
  estabelecimento: string;
}

/** Cria a conta pela API (o cadastro pela TELA já é provado em
 * registration-flow.spec.ts; aqui ele é só a fixture para chegar na tela de
 * serviços). */
async function criarConta(request: APIRequestContext, rotulo: string): Promise<ContaCriada> {
  const sufixo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `servicos-${rotulo}-${sufixo}@example.test`;
  const estabelecimento = `Estabelecimento ${rotulo} ${sufixo}`;

  const resposta = await request.post(`${BACKEND_URL}/auth/register`, {
    data: {
      ownerName: `Dono ${rotulo}`,
      businessName: estabelecimento,
      email,
      phone: "11977776666",
      password: SENHA_TESTE,
    },
  });
  expect(resposta.status(), await resposta.text()).toBe(201);

  return { email, senha: SENHA_TESTE, estabelecimento };
}

async function entrar(page: Page, conta: ContaCriada): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(conta.email);
  await page.getByLabel("Senha").fill(conta.senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/conta$/);
}

test.describe("gestão real de serviços", () => {
  test("criar → listar → reload → editar → desativar, tudo persistido de verdade", async ({
    page,
    request,
  }) => {
    const conta = await criarConta(request, "fluxo");
    await entrar(page, conta);

    await page.getByRole("button", { name: "Gerenciar serviços" }).click();
    await expect(page).toHaveURL(/\/conta\/servicos$/);

    // Estado vazio com ação de cadastro — nunca uma lista demo.
    await expect(page.getByText("Nenhum serviço cadastrado")).toBeVisible();
    await expect(page.getByText("Corte Masculino")).toHaveCount(0);

    let chamadasInvalidas = 0;
    const contarCriacao = (req: { method: () => string; url: () => string }) => {
      if (req.method() === "POST" && /\/services$/.test(req.url())) chamadasInvalidas += 1;
    };
    page.on("request", contarCriacao);

    // Validação de campo acontece no cliente, sem gastar uma ida à API.
    await page.getByRole("button", { name: "Cadastrar serviço" }).click();
    await page.getByLabel("Duração (minutos)").fill("0");
    await page.getByLabel("Preço", { exact: true }).fill("abc");
    await page.locator('form button[type="submit"]').click();
    await expect(page.getByText("Informe o nome do serviço.")).toBeVisible();
    await expect(page.getByText(/Informe um valor válido/)).toBeVisible();
    expect(chamadasInvalidas, "formulário inválido nunca chega na API").toBe(0);
    page.off("request", contarCriacao);

    await page.getByLabel("Preço", { exact: true }).fill("");
    await page.getByLabel("Nome do serviço").fill("Atendimento padrão");
    await page.getByLabel("Descrição curta").fill("Sessão inicial");
    await page.getByLabel("Duração (minutos)").fill("50");
    await page.getByLabel("Preço", { exact: true }).fill("85,50");

    // Envio duplicado: o botão fica desabilitado enquanto a requisição está em
    // voo, então dois cliques nunca viram dois POST.
    let criacoes = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && /\/services$/.test(req.url())) criacoes += 1;
    });

    // Segura a resposta da criação para o segundo clique acontecer com a
    // requisição comprovadamente em voo — sem isso ele poderia cair depois de
    // a gravação terminar e não provaria nada. A requisição continua indo ao
    // backend real; nada é simulado.
    await page.route("**/tenants/*/services", async (rota) => {
      if (rota.request().method() === "POST") {
        await new Promise((resolver) => setTimeout(resolver, 1_500));
      }
      await rota.continue();
    });

    // Localizador pelo `type`, nunca pelo texto: durante a gravação o rótulo
    // do botão vira "Salvando...", e um locator por nome deixaria de casar.
    const salvar = page.locator('form button[type="submit"]');
    await salvar.click();
    await expect(salvar).toBeDisabled();
    await salvar.click({ force: true });
    await page.unroute("**/tenants/*/services");

    await expect(page.getByText("Atendimento padrão")).toBeVisible();
    // R$ 85,50 formatado pelo Intl usa espaço não separável.
    await expect(page.getByText(/R\$\s85,50/)).toBeVisible();
    await expect(page.getByText(/50 min/)).toBeVisible();
    expect(criacoes, "um envio só, mesmo com dois cliques").toBe(1);

    // Persistência real: o reload relê tudo do banco via API.
    await page.reload();
    await expect(page.getByText("Atendimento padrão")).toBeVisible();
    await expect(page.getByText(/R\$\s85,50/)).toBeVisible();

    await page.getByRole("button", { name: "Editar Atendimento padrão" }).click();
    await page.getByLabel("Nome do serviço").fill("Atendimento estendido");
    await page.getByLabel("Duração (minutos)").fill("90");
    await page.getByRole("button", { name: "Salvar alterações" }).click();

    await expect(page.getByText("Atendimento estendido")).toBeVisible();
    await expect(page.getByText(/1h30min/)).toBeVisible();

    await page.getByRole("button", { name: "Desativar Atendimento estendido" }).click();
    await expect(page.getByText(/Ele deixa de ser oferecido/)).toBeVisible();
    await page.getByRole("button", { name: "Confirmar desativação" }).click();

    // Desativado continua visível e marcado — nunca sumiu do banco.
    await expect(page.getByText("Inativo")).toBeVisible();
    await expect(page.getByText("Atendimento estendido")).toBeVisible();

    await page.reload();
    await expect(page.getByText("Inativo")).toBeVisible();
    await expect(page.getByText("Atendimento estendido")).toBeVisible();

    // Envio duplicado também vale para reativação: segura a resposta e
    // clica duas vezes com a primeira chamada comprovadamente em voo.
    let reativacoes = 0;
    page.on("request", (req) => {
      if (req.method() === "POST" && /\/reactivate$/.test(req.url())) reativacoes += 1;
    });
    await page.route("**/tenants/*/services/*/reactivate", async (rota) => {
      await new Promise((resolver) => setTimeout(resolver, 1_500));
      await rota.continue();
    });

    const reativar = page.getByRole("button", { name: "Reativar Atendimento estendido" });
    await reativar.click();
    await expect(reativar).toBeDisabled();
    await reativar.click({ force: true });
    await page.unroute("**/tenants/*/services/*/reactivate");

    // Reativado some da marcação de inativo e volta a mostrar "Desativar".
    await expect(page.getByText("Inativo")).toHaveCount(0);
    await expect(page.getByText("Atendimento estendido")).toBeVisible();
    expect(reativacoes, "um envio só, mesmo com dois cliques").toBe(1);

    // Persistência real: reload confirma que a reativação gravou no banco,
    // não só no estado do React.
    await page.reload();
    await expect(page.getByText("Inativo")).toHaveCount(0);
    await expect(page.getByText("Atendimento estendido")).toBeVisible();
    await expect(page.getByRole("button", { name: "Desativar Atendimento estendido" })).toBeVisible();
  });

  test("isolamento entre estabelecimentos, atacado direto na API com sessão válida", async ({
    browser,
    request,
  }) => {
    const contaA = await criarConta(request, "iso-a");
    const contaB = await criarConta(request, "iso-b");

    // Duas sessões reais e independentes, cada uma com seu cookie.
    const contextoA = await browser.newContext();
    const contextoB = await browser.newContext();
    const paginaA = await contextoA.newPage();
    const paginaB = await contextoB.newPage();

    await entrar(paginaA, contaA);
    await entrar(paginaB, contaB);

    const tenantDe = async (pagina: Page): Promise<string> => {
      const corpo = await pagina.evaluate(async () => {
        const r = await fetch("http://localhost:3001/auth/me", { credentials: "include" });
        return (await r.json()) as { activeContext: { tenantId: string } | null };
      });
      expect(corpo.activeContext).not.toBeNull();
      return corpo.activeContext!.tenantId;
    };

    const tenantA = await tenantDe(paginaA);
    const tenantB = await tenantDe(paginaB);
    expect(tenantA).not.toBe(tenantB);

    // A cria um serviço pela tela.
    await paginaA.goto("/conta/servicos");
    await paginaA.getByRole("button", { name: "Cadastrar serviço" }).click();
    await paginaA.getByLabel("Nome do serviço").fill("Serviço exclusivo do A");
    await paginaA.getByLabel("Duração (minutos)").fill("30");
    await paginaA.getByRole("button", { name: "Cadastrar serviço" }).click();
    await expect(paginaA.getByText("Serviço exclusivo do A")).toBeVisible();

    // O id real do serviço de A, obtido pela própria API de A.
    const servicoDeA = await paginaA.evaluate(async (tenantId) => {
      const r = await fetch(`http://localhost:3001/tenants/${tenantId}/services`, {
        credentials: "include",
      });
      const corpo = (await r.json()) as { services: { id: string; name: string }[] };
      return corpo.services[0];
    }, tenantA);
    expect(servicoDeA.name).toBe("Serviço exclusivo do A");

    // --- Ataques diretos na API, com a sessão VÁLIDA de B ---
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

    // 1. Listar os serviços do tenant de A.
    const listaCruzada = await comoB(`/tenants/${tenantA}/services`);
    expect(listaCruzada.status).toBe(404);
    expect(listaCruzada.texto).not.toContain("Serviço exclusivo do A");

    // 2. Editar o serviço de A pelo id real, usando o tenant de A.
    expect((await comoB(`/tenants/${tenantA}/services/${servicoDeA.id}`, "PATCH", { name: "Invadido" })).status).toBe(404);

    // 3. Editar o serviço de A pelo id real, mas passando o PRÓPRIO tenant de
    //    B — o caso em que o vínculo existe e só o recurso é de outro dono.
    expect((await comoB(`/tenants/${tenantB}/services/${servicoDeA.id}`, "PATCH", { name: "Invadido" })).status).toBe(404);

    // 4. Desativar o serviço de A.
    expect((await comoB(`/tenants/${tenantB}/services/${servicoDeA.id}/deactivate`, "POST")).status).toBe(404);

    // 5. Criar no tenant de A.
    expect((await comoB(`/tenants/${tenantA}/services`, "POST", { name: "Plantado", durationMinutes: 30 })).status).toBe(404);

    // 6. Forjar tenantId no corpo de uma criação no próprio tenant de B: o
    //    campo nem existe no contrato, então é 400 — nunca aplicado.
    expect(
      (await comoB(`/tenants/${tenantB}/services`, "POST", {
        name: "Forjado",
        durationMinutes: 30,
        tenantId: tenantA,
      })).status,
    ).toBe(400);

    // 7. Reativar o serviço de A — bloqueado mesmo já estando ativo: a
    //    autorização é verificada ANTES de checar o estado atual do serviço,
    //    então nem um serviço já ativo revela nada sobre si a quem não tem
    //    vínculo.
    expect(
      (await comoB(`/tenants/${tenantB}/services/${servicoDeA.id}/reactivate`, "POST")).status,
    ).toBe(404);

    // Nada disso alterou o serviço de A nem plantou serviço em ninguém.
    await paginaA.reload();
    await expect(paginaA.getByText("Serviço exclusivo do A")).toBeVisible();
    await expect(paginaA.getByText("Inativo")).toHaveCount(0);
    await expect(paginaA.getByText("Plantado")).toHaveCount(0);
    await expect(paginaA.getByText("Forjado")).toHaveCount(0);

    // E B continua sem serviço nenhum — a lista dele nunca misturou.
    await paginaB.goto("/conta/servicos");
    await expect(paginaB.getByText("Nenhum serviço cadastrado")).toBeVisible();

    // Sem sessão nenhuma, a API recusa antes de qualquer consulta.
    const semSessao = await browser.newContext();
    const paginaAnonima = await semSessao.newPage();
    // Precisa navegar antes de usar `fetch`: em `about:blank` a origem é
    // opaca e o navegador recusa a requisição por CORS antes de ela sair,
    // o que testaria o navegador em vez da API.
    await paginaAnonima.goto("/login");
    const anonimo = await paginaAnonima.evaluate(async (tenantId) => {
      const r = await fetch(`http://localhost:3001/tenants/${tenantId}/services`, {
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
