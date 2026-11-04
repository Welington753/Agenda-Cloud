// Apuração da comissão NA CONCLUSÃO do atendimento. Roda dentro da mesma
// transação que muda a reserva para `COMPLETED` (appointments.service.ts,
// `applyStatusChange`), com a reserva já travada: ou a conclusão e a
// apuração ficam juntas, ou nenhuma das duas.
//
// - Só quando o estabelecimento tem o recurso `COMISSOES` NA HORA da
//   conclusão. Ligar o recurso, criar ou mudar regras depois nunca gera
//   comissão para atendimentos já concluídos.
// - Uma linha por serviço da reserva, com o preço registrado no item, a regra
//   que valia (ou a falta dela) e o valor calculado no servidor
//   (commission-calculation.ts). O profissional é o da reserva (um por
//   reserva, regra atual do agendamento).
// - Idempotente: o índice único por item faz a repetição não gravar nada, e
//   uma linha existente nunca é recalculada.
// - Cancelado e falta nunca chegam aqui. Hoje `COMPLETED` é final; se um lote
//   futuro reabrir ou cancelar um atendimento concluído, ele chama
//   `reverterApuracao` (a linha fica, marcada como revertida) e, numa nova
//   conclusão, `apurarNaConclusao` reativa a MESMA fotografia, sem recalcular.
import type { EntityManager } from 'typeorm';
import { featureEnabled } from '../commercial/commercial-gate.js';
import { generateId } from '../entities/common/generate-id.js';
import { FeatureKey } from '../entities/enums/feature-key.enum.js';
import { calcularComissaoDoItem, type StoredRule } from './commission-calculation.js';

interface ItemComRegra {
  item_id: string;
  service_id: string;
  price_cents: number | null;
  rule_type: StoredRule['type'] | null;
  rule_value: number | null;
}

export async function apurarNaConclusao(
  manager: EntityManager,
  appointment: { tenantId: string; id: string; professionalId: string; startAt: Date },
  now: Date,
): Promise<void> {
  await manager.query(
    `UPDATE commission_entries SET status = 'CONFIRMED', reactivated_at = $3
      WHERE tenant_id = $1 AND appointment_id = $2 AND status = 'REVERSED'`,
    [appointment.tenantId, appointment.id, now],
  );
  if (!(await featureEnabled(manager, appointment.tenantId, FeatureKey.COMISSOES))) return;
  const itens = await manager.query<ItemComRegra[]>(
    `SELECT ai.id AS item_id, ai.service_id, ai.price_cents_snapshot AS price_cents,
            cr.type::text AS rule_type, cr.value AS rule_value
       FROM appointment_items ai
       LEFT JOIN commission_rules cr
         ON cr.tenant_id = ai.tenant_id AND cr.professional_id = $3 AND cr.service_id = ai.service_id
      WHERE ai.tenant_id = $1 AND ai.appointment_id = $2
        AND NOT EXISTS (SELECT 1 FROM commission_entries ce WHERE ce.appointment_item_id = ai.id)
      ORDER BY ai.position, ai.id`,
    [appointment.tenantId, appointment.id, appointment.professionalId],
  );
  for (const item of itens) {
    const regra = item.rule_type === null ? null : { type: item.rule_type, value: Number(item.rule_value) };
    const preco = item.price_cents === null ? null : Number(item.price_cents);
    const valores = calcularComissaoDoItem(preco, regra);
    await manager.query(
      `INSERT INTO commission_entries (id, tenant_id, appointment_id, appointment_item_id, professional_id, service_id,
          price_cents_snapshot, applied_type, applied_value, professional_cents, establishment_cents, service_date,
          calculated_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::commission_type, $9, $10, $11, $12, $13, 'CONFIRMED')
       ON CONFLICT (appointment_item_id) DO NOTHING`,
      [
        generateId(),
        appointment.tenantId,
        appointment.id,
        item.item_id,
        appointment.professionalId,
        item.service_id,
        preco,
        regra?.type ?? null,
        regra?.value ?? null,
        valores.professionalCents,
        valores.establishmentCents,
        appointment.startAt,
        now,
      ],
    );
  }
}

/** Para um lote futuro que tire um atendimento de `COMPLETED`: marca a
 * apuração como revertida, sem apagar nem mudar valores. */
export async function reverterApuracao(
  manager: EntityManager,
  appointment: { tenantId: string; id: string },
  now: Date,
): Promise<void> {
  await manager.query(
    `UPDATE commission_entries SET status = 'REVERSED', reversed_at = $3
      WHERE tenant_id = $1 AND appointment_id = $2 AND status = 'CONFIRMED'`,
    [appointment.tenantId, appointment.id, now],
  );
}
