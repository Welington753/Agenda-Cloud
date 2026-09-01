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
    include: ["src/**/*.test.ts"],
    // Testes de banco (*.db.test.ts) vivem em vitest.db.config.ts / `npm run
    // test:db` — precisam rodar seriais contra Postgres real, então ficam fora
    // desta suíte padrão (sem rede/banco).
    exclude: ["**/node_modules/**", "**/*.db.test.ts"],
  },
});
