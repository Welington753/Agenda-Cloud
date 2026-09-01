import { defineConfig } from "vitest/config";
import path from "node:path";

// Suíte separada de testes de banco (*.db.test.ts). Roda contra o Postgres real
// (mesma DATABASE_URL/DIRECT_URL do .env do projeto), então precisa de execução
// SERIAL (fileParallelism: false) para não gerar corrida entre arquivos de teste
// que compartilham o mesmo banco. `npm run test` (vitest.config.ts) continua
// ignorando estes arquivos — ver `exclude` lá.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.db.test.ts", "prisma/**/*.db.test.ts"],
    setupFiles: ["./prisma/db-test-setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
