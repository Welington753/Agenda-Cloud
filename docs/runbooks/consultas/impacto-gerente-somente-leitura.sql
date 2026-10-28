-- Impacto de TeamManagerAccess1793145600000, SOMENTE LEITURA.
--
-- Mostra, por estabelecimento, o efeito da regra nova das vagas (gerentes
-- ativos passam a ocupar vaga de equipe; o dono continua fora) e as colisões
-- antigas entre login e e-mail que impedem a migration. Funciona antes e
-- depois da migration (não lê a coluna nova). Só ids, slug e contagens:
-- nenhum nome, e-mail, login, telefone ou senha.
--
-- Mesma regra de backend/src/team/seats.ts e do levantamento que as fases
-- `preparar`, `aplicar` e `conferir` imprimem (backend/scripts/lib/gerente-acessos-schema.ts).
-- O teste backend/test/pilot-team-manager-check.db-e2e-spec.ts roda este
-- arquivo contra PostgreSQL descartável.
--
-- NÃO execute no piloto fora do procedimento protegido
-- (docs/runbooks/publicacao-gerente-piloto.md): lá, a fase `preparar` já
-- imprime o mesmo levantamento com destino, TLS e endpoint conferidos.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';

-- 1. Vagas por estabelecimento com gerente ou acima do limite.
--    vagas_antes: regra anterior (PROFISSIONAL ativos + convites pendentes).
--    vagas_depois: regra nova (PROFISSIONAL e GERENTE ativos + convites).
--    situacao_das_vagas:
--      acima_antes      já estava acima do limite;
--      passa_acima      fica acima só porque os gerentes passam a contar:
--                       acessos e permissões ficam como estão; criar acesso,
--                       convidar e reativar são recusados até sobrar vaga;
--      passa_ao_limite  fica exatamente no limite: o próximo é recusado;
--      sem_mudanca      continua com vaga livre.
SELECT tenant_id, slug, situacao, plano, limite, profissionais_ativos, gerentes_ativos, gerentes_suspensos,
       convites_pendentes, vagas_antes, vagas_depois,
       CASE
         WHEN vagas_antes > limite THEN 'acima_antes'
         WHEN vagas_depois > limite THEN 'passa_acima'
         WHEN vagas_depois = limite AND vagas_antes < limite THEN 'passa_ao_limite'
         ELSE 'sem_mudanca'
       END AS situacao_das_vagas
  FROM (
    SELECT t.id AS tenant_id, t.slug::text AS slug, t.status::text AS situacao, p.code AS plano,
           p.max_professionals AS limite, x.profissionais_ativos, x.gerentes_ativos, x.gerentes_suspensos,
           x.convites_pendentes,
           x.profissionais_ativos + x.convites_pendentes AS vagas_antes,
           x.profissionais_ativos + x.gerentes_ativos + x.convites_pendentes AS vagas_depois,
           t.created_at
      FROM tenants t
      JOIN plans p ON p.id = t.plan_id
      CROSS JOIN LATERAL (
        SELECT
          (SELECT count(*) FROM memberships m WHERE m.tenant_id = t.id AND m.role = 'PROFISSIONAL' AND m.status = 'ACTIVE')::int AS profissionais_ativos,
          (SELECT count(*) FROM memberships m WHERE m.tenant_id = t.id AND m.role = 'GERENTE' AND m.status = 'ACTIVE')::int AS gerentes_ativos,
          (SELECT count(*) FROM memberships m WHERE m.tenant_id = t.id AND m.role = 'GERENTE' AND m.status <> 'ACTIVE')::int AS gerentes_suspensos,
          (SELECT count(*) FROM invites i WHERE i.tenant_id = t.id AND i.establishment_role = 'PROFISSIONAL'
              AND i.status = 'PENDING' AND i.expires_at > now())::int AS convites_pendentes
      ) x
  ) v
 WHERE gerentes_ativos > 0 OR gerentes_suspensos > 0 OR vagas_depois > limite
 ORDER BY created_at, tenant_id;

-- 2. Totais dos gerentes. Os ajustes GRANTED antigos continuam gravados e
--    sem valer até o dono confirmar as permissões na tela nova.
SELECT count(*) FILTER (WHERE m.status = 'ACTIVE')::int AS gerentes_ativos,
       count(*) FILTER (WHERE m.status <> 'ACTIVE')::int AS gerentes_suspensos,
       count(*) FILTER (WHERE m.professional_id IS NOT NULL)::int AS gerentes_com_profissional,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM membership_permission_overrides o
                                       WHERE o.membership_id = m.id AND o.mode = 'GRANTED'))::int AS gerentes_com_ajustes_concedidos
  FROM memberships m
 WHERE m.role = 'GERENTE';

-- 3. Colisões antigas: o login de uma conta é o e-mail de OUTRA conta. A
--    migration para sem alterar nada enquanto houver uma. Só os ids; cada
--    caso é decidido por uma pessoa, nunca por script.
SELECT a.id AS login_user_id, b.id AS email_user_id
  FROM users a
  JOIN users b ON b.id <> a.id AND b.email = a.username
 ORDER BY a.id, b.id
 LIMIT 50;

ROLLBACK;
