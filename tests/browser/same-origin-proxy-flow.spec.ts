// Fluxo do piloto na MESMA origem, em HTTPS isolado (ver
// playwright.proxy.config.ts): o navegador só fala com
// `https://localhost:3443`; a borda local encaminha ao Next.js, cujo proxy
// `/agenda_api` chama a API real (NestJS, `NODE_ENV=production`).
//
// Prova, sem nenhum recurso externo:
// - cadastro, login, restauração de sessão, operação autenticada e logout
//   pelo proxy, sem nenhuma requisição do navegador à porta da API;
// - cookie de produção (`HttpOnly`, `Secure`, `SameSite=Lax`, sem `Domain`)
//   gravado na origem do frontend, e removido no logout;
// - escrita com `Origin` de outro site recusada pelo proxy;
// - cabeçalhos de IP forjados não escapam do rate limit, e clientes
//   diferentes não dividem o mesmo limite.
//
// O que só a hospedagem real prova (borda do Render, certificado público,
// hibernação do plano gratuito) fica no runbook, seção 9.
import https from "node:https";

import { expect, test, type Page } from "@playwright/test";

const ORIGEM = "https://localhost:3443";
const PORTA_API = "3001";
const SENHA = "senha-do-proxy-e2e-123";

interface RespostaCrua {
  status: number;
  corpo: string;
  setCookie: string[];
}

/** Requisição HTTPS crua, saindo de um endereço de loopback escolhido
 * (`127.0.0.x`): é assim que o teste simula clientes diferentes para a borda
 * local. Aceita só o certificado autoassinado desta execução, só aqui. */
function requisicaoCrua(
  metodo: string,
  caminho: string,
  opcoes: { origemLocal: string; headers?: Record<string, string>; corpo?: unknown },
): Promise<RespostaCrua> {
  const corpo = opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo);
  return new Promise((resolve, reject) => {
    // Conecta por IPv4 explícito: `localhost` pode resolver para `::1`, que
    // não aceita um endereço local IPv4. O `Host` continua o do frontend.
    const req = https.request(
      `https://127.0.0.1:3443${caminho}`,
      {
        method: metodo,
        localAddress: opcoes.origemLocal,
        rejectUnauthorized: false,
        servername: "localhost",
        headers: {
          host: "localhost:3443",
          ...(corpo ? { "content-type": "application/json" } : {}),
          ...opcoes.headers,
        },
      },
      (res) => {
        const partes: Buffer[] = [];
        res.on("data", (parte: Buffer) => partes.push(parte));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            corpo: Buffer.concat(partes).toString("utf8"),
            setCookie: res.headers["set-cookie"] ?? [],
          }),
        );
      },
    );
    req.on("error", reject);
    if (corpo) req.write(corpo);
    req.end();
  });
}

function sufixo(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function cadastrarPelaPagina(page: Page): Promise<string> {
  const email = `proxy-${sufixo()}@example.test`;
  const status = await page.evaluate(
    async ({ email, senha }) => {
      const r = await fetch("/agenda_api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerName: "Maria Proxy E2E",
          businessName: `Estúdio Proxy ${Date.now()}`,
          email,
          phone: "11999998888",
          password: senha,
        }),
      });
      return r.status;
    },
    { email, senha: SENHA },
  );
  expect(status).toBe(201);
  return email;
}

