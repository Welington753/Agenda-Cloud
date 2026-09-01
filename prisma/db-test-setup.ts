// Setup global da suíte de testes de banco (vitest.db.config.ts). Carrega
// .env/.env.local da mesma forma que o Next carregaria, já que os testes rodam
// via `tsx`/`vitest` puro, fora do runtime do Next — sem isto, DATABASE_URL não
// estaria disponível para src/lib/db/prisma.ts.
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
