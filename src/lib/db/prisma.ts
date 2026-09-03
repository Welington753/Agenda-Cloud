// Instância singleton do PrismaClient para uso em runtime (server-only) e nos
// testes de banco (*.db.test.ts).
//
// DESVIO do plano registrado aqui: o plano previa usar DATABASE_URL (pooled)
// para este client, reservando DIRECT_URL só para o CLI (prisma.config.ts) e
// o seed. Na prática, a DATABASE_URL deste projeto é uma connection string
// `prisma+postgres://...` do Prisma Accelerate — um protocolo HTTP(S) próprio,
// não Postgres cru. `@prisma/adapter-pg` usa o driver `pg`, que só fala o
// protocolo de fio do Postgres; apontá-lo para a URL do Accelerate resulta em
// ETIMEDOUT (confirmado ao rodar a suíte de testes de banco). Só DIRECT_URL é
// uma connection string `postgres://` de verdade. Por isso este arquivo (e,
// por extensão, os testes de banco) usa DIRECT_URL, com o mesmo padrão de
// prisma.config.ts e prisma/seed.ts. Consumir DATABASE_URL/Accelerate exigiria
// a extensão `@prisma/extension-accelerate` (fora do escopo desta etapa) em
// vez de `@prisma/adapter-pg` — decisão para quando a app realmente rodar em
// runtime, não para hoje. Cacheado em `globalThis` para sobreviver ao hot
// reload do Next em dev e não abrir uma pool nova a cada reload.
//
// Nenhuma tela consome este arquivo ainda — ver "Limites desta etapa" em
// docs/plans/fundacao-postgresql.md. Ele existe para os testes de banco (e para
// a camada de repositórios de uma fase futura) falarem com o Postgres.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

declare global {
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DIRECT_URL;
  if (!connectionString) {
    throw new Error("DIRECT_URL não definida — necessária para conectar ao Postgres (ver comentário acima).");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalThis.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
