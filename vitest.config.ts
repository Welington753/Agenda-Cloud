import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // `prisma/*.test.ts` cobre só testes puros do Prisma legado (ex.: o guard
    // de seed-guard.ts) — sem rede/banco, por isso cabem nesta suíte padrão.
    include: ["src/**/*.test.ts", "prisma/*.test.ts"],
    // Testes de banco (*.db.test.ts) vivem em vitest.db.config.ts / `npm run
    // test:db` — precisam rodar seriais contra Postgres real, então ficam fora
    // desta suíte padrão (sem rede/banco). O exclude abaixo também protege
    // `prisma/*.test.ts` acima: qualquer *.db.test.ts continua de fora daqui.
    exclude: ["**/node_modules/**", "**/*.db.test.ts"],
  },
});
