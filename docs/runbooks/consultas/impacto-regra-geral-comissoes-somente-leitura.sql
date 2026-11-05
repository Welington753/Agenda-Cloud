-- Impacto de ProfessionalCommissionSettings1793577600000, SOMENTE LEITURA.
--
-- Funciona nos dois estados (15 e 16): não lê a tabela nem a coluna novas; o
-- que é novo sai da fase `conferir` do procedimento e da consulta da janela
-- (janela-regra-geral-comissoes-somente-leitura.sql). Só ids e contagens:
-- nenhum nome, e-mail, telefone, senha ou valor.
--
-- Mesma lógica do levantamento que as fases imprimem
-- (backend/scripts/lib/regra-geral-comissoes-schema.ts). O teste
-- backend/test/pilot-regra-geral-comissoes-check.db-e2e-spec.ts roda este
-- arquivo contra PostgreSQL descartável.
--
-- NÃO execute no piloto fora do procedimento protegido
-- (docs/runbooks/publicacao-regra-geral-comissoes-piloto.md).

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';

-- 1. Totais: estabelecimentos (e com o recurso de comissões efetivo),
--    profissionais, regras, apurações e atendimentos concluídos.
--    Recurso: exceção individual primeiro, senão o catálogo do plano
--    (backend/src/commercial/commercial-gate.ts, FEATURE_ENABLED_SQL).
SELECT
  (SELECT count(*) FROM tenants) AS estabelecimentos,
  (SELECT count(*) FROM tenants t
    WHERE coalesce((SELECT o.enabled FROM tenant_feature_overrides o
                     WHERE o.tenant_id = t.id AND o.feature_id = 'feat_comissoes'),
                   EXISTS (SELECT 1 FROM plan_features pf
                            WHERE pf.plan_id = t.plan_id AND pf.feature_id = 'feat_comissoes'))) AS com_comissoes,
  (SELECT count(*) FROM professionals) AS profissionais,
  (SELECT count(*) FROM professionals WHERE active) AS profissionais_ativos,
  (SELECT count(*) FROM commission_rules) AS regras,
  (SELECT count(*) FROM commission_entries) AS apuracoes,
  (SELECT count(*) FROM appointments WHERE status = 'COMPLETED') AS atendimentos_concluidos;

-- 2. Estabelecimentos ativos com quem combinar a janela de transição (só ids):
--    os que têm o recurso de comissões (concluir atendimento apura) e todos os
--    que têm profissional ativo (cadastrar profissional muda de comportamento
--    entre a API anterior e a nova).
SELECT t.id AS tenant_id, t.plan_id,
       coalesce((SELECT o.enabled FROM tenant_feature_overrides o
                  WHERE o.tenant_id = t.id AND o.feature_id = 'feat_comissoes'),
                EXISTS (SELECT 1 FROM plan_features pf
                         WHERE pf.plan_id = t.plan_id AND pf.feature_id = 'feat_comissoes')) AS com_comissoes,
       (SELECT count(*) FROM professionals p WHERE p.tenant_id = t.id AND p.active) AS profissionais_ativos
  FROM tenants t
 WHERE t.status = 'ACTIVE'
 ORDER BY t.id;

ROLLBACK;
