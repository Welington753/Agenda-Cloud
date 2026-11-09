// Apuração da comissão NA CONCLUSÃO do atendimento. Roda dentro da mesma
// transação que muda a reserva para `COMPLETED` (appointments.service.ts,
// `applyStatusChange`), com a reserva já travada: ou a conclusão e a
// apuração ficam juntas, ou nenhuma das duas.
//
// - Só quando o estabelecimento tem o recurso `COMISSOES` NA HORA da
//   conclusão. Ligar o recurso, criar ou mudar regras depois nunca gera
//   comissão para atendimentos já concluídos.
// - Só quando o profissional RECEBE COMISSÃO na hora da conclusão
//   (`professional_commission_settings`; sem linha = recebe, sem regra
//   geral, o estado anterior à regra geral). Desligado, nada é gravado,
//   mesmo com regras guardadas; religar depois não apura o que já foi
//   concluído.
// - Uma linha por serviço da reserva, com o preço registrado no item, a regra
//   que valia (exceção do serviço > regra geral > nenhuma, `regraEfetiva`) e
//   a origem dela, e o valor calculado no servidor (commission-calculation.ts).
//   O profissional é o da reserva (um por reserva, regra atual do agendamento).
// - Configuração coerente: antes de ler, trava a linha do profissional
//   (`FOR KEY SHARE`). Quem muda regra ou configuração trava a mesma linha com
//   `FOR UPDATE` (commissions.service.ts), então cada apuração vê a
//   configuração inteira de antes ou a de depois de uma mudança, nunca metade.
// - Idempotente: o índice único por item faz a repetição não gravar nada, e
//   uma linha existente nunca é recalculada.
// - Cancelado e falta nunca chegam aqui. Hoje `COMPLETED` é final; se um lote
//   futuro reabrir ou cancelar um atendimento concluído, ele chama
//   `reverterApuracao` (a linha fica, marcada como revertida) e, numa nova
//   conclusão, `apurarNaConclusao` reativa a MESMA fotografia, sem
//   recalcular, nas mesmas condições de uma apuração nova (recurso no plano e
//   profissional recebendo). Fora delas, a fotografia continua revertida, fora
//   do total.
import type { EntityManager } from 'typeorm';
import { featureEnabled } from '../commercial/commercial-gate.js';
import { generateId } from '../entities/common/generate-id.js';
import { FeatureKey } from '../entities/enums/feature-key.enum.js';
import {
  CONFIGURACAO_SEM_LINHA,
  calcularComissaoDoItem,
  regraEfetiva,
  type CommissionSettings,
  type StoredRule,
} from './commission-calculation.js';

interface ConfiguracaoLida {
  receives_commission: boolean;
  default_type: StoredRule['type'] | null;
  default_value: number | null;
}

interface ItemComRegra {
  item_id: string;
  service_id: string;
  price_cents: number | null;
  rule_type: StoredRule['type'] | null;
  rule_value: number | null;
}

/** Trava o profissional (contra mudança de regra ou configuração em curso) e
 * só DEPOIS lê a configuração. `null`: profissional não encontrado.
 *
 * Duas instruções, de propósito: em READ COMMITTED, um `SELECT ... FOR KEY
 * SHARE` que esperou um `FOR UPDATE` relê só a linha travada; as linhas de um
 * JOIN na mesma instrução viriam da fotografia de antes da espera (a
 * configuração antiga, misturada com as exceções novas lidas depois). A
 * instrução seguinte já enxerga tudo o que a mudança gravou. */
export async function configuracaoTravada(
  manager: EntityManager,
  tenantId: string,
  professionalId: string,
): Promise<CommissionSettings | null> {
  const [profissional] = await manager.query<unknown[]>(
    `SELECT 1 FROM professionals WHERE tenant_id = $1 AND id = $2 FOR KEY SHARE`,
    [tenantId, professionalId],
  );
  if (!profissional) return null;
  const [linha] = await manager.query<ConfiguracaoLida[]>(
    `SELECT receives_commission, default_type::text AS default_type, default_value
       FROM professional_commission_settings WHERE tenant_id = $1 AND professional_id = $2`,
    [tenantId, professionalId],
  );
  // Sem linha: recebe, sem regra geral (estado anterior à regra geral).
  if (!linha) return CONFIGURACAO_SEM_LINHA;
  return {
    receivesCommission: linha.receives_commission,
    defaultRule: linha.default_type === null ? null : { type: linha.default_type, value: Number(linha.default_value) },
  };
}

export async function apurarNaConclusao(
  manager: EntityManager,
  appointment: { tenantId: string; id: string; professionalId: string; startAt: Date },
  now: Date,
): Promise<void> {
  if (!(await featureEnabled(manager, appointment.tenantId, FeatureKey.COMISSOES))) return;
  const configuracao = await configuracaoTravada(manager, appointment.tenantId, appointment.professionalId);
  if (!configuracao?.receivesCommission) return;
  // Reabertura futura: a fotografia revertida volta exatamente como estava.
  await manager.query(
    `UPDATE commission_entries SET status = 'CONFIRMED', reactivated_at = $3
      WHERE tenant_id = $1 AND appointment_id = $2 AND status = 'REVERSED'`,
    [appointment.tenantId, appointment.id, now],
  );
  const itens = await manager.query<ItemComRegra[]>(
    `SELECT ai.id AS item_id, ai.service_id, ai.price_cents_snapshot AS price_cents,
            cr.type::text AS rule_type, cr.value AS rule_value
       FROM appointment_items ai
       LEFT JOIN commission_rules cr
         ON cr.tenant_id = ai.tenant_id AND cr.professional_id = $3 AND cr.service_id = ai.service_id
      WHERE ai.tenant_id = $1 AND ai.appointment_id = $2
        AND NOT EXISTS (SELECT 1 FROM commission_entries ce
                         WHERE ce.tenant_id = $1 AND ce.appointment_item_id = ai.id)
      ORDER BY ai.position, ai.id`,
    [appointment.tenantId, appointment.id, appointment.professionalId],
  );
  for (const item of itens) {
    const excecao = item.rule_type === null ? null : { type: item.rule_type, value: Number(item.rule_value) };
    const { scope, rule: regra } = regraEfetiva(excecao, configuracao.defaultRule);
    const preco = item.price_cents === null ? null : Number(item.price_cents);
    const valores = calcularComissaoDoItem(preco, regra);
    await manager.query(
      `INSERT INTO commission_entries (id, tenant_id, appointment_id, appointment_item_id, professional_id, service_id,
          price_cents_snapshot, applied_type, applied_value, applied_rule_scope, professional_cents, establishment_cents,
          service_date, calculated_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::commission_type, $9, $10, $11, $12, $13, $14, 'CONFIRMED')
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
        scope,
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
