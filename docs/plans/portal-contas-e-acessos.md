# Portal: "Contas e acessos" com abas separadas no servidor

Base: integration `becc923`. Sem migration, sem variável nova. Muda a API (`GET /platform/users` e a ficha `GET /platform/users/:id`) e o web.

## Pedido

"Responsáveis e acessos" (tela `/portal/usuarios`, título "Usuários") passa a se chamar **Contas e acessos** e separa:

1. **Contas dos estabelecimentos:** só os responsáveis, ou seja, contas com vínculo real de dono com um estabelecimento.
2. **Administradores do sistema:** as contas administrativas da plataforma, visíveis só para os proprietários da plataforma.

Funcionários continuam em "Equipe e acessos", na conta do estabelecimento. Nada é apagado nem alterado para organizar a lista.

## Regras (servidor)

`backend/src/accounts/accounts-directory.service.ts`, `listUsers`, com `scope` no DTO (`ESTABLISHMENTS` por padrão, ou `ADMINS`). A aba vale antes da busca, da situação, da paginação e dos totais.

| Aba | Entra | Fica fora |
|---|---|---|
| `ESTABLISHMENTS` (`ESTABLISHMENT_ACCOUNT_SQL`) | vínculo `DONO` (qualquer situação do vínculo) ou convite de `DONO` pendente e não vencido | só funcionário, sem vínculo nenhum, só administrador, convite vencido |
| `ADMINS` (`ADMIN_ACCOUNT_SQL`) | `platform_role IS NOT NULL` | todo o resto |

- **Uma linha por conta.** Os estabelecimentos do responsável vão em `establishments` (`OWNER` ou `PENDING_INVITE`). Dono de dois estabelecimentos conta uma vez. Vínculo de funcionário de uma conta mista não aparece como estabelecimento dela.
- **Busca:** na aba de estabelecimentos, procura no nome, no e-mail e no login da conta, e também no nome ou slug dos estabelecimentos de que ela é responsável. Na aba de administradores, só nos dados da conta. O filtro `tenantId` só vale na aba de estabelecimentos e considera só os estabelecimentos de que a conta é responsável.
- **Totais:** `total`, `active`, `invited` e `suspended`, contados no conjunto da aba e da busca, sem o filtro de situação.
- **Sem mistura de dados:** a aba de estabelecimentos nunca devolve `platformRole` nem `platformPermissions`, e a de administradores nunca devolve vínculos. O filtro antigo `platformRole` saiu, e o DTO estrito o recusa com 400.
- **Autorização:** o portal já exige `viewDirectory` (só `MASTER_OWNER` ativo). A aba `ADMINS` exige também `managePlatformAccess`, pela autorização existente (`requireCapability`). Hoje as duas capacidades andam juntas; a regra é da capacidade para continuar valendo se um dia houver quem consulte sem cuidar dos acessos.
- **Ficha por id** (`userDetail`): conta com papel de plataforma vista sem `managePlatformAccess` é classificada pelo vínculo (`platformDataVisibility` em `actor.ts`). Com vínculo ou convite de estabelecimento, a ficha sai sem os dados administrativos (`platformDataHidden: true`, sem convites de plataforma). Sem vínculo, a resposta é 404. As ações continuam decididas pelo papel real (`canManageAccount`).
- Nenhum nome ou e-mail fixo no código. Nenhum papel é concedido nem alterado.

## Tela

`src/app/portal/(area)/usuarios/page.tsx` (mesmo endereço). A aba vai em `?aba=administradores`, e as regras de tela ficam em `src/lib/administracao/contas-e-acessos.ts`, com teste. As peças comuns ficam em `src/components/administracao/contas-e-acessos.tsx`.

- As abas só aparecem com `managePlatformAccess` confirmado por `GET /platform/access`. Sem ele, `?aba=administradores` abre a aba de estabelecimentos.
- Há quatro cartões de totais, busca, filtro de situação e paginação, tudo lido do servidor. No computador a lista é uma tabela; no celular cada linha vira um cartão, na mesma marcação.
- A ação da linha é "Ver conta", ou "Ver convite" quando a conta ainda não ativou; as duas abrem a ficha existente. "Convidar responsável" leva a Estabelecimentos, onde o convite já existe (ou à criação de um novo).
- Menu: "Responsáveis e acessos" virou "Contas e acessos". "Proprietários da plataforma" (`/portal/papeis`) continua como era; a aba de administradores tem um link para essa página.
- Na ficha, as seções "Portal da plataforma" e "Segundo fator" somem quando o servidor oculta os dados de plataforma.

## Testes

- `backend/src/accounts/actor.spec.ts`: `platformDataVisibility`.
- `backend/test/accounts.e2e-spec.ts`: aba padrão, aba desconhecida e `platformRole` recusados (400), e 403 do serviço repassado.
- `backend/test/accounts-postgres.db-e2e-spec.ts`: as duas abas, com dono, funcionário, administrador, conta sem vínculo, múltiplos vínculos, proprietário que também é dono, convite pendente e convite vencido. Também cobre contagens, páginas e busca por estabelecimento; prova que nada é alterado e que quem não é proprietário recebe 403 nas duas abas e na ficha.
- `backend/test/platform-portal-postgres.db-e2e-spec.ts`: `?scope=ADMINS` nas listas de recusa.
- `src/lib/administracao/contas-e-acessos.test.ts` e `rotas.test.ts`.
- Navegador: `tests/browser/portal-contas-e-acessos-flow.spec.ts` (na invocação `test:browser:contas`), em 1280, 390 e 360 px, mais os ajustes de rótulo em `administracao-flow`, `portal-entrada-flow` e `contas-convites-flow`.

## Publicação

A API muda, então **não existe publicação só do web**: o web novo manda `scope`, que a API antiga recusa com 400. Esconder a aba no web também não protege nada sem a API nova.

O `backend/` deste lote parte do de `becc923`. A API exige as 18 migrations e as três variáveis `PLATFORM_*`, então este lote só vai ao piloto **depois da etapa 3** de [publicacao-consolidada-b5b2704.md](publicacao-consolidada-b5b2704.md), como uma etapa própria sem migration (API e depois web, no mesmo SHA, pelo roteiro de publicação). Juntar o lote à etapa 3 seria trocar o alvo dela, e essa decisão é do responsável.

## Estado e retomada

- **17/11/2026:** implementado na branch `feat/portal-contas-e-acessos` (worktree `C:\wt\contas`). Unitários, e2e HTTP, db-e2e (suíte completa em banco novo) e navegador locais verdes. Os detalhes estão no PR.
- **Não publicado.** Bloqueado pela fila de publicação (etapas 0 a 3 pendentes, com informações da seção 8 e decisões D5, D7 e D8 em aberto). Leitura do Render em 17/11: web `becc923`, API `8e8577d`.
- **Próximo passo:** depois da etapa 3, publicar o merge deste PR como etapa própria (API → web), conferindo o login do proprietário, as duas abas, a ficha e a recusa a um dono comum.
