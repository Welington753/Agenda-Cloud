// Os serviços de UMA reserva, agregados para as leituras em SQL explícito
// (recebimentos, visão geral, agenda própria). Um item por serviço, com os
// snapshots congelados na reserva (ver
// docs/plans/agendamento-multiplos-servicos.md):
// - `service_name`: os nomes na ordem do atendimento ("Corte + Barba"); um
//   item antigo sem snapshot usa o nome atual, como antes;
// - `duration_minutes`: a soma das durações;
// - `price_cents`: a soma dos preços, ou NULL se algum item for sob consulta.
//
// Espera a reserva com o alias `a`; expõe o alias `i`.
export const ITENS_DA_RESERVA_SQL = `LEFT JOIN LATERAL (
  SELECT string_agg(COALESCE(ai.service_name_snapshot, sv.name), ' + ' ORDER BY ai.position, ai.id) AS service_name,
         sum(ai.duration_minutes_snapshot)::int AS duration_minutes,
         CASE WHEN count(*) > 0 AND bool_and(ai.price_cents_snapshot IS NOT NULL)
              THEN sum(ai.price_cents_snapshot) END AS price_cents
    FROM appointment_items ai
    LEFT JOIN services sv ON sv.tenant_id = ai.tenant_id AND sv.id = ai.service_id
   WHERE ai.tenant_id = a.tenant_id AND ai.appointment_id = a.id
) i ON true`;
