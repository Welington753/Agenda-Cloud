-- Impacto de PlatformPortal1793318400000 e
-- AppointmentServiceSnapshots1793404800000, SOMENTE LEITURA.
--
-- Mostra o que as duas migrations precisam preservar: registros comerciais
-- (períodos de acesso, marca de anterior ao controle), reservas e itens,
-- recebimentos e contas com papel global. Funciona nos três estados (antes,
-- intermediário e final): não lê nenhuma tabela ou coluna nova; o que é novo
-- sai da fase `conferir` do procedimento. Só ids, papéis, situações e
-- contagens: nenhum nome, e-mail, telefone, senha ou valor.
--
-- Mesma lógica do levantamento que as fases `preparar`, `aplicar` e
-- `conferir` imprimem (backend/scripts/lib/portal-multisservicos-schema.ts).
-- O teste backend/test/pilot-portal-multisservicos-check.db-e2e-spec.ts roda
-- este arquivo contra PostgreSQL descartável.
--
-- NÃO execute no piloto fora do procedimento protegido
-- (docs/runbooks/publicacao-portal-multisservicos-piloto.md): lá, as fases
-- já imprimem o mesmo levantamento com destino, TLS e endpoint conferidos.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';

-- 1. Registros comerciais que nenhuma das duas migrations toca.
SELECT
  (SELECT count(*) FROM tenants) AS estabelecimentos,
  (SELECT count(*) FROM tenants WHERE access_legacy_since IS NOT NULL) AS marcados_como_anteriores,
  (SELECT count(*) FROM tenant_access_periods) AS periodos,
  (SELECT count(*) FROM tenant_access_periods WHERE kind = 'PAID') AS pagos,
  (SELECT count(*) FROM tenant_access_periods WHERE kind = 'COURTESY') AS cortesias,
  (SELECT count(*) FROM tenant_access_periods WHERE kind = 'TRIAL') AS testes,
  (SELECT count(*) FROM tenant_access_periods WHERE canceled_at IS NOT NULL) AS anulados;

-- 2. Reservas, itens e recebimentos. `reservas_com_varios_itens`: antes desta
--    versão nenhuma tela criava reserva com mais de um serviço.
SELECT
  (SELECT count(*) FROM appointments) AS reservas,
  (SELECT count(*) FROM appointment_items) AS itens,
  (SELECT count(*) FROM (SELECT appointment_id FROM appointment_items GROUP BY appointment_id HAVING count(*) > 1) v)
    AS reservas_com_varios_itens,
  (SELECT count(*) FROM appointments a WHERE NOT EXISTS (SELECT 1 FROM appointment_items i WHERE i.appointment_id = a.id))
    AS reservas_sem_item,
  (SELECT count(*) FROM appointment_payments) AS recebimentos;

-- 3. Contas com papel global (só ids). Com a API nova, só MASTER_OWNER ativo
--    entra no portal; MASTER_ADMIN e MASTER_SUPPORT ficam gravados, sem
--    acesso. Nada aqui altera papel ou permissão; a conferência das
--    identidades é autorizada e feita à parte
--    (contas-com-papel-global-somente-leitura.sql).
SELECT u.id, u.platform_role::text AS papel, u.status::text AS situacao,
       (SELECT count(*) FROM memberships m WHERE m.user_id = u.id AND m.role = 'DONO') AS vinculos_de_dono,
       to_char(u.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS criada
  FROM users u
 WHERE u.platform_role IS NOT NULL
 ORDER BY u.platform_role::text, u.created_at, u.id;

-- 4. Convites de plataforma pendentes, por papel. Um convite pendente com
--    papel delegado, se aceito, grava um papel que a API nova não reconhece.
SELECT coalesce(platform_role::text, 'sem_papel') AS papel, count(*) AS pendentes
  FROM invites
 WHERE type = 'PLATFORM' AND status = 'PENDING'
 GROUP BY 1
 ORDER BY 1;

ROLLBACK;
