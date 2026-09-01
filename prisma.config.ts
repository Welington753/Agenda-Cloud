import { loadEnvConfig } from "@next/env";
import { defineConfig } from "prisma/config";

loadEnvConfig(import.meta.dirname);

// O CLI do Prisma (migrate, studio, db execute) usa DIRECT_URL: precisa de uma
// conexão direta (sessão longa, DDL, advisory locks), não da conexão com
// pooling que a aplicação usa em runtime (DATABASE_URL, via @prisma/adapter-pg
// em src/lib/db/prisma.ts). Lida com process.env diretamente (não com o
// helper `env()`, que lança exceção) para que `prisma format`/`validate`/
// `generate` continuem funcionando mesmo antes de DIRECT_URL existir —
// somente comandos que efetivamente migram o banco exigem essa variável.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DIRECT_URL,
  },
});
