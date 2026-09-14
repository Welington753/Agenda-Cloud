// Prova que o runtime de migrations compilado para JavaScript puro (
// `dist-migrations/`, gerado por `npm run build:migrations-runtime`) é o
// mesmo artefato que o TypeORM CLI usa em production — importável por Node
// puro, sem `ts-node`, sem inicializar conexão nenhuma. Nunca usa URL real:
// só uma URL fictícia em `localhost`, e nunca chama `.initialize()`.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.join(moduleDir, '../..');
const distMigrationsDir = path.join(backendDir, 'dist-migrations');
// Chama o entrypoint JS do próprio pacote `typescript` via `node`, nunca o
// wrapper `.cmd`/`.ps1` de `.bin` — evita `shell: true` (e o
// `DEP0190`/superfície de escaping que vem junto) mesmo sendo só um script de
// teste, seguindo a mesma convenção de `shell: false` usada no caminho real
// de production (ver `process-runner.ts`).
const tscEntrypoint = path.join(backendDir, 'node_modules', 'typescript', 'bin', 'tsc');

const FAKE_LOCALHOST_URL = 'postgresql://fake_user:fake_pass@localhost:5432/fake_db';

function buildMigrationsRuntimeOnce(): void {
  execFileSync(process.execPath, [tscEntrypoint, '-p', 'tsconfig.migrations.json'], {
    cwd: backendDir,
    stdio: 'pipe',
  });
}

describe('runtime de migrations compilado (dist-migrations)', () => {
  buildMigrationsRuntimeOnce();

  it('gera exatamente o DataSource de migrations compilado em JS', () => {
    expect(existsSync(path.join(distMigrationsDir, 'database/migrations-data-source.js'))).toBe(true);
  });

  it('descobre as três migrations no dist (nunca specs)', () => {
    const files = readdirSync(path.join(distMigrationsDir, 'migrations'));
    const migrationJsFiles = files.filter((f) => f.endsWith('.js') && !f.includes('.spec.'));
    expect(migrationJsFiles).toHaveLength(3);
    expect(migrationJsFiles.some((f) => f.includes('InitialSchema'))).toBe(true);
    expect(migrationJsFiles.some((f) => f.includes('AllowUndefinedPlanPrice'))).toBe(true);
    expect(migrationJsFiles.some((f) => f.includes('InitialPlanCatalog'))).toBe(true);
    // Nenhum `.spec.js` deve escapar para o dist — só código de migration real.
    expect(files.some((f) => f.includes('.spec.'))).toBe(false);
  });

  it('descobre as entidades no dist', () => {
    const files = readdirSync(path.join(distMigrationsDir, 'entities'));
    const entityJsFiles = files.filter((f) => f.endsWith('.entity.js'));
    expect(entityJsFiles.length).toBeGreaterThan(0);
    expect(files.some((f) => f.includes('.spec.'))).toBe(false);
  });

  it('módulo compilado importa com Node puro, expõe exatamente um DataSource, e nunca inicializa ao importar', async () => {
    const previousDirectUrl = process.env.DIRECT_URL;
    process.env.DIRECT_URL = FAKE_LOCALHOST_URL;
    try {
      const modulePath = path.join(distMigrationsDir, 'database/migrations-data-source.js');
      const moduleUrl = `${pathToFileURL(modulePath).href}?fresh=${Date.now()}`;
      const mod = (await import(moduleUrl)) as Record<string, unknown>;

      const { DataSource } = await import('typeorm');
      const dataSourceExports = Object.values(mod).filter((value) => value instanceof DataSource);
      expect(dataSourceExports).toHaveLength(1);

      const dataSource = dataSourceExports[0] as InstanceType<typeof DataSource>;
      // Nunca conectou — construir a instância só guarda config em memória.
      expect(dataSource.isInitialized).toBe(false);
      expect((dataSource.options as { url?: string }).url).toBe(FAKE_LOCALHOST_URL);
    } finally {
      process.env.DIRECT_URL = previousDirectUrl;
    }
  });
});
