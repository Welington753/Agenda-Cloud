// Trava a regressão que motivou este lote: o caminho real de production
// (tudo que `migrate:production:guarded` chega a executar) nunca pode voltar
// a depender do loader experimental `ts-node/esm` — nem direto, nem via
// `typeorm-ts-node-esm`, nem via `--loader`. Isso é verificado lendo o texto
// fonte (`package.json` e `apply-lote6b2-production.ts`), nunca executando
// nada contra um banco.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.join(moduleDir, '..');

const packageJson = JSON.parse(readFileSync(path.join(backendDir, 'package.json'), 'utf-8')) as {
  scripts: Record<string, string>;
};

const orchestratorSource = readFileSync(path.join(backendDir, 'scripts/apply-lote6b2-production.ts'), 'utf-8');

const FORBIDDEN_IN_PRODUCTION_PATH = ['ts-node/esm', 'typeorm-ts-node-esm', '--loader', '--experimental-loader'];

describe('caminho de production nunca usa ts-node/esm', () => {
  it.each(['migrate:production:guarded', 'build:migrations-runtime', 'migration:show:compiled', 'migration:run:compiled'])(
    'script "%s" do package.json não contém loader experimental',
    (scriptName) => {
      const command = packageJson.scripts[scriptName];
      expect(command).toBeDefined();
      for (const forbidden of FORBIDDEN_IN_PRODUCTION_PATH) {
        expect(command).not.toContain(forbidden);
      }
    },
  );

  it('migration:show:compiled usa o TypeORM CLI puro contra o DataSource compilado em dist-migrations', () => {
    expect(packageJson.scripts['migration:show:compiled']).toBe(
      'typeorm migration:show -d dist-migrations/database/migrations-data-source.js',
    );
  });

  it('migration:run:compiled usa o TypeORM CLI puro contra o DataSource compilado em dist-migrations', () => {
    expect(packageJson.scripts['migration:run:compiled']).toBe(
      'typeorm migration:run -d dist-migrations/database/migrations-data-source.js',
    );
  });

  it('migrate:production:guarded compila o runtime de migrations uma única vez antes de orquestrar', () => {
    const command = packageJson.scripts['migrate:production:guarded'];
    const buildIndex = command.indexOf('build:migrations-runtime');
    const runIndex = command.indexOf('run-apply-lote6b2-production.js');
    expect(buildIndex).toBeGreaterThan(-1);
    expect(runIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeLessThan(runIndex);
  });

  it('orquestrador só invoca as variantes ":compiled" de migration:show/migration:run — nunca as ts-node/esm', () => {
    expect(orchestratorSource).toContain("'migration:show:compiled'");
    expect(orchestratorSource).toContain("'migration:run:compiled'");
    expect(orchestratorSource).not.toMatch(/'migration:show'/);
    expect(orchestratorSource).not.toMatch(/'migration:run'(?!:compiled')/);
  });

  it('orquestrador continua passando "-t all" para migration:run', () => {
    expect(orchestratorSource).toMatch(/migration:run:compiled['"],\s*['"]--['"],\s*['"]-t['"],\s*['"]all['"]/);
  });

  it('orquestrador nunca fixa um cwd relativo (a causa raiz do ENOENT observado em production)', () => {
    expect(orchestratorSource).not.toMatch(/cwd:\s*['"]backend['"]/);
  });
});
