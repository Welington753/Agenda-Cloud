-- Validade do acesso DEPOIS de CommercialAccess1793232000000, SOMENTE LEITURA.
--
-- Para conferir o piloto depois da publicação e, principalmente, depois de
-- qualquer período em que a API anterior tenha voltado ao ar: ela cria
-- estabelecimentos sem a marca de anterior e sem teste gravado, que a API
-- nova bloqueia ("Sem validade registrada"). Só ids, slug, códigos e datas:
-- nenhum nome, e-mail, telefone ou senha. Só funciona depois da migration.
--
-- A regra exata da validade é a de backend/src/commercial/access-periods.ts
-- (fim exclusivo, meia-noite local, renovações encadeadas); aqui a
-- aproximação "algum período válido cobre agora" basta para separar quem
-- opera de quem está bloqueado. O teste
-- backend/test/pilot-commercial-access-check.db-e2e-spec.ts roda este
-- arquivo contra PostgreSQL descartável.
--
-- NÃO execute no piloto sem autorização própria. Nada aqui corrige
-- estabelecimento: a regularização é individual, pela administração
-- (pagamento, prorrogação do teste ou cortesia), sempre auditada.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';

-- 1. Por estabelecimento: situação aproximada da validade.
--    sem_validade  sem a marca de anterior e sem período válido: BLOQUEADO;
--    vencido       tem períodos válidos, nenhum cobre agora: BLOQUEADO;
--    em_validade   algum período válido cobre agora;
--    anterior      marcado como anterior, sem período: opera como antes
--                  ("Validade ainda não definida").
SELECT t.id AS tenant_id, t.slug::text AS slug, t.status::text AS situacao, p.code AS plano,
       t.access_legacy_since IS NOT NULL AS marcado_como_anterior,
       (SELECT count(*) FROM tenant_access_periods a WHERE a.tenant_id = t.id AND a.canceled_at IS NULL) AS periodos_validos,
       (SELECT max(a.ends_at) FROM tenant_access_periods a WHERE a.tenant_id = t.id AND a.canceled_at IS NULL) AS ultimo_fim,
       CASE
         WHEN EXISTS (SELECT 1 FROM tenant_access_periods a WHERE a.tenant_id = t.id AND a.canceled_at IS NULL
                         AND a.starts_at <= now() AND now() < a.ends_at) THEN 'em_validade'
         WHEN EXISTS (SELECT 1 FROM tenant_access_periods a WHERE a.tenant_id = t.id AND a.canceled_at IS NULL) THEN 'vencido'
         WHEN t.access_legacy_since IS NOT NULL THEN 'anterior'
         ELSE 'sem_validade'
       END AS validade
  FROM tenants t
  JOIN plans p ON p.id = t.plan_id
 ORDER BY validade DESC, t.created_at, t.id;

-- 2. Resumo.
SELECT
  (SELECT count(*) FROM tenants) AS estabelecimentos,
  (SELECT count(*) FROM tenants WHERE access_legacy_since IS NOT NULL) AS marcados_como_anteriores,
  (SELECT count(*) FROM tenants t WHERE t.access_legacy_since IS NULL
     AND NOT EXISTS (SELECT 1 FROM tenant_access_periods a WHERE a.tenant_id = t.id AND a.canceled_at IS NULL)) AS sem_validade,
  (SELECT count(*) FROM tenant_access_periods) AS periodos,
  (SELECT count(*) FROM tenant_access_periods WHERE canceled_at IS NOT NULL) AS periodos_anulados,
  (SELECT count(*) FROM tenant_feature_overrides WHERE NOT enabled) AS excecoes_desligadas;

ROLLBACK;
