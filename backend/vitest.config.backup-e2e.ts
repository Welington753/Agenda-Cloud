import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Caminho completo do backup agendado (lote O1) com dados FICTÍCIOS: banco
// de origem e de restauração num PostgreSQL descartável com TLS
// (`DB_E2E_DIRECT_URL`), `pg_dump`/`pg_restore` de `PG_BIN`, age de
// `AGE_BIN` e simuladores locais de S3 (B2) e do monitor de cron. Separado do
// db-e2e porque exige binários que o job principal do CI não instala.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.backup-e2e-spec.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
