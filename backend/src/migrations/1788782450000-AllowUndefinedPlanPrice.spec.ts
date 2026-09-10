// Prova de schema com QueryRunner falso — nunca conecta a banco nenhum,
// mesma filosofia dos demais specs de migration nesta pasta.
import { describe, expect, it, vi } from 'vitest';
import type { QueryRunner } from 'typeorm';
import { AllowUndefinedPlanPrice1788782450000 } from './1788782450000-AllowUndefinedPlanPrice.js';

function criarQueryRunnerFalso() {
  return { query: vi.fn().mockResolvedValue(undefined) } as unknown as QueryRunner & {
    query: ReturnType<typeof vi.fn>;
  };
}

describe('AllowUndefinedPlanPrice1788782450000.up', () => {
  it('remove NOT NULL de plans.price_cents', async () => {
    const queryRunner = criarQueryRunnerFalso();
    await new AllowUndefinedPlanPrice1788782450000().up(queryRunner);

    expect(queryRunner.query).toHaveBeenCalledTimes(1);
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringMatching(/ALTER TABLE plans ALTER COLUMN price_cents DROP NOT NULL/i),
    );
  });
});

describe('AllowUndefinedPlanPrice1788782450000.down', () => {
  it('restaura NOT NULL em plans.price_cents', async () => {
    const queryRunner = criarQueryRunnerFalso();
    await new AllowUndefinedPlanPrice1788782450000().down(queryRunner);

    expect(queryRunner.query).toHaveBeenCalledTimes(1);
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringMatching(/ALTER TABLE plans ALTER COLUMN price_cents SET NOT NULL/i),
    );
  });
});

describe('nome/timestamp da migration', () => {
  it('o nome da classe é consistente com o timestamp do arquivo (convenção do TypeORM CLI)', () => {
    const migration = new AllowUndefinedPlanPrice1788782450000();
    expect(migration.name).toBe('AllowUndefinedPlanPrice1788782450000');
  });

  it('timestamp fica entre a migration inicial e o catálogo de planos', () => {
    const timestampInicial = 1788782400000;
    const timestampEsteArquivo = 1788782450000;
    const timestampCatalogo = 1788782460000;
    expect(timestampEsteArquivo).toBeGreaterThan(timestampInicial);
    expect(timestampEsteArquivo).toBeLessThan(timestampCatalogo);
  });
});
