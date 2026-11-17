// Preço base da assinatura modular para os testes de banco. Os specs dividem
// o mesmo banco: grava só se ainda não houver preço (valor de exemplo, não
// aprovado). Quem precisa de um valor exato lê o preço em vigor.
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { ensureModularPlan, MODULAR_PLAN_ID } from '../../src/commercial/modular-plan.js';

export const PRECO_BASE_DE_EXEMPLO = 2990;

export async function garantirPrecoBase(db: DataSource, gravadoPor: string): Promise<number> {
  await db.transaction(async (manager) => {
    await ensureModularPlan(manager);
    await manager.query(
      `INSERT INTO plan_prices (id, plan_id, billing_cycle, amount_cents, recorded_at, recorded_by_user_id, request_key)
       SELECT $1::varchar, $2::varchar, 'MONTHLY'::billing_cycle, $3::int, now(), $4::varchar, $5::varchar
        WHERE NOT EXISTS (SELECT 1 FROM plan_prices WHERE plan_id = $2::varchar AND billing_cycle = 'MONTHLY')`,
      [randomUUID().replace(/-/g, '').slice(0, 26), MODULAR_PLAN_ID, PRECO_BASE_DE_EXEMPLO, gravadoPor, `db-e2e-base-${randomUUID()}`],
    );
  });
  const [linha] = (await db.query(
    `SELECT amount_cents FROM plan_prices WHERE plan_id = $1 AND billing_cycle = 'MONTHLY' ORDER BY recorded_at DESC, id DESC LIMIT 1`,
    [MODULAR_PLAN_ID],
  )) as { amount_cents: number }[];
  return Number(linha.amount_cents);
}
