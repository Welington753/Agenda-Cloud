# Continuidade: gerente e login interno (PR #77)

Estado entre sessões do lote "Equipe e acessos" (gerente com permissões do
dono e login interno), migration `TeamManagerAccess1793145600000`. Nada foi
executado no piloto, no Neon ou em `agenda_dev`.

## Estado

- Branch `feat/equipe-login-interno`, PR #77 para
  `integration/nestjs-typeorm-frontend`.
- `5e8c9ae`: implementação (backend, telas, testes). CI verde nos dois
  workflows exigidos, inclusive `proxy` e `migration:show/run`.
- `98c0d96`: procedimento protegido (`abrir-gerente-piloto.ps1`,
  `aplicar-gerente-piloto.mjs`, `conferir-restauracao-gerente.mjs`,
  `gerente-piloto.mjs`, `lib/gerente-acessos-schema.ts`), consulta de
  impacto só leitura (`consultas/impacto-gerente-somente-leitura.sql`), limite
  de recusas na criação de acesso e no convite, mensagem genérica no convite.

## Comprovado nesta rodada (dados fictícios, bancos descartáveis com TLS)

- **Testes novos:** `team-manager-postgres.db-e2e-spec.ts` com 13 cenários
  (convite × login interno, corrida convite × criação, uso acima do limite);
  `pilot-team-manager-check.db-e2e-spec.ts`; `team.e2e-spec.ts` (429 depois de
  10 recusas). Backend: 1504 unitários, 133 HTTP e2e, lint limpo.
- **PostgreSQL 17.11** (Docker `postgres:17`, CA descartável, host fictício
  `ep-ensaio-piloto-222...neon.tech`), modo ensaio:
  - colisão antiga: `preparar` para em `ERR_COLISAO_DE_LOGIN` antes do backup;
    a migration sozinha também para; dados iguais;
  - `preparar`, `restauracao` (cópia em PostgreSQL 18.6: binários 17 não
    disponíveis nesta máquina), frase errada, tabela ocupada (`55P03`),
    queda antes do último comando, aplicação, repetição recusada, queda logo
    depois do COMMIT, conferência posterior sem conexão e banco fora do ar.
- **Retorno da API para `96f5417`** (schema novo, dados da API nova):
  - sessões abertas continuam valendo; gerentes recebem 403 em todas as
    áreas (falha fechada, sem telefone nem preço); suspenso continua sem
    contexto; troca obrigatória continua; profissionais com login com `@`
    mantêm a agenda própria pela sessão aberta;
  - entrar: dono por e-mail e login sem `@` funcionam; `recepcao@retorno.test`
    responde 401 e `maria@retorno`, 400;
  - a API antiga não conta gerentes nas vagas: criou um acesso que deixou um
    estabelecimento com 3 acessos para 2 vagas;
  - convite para e-mail igual a um login interno: 500, nada gravado;
  - suspender ou gerar senha de gerente: 404 (a API antiga só conhece
    PROFISSIONAL na equipe).

## Pendente

- API nova de volta depois do retorno (o que a API antiga deixou).
- Web `96f5417` com a API nova (retorno só do web).
- Runbook `publicacao-gerente-piloto.md`, PR e CI no SHA final.

## Para retomar

- Worktree temporária da versão publicada:
  `%TEMP%\claude\...\scratchpad\antiga` (destacada em `96f5417`, `npm ci`
  próprio). Remover com `git worktree remove` no fim.
- PostgreSQL 18 descartável na porta 55434 (`disposable_retorno`) e contêiner
  `agenda-ensaio-gerente-pg17` na porta 55517: só dados fictícios.
