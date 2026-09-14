import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Config dedicado para o teste de integração do Lote 6B.2 contra um
// PostgreSQL descartável real (ver scripts/lote6b2-migration.migration-e2e-spec.ts).
// Separado de vitest.config.e2e.ts (app Nest, sem Postgres) porque este
// precisa de infraestrutura externa e só roda quando
// `MIGRATION_E2E_DIRECT_URL` está definida (CI dedicado, nunca localmente
// por acidente, nunca contra Neon).
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.migration-e2e-spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
