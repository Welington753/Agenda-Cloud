import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Config dedicado aos testes de integração que precisam de um PostgreSQL
// DESCARTÁVEL real (Lote 6D.1 em diante). Separado de vitest.config.e2e.ts
// (app Nest, sem banco) porque este depende de infraestrutura externa: só roda
// quando `DB_E2E_DIRECT_URL` está definida — nunca localmente por acidente,
// nunca contra Neon. Não usa `test/e2e-env-setup.ts`: aqui nenhum AppModule é
// montado, o DataSource é construído explicitamente pelo próprio teste com a
// URL descartável.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.db-e2e-spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Sem paralelismo entre arquivos: todos compartilham o mesmo banco
    // descartável.
    fileParallelism: false,
  },
});