test.describe("piloto na mesma origem, em HTTPS isolado", () => {
  test("cadastro, login, sessão restaurada, operação autenticada e logout, só pelo proxy", async ({
    page,
    context,
  }) => {
    const chamadasDiretasAApi: string[] = [];
    page.on("request", (req) => {
      if (new URL(req.url()).port === PORTA_API) chamadasDiretasAApi.push(req.url());
    });

    await page.goto("/login");
    const email = await cadastrarPelaPagina(page);

    // O cadastro já abre sessão; sai para provar o login pela tela.
    await context.clearCookies();
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/conta$/);
    await expect(page.getByText("Dono(a)")).toBeVisible();

    // Cookie de produção, na origem do frontend, e em nenhum outro lugar.
    const cookies = await context.cookies();
    const sessao = cookies.filter((c) => c.name === "session_token");
    expect(sessao).toHaveLength(1);
    expect(sessao[0]).toMatchObject({
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });
    // Sem `Domain` no Set-Cookie: o Playwright mostra cookie de host sem o
    // ponto inicial que um cookie com `Domain=localhost` teria.
    expect(sessao[0].domain.startsWith(".")).toBe(false);
    expect(await page.evaluate(() => document.cookie)).not.toContain("session_token");

    // Restauração de sessão.
    await page.reload();
    await expect(page).toHaveURL(/\/conta$/);
    await expect(page.getByText("Dono(a)")).toBeVisible();

    // Operação autenticada (escrita) pelo proxy, e a tela mostrando o
    // resultado lido de volta pelo proxy.
    const nomeServico = `Corte pelo proxy ${sufixo()}`;
    const criacao = await page.evaluate(async (nome) => {
      const me = await fetch("/agenda_api/auth/me");
      const { activeContext } = (await me.json()) as { activeContext: { tenantId: string } };
      const r = await fetch(`/agenda_api/tenants/${activeContext.tenantId}/services`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nome,
          shortDescription: "",
          priceCents: 5000,
          priceVisible: true,
          durationMinutes: 30,
          bufferAfterMinutes: 0,
          modality: "IN_PERSON",
          activeInPublicBooking: true,
          requiresManualConfirmation: false,
        }),
      });
      return { status: r.status, cacheControl: r.headers.get("cache-control") };
    }, nomeServico);
    expect(criacao).toEqual({ status: 201, cacheControl: "no-store" });
    await page.goto("/conta/servicos");
    await expect(page.getByText(nomeServico)).toBeVisible();

    // Erro da API chega com o mesmo status e corpo.
    const naoEncontrado = await page.evaluate(async () => {
      const r = await fetch("/agenda_api/tenants/tenant-que-nao-existe/services");
      return { status: r.status, corpo: (await r.json()) as { statusCode: number } };
    });
    expect([403, 404]).toContain(naoEncontrado.status);
    expect(naoEncontrado.corpo.statusCode).toBe(naoEncontrado.status);

    // Logout: o cookie some e a sessão fica revogada no servidor.
    await page.goto("/conta");
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await context.cookies()).find((c) => c.name === "session_token")).toBeFalsy();
    await page.goto("/conta");
    await expect(page).toHaveURL(/\/login\?next=%2Fconta$/);

    expect(chamadasDiretasAApi, "o navegador nunca chama a porta da API").toEqual([]);
  });

  test("escrita com Origin de outro site é recusada pelo proxy, antes da API", async () => {
    for (const origin of ["https://outro-site.test", "http://localhost:3443", "null"]) {
      const resposta = await requisicaoCrua("POST", "/agenda_api/auth/logout", {
        origemLocal: "127.0.0.1",
        headers: { origin },
      });
      expect(resposta.status, origin).toBe(403);
      expect(resposta.setCookie).toEqual([]);
    }
    const semOrigin = await requisicaoCrua("POST", "/agenda_api/auth/logout", { origemLocal: "127.0.0.1" });
    expect(semOrigin.status).toBe(403);
  });

  test("cabeçalhos de IP forjados não escapam do limite; outro cliente segue livre", async () => {
    const tentativa = (origemLocal: string, i: number) =>
      requisicaoCrua("POST", "/agenda_api/auth/login", {
        origemLocal,
        headers: {
          origin: ORIGEM,
          "cf-connecting-ip": `203.0.113.${i + 1}`,
          "x-forwarded-for": `198.51.100.${i + 1}`,
          "x-real-ip": `192.0.2.${i + 1}`,
          "x-agenda-client-ip": `203.0.113.${i + 101}`,
          "x-agenda-proxy-secret": "segredo-forjado-pelo-cliente-0123456789",
        },
        corpo: { email: `ninguem-${sufixo()}@example.test`, password: "senha-errada-123" },
      });

    const status: number[] = [];
    for (let i = 0; i < 6; i++) status.push((await tentativa("127.0.0.3", i)).status);
    expect(status.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(status[5]).toBe(429);

    // Outro cliente (outro endereço para a borda) tem o próprio limite.
    expect((await tentativa("127.0.0.4", 0)).status).toBe(401);
  });

  test("chamada direta à API com X-Agenda-Client-IP forjado, sem o segredo, não escapa do limite", async ({
    request,
  }) => {
    const status: number[] = [];
    for (let i = 0; i < 6; i++) {
      const resposta = await request.post(`http://localhost:${PORTA_API}/auth/login`, {
        headers: { "x-agenda-client-ip": `203.0.113.${i + 1}`, "x-agenda-proxy-secret": "x".repeat(40) },
        data: { email: `direto-${sufixo()}@example.test`, password: "senha-errada-123" },
      });
      status.push(resposta.status());
    }
    expect(status[5]).toBe(429);
  });
});
