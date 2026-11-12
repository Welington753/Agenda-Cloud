// Guarda de arquitetura do segundo fator: todo controller de plataforma
// declara o guard do segundo fator NA CLASSE, e só as rotas listadas aqui o
// dispensam. Um controller novo em `/platform` sem o guard reprova aqui. A
// prova pela API (todas as rotas registradas): test/second-factor.e2e-spec.ts.
import { readFileSync, globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROTAS_SEM_SEGUNDO_FATOR } from './second-factor.guard.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const controllers = globSync('**/*.controller.ts', { cwd: SRC }).filter((f) => !f.includes('.spec.'));


describe('guard do segundo fator nos controllers de plataforma', () => {
  const dePlataforma = controllers.filter((f) => /@Controller\('platform/.test(readFileSync(path.join(SRC, f), 'utf8')));

  it('existem os controllers de plataforma conhecidos (a lista não ficou vazia)', () => {
    expect(dePlataforma.map((f) => f.replaceAll('\\', '/')).sort()).toEqual([
      'accounts/accounts-admin.controller.ts',
      'platform/platform.controller.ts',
      'second-factor/second-factor.controller.ts',
    ]);
  });

  it.each(dePlataforma)('%s aplica SessionGuard e PlatformSecondFactorGuard na classe', (arquivo) => {
    const fonte = readFileSync(path.join(SRC, arquivo), 'utf8');
    const classes = fonte.split(/@Controller\(/).slice(1);
    for (const trecho of classes) {
      if (!trecho.startsWith("'platform")) continue;
      expect(trecho).toMatch(/^'platform[^']*'\)\s*\r?\n@UseGuards\(SessionGuard, PlatformSecondFactorGuard\)/);
    }
  });

  it('só as exceções conhecidas usam @SemSegundoFator()', () => {
    const usos = controllers.flatMap((f) => {
      const fonte = readFileSync(path.join(SRC, f), 'utf8');
      return [...fonte.matchAll(/@(Get|Post|Put|Patch|Delete)\('([^']*)'\)\s*\r?\n\s*@SemSegundoFator\(\)/g)].map(
        (m) => `${m[1].toUpperCase()} /platform/${m[2]}`,
      );
    });
    expect(usos.sort()).toEqual([...ROTAS_SEM_SEGUNDO_FATOR].sort());
  });
});
