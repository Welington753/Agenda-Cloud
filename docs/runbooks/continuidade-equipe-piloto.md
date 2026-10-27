# Continuidade — publicação de equipe e acessos no piloto

Nota para retomar em qualquer máquina. Atualizada em 27/10/2026, depois da
publicação.

## Onde está

- `integration/nestjs-typeorm-frontend` em `c77c313` tem #67 (mensagens), #68
  (API e migration `TeamAccess1792886400000`), #69 (telas) e #70 (procedimento
  de publicação).
- Procedimento: `docs/runbooks/publicacao-equipe-piloto.md`.
- Regras do lote: `docs/plans/equipe-acessos-e-plano.md`.

## Estado do piloto

### Migration (conferido pelo agente)

- **TeamAccess1792886400000 foi aplicada no piloto em 27/10/2026 02:02:25 UTC.
  Não aplique de novo.** A fase `aplicar` deve recusar, mas não dependa disso.
- Execução `2026-10-27T02-01-33-899Z`, commit `c77c313`, endpoint
  `ep-orange-bread-b7f8iike`: `migration_iniciada` → `aplicada` →
  `aplicada_e_conferida`.
- `conferir` final (execução `2026-10-27T02-05-52-757Z`): `ESTADO: after`,
  0 sessões da migration. O usuário viu na janela `MIGRATIONS_APPLIED: 8` e
  `SCHEMA_OBJECTS_OK: 19/19`, com saída 0.
- Registros em `%USERPROFILE%\AgendaCloud-operacoes\operacoes.jsonl`, no PC de
  casa.
- Backups no PC de casa, em `%USERPROFILE%\AgendaCloud-operacoes`:
  - `equipe-preparar-2026-10-27T01-54-59-643Z`: backup conferido por
    restauração (sha256 `061ce04b…`);
  - `equipe-aplicar-2026-10-27T02-01-33-899Z`: backup tirado imediatamente
    antes da aplicação (sha256 `b7a9e339…`).

  Os dois têm hashes de senha. Não copie para o PC do trabalho nem para a
  nuvem.

### Deploy

- **Informado pelo usuário:** deploy manual pelo painel do Render da API e do
  web concluído.
- **Conferido pelo agente** em 27/10/2026, sem acesso ao painel:
  - registros de deployment do GitHub: `agenda-cloud-piloto-web` em `c77c313`
    às 02:07:12 UTC e `agenda-cloud-piloto-api` em `c77c313` às 02:07:19 UTC,
    os dois `success`;
  - `GET https://agenda-cloud-piloto-api.onrender.com/` deu `200`;
  - `GET https://agenda-cloud-piloto-web.onrender.com/agenda_api/auth/me`
    sem cookie deu `401`;
  - `GET https://agenda-cloud-piloto-web.onrender.com/login` deu `200`.
- Auto-Deploy: o usuário informou **Off** nos dois serviços em 26/10/2026. Não
  foi conferido no painel pelo agente.

## Testes manuais pendentes

Exigem login real, então ficam com o usuário (passos 5 e 6 do runbook):

1. Entrar com a conta do dono e confirmar que o login funciona.
2. Como dono, abrir **Equipe e acessos** e conferir vagas e profissionais.
3. Como `MASTER_OWNER`, abrir **Administração → Estabelecimentos → ficha** e
   conferir situação, plano e uso.
4. Teste de borda real do IP do cliente (`cf-connecting-ip`), runbook 7.9 da
   publicação do piloto, que continua pendente.

Não crie estabelecimento de teste no piloto, e não convide funcionário real só
para testar: o convite ocupa vaga.

## Limpeza pendente (PC de casa)

- Remover o worktree da publicação:
  `git -C C:\Projetos\Agenda-Cloud worktree remove C:\Projetos\Agenda-Cloud-publicacao`.
- Manter a pasta de operações. Apagar os dumps quando não forem mais
  necessários.

## Cuidados

- Nunca mesclar `reserva/api-cadastro-fechado` na integration. Ela é anterior
  a AccountsAdministration e não é recuperação deste lote.
- Não reverta TeamAccess e não volte a API para `f37cbc9`. Isso reabre acessos
  suspensos (sem dados), tira o limite do plano e transforma convites de
  funcionário em vínculos sem profissional. Ver "Recuperação" no runbook.
- Stash antigo `WIP on fix/cancel-stale-confirmation` preservado no clone de
  casa (`C:\Projetos\Agenda-Cloud`). Ele não está no remoto e não faz parte
  deste lote.
