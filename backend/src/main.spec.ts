// Guarda da ordem de inicialização. `main.ts` sobe a API ao ser importado,
// então a ordem é conferida no texto: a conferência das migrations exigidas
// acontece depois de criar a aplicação e ANTES de escutar a porta, e a falha
// encerra o processo. O comportamento em si é testado em
// database/schema-readiness.spec.ts e, com banco real, em
// test/schema-readiness-postgres.db-e2e-spec.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const fonte = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'main.ts'), 'utf8');
// Só o código: comentários citam `app.listen` e não contam para a ordem.
const codigo = fonte.replace(/^\s*\/\/.*$/gm, '');

describe('ordem de inicialização da API', () => {
  it('confere as migrations exigidas depois de criar a aplicação e antes de escutar', () => {
    const criar = codigo.indexOf('NestFactory.create(');
    const conferir = codigo.indexOf('ensureRequiredMigrations(');
    const escutar = codigo.indexOf('app.listen(');

    expect(criar).toBeGreaterThanOrEqual(0);
    expect(conferir).toBeGreaterThan(criar);
    expect(escutar).toBeGreaterThan(conferir);
  });

  it('a recusa encerra o processo com código 1, sem seguir para a porta', () => {
    const recusa = codigo.slice(codigo.indexOf('SchemaNotReadyError)'), codigo.indexOf('app.listen('));
    expect(recusa).toContain('process.exit(1)');
  });

  it('a inicialização não aplica migration nem sincroniza schema', () => {
    expect(codigo).not.toMatch(/runMigrations|synchronize\s*\(|migrationsRun/);
  });
});
