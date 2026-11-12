// Dois aplicativos instaláveis na mesma origem: "TimVix" (operação,
// src/app/manifest.ts, sem mudança) e "Portal TimVix" (portal da plataforma,
// src/lib/pwa/manifest-portal.ts). Contra o backend real e o PostgreSQL
// DESCARTÁVEL, só com dados fictícios. A promoção a MASTER_OWNER é fixture de
// teste: não existe rota para isso.
//
// Prova o que o HTML e o navegador entregam (manifest, apple-touch-icon,
// título do aplicativo, login e volta, navegação entre as áreas). NÃO prova a
// instalação no iPhone, os cookies separados de cada aplicativo da Tela de
// Início nem o comportamento de links fora do escopo: isso é o roteiro no
// aparelho real.
//
// Invocação própria (`npm run test:browser:portal-instalavel`): 3 aceites de
// convite e 4 logins.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { conectarBancoDeTeste, criarContaDeTeste } from "./support/contas-de-teste";
import { SEM_ACESSO_AO_PORTAL, VISAO_GERAL_DO_PORTAL, entrarPeloFormulario, navPortal, sairDoPortal } from "./support/portal";

const SENHA = "senha-do-portal-instalavel-1";
const id = () => randomUUID().replaceAll("-", "").slice(0, 10);

const MANIFEST_OPERACAO = "/manifest.webmanifest";
const MANIFEST_PORTAL = "/portal/manifest.webmanifest";

type Cabeca = { manifests: string[]; apple: string[]; titulo: string | null };

/** Metadados de instalação do HTML servido (antes de qualquer JavaScript). */
async function cabecaDoHtml(request: APIRequestContext, caminho: string): Promise<Cabeca> {
  const r = await request.get(caminho, { maxRedirects: 0 });
  expect(r.status(), caminho).toBe(200);
  const html = await r.text();
  const todos = (re: RegExp) => [...html.matchAll(re)].map((m) => m[1].replaceAll("&amp;", "&"));
  return {
    manifests: todos(/<link rel="manifest" href="([^"]+)"/g),
    apple: todos(/<link rel="apple-touch-icon" href="([^"]+)"/g),
    titulo: /<meta name="apple-mobile-web-app-title" content="([^"]+)"/.exec(html)?.[1] ?? null,
  };
}

/** Metadados de instalação do documento já montado (depois da navegação). */
async function cabecaDaPagina(page: Page): Promise<Cabeca> {
  return page.evaluate(() => ({
    manifests: [...document.querySelectorAll('link[rel="manifest"]')].map((l) => l.getAttribute("href") ?? ""),
    apple: [...document.querySelectorAll('link[rel="apple-touch-icon"]')].map((l) => l.getAttribute("href") ?? ""),
    titulo: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute("content") ?? null,
  }));
}

function esperarPortal(c: Cabeca) {
  expect(c.manifests).toEqual([MANIFEST_PORTAL]);
  expect(c.apple).toHaveLength(1);
  expect(c.apple[0]).toMatch(/^\/portal\/apple-icon(\?|$)/);
  expect(c.titulo).toBe("Portal TimVix");
}

function esperarOperacao(c: Cabeca) {
  expect(c.manifests).toEqual([MANIFEST_OPERACAO]);
  expect(c.apple).toHaveLength(1);
  expect(c.apple[0]).toMatch(/^\/apple-icon(\?|$)/);
  expect(c.titulo).toBe("TimVix");
}

