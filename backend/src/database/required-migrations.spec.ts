// O manifesto (required-migrations.ts) precisa ser EXATAMENTE o diretório de
// migrations: uma migration nova fora dele deixaria a conferência de
// inicialização aprovar um banco que não a tem.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REQUIRED_MIGRATIONS } from './required-migrations.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

/** `1793664000000-TenantTestFlag.ts` -> `TenantTestFlag1793664000000`, o nome
 * que o TypeORM grava na tabela de controle. */
function nomesDoDiretorio(): string[] {
  return readdirSync(migrationsDir)
    .map((arquivo) => /^(\d{13})-([A-Za-z0-9]+)\.ts$/.exec(arquivo))
    .filter((partes): partes is RegExpExecArray => partes !== null)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map(([, carimbo, nome]) => `${nome}${carimbo}`);
}

describe('manifesto das migrations exigidas', () => {
  it('lista todas as migrations do diretório, na ordem de aplicação, e nenhuma a mais', () => {
    expect(REQUIRED_MIGRATIONS).toEqual(nomesDoDiretorio());
  });

  it('o diretório foi lido de verdade (não compara duas listas vazias)', () => {
    expect(nomesDoDiretorio().length).toBeGreaterThanOrEqual(18);
    expect(REQUIRED_MIGRATIONS).toContain('InitialSchema1788782400000');
    expect(REQUIRED_MIGRATIONS).toContain('TenantTestFlag1793664000000');
  });

  it('não repete nome e todo nome termina no carimbo de 13 dígitos', () => {
    expect(new Set(REQUIRED_MIGRATIONS).size).toBe(REQUIRED_MIGRATIONS.length);
    for (const nome of REQUIRED_MIGRATIONS) expect(nome).toMatch(/^[A-Za-z0-9]+\d{13}$/);
  });
});
