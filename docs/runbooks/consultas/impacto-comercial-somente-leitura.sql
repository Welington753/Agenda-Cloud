-- Impacto de CommercialAccess1793232000000, SOMENTE LEITURA.
--
-- Mostra as exceções de recurso desligadas (que, com o código novo, passam a
-- retirar o recurso), quais estabelecimentos ganhariam a exceção ligada da
-- migration (plano sem um recurso que já usavam) e se algum recurso existente
-- ficaria negado. Funciona antes e depois da migration (não lê a coluna nem a
-- tabela novas). Só ids, códigos de plano e de recurso e contagens: nenhum
-- nome, e-mail, telefone ou senha.
--
-- Mesma regra de backend/src/commercial/commercial-gate.ts
-- (FEATURE_ENABLED_SQL: exceção individual primeiro, senão o catálogo do
-- plano) e do levantamento que as fases `preparar`, `aplicar` e `conferir`
-- imprimem (backend/scripts/lib/acesso-comercial-schema.ts). O teste
-- backend/test/pilot-commercial-access-check.db-e2e-spec.ts roda este arquivo
-- contra PostgreSQL descartável.
--
-- NÃO execute no piloto fora do procedimento protegido
-- (docs/runbooks/publicacao-acesso-comercial-piloto.md): lá, a fase
-- `preparar` já imprime o mesmo levantamento com destino, TLS e endpoint
-- conferidos.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';

-- 1. Exceções de recurso DESLIGADAS. Esperado: nenhuma linha. Cada linha é
--    decidida por uma pessoa antes da migration; nada aqui as altera.
SELECT o.tenant_id, o.feature_id, f.key::text AS recurso, t.status::text AS situacao, p.code AS plano
  FROM tenant_feature_overrides o
  JOIN features f ON f.id = o.feature_id
  JOIN tenants t ON t.id = o.tenant_id
  JOIN plans p ON p.id = t.plan_id
 WHERE NOT o.enabled
 ORDER BY o.tenant_id, o.feature_id;

-- 2. Por estabelecimento e recurso existente: o que vale depois da migration.
--    efeito:
--      no_plano            o catálogo (com as linhas novas) já dá o recurso;
--      excecao_ligada      já existe exceção ligada (manual ou da migration);
--      excecao_da_migration  a migration grava a exceção ligada (tfo_ca_*);
--      NEGADO              exceção desligada: o recurso deixaria de valer.
WITH catalogo AS (
  SELECT plan_id, feature_id FROM plan_features
  UNION
  SELECT v.plan_id, v.feature_id FROM (VALUES
    ('plan_essencial', 'feat_consumidores'),
    ('plan_essencial', 'feat_equipe'),
    ('plan_essencial', 'feat_pagamentos'),
    ('plan_equipe', 'feat_pagamentos')
  ) AS v (plan_id, feature_id)
), pares AS (
  SELECT t.id AS tenant_id, t.status::text AS situacao, p.code AS plano, f.id AS feature_id,
         (SELECT o.enabled FROM tenant_feature_overrides o WHERE o.tenant_id = t.id AND o.feature_id = f.id) AS excecao,
         EXISTS (SELECT 1 FROM catalogo k WHERE k.plan_id = t.plan_id AND k.feature_id = f.id) AS no_plano
    FROM tenants t
    JOIN plans p ON p.id = t.plan_id
   CROSS JOIN features f
   WHERE f.id IN ('feat_agenda', 'feat_agendamento_publico', 'feat_profissionais',
                  'feat_consumidores', 'feat_equipe', 'feat_pagamentos')
)
SELECT tenant_id, situacao, plano, feature_id,
       CASE
         WHEN excecao IS FALSE THEN 'NEGADO'
         WHEN excecao IS TRUE THEN 'excecao_ligada'
         WHEN no_plano THEN 'no_plano'
         ELSE 'excecao_da_migration'
       END AS efeito
  FROM pares
 WHERE excecao IS NOT NULL OR NOT no_plano
 ORDER BY tenant_id, feature_id;

-- 3. Resumo.
SELECT
  (SELECT count(*) FROM tenants) AS estabelecimentos,
  (SELECT count(*) FROM tenants
    WHERE plan_id NOT IN ('plan_essencial', 'plan_equipe', 'plan_pro')) AS em_plano_fora_do_catalogo,
  (SELECT count(*) FROM tenant_feature_overrides) AS excecoes,
  (SELECT count(*) FROM tenant_feature_overrides WHERE NOT enabled) AS excecoes_desligadas,
  (SELECT count(*) FROM tenant_feature_overrides WHERE starts_with(id, 'tfo_ca_')) AS excecoes_da_migration,
  (SELECT string_agg(id || '=' || code || ':' || name, ' ' ORDER BY id) FROM plans
    WHERE id IN ('plan_essencial', 'plan_equipe', 'plan_pro')) AS planos;

ROLLBACK;
