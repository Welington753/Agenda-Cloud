// Fluxo do piloto na MESMA origem, em HTTPS isolado (ver
// playwright.proxy.config.ts): o navegador só fala com
// `https://localhost:3443`; a borda local encaminha ao Next.js, cujo proxy
// `/agenda_api` chama a API real (NestJS, `NODE_ENV=production`).
//
// Prova, sem nenhum recurso externo:
// - ativação por convite, login, restauração de sessão, operação autenticada e logout
//   pelo proxy, sem nenhuma requisição do navegador à porta da API;
// - cookie de produção (`HttpOnly`, `Secure`, `SameSite=Lax`, sem `Domain`)
//   gravado na origem do frontend, e removido no logout;
// - escrita com `Origin` de outro site recusada pelo proxy;
// - estabelecimento de teste: `/agendar/<slug>` responde 200 com
//   `X-Robots-Tag: noindex, nofollow` e meta robots no HTML; o real, não.
//   Com a API lenta ou fora (relé tests/browser/support/api-controlavel.mjs),
//   os dois recebem 503 com `Retry-After`, mesmo já lidos antes: nenhuma
//   classificação antiga é reaproveitada, nunca a página "indexável" nem 404.
//   A marca trocada antes da falha vale assim que a API volta;
// - cabeçalhos de IP forjados não escapam do rate limit, e clientes
//   diferentes não dividem o mesmo limite, tanto pelo proxy quanto numa
//   chamada direta à API pela borda dela (`CLIENT_IP_SOURCE=cf-connecting-ip`
//   nos dois serviços, como em render.yaml).
//
// O que só a hospedagem real prova (borda do Render, certificado público,
// hibernação do plano gratuito) fica no runbook, seção 9.
import { conectarBancoDeTeste, prepararConviteDeDono } from "./support/contas-de-teste";
import https from "node:https";

import { expect, test, type Page } from "@playwright/test";

const ORIGEM = "https://localhost:3443";
const PORTA_API = "3001";
const SENHA = "senha-do-proxy-e2e-123";

interface RespostaCrua {
  status: number;
  corpo: string;
  setCookie: string[];
  headers: Record<string, string | string[] | undefined>;
}

/** Porta da borda local na frente da API (chamadas diretas). */
const PORTA_BORDA_API = 3444;

/** Requisição HTTPS crua, saindo de um endereço de loopback escolhido
 * (`127.0.0.x`): é assim que o teste simula clientes diferentes para a borda
 * local. `porta` escolhe a borda: 3443 (frontend, padrão) ou 3444 (API).
 * Aceita só o certificado autoassinado desta execução, só aqui. */
