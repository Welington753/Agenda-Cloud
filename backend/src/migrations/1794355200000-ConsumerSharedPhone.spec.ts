// A parte 3 dos clientes só remove o UNIQUE de telefone; o retorno recusa
// recriá-lo com telefones repetidos (QueryRunner falso; contra PostgreSQL
// real: test/consumer-migrations.db-e2e-spec.ts).
import { describe, expect, it, vi } from 'vitest';
import type { QueryRunner } from 'typeorm';
import { ConsumerSharedPhone1794355200000, SHARED_PHONE_CONSTRAINT } from './1794355200000-ConsumerSharedPhone.js';

function criarQueryRunnerFalso(respostas: unknown[] = []) {
  const query = vi.fn();
  for (const resposta of respostas) query.mockResolvedValueOnce(resposta);
  query.mockResolvedValue(undefined);
  return { query } as unknown as QueryRunner & { query: ReturnType<typeof vi.fn> };
}

describe('ConsumerSharedPhone1794355200000', () => {
  it('up() só remove o UNIQUE de telefone por estabelecimento', async () => {
    const qr = criarQueryRunnerFalso();
    await new ConsumerSharedPhone1794355200000().up(qr);
    expect(qr.query.mock.calls.map((c) => String(c[0]))).toEqual([
      'ALTER TABLE consumers DROP CONSTRAINT uq_consumers_tenant_whatsapp',
    ]);
    expect(SHARED_PHONE_CONSTRAINT).toBe('uq_consumers_tenant_whatsapp');
  });

  it('down() recria o UNIQUE só quando nenhum telefone tem mais de um cadastro', async () => {
    const livre = criarQueryRunnerFalso([[{ repetidos: 0 }]]);
    await new ConsumerSharedPhone1794355200000().down(livre);
    expect(String(livre.query.mock.calls[1][0])).toBe(
      'ALTER TABLE consumers ADD CONSTRAINT uq_consumers_tenant_whatsapp UNIQUE (tenant_id, whatsapp_normalized)',
    );

    const repetido = criarQueryRunnerFalso([[{ repetidos: 1 }]]);
    await expect(new ConsumerSharedPhone1794355200000().down(repetido)).rejects.toThrow(/só para frente/);
    expect(repetido.query).toHaveBeenCalledTimes(1);
  });

  it('não declara transaction (o modo vem do runner)', () => {
    const migration = new ConsumerSharedPhone1794355200000() as ConsumerSharedPhone1794355200000 & { transaction?: boolean };
    expect(migration.transaction).toBeUndefined();
  });
});
