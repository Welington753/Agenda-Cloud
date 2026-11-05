-- Impacto de ProfessionalCommissions1793491200000, SOMENTE LEITURA.
--
-- Mostra quem passa a apurar comissões com o catálogo novo (o recurso
-- COMISSOES entra no plano Pro, código `equipe`), as exceções individuais do
-- recurso (continuam valendo sobre o plano) e o que já existe nas tabelas de
-- comissão. Funciona nos dois estados (antes e depois): não lê nenhuma coluna
-- nova; o que é novo sai da fase `conferir` do procedimento. Só ids, códigos
-- e contagens: nenhum nome, e-mail, telefone, senha ou valor.
--
-- Mesma lógica do levantamento que as fases `preparar`, `aplicar` e
-- `conferir` imprimem (backend/scripts/lib/comissoes-profissionais-schema.ts).
-- O teste backend/test/pilot-comissoes-profissionais-check.db-e2e-spec.ts
-- roda este arquivo contra PostgreSQL descartável.
--
-- NÃO execute no piloto fora do procedimento protegido
-- (docs/runbooks/publicacao-comissoes-profissionais-piloto.md): lá, as fases
-- já imprimem o mesmo levantamento com destino, TLS e endpoint conferidos.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';

-- 1. Por plano: estabelecimentos, com o recurso hoje e com o catálogo novo.
--    Regra do recurso: exceção individual primeiro, senão o catálogo do plano
--    (backend/src/commercial/commercial-gate.ts, FEATURE_ENABLED_SQL).
WITH efetivo AS (
  SELECT t.id, t.plan_id,
         (SELECT o.enabled FROM tenant_feature_overrides o
           WHERE o.tenant_id = t.id AND o.feature_id = 'feat_comissoes') AS excecao,
         EXISTS (SELECT 1 FROM plan_features pf
                  WHERE pf.plan_id = t.plan_id AND pf.feature_id = 'feat_comissoes') AS no_plano
    FROM tenants t
)
SELECT p.id AS plano, p.code AS codigo,
       count(e.id) AS estabelecimentos,
       count(e.id) FILTER (WHERE coalesce(e.excecao, e.no_plano)) AS com_comissoes_agora,
       count(e.id) FILTER (WHERE coalesce(e.excecao, e.no_plano OR p.id = 'plan_equipe')) AS com_comissoes_depois
  FROM plans p LEFT JOIN efetivo e ON e.plan_id = p.id
 GROUP BY p.id, p.code
 ORDER BY p.id;

-- 2. Exceções individuais do recurso de comissões, por estabelecimento (só
--    ids). Uma desligada num Pro continua desligando depois da migration.
SELECT o.tenant_id, t.plan_id, o.enabled
  FROM tenant_feature_overrides o JOIN tenants t ON t.id = o.tenant_id
 WHERE o.feature_id = 'feat_comissoes'
 ORDER BY o.tenant_id;

-- 3. O que já existe: regras, apurações, concessões das próprias comissões e
--    atendimentos concluídos (nenhum é apurado retroativamente).
SELECT
  (SELECT count(*) FROM commission_rules) AS regras,
  (SELECT count(*) FROM commission_entries) AS apuracoes,
  (SELECT count(*) FROM membership_permission_overrides
    WHERE permission::text = 'COMISSOES_PROPRIAS_VISUALIZAR') AS concessoes_das_proprias,
  (SELECT count(*) FROM appointments WHERE status = 'COMPLETED') AS atendimentos_concluidos,
  (SELECT count(*) FROM appointment_items) AS itens_de_reserva;

-- 4. Planos que têm o recurso hoje (antes: só plan_pro; depois: plan_equipe e plan_pro).
SELECT plan_id, id
  FROM plan_features
 WHERE feature_id = 'feat_comissoes'
 ORDER BY plan_id, id;

ROLLBACK;
