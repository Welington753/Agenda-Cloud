# Continuidade — publicação de equipe e acessos no piloto

Nota para retomar em qualquer máquina. Atualizada em 27/10/2026.

## Onde está

- `integration/nestjs-typeorm-frontend` tem #67 (mensagens), #68 (API e
  migration `TeamAccess1792886400000`) e #69 (telas) desde `b0539c5`, e o
  procedimento de publicação desta nota (PR `chore/publicacao-equipe-piloto`).
- Procedimento: `docs/runbooks/publicacao-equipe-piloto.md`.
- Regras do lote: `docs/plans/equipe-acessos-e-plano.md`.

## Estado do piloto

- **TeamAccess NÃO foi aplicada no piloto.** O piloto tem as sete migrations
  até `AccountsAdministration1792800000000`.
- API e web do piloto: `f37cbc9` (registros de deployment do GitHub; último em
  26/10/2026 11:08 UTC). Os merges de #67, #68 e #69 não geraram deployment.
- Auto-Deploy: o usuário informou **Off** nos dois serviços em 26/10/2026.
  Registro do usuário, não conferido no painel pelo agente.
- **Não publique a API nova antes de TeamAccess aplicada e conferida.** Sem a
  migration, todo login da API nova responde 500 (ensaiado).

## Próximo passo operacional

No PC que tiver o gerenciador de senhas e o PostgreSQL com `pg_dump` na versão
do piloto ou maior:

1. Worktree limpo do SHA de integration que contém o runbook, com `npm ci`
   (passo 0).
2. `preparar` → `restauracao` → `aplicar` → `conferir`, pelo lançador
   `backend/scripts/abrir-equipe-piloto.ps1`, no mesmo SHA.
3. Só com `ESTADO: after`: deploy manual da API, depois do web, no mesmo SHA.

## Cuidados

- Nunca mesclar `reserva/api-cadastro-fechado` na integration. Ela é anterior
  a AccountsAdministration e não é recuperação deste lote.
- Voltar a API para `f37cbc9` depois de publicar a nova reabre acessos
  suspensos (sem dados), tira o limite do plano e transforma convites de
  funcionário em vínculos sem profissional. Ver "Recuperação" no runbook.
- Stash antigo `WIP on fix/cancel-stale-confirmation` preservado no clone de
  casa (`C:\Projetos\Agenda-Cloud`); não faz parte deste lote.
