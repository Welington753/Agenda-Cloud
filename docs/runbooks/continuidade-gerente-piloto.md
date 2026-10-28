# Continuidade: gerente e login interno (PR #77)

Estado entre sessões do lote "Equipe e acessos" (gerente com permissões do
dono e login interno), migration `TeamManagerAccess1793145600000`. Nada foi
executado no piloto, no Neon ou em `agenda_dev`; nenhum e-mail real foi
enviado; Render e Auto-Deploy não foram tocados.

## Estado em 28/10/2026

- Branch `feat/equipe-login-interno`, PR #77 para
  `integration/nestjs-typeorm-frontend`. Sem merge, sem deploy.
- Commits:
  - `5e8c9ae`: implementação (backend, telas, testes);
  - `98c0d96`: procedimento protegido, consulta de impacto, limite de recusas
    na criação de acesso e no convite, mensagem genérica no convite;
  - `8a29566`: checkpoint desta nota (incompleto);
  - o commit seguinte: o web anterior entra com login interno com `@` pela API
    nova, runbook `publicacao-gerente-piloto.md`, esta nota e o plano.
- O piloto tem dez migrations (StaffLogin e AppointmentPayments já aplicadas,
  registradas no PR #74). **Não as repita.** O procedimento deste lote só aceita
  TeamManagerAccess como pendente.

## Comprovado (dados fictícios, bancos descartáveis com TLS)

Detalhes e tabelas em `publicacao-gerente-piloto.md` ("Ensaio" e "Recuperação").

- **Revisão de permissões e login:** criação de usuário só por dois caminhos
  (convite e criação direta), ambos cobertos pelo gatilho, pela conferência
  prévia e pela recusa genérica. Testes novos em
  `team-manager-postgres.db-e2e-spec.ts` (convite × login interno, corrida
  convite × criação, uso acima do limite, corpo antigo do login),
  `pilot-team-manager-check.db-e2e-spec.ts` e `team.e2e-spec.ts` (429 depois
  de 10 recusas).
- **PostgreSQL 17.11:** procedimento completo em modo ensaio (colisão,
  preparar, restauração, frase errada, tabela ocupada, quedas antes e depois
  do COMMIT, conferência posterior falha, aplicação, repetição recusada,
  banco fora do ar).
- **API nova com o schema anterior:** equipe e gerente antigo com ajuste dão
  500. A migration vem antes da API.
- **Retorno só do web (`96f5417` + API nova):** todos entram; gerentes ficam
  sem menu, mas continuam com a permissão no servidor; a tela antiga de equipe
  não mostra gerentes.
- **Retorno da API (`96f5417`):** sessões abertas valem; gerentes 403 em tudo;
  logins com `@` não entram; a API antiga cria acesso acima do limite novo;
  convite para e-mail igual a login interno dá 500 sem gravar nada. Com a API
  nova de volta, tudo volta a valer e nada foi perdido.

## Limitações

- **Restauração em PostgreSQL 17:** provada por harness de ensaio com o
  servidor e o `pg_restore` da imagem oficial `postgres:17` e as mesmas
  funções do procedimento. O script `conferir-restauracao-gerente.mjs` só
  chama binários Windows e rodou aqui com os do 18.6; com binários 17 ele roda
  pela primeira vez na operação real (`-PgBin` do PC do operador).
- A versão do servidor do piloto não foi lida (última conhecida: 17.11).
- Web novo com a API antiga não validado: publicar API → web, voltar web → API.
- Voltar só o web não revoga permissões na API e não dá ao dono como suspender
  um gerente: não é recuperação para incidente de permissões.
- Lançador aberto no Windows Terminal em modo ENSAIO com teclas simuladas; a
  colagem real com Ctrl+V é a das publicações anteriores.

## Pendente (depende de execução real, com autorização)

1. Merge do PR #77 na integração (revisão humana).
2. No piloto, pelo runbook: `preparar` (ler o levantamento de vagas e
   colisões), `restauracao`, `aplicar`, `conferir`.
3. Deploy da API e depois do web, do mesmo SHA.

## Para retomar

- Clone: `C:\Projetos\Agenda-Cloud`, branch acima. O `CLAUDE.md` local tem
  alteração do usuário fora do Git: não incluir nem reverter.
- Ambientes descartáveis desta rodada (podem ser apagados):
  - PostgreSQL 18 na porta 55434 (`disposable_equipe`, `disposable_retorno`,
    `disposable_dez`), na pasta de rascunho da sessão;
  - o contêiner PostgreSQL 17 do ensaio já foi removido.
- A worktree temporária de `96f5417` já foi removida.