test("HTML e manifests: o portal anuncia o Portal TimVix; operação, login e agendamento público seguem com o TimVix", async ({ request }) => {
  for (const caminho of ["/portal", "/portal?next=%2Fportal%2Fusuarios", VISAO_GERAL_DO_PORTAL, "/portal/estabelecimentos"]) {
    esperarPortal(await cabecaDoHtml(request, caminho));
  }
  for (const caminho of ["/conta/visao-geral", "/login", "/agendar/slug-inexistente-portal-instalavel", "/"]) {
    esperarOperacao(await cabecaDoHtml(request, caminho));
  }

  const operacao = await request.get(MANIFEST_OPERACAO);
  expect(operacao.headers()["content-type"]).toContain("application/manifest+json");
  expect(await operacao.json()).toMatchObject({
    id: "/conta/visao-geral",
    start_url: "/conta/visao-geral",
    scope: "/",
    display: "standalone",
    name: "TimVix",
  });

  const portal = await request.get(MANIFEST_PORTAL);
  expect(portal.headers()["content-type"]).toContain("application/manifest+json");
  const m = (await portal.json()) as { icons: { src: string; sizes: string }[] };
  expect(m).toMatchObject({
    id: "/portal/visao-geral",
    start_url: "/portal/visao-geral",
    scope: "/portal",
    display: "standalone",
    name: "Portal TimVix",
    short_name: "Portal TimVix",
  });
  const apple = (await cabecaDoHtml(request, VISAO_GERAL_DO_PORTAL)).apple[0];
  for (const src of [...m.icons.map((i) => i.src), apple]) {
    const r = await request.get(src);
    expect(r.status(), src).toBe(200);
    expect(r.headers()["content-type"], src).toBe("image/png");
  }
  // O ícone do portal não é o da operação.
  const [iconePortal, iconeOperacao] = await Promise.all([request.get(apple), request.get((await cabecaDoHtml(request, "/login")).apple[0])]);
  expect(Buffer.compare(await iconePortal.body(), await iconeOperacao.body())).not.toBe(0);
});

test("Portal TimVix sem sessão: login no portal, volta à Visão geral, destinos externos ignorados e navegação entre as áreas", async ({ page }) => {
  test.setTimeout(120_000);
  const db = await conectarBancoDeTeste();
  try {
    const marca = `portal-instalavel-${id()}`;
    const email = `${marca}@example.test`;
    const conta = await criarContaDeTeste(page.request, {
      ownerName: "Proprietária Fictícia",
      businessName: `${marca} Negócio`,
      email,
      password: SENHA,
    });
    await db.query("DELETE FROM memberships WHERE user_id = $1", [conta.user.id]);
    await db.query("UPDATE users SET platform_role = 'MASTER_OWNER' WHERE id = $1", [conta.user.id]);
    await page.context().clearCookies();

    // Abertura do aplicativo instalado (start_url) sem sessão.
    await page.goto(VISAO_GERAL_DO_PORTAL);
    await expect(page).toHaveURL("/portal?next=%2Fportal%2Fvisao-geral");
    await expect(page.getByRole("heading", { name: "Entrar no portal" })).toBeVisible();
    esperarPortal(await cabecaDaPagina(page));
    await entrarPeloFormulario(page, email, SENHA);
    await expect(page).toHaveURL(VISAO_GERAL_DO_PORTAL);
    await expect(navPortal(page)).toBeVisible();
    esperarPortal(await cabecaDaPagina(page));

    // Navegação dentro do portal (sem recarregar) mantém o Portal TimVix.
    await navPortal(page).getByRole("link", { name: "Estabelecimentos" }).click();
    await expect(page).toHaveURL("/portal/estabelecimentos");
    esperarPortal(await cabecaDaPagina(page));

    // Destinos de fora do portal ou de outra origem nunca são seguidos.
    for (const next of ["//evil.example/x", "https://evil.example/x", "/\\evil.example", "/conta/visao-geral", "/portalx"]) {
      await page.goto(`/portal?next=${encodeURIComponent(next)}`);
      await expect(page, next).toHaveURL(VISAO_GERAL_DO_PORTAL);
    }

    // Da operação para o portal e de volta: cada área com o seu aplicativo.
    await page.goto("/conta/configuracoes");
    await expect(page).toHaveURL(/\/conta\/configuracoes/);
    esperarOperacao(await cabecaDaPagina(page));
    await page.goto(VISAO_GERAL_DO_PORTAL);
    await expect(navPortal(page)).toBeVisible();
    esperarPortal(await cabecaDaPagina(page));
  } finally {
    await db.end();
  }
});

