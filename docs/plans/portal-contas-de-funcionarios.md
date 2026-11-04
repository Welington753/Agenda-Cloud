# Portal: contas só de funcionário fora da lista global de contas

Base: integration `6fac73c`. Sem migration, sem mudança de autorização.

## Pedido

A lista global de contas do portal (`GET /platform/users`, tela
`/portal/usuarios`) mostrava todo funcionário de todo estabelecimento ao lado
dos responsáveis. Ela passa a mostrar só responsáveis e contas da plataforma.

## Critério (servidor, `STAFF_ONLY_ACCOUNT_SQL`)

Uma conta fica FORA da lista global quando, ao mesmo tempo:

- não tem papel de plataforma (`users.platform_role` nulo);
- não tem vínculo `DONO` em nenhum estabelecimento;
- não tem convite pendente de `DONO`;
- tem ao menos um vínculo de outro papel (GERENTE, RECEPCIONISTA,
  PROFISSIONAL) ou um convite pendente de estabelecimento com outro papel.

Consequências:

- Quem é dono de um negócio e funcionário de outro continua listado, com
  todos os vínculos na linha.
- Responsável ainda sem estabelecimento (convite de dono pendente, sem
  vínculo) e contas sem vínculo nenhum (antigas, `MASTER_OWNER`) continuam.
- Conta com papel de plataforma continua, mesmo com vínculo de funcionário.
- O critério entra na mesma cláusula `WHERE` da busca, antes da paginação e
  dos contadores (total, situações, contas da plataforma, sem
  estabelecimento). O filtro por estabelecimento também passa a mostrar só os
  responsáveis dele.

## O que não muda

- Nenhum usuário, vínculo, convite, sessão ou histórico é apagado ou
  alterado; a consulta é só leitura.
- A equipe de cada estabelecimento (`GET /platform/establishments/:id/members`)
  e a ficha da conta (`GET /platform/users/:id`) continuam mostrando os
  funcionários.
- A lista de convites (`GET /platform/invites`) é o histórico de convites e
  continua completa.
- Permissões, limites de equipe e a autorização do portal (só
  `MASTER_OWNER` ativo) ficam iguais.

## Validação

- `test/accounts-postgres.db-e2e-spec.ts`, caso novo: funcionário exclusivo
  (um e dois estabelecimentos), convite pendente de funcionário, pessoa com
  vínculo de dono e de funcionário, funcionária com convite de dono pendente,
  responsável sem estabelecimento, `MASTER_OWNER` sem estabelecimento e
  administrador com vínculo de funcionário. Confere itens, total, contadores,
  páginas de 2, busca, filtro por estabelecimento, equipe, ficha, contagem de
  linhas antes/depois e as recusas do portal.
- Mutação: sem o critério, o caso novo falha.
