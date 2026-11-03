-- Contas com papel global, COM IDENTIFICAÇÃO, SOMENTE LEITURA.
--
-- Para a conferência das identidades dos proprietários (MASTER_OWNER) antes
-- de publicar a API do portal. Diferente das outras consultas, esta mostra
-- NOME e E-MAIL: só rode com autorização expressa do dono para esta leitura,
-- e não copie o resultado para o repositório, para issues ou para notas de
-- continuidade. Os procedimentos automáticos mostram só ids
-- (impacto-portal-multisservicos-somente-leitura.sql e a fase `conferir`).
--
-- NADA aqui altera papel ou permissão. Promover, rebaixar ou bloquear uma
-- conta é decisão do dono, fora desta consulta (a promoção a MASTER_OWNER tem
-- procedimento próprio).
--
-- O teste backend/test/pilot-portal-multisservicos-check.db-e2e-spec.ts roda
-- este arquivo contra PostgreSQL descartável (dados fictícios).

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';

SELECT u.id,
       u.platform_role::text AS papel,
       u.status::text AS situacao,
       u.name AS nome,
       u.email::text AS email,
       u.email_verified AS email_verificado,
       (SELECT count(*) FROM memberships m WHERE m.user_id = u.id AND m.role = 'DONO') AS vinculos_de_dono,
       (SELECT max(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS ultima_sessao_criada,
       u.created_at AS criada_em
  FROM users u
 WHERE u.platform_role IS NOT NULL
 ORDER BY (u.platform_role <> 'MASTER_OWNER'), u.platform_role::text, u.created_at, u.id;

ROLLBACK;
