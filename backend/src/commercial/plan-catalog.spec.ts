import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLAN_RENAMES } from '../migrations/1793232000000-CommercialAccess.js';
import { COMMERCIAL_PLANS, commercialPlanName } from './plan-catalog.js';

describe('catálogo comercial dos planos', () => {
  it('Básico = essencial, Pro = equipe, Max = pro (ids preservados)', () => {
    expect(COMMERCIAL_PLANS.map((p) => [p.name, p.code, p.id])).toEqual([
      ['Básico', 'essencial', 'plan_essencial'],
      ['Pro', 'equipe', 'plan_equipe'],
      ['Max', 'pro', 'plan_pro'],
    ]);
    expect(commercialPlanName('equipe')).toBe('Pro');
    expect(commercialPlanName('pro')).toBe('Max');
    expect(commercialPlanName('outro')).toBeNull();
  });

  it('a migration grava exatamente estes nomes nos mesmos ids e códigos', () => {
    expect(PLAN_RENAMES.map((p) => [p.to.name, p.code, p.id])).toEqual(
      COMMERCIAL_PLANS.map((p) => [p.name, p.code, p.id]),
    );
  });

  it('nenhum código de runtime decide pelo nome ou pelo código do plano', () => {
    const raiz = join(import.meta.dirname, '..');
    const arquivos: string[] = [];
    const visitar = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) {
          if (nome !== 'migrations' && nome !== 'testing') visitar(caminho);
        } else if (nome.endsWith('.ts') && !nome.endsWith('.spec.ts')) {
          arquivos.push(caminho);
        }
      }
    };
    visitar(raiz);
    const suspeito = /(plan|plano)\w*\.(name|code|nome|codigo)\s*[!=]==\s*['"]|(planName|planCode)\s*[!=]==\s*['"]/i;
    const achados = arquivos.filter((a) => suspeito.test(readFileSync(a, 'utf8')));
    expect(achados).toEqual([]);
  });
});
