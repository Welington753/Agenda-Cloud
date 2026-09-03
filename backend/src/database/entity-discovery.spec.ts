// Comprova que as 30 entidades são descobertas pelo padrão glob já usado em
// `entities:` (runtime-data-source.ts / migrations-data-source.ts) — sem
// nunca chamar `.initialize()`. TypeORM só resolve esse glob dentro de
// `buildMetadatas()`, chamado de dentro de `initialize()` **depois** de
// `driver.connect()` já ter rodado — ou seja, não existe forma de exercitar
// a resolução real do TypeORM sem antes tentar uma conexão de rede. Por
// isso a resolução aqui é feita com `node:fs` (`globSync`, nativo desde o
// Node 22, sem dependência nova), replicando exatamente a stringa de
// padrão usada nos dois arquivos de DataSource — nunca reimplementando um
// registro de entidades paralelo.
import { globSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MigrationsDataSource,
  migrationsDataSourceOptions,
} from './migrations-data-source.js';
import {
  RuntimeDataSource,
  runtimeDataSourceOptions,
} from './runtime-data-source.js';

const databaseDir = path.dirname(fileURLToPath(import.meta.url));
const entitiesDir = path.join(databaseDir, '../entities');

function entitiesGlobOf(options: { entities?: unknown }): string {
  const [pattern] = options.entities as string[];
  return pattern;
}

describe('descoberta de entidades — sem inicializar DataSource', () => {
  it('o padrão glob configurado é o mesmo nos dois DataSources (runtime e migrations)', () => {
    expect(entitiesGlobOf(runtimeDataSourceOptions)).toBe(
      entitiesGlobOf(migrationsDataSourceOptions),
    );
    expect(entitiesGlobOf(runtimeDataSourceOptions)).toContain('.entity.{ts,js}');
  });

  it('resolve exatamente as 30 entidades reais em desenvolvimento (arquivos .entity.ts)', () => {
    const encontrados = globSync(entitiesGlobOf(runtimeDataSourceOptions));
    const entityTs = encontrados.filter((f) => f.endsWith('.entity.ts'));
    expect(entityTs).toHaveLength(30);
  });

  it('nenhum arquivo .spec.ts é tratado como entidade pelo padrão configurado', () => {
    const encontrados = globSync(entitiesGlobOf(runtimeDataSourceOptions));
    expect(encontrados.some((f) => f.includes('.spec.'))).toBe(false);
  });

  it('todo arquivo encontrado vive dentro de backend/src/entities — nunca no frontend (src/lib) nem no Prisma gerado (src/generated)', () => {
    const encontrados = globSync(entitiesGlobOf(runtimeDataSourceOptions));
    expect(encontrados.length).toBeGreaterThan(0);
    for (const arquivo of encontrados) {
      const absoluto = path.resolve(arquivo);
      expect(absoluto.startsWith(path.resolve(entitiesDir))).toBe(true);
      expect(absoluto).not.toContain(`${path.sep}src${path.sep}lib${path.sep}`);
      expect(absoluto).not.toContain('generated');
    }
  });

  describe('cobertura da alternância {ts,js} (dev .ts / produção compilada .js)', () => {
    let tempDir: string;

    afterEach(() => {
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    });

    it('o mesmo padrão de glob casa tanto .entity.ts (dev) quanto .entity.js (dist compilado), e nunca .spec.ts', () => {
      tempDir = mkdtempSync(path.join(tmpdir(), 'entity-glob-'));
      writeFileSync(path.join(tempDir, 'foo.entity.ts'), '// dev');
      writeFileSync(path.join(tempDir, 'foo.entity.js'), '// dist compilado');
      writeFileSync(path.join(tempDir, 'foo.spec.ts'), '// nunca é entidade');

      const padrao = path.join(tempDir, '*.entity.{ts,js}');
      const encontrados = globSync(padrao).map((f) => path.basename(f)).sort();

      expect(encontrados).toEqual(['foo.entity.js', 'foo.entity.ts']);
    });
  });

  it('as instâncias exportadas permanecem não inicializadas mesmo depois da resolução do glob acima', () => {
    expect(RuntimeDataSource.isInitialized).toBe(false);
    expect(MigrationsDataSource.isInitialized).toBe(false);
  });
});
