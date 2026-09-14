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
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node dist/main.js",
      cwd: "backend",
      url: "http://localhost:3001/auth/me",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "npm run start",
      url: "http://localhost:3000/login",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
