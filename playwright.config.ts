import { defineConfig, devices } from "@playwright/test";

// Teste de navegador do fluxo real de cookies (Lote 6C.1) — sobe o backend
// NestJS e o frontend Next.js já compilados, contra um Postgres descartável
// (nunca Neon/produção; a URL vem só de variáveis de ambiente já validadas
// pelo backend, ver backend/src/config/env.validation.ts). `webServer` aqui
// nunca inicia banco nenhum — quem sobe o Postgres descartável e roda as
// migrations é a etapa anterior do workflow de CI (ou o passo manual local
// documentado em docs/setup-local.md).
export default defineConfig({
  testDir: "./tests/browser",
  // Fluxo da mesma origem em HTTPS: precisa de outro build do frontend e de
  // outro ambiente da API, então só roda pela própria configuração
  // (playwright.proxy.config.ts, `npm run test:browser:proxy`).
  testIgnore: "same-origin-proxy-flow.spec.ts",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // `list` só: nenhum relatório HTML é gerado, então NADA cria
  // `playwright-report/` — quem precisa do diagnóstico usa o `trace.zip` que
  // `trace: "retain-on-failure"` grava em `outputDir` (ver
  // test-frontend-auth.yml, passo que sobe `test-results/`).
  reporter: [["list"]],
  // Um subdiretório por invocação do Playwright no CI: são seis invocações
  // separadas no mesmo job, e cada uma LIMPA o próprio `outputDir` ao
  // começar. Sem separar, a invocação seguinte apagaria o trace da anterior.
  // Fora do CI continua em `test-results/`, como antes.
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // `PORT` fixado aqui (nunca herdado do ambiente do job) — um `PORT`
      // exportado no nível do job de CI vazaria para os DOIS processos
      // (backend e frontend), fazendo os dois tentarem escutar a mesma porta
      // (`EADDRINUSE`, causa real de uma falha anterior deste workflow).
      command: "node dist/main.js",
      cwd: "backend",
      env: { PORT: "3001" },
      url: "http://localhost:3001/auth/me",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "npm run start -- -p 3000",
      env: { PORT: "3000" },
      url: "http://localhost:3000/login",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
