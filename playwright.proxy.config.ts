import { defineConfig, devices } from "@playwright/test";

// Fluxo do PILOTO: navegador → borda HTTPS → Next.js (proxy `/agenda_api`) →
// API NestJS, tudo local e isolado. Mesma disciplina de playwright.config.ts:
// banco sempre o PostgreSQL descartável do CI (ou um equivalente local), nunca
// Neon nem `agenda_dev`; a URL vem só do ambiente.
//
// Diferenças em relação à configuração padrão, todas de propósito:
// - a API roda com `NODE_ENV=production`: o cookie de sessão sai `Secure`,
//   e `FRONTEND_URL` precisa ser HTTPS, como na hospedagem;
// - o frontend precisa ter sido compilado com `NEXT_PUBLIC_API_URL=/agenda_api`
//   (modo mesma origem); o navegador nunca fala com a porta da API;
// - a borda (tests/browser/support/borda-https.mjs) termina o TLS e escreve
//   `CF-Connecting-IP` como a borda do Render. Há uma borda na frente de cada
//   serviço, como na hospedagem: 3443 → Next.js e 3444 → API (chamadas
//   diretas). Os dois serviços rodam com `CLIENT_IP_SOURCE=cf-connecting-ip`,
//   o valor de render.yaml. O salto do proxy até a API é direto (HTTP local):
//   nele, o IP do cliente vai no cabeçalho autenticado pelo segredo;
// - entre o Next.js e a API fica um relé local
//   (tests/browser/support/api-controlavel.mjs, porta 3002) que repassa tudo
//   sem mudar nada, e que o teste põe em modo "lenta" ou "fora" para provar a
//   decisão de indexação da página pública com a API falhando.
//
// `API_PROXY_SECRET` vem do ambiente (valor descartável do job de CI); os dois
// processos recebem o mesmo valor.
const ORIGEM_PUBLICA = "https://localhost:3443";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "same-origin-proxy-flow.spec.ts",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results/proxy",
  use: {
    baseURL: ORIGEM_PUBLICA,
    // Só o certificado autoassinado da borda local, gerado a cada execução.
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node dist/main.js",
      cwd: "backend",
      env: {
        PORT: "3001",
        NODE_ENV: "production",
        FRONTEND_URL: ORIGEM_PUBLICA,
        // Obrigatórias em production. Chave FICTÍCIA (32 bytes fixos), só de
        // teste; nenhuma conta desta suíte tem papel de plataforma.
        PLATFORM_2FA_ENFORCEMENT: "optional",
        PLATFORM_TOTP_KEYS: `1:${Buffer.alloc(32, 7).toString("base64")}`,
        PLATFORM_TOTP_KEY_CURRENT: "1",
        CLIENT_IP_SOURCE: "cf-connecting-ip",
      },
      url: "http://localhost:3001/",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "node tests/browser/support/api-controlavel.mjs",
      url: "http://127.0.0.1:3002/",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "npm run start -- -p 3000",
      env: {
        PORT: "3000",
        API_PROXY_TARGET: "http://127.0.0.1:3002",
        APP_PUBLIC_ORIGIN: ORIGEM_PUBLICA,
        CLIENT_IP_SOURCE: "cf-connecting-ip",
      },
      url: "http://localhost:3000/login",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "node tests/browser/support/borda-https.mjs",
      url: `${ORIGEM_PUBLICA}/login`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "node tests/browser/support/borda-https.mjs",
      env: { BORDA_PORTA: "3444", BORDA_DESTINO_PORTA: "3001" },
      url: "https://localhost:3444/",
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