test("Portal TimVix com a sessão de quem não é proprietário da plataforma: recusa, e a operação segue normal", async ({ page }) => {
  test.setTimeout(120_000);
  const marca = `portal-instalavel-dono-${id()}`;
  const email = `${marca}@example.test`;
  await criarContaDeTeste(page.request, {
    ownerName: "Dona Fictícia",
    businessName: `${marca} Negócio`,
    email,
    password: SENHA,
  });
  await page.context().clearCookies();

  await page.goto(VISAO_GERAL_DO_PORTAL);
  await expect(page).toHaveURL("/portal?next=%2Fportal%2Fvisao-geral");
  await entrarPeloFormulario(page, email, SENHA);
  await expect(page.getByText(SEM_ACESSO_AO_PORTAL)).toBeVisible();
  await expect(navPortal(page)).toHaveCount(0);
  esperarPortal(await cabecaDaPagina(page));

  await page.goto("/conta/visao-geral");
  await expect(page).toHaveURL(/\/conta\//);
  esperarOperacao(await cabecaDaPagina(page));
});

// Regressão do manifest duplicado (react/react#38155; ver o comentário de
// `htmlLimitedBots` em next.config.ts). Com a CPU 8x mais lenta, a guarda de
// sessão manda para a entrada antes de o React hidratar os metadados do HTML
// inicial; com metadados em streaming, as tags do servidor ficavam órfãs e
// cada página seguinte somava as suas. Um observador conta, desde o início do
// documento, o maior número de `<link rel="manifest">` que existiu ao mesmo
// tempo: até uma duplicação passageira reprova.
test("CPU 8x mais lenta: acesso direto sem sessão, login, navegação, saída e volta nunca deixam dois manifests", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const w = window as unknown as { __maiorContagemDeManifests: number };
    w.__maiorContagemDeManifests = 0;
    const contar = () => {
      const n = document.querySelectorAll('link[rel="manifest"]').length;
      if (n > w.__maiorContagemDeManifests) w.__maiorContagemDeManifests = n;
    };
    new MutationObserver(contar).observe(document, { childList: true, subtree: true });
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 8 });

  /** Espera a página atual ter o seu manifest e confere que nunca houve dois. */
  async function manifestUnicoDoPortal() {
    await expect.poll(async () => (await cabecaDaPagina(page)).manifests, { timeout: 20_000 }).toEqual([MANIFEST_PORTAL]);
    esperarPortal(await cabecaDaPagina(page));
    expect(await page.evaluate(() => (window as unknown as { __maiorContagemDeManifests: number }).__maiorContagemDeManifests)).toBe(1);
  }

  const db = await conectarBancoDeTeste();
  try {
    const marca = `portal-instalavel-lento-${id()}`;
    const email = `${marca}@example.test`;
    const conta = await criarContaDeTeste(page.request, {
      ownerName: "Proprietária Fictícia Lenta",
      businessName: `${marca} Negócio`,
      email,
      password: SENHA,
    });
    await db.query("DELETE FROM memberships WHERE user_id = $1", [conta.user.id]);
    await db.query("UPDATE users SET platform_role = 'MASTER_OWNER' WHERE id = $1", [conta.user.id]);
    await page.context().clearCookies();

    // Acesso direto ao start_url sem sessão: a guarda manda para a entrada.
    await page.goto(VISAO_GERAL_DO_PORTAL);
    await expect(page).toHaveURL("/portal?next=%2Fportal%2Fvisao-geral", { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Entrar no portal" })).toBeVisible({ timeout: 20_000 });
    await manifestUnicoDoPortal();

    // Login e volta à Visão geral.
    await entrarPeloFormulario(page, email, SENHA);
    await expect(page).toHaveURL(VISAO_GERAL_DO_PORTAL, { timeout: 20_000 });
    await expect(navPortal(page)).toBeVisible({ timeout: 20_000 });
    await manifestUnicoDoPortal();

    // Navegação interna.
    await navPortal(page).getByRole("link", { name: "Estabelecimentos" }).click();
    await expect(page).toHaveURL("/portal/estabelecimentos", { timeout: 20_000 });
    await manifestUnicoDoPortal();

    // Saída e volta ao portal pelo login.
    await sairDoPortal(page);
    await expect(page.getByRole("heading", { name: "Entrar no portal" })).toBeVisible({ timeout: 20_000 });
    await manifestUnicoDoPortal();
    await entrarPeloFormulario(page, email, SENHA);
    await expect(navPortal(page)).toBeVisible({ timeout: 20_000 });
    await manifestUnicoDoPortal();
  } finally {
    await db.end();
  }
});
