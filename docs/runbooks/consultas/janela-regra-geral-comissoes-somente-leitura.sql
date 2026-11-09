-- Janela de transição de ProfessionalCommissionSettings1793577600000,
-- SOMENTE LEITURA, só no estado 16 (depois da migration).
--
-- Lista, desde o início da janela, o que a API anterior criou ou apurou e o
-- que a API nova criou desligado. Só ids, datas e códigos: nenhum nome,
-- e-mail, telefone, senha ou valor. Mesma lógica de `lerUsoDesdeAJanela`
-- (backend/scripts/lib/regra-geral-comissoes-schema.ts).
--
-- Antes de rodar, troque o instante abaixo pelo `JANELA_DESDE` impresso pela
-- fase `aplicar` (relógio do banco, UTC). Rode só com autorização para a
-- leitura (runbook, "Janela de transição").

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL agenda.janela_desde = '<JANELA_DESDE>';

-- 1. Profissionais criados desde o início da janela. `origem`:
--    API_ANTERIOR (sem configuração: recebe, pelo comportamento antigo) ou
--    API_NOVA (nasce sem receber até o dono ligar no web novo).
SELECT p.tenant_id, p.id AS professional_id, p.created_at,
       CASE WHEN s.professional_id IS NULL THEN 'API_ANTERIOR' ELSE 'API_NOVA' END AS origem,
       s.receives_commission
  FROM professionals p
  LEFT JOIN professional_commission_settings s ON s.tenant_id = p.tenant_id AND s.professional_id = p.id
 WHERE p.created_at >= current_setting('agenda.janela_desde')::timestamptz
 ORDER BY p.created_at, p.id;

-- 2. Apurações com regra e sem escopo calculadas desde o início da janela:
--    feitas pela API anterior (a nova sempre grava o escopo quando aplica
--    regra). Ignoraram "Recebe comissão" e a regra geral.
SELECT ce.tenant_id, ce.appointment_id, ce.professional_id, ce.calculated_at, ce.status::text AS status
  FROM commission_entries ce
 WHERE ce.calculated_at >= current_setting('agenda.janela_desde')::timestamptz
   AND ce.applied_type IS NOT NULL
   AND ce.applied_rule_scope IS NULL
 ORDER BY ce.calculated_at, ce.appointment_id;

ROLLBACK;