function requisicaoCrua(
  metodo: string,
  caminho: string,
  opcoes: { origemLocal: string; porta?: number; headers?: Record<string, string>; corpo?: unknown },
): Promise<RespostaCrua> {
  const corpo = opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo);
  const porta = opcoes.porta ?? 3443;
  return new Promise((resolve, reject) => {
    // Conecta por IPv4 explícito: `localhost` pode resolver para `::1`, que
    // não aceita um endereço local IPv4. O `Host` continua `localhost`.
    const req = https.request(
      `https://127.0.0.1:${porta}${caminho}`,
      {
        method: metodo,
        localAddress: opcoes.origemLocal,
        rejectUnauthorized: false,
        servername: "localhost",
        headers: {
          host: `localhost:${porta}`,
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
            headers: res.headers,
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

/** Porta de controle do relé entre o Next.js e a API (api-controlavel.mjs). */
const CONTROLE_RELE = "http://127.0.0.1:3446";

async function modoDaApi(modo: "normal" | "lenta" | "fora"): Promise<void> {
  const r = await fetch(`${CONTROLE_RELE}/modo/${modo}`, { method: "POST" });
  expect(r.status).toBe(200);
}

/** Estabelecimentos fictícios com página pública ligada, um por chave; o
 * valor diz se é de teste (`is_test`). Slug `<chave>-<marca>`, nome
 * `Estúdio <chave> <marca>`. */
async function criarEstabelecimentosPublicos<K extends string>(
  tipos: Record<K, boolean>,
): Promise<{ marca: string; slugs: Record<K, string>; tenantIds: Record<K, string> }> {
  const marca = sufixo().replace(/[^a-z0-9]/g, "");
  const plano = `pl${marca}`.slice(0, 30);
  const slugs = {} as Record<K, string>;
  const tenantIds = {} as Record<K, string>;
  const db = await conectarBancoDeTeste();
  try {
    // Plano fictício com todos os recursos (o agendamento público incluso).
    await db.query(
      `WITH novo AS (INSERT INTO plans (id, code, name, short_description, max_professionals, max_units)
                     VALUES ($1, $1, 'Plano fictício', '', 5, 1) RETURNING id)
       INSERT INTO plan_features (id, plan_id, feature_id)
       SELECT 'pf' || substr(md5(novo.id || f.id), 1, 26), novo.id, f.id FROM novo CROSS JOIN features f`,
      [plano],
    );
    for (const [tipo, ehTeste] of Object.entries(tipos) as [K, boolean][]) {
      const tenantId = `t${tipo}${marca}`.slice(0, 30);
      slugs[tipo] = `${tipo}-${marca}`;
      tenantIds[tipo] = tenantId;
      await db.query(
        `INSERT INTO tenants (id, slug, category, timezone, plan_id, status, access_legacy_since, is_test)
         VALUES ($1, $2, 'OTHER', 'America/Sao_Paulo', $3, 'ACTIVE', now(), $4)`,
        [tenantId, slugs[tipo], plano, ehTeste],
      );
      await db.query(
        `INSERT INTO units (id, tenant_id, name, address, timezone, is_primary) VALUES ($1, $2, $3, '', 'America/Sao_Paulo', true)`,
        [`u${tenantId}`.slice(0, 30), tenantId, `Estúdio ${tipo} ${marca}`],
      );
      await db.query(`INSERT INTO public_booking_settings (tenant_id, enabled, updated_at) VALUES ($1, true, now())`, [tenantId]);
    }
  } finally {
    await db.end();
  }
  return { marca, slugs, tenantIds };
}

const META_NOINDEX = /<meta name="robots" content="noindex, nofollow"/;

/** O cadastro público foi fechado: a conta nasce de um convite gravado pela
 * fixture no banco descartável e é ATIVADA pela página, pelo proxy da mesma
 * origem (`/agenda_api/invites/accept`), como faria quem recebe o e-mail. */
async function ativarPelaPagina(page: Page): Promise<string> {
  const email = `proxy-${sufixo()}@example.test`;
  const db = await conectarBancoDeTeste();
  let token: string;
  try {
    ({ token } = await prepararConviteDeDono(db, {
      ownerName: "Maria Proxy E2E",
      businessName: `Estúdio Proxy ${Date.now()}`,
      email,
      phone: "11999998888",
      password: SENHA,
    }));
  } finally {
    await db.end();
  }
  const status = await page.evaluate(
    async ({ token, senha }) => {
      const r = await fetch("/agenda_api/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: senha }),
      });
      return r.status;
    },
    { token, senha: SENHA },
  );
  expect(status).toBe(200);
  return email;
}

test.describe("piloto na mesma origem, em HTTPS isolado", () => {
  test("ativação por convite, login, sessão restaurada, operação autenticada e logout, só pelo proxy", async ({
    page,
    context,
  }) => {
    const chamadasDiretasAApi: string[] = [];
    page.on("request", (req) => {
      if (new URL(req.url()).port === PORTA_API) chamadasDiretasAApi.push(req.url());
    });

    await page.goto("/login");
    const email = await ativarPelaPagina(page);

    // A ativação já abre sessão; sai para provar o login pela tela.
    await context.clearCookies();
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha").fill(SENHA);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/conta\/visao-geral$/);
    await page.goto("/conta/configuracoes/perfil");
    await expect(page.getByTestId("perfil-acessos")).toContainText("Dono(a)");

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
    await expect(page).toHaveURL(/\/conta\/configuracoes\/perfil$/);
    await expect(page.getByTestId("perfil-acessos")).toContainText("Dono(a)");

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
    await page.goto("/conta/configuracoes/servicos");
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
    // "Sair" fica no menu da conta. O menu fecha a cada troca de rota, então
    // só abre depois que `/conta` terminou de levar ao Início (senão o
    // redirecionamento fecha o menu recém-aberto).
    await expect(page).toHaveURL(/\/conta\/visao-geral$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await page.getByTestId("abrir-menu-conta").click();

    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await context.cookies()).find((c) => c.name === "session_token")).toBeFalsy();
    await page.goto("/conta");
    await expect(page).toHaveURL(/\/login\?next=%2Fconta$/);

    expect(chamadasDiretasAApi, "o navegador nunca chama a porta da API").toEqual([]);
  });

  test("estabelecimento de teste fica fora da busca pelo cabeçalho e pelo HTML; o real continua indexável", async () => {
    const { marca, slugs } = await criarEstabelecimentosPublicos({ teste: true, real: false });

    const teste = await requisicaoCrua("GET", `/agendar/${slugs.teste}`, { origemLocal: "127.0.0.31" });
    expect(teste.status).toBe(200);
    expect(teste.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(teste.corpo).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    expect(teste.corpo).not.toMatch(/rel="canonical"/);
    expect(teste.corpo).not.toContain("application/ld+json");
    // Compartilhamento continua: título do estabelecimento no HTML.
    expect(teste.corpo).toContain(`Estúdio teste ${marca} · Agendamento online`);

    const real = await requisicaoCrua("GET", `/agendar/${slugs.real}`, { origemLocal: "127.0.0.32" });
    expect(real.status).toBe(200);
    expect(real.headers["x-robots-tag"]).toBeUndefined();
    expect(real.corpo).not.toMatch(/<meta name="robots" content="noindex/);
    expect(real.corpo).toMatch(new RegExp(`rel="canonical" href="[^"]*/agendar/${slugs.real}"`));
    // Página dinâmica: nenhuma cópia em cache compartilhado.
    for (const r of [teste, real]) expect(String(r.headers["cache-control"])).toMatch(/no-store/);

    // Cabeçalho interno forjado pelo cliente não escolhe a decisão.
    const forjado = await requisicaoCrua("GET", `/agendar/${slugs.teste}`, {
      origemLocal: "127.0.0.31",
      headers: { "x-agenda-indexacao": "indexavel" },
    });
    expect(forjado.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(forjado.corpo).toMatch(META_NOINDEX);
    const forjadoReal = await requisicaoCrua("GET", `/agendar/${slugs.real}`, {
      origemLocal: "127.0.0.32",
      headers: { "x-agenda-indexacao": "teste" },
    });
    expect(forjadoReal.headers["x-robots-tag"]).toBeUndefined();
    expect(forjadoReal.corpo).not.toMatch(/<meta name="robots" content="noindex/);
  });

  test("API lenta ou fora: 503 sem reaproveitar classificação antiga; marca trocada vale quando a API volta", async () => {
    test.setTimeout(120_000);
    const { slugs, tenantIds } = await criarEstabelecimentosPublicos({ teste: true, real: false });
    const abrir = (slug: string, origemLocal: string) => requisicaoCrua("GET", `/agendar/${slug}`, { origemLocal });
    const esperar503 = (r: RespostaCrua, rotulo: string) => {
      expect(r.status, rotulo).toBe(503);
      expect(r.headers["retry-after"], rotulo).toBe("30");
      expect(r.headers["cache-control"], rotulo).toBe("no-store");
      expect(r.headers["x-robots-tag"], rotulo).toBeUndefined();
      expect(r.corpo, rotulo).toContain("Tentar de novo agora");
      expect(r.corpo, rotulo).not.toMatch(/noindex/);
    };
    const trocarMarcas = async (teste: boolean, real: boolean) => {
      const db = await conectarBancoDeTeste();
      try {
        await db.query("UPDATE tenants SET is_test = $2 WHERE id = $1", [tenantIds.teste, teste]);
        await db.query("UPDATE tenants SET is_test = $2 WHERE id = $1", [tenantIds.real, real]);
      } finally {
        await db.end();
      }
    };

    // API normal: as duas páginas são lidas e classificadas.
    expect((await abrir(slugs.teste, "127.0.0.33")).headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect((await abrir(slugs.real, "127.0.0.34")).headers["x-robots-tag"]).toBeUndefined();

    try {
      // Já lidos, com a API lenta ou fora: 503 para os dois.
      for (const modo of ["lenta", "fora"] as const) {
        await modoDaApi(modo);
        esperar503(await abrir(slugs.teste, "127.0.0.33"), `teste, ${modo}`);
        esperar503(await abrir(slugs.real, "127.0.0.34"), `real, ${modo}`);
      }

      // A marca muda (real vira teste, teste é desmarcado) e a API falha
      // em seguida: 503, nunca a classificação de antes da troca.
      await modoDaApi("normal");
      await trocarMarcas(false, true);
      await modoDaApi("fora");
      esperar503(await abrir(slugs.real, "127.0.0.34"), "real marcado como teste, API fora");
      esperar503(await abrir(slugs.teste, "127.0.0.33"), "teste desmarcado, API fora");

      // A API volta: vale a classificação atual.
      await modoDaApi("normal");
      const marcado = await abrir(slugs.real, "127.0.0.34");
      expect(marcado.status).toBe(200);
      expect(marcado.headers["x-robots-tag"]).toBe("noindex, nofollow");
      expect(marcado.corpo).toMatch(META_NOINDEX);
      expect(marcado.corpo).not.toMatch(/rel="canonical"/);
      const desmarcado = await abrir(slugs.teste, "127.0.0.33");
      expect(desmarcado.status).toBe(200);
      expect(desmarcado.headers["x-robots-tag"]).toBeUndefined();
      expect(desmarcado.corpo).not.toMatch(/<meta name="robots" content="noindex/);
      expect(desmarcado.corpo).toMatch(/rel="canonical"/);
    } finally {
      await modoDaApi("normal");
    }
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

  test("chamada direta à API pela borda: cabeçalhos forjados não escapam do limite; outro cliente segue livre", async () => {
    const tentativa = (origemLocal: string, i: number) =>
      requisicaoCrua("POST", "/auth/login", {
        origemLocal,
        porta: PORTA_BORDA_API,
        headers: {
          "cf-connecting-ip": `203.0.113.${i + 1}`,
          "x-forwarded-for": `198.51.100.${i + 1}`,
          "x-real-ip": `192.0.2.${i + 1}`,
          "x-agenda-client-ip": `203.0.113.${i + 101}`,
          "x-agenda-proxy-secret": "segredo-forjado-pelo-cliente-0123456789",
        },
        corpo: { email: `direto-borda-${sufixo()}@example.test`, password: "senha-errada-123" },
      });

    const status: number[] = [];
    for (let i = 0; i < 6; i++) status.push((await tentativa("127.0.0.5", i)).status);
    expect(status.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(status[5]).toBe(429);

    // Outro cliente (outro endereço para a borda da API) tem o próprio limite.
    expect((await tentativa("127.0.0.6", 0)).status).toBe(401);
  });
});
