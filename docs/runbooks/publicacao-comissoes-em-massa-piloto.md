# Runbook — Publicar a comissão em massa no piloto (sem migration)

Leva a API e o web do piloto de `8e8577d` (C_final, Portal AC) para o merge do
PR #102, comissão em massa com a escolha de manter ou remover as exceções por
serviço:

**SHA alvo = `5d74556e9e12e55f38e0056d0f19911f3e66f475`**

Não use um commit posterior sem antes listar e revisar o que ele acrescenta:
`git log --oneline 5d74556..<outro>` e `git diff --stat 5d74556 <outro>`.

Este roteiro **reaproveita** os existentes e só acrescenta o que faltava para
uma publicação sem migration no estado 16:

- `publicacao-regra-geral-comissoes-piloto.md`: kit da 16 (fase `conferir`),
  compatibilidade e recuperação no schema 16;
- `publicacao-piloto-render.md`: deploy manual, verificações (seção 7,
  passo 8) e retorno ao commit anterior (seção 8);
- `continuidade-comissoes-piloto.md`: registro da aplicação da 16 (na branch
  `docs/continuidade-pos-merges-98-100`, PR #101, ainda não mesclado).

**Este documento nunca contém credencial, URL de banco, Endpoint ID ou
endereço real.** `<ep-piloto>`, `<ep-proibido>`, `<web>` e `<api>` são
digitados por quem opera.

## Evidências: verificado x anotado

**Verificado no repositório em 09/11/2026, sem acesso ao piloto:**

- `git diff 8e8577d 5d74556 -- backend/src/migrations` vazio: **nenhuma
  migration nova**. O alvo exige as mesmas 16 migrations do C_final.
- No backend, só mudam `backend/src/commissions/*` (rotas
  `bulk-settings/preview` e `bulk-settings`, e a escolha `exceptions` no
  `PUT .../settings`). Nada em `backend/scripts`:
  `git diff e42fb81 5d74556 -- backend/scripts` vazio (o kit da 16 é o
  ensaiado).
- `render.yaml` sem migration no deploy: a API roda `npm run build` e
  `node dist/main.js`.
- A API nova grava só em tabelas que já existem
  (`professional_commission_settings`, `commission_rules`, `audit_logs`, com a
  ação `COMMISSION_RULE_CHANGED` que já existe) e nunca toca
  `commission_entries`.
- CI do PR #102 no head `e862b32`: `test-frontend-auth` com sucesso (run
  42664086994). O merge `5d74556` tem a mesma árvore do head mais a base
  `8e8577d`, que não mudou desde a abertura do PR.

**Anotado em 09/11/2026, não reconferido agora.** Essas informações vêm dos
registros da sessão de publicação da 16 (PR #101 e notas locais):

- Migration 16 aplicada pelo kit às 13:10:24 UTC. A `conferir` das 13:16 UTC
  deu `after-commission-settings` e `JANELA_DE_TRANSICAO: ok`.
- API e web Live em `8e8577d` desde 13:26 e 13:27 UTC, por deploys manuais,
  com Auto-Deploy desligado.

O passo 2 abaixo confere de novo o estado do banco, e o passo 0 confere o
Render. **Não publique com base só nessas anotações.**

## Compatibilidade (leitura do código; não ensaiada por HTTP no piloto)

| Combinação | Resultado |
| --- | --- |
| web `8e8577d` × API `5d74556` (entre os deploys) | funciona. Os campos novos do `PUT .../settings` são opcionais e, sem eles, as exceções ficam como estão. O validador antigo do web ignora o campo novo `exceptionsFingerprint` |
| web `5d74556` × API `8e8577d` | a tela de comissões do profissional mostra "Não foi possível carregar" (o validador novo exige `exceptionsFingerprint`), e a comissão em massa responde 404. Por isso a ordem é **API e depois web**, e para voltar, **web e depois API** |
| web e API `5d74556` | destino; coberto pelo CI (suítes de navegador `comissoes-em-massa` e `comissoes`) |

## Pré-requisitos

- Computador de casa, Windows Terminal, Node 24, Git Bash.
- Painel do Render (ou Render CLI com login) para
  `agenda-cloud-piloto-api` e `agenda-cloud-piloto-web`.
- URL direta do piloto, Endpoint ID do piloto e Endpoint ID proibido, vindos
  do gerenciador de senhas.
- PostgreSQL 17.11 ou mais novo para Windows (`-PgBin`).
- Pasta `%USERPROFILE%\AgendaCloud-operacoes`, onde ficam os backups
  existentes. Não apague nenhum.
- Uma worktree limpa no SHA alvo, com `npm ci` próprio no `backend`:

  ```powershell
  git -C C:\Projetos\Agenda-Cloud fetch origin
  git -C C:\Projetos\Agenda-Cloud worktree add --detach C:\Projetos\Agenda-Cloud-publicacao-5d74556 5d74556e9e12e55f38e0056d0f19911f3e66f475
  cd C:\Projetos\Agenda-Cloud-publicacao-5d74556\backend
  npm ci
  ```

## Sequência

Qualquer `ERRO:`, `FAILURE` ou resultado diferente do esperado **para** a
sequência (ver "Critérios de interrupção"). Cada deploy exige autorização
expressa do dono naquele momento.

### 0. Render, só leitura

- API e web Live em `8e8577d`, Auto-Deploy desligado nos dois.
- Anote os IDs dos deploys Live atuais: são o destino do rollback.
- Se algum serviço estiver em outro SHA, pare e reavalie.

### 1. Backup e validação

**Lacuna do procedimento existente.** Nenhum script do repositório faz
backup protegido de um banco que **já** está no estado 16:

- a fase `preparar` do kit da 16 só faz backup no estado "antes" e recusa o
  estado 16 com `ERR_MIGRATION_JA_APLICADA`;
- o backup diário (`backup-piloto-automatico.md`) estava sem configuração no
  último registro (29/10/2026).

Os backups de 09/11 estão no `AgendaCloud-operacoes` do **PC do trabalho** e
são de **antes** da 16 (`regra-geral-comissoes-aplicar-2026-11-09T13-09-24-558Z`).
Servem para consulta, nunca para restaurar sobre o piloto.

Esta publicação não escreve no schema. O backup é rede de segurança contra
gravações erradas da API nova (por exemplo, exceções removidas por engano),
não pré-requisito de migration. Escolha **uma** opção antes de começar:

- **A. Branch do Neon** (o "backup (branch do Neon)" de
  `publicacao-piloto-render.md`, seção 8). No console do Neon, no projeto do
  piloto, crie uma branch a partir do estado atual, com nome datado, logo
  antes do passo 4.
  - Validação: a branch aparece com o horário de criação, e o tamanho é
    compatível com o da principal.
  - Não conecte a API a ela.
  - Para consultar ou restaurar numa cópia, use o endpoint dela, nunca o do
    piloto.
  - É uma escrita no projeto do Neon (não nos dados) e precisa de
    autorização. Pode contar no limite de branches do plano gratuito.
- **B. Backup diário**, se já estiver configurado: uma execução manual
  (*Run workflow*) logo antes do passo 4, validada pela seção 4 de
  `backup-piloto-automatico.md`: `RESTAURACAO_IGUAL: true` e
  `RESULTADO: backup_ok`.
- **C. Sem backup novo.** Fica só o histórico de 6 h do Neon Free. Aceitável
  apenas se o dono decidir por escrito.

Não faça `pg_dump` manual fora de um kit: o projeto não tem guarda nem
comprovante para isso.

### 2. Conferência do banco (só leitura)

Faça as duas conferências. Elas usam a mesma função, mas a primeira deixa
registro em `operacoes.jsonl` e pede a URL num prompt oculto.

1. **Fase `conferir` do kit da 16**, a partir da worktree do alvo:

   ```powershell
   wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File C:\Projetos\Agenda-Cloud-publicacao-5d74556\backend\scripts\abrir-regra-geral-comissoes-piloto.ps1 -Fase conferir -PilotEndpointId <ep-piloto> -ProductionEndpointId <ep-proibido> -PgBin '<pasta bin do PostgreSQL 17>'
   ```

   Esperado:

   ```text
   ESTADO: after-commission-settings
   MIGRATIONS_APPLIED: 16
   SCHEMA_OBJECTS_OK: 7/7
   SESSOES_DA_MIGRATION_ATIVAS: 0
   DESFECHO: estado_identificado
   ```

   Linhas informativas, que não decidem:
   - `TRANSICAO_*` e `REVERSAO_AFETARIA_*`: com o uso normal desde 09/11,
     contagens maiores que zero são esperadas.
   - `JANELA_DE_TRANSICAO`: usa o registro da fase `aplicar` na pasta de
     operações deste computador. A 16 foi aplicada no PC do trabalho, então
     em casa o esperado é "sem registro da fase aplicar nesta pasta de
     operações; nada conferido". Se aparecer `VIOLADA`, pare e trate como
     divergência.

2. **`npm run pilot:check-database`**, em Git Bash, na mesma worktree:

   ```bash
   cd /c/Projetos/Agenda-Cloud-publicacao-5d74556/backend
   read -rs PILOT_DIRECT_URL && export PILOT_DIRECT_URL   # cole a URL direta, Enter (não ecoa)
   export PILOT_ENDPOINT_ID=<ep-piloto> PRODUCTION_ENDPOINT_ID=<ep-proibido>
   PILOT_EXPECT=after-commission-settings npm run pilot:check-database
   unset PILOT_DIRECT_URL
   ```

   Esperado: `TARGET_ENDPOINT_MATCH: true`, `DISTINCT_FROM_PRODUCTION: true`,
   `TLS_VERIFICATION: true`, `MIGRATIONS_APPLIED: 16`,
   `SCHEMA_OBJECTS_OK: 7/7`, `BASELINE_FAILURES: none`,
   `RESULT: SUCCESS`.

**O que essa expectativa confere** (`scripts/lib/regra-geral-comissoes-schema.ts`),
além da contagem:

- **Identidade das migrations:** o histórico em `typeorm_migrations` precisa
  ser exatamente a lista das 16, **pelo nome e na ordem**. A 15ª é
  `ProfessionalCommissions1793491200000` e a 16ª é
  `ProfessionalCommissionSettings1793577600000`. Outra ordem, nome diferente
  ou migration a mais dá `migration_history`.
- **Estrutura da 15:** a conferência inteira `after-professional-commissions`,
  sem exigir exatamente 15 migrations.
- **Estrutura da 16:**
  - tabela `professional_commission_settings` com colunas, tipos, nulidade e
    padrões exatos, só o índice da chave e nenhum gatilho;
  - coluna `commission_entries.applied_rule_scope`;
  - as cinco constraints com a definição exata (`pg_get_constraintdef`).

### 3. Decisão sobre migration

| Resultado do passo 2 | Ação |
| --- | --- |
| as duas conferências passam como esperado | **seguir sem migration** para o passo 4 |
| `before-commission-settings` (15 migrations) | o banco **não** está no estado anotado. Pare: publicar o alvo assim quebra cadastro de profissional e comissões. O caminho é o kit da 16 (`publicacao-regra-geral-comissoes-piloto.md`, passos 2 a 6, com janela combinada), em sessão própria e com autorização |
| `before-professional-commissions` ou 14 migrations | pare. A sequência é a da 15 e depois a da 16 (mesmo runbook, passo 1) |
| `divergente`, `BASELINE_FAILURES` com itens, ou `migration_history` | **não altere nada.** Guarde a saída, rode a consulta de impacto só leitura se o dono autorizar e investigue numa cópia (branch do Neon ou restauração de backup em PostgreSQL descartável). Não use `migration:run`, `migration:revert` nem `migration:show` no piloto |
| erro de destino ou TLS (`ERR_...` antes de conectar) | confira os Endpoint IDs e a URL. Nada foi lido |

### 4. Publicar a API no alvo

Em `agenda-cloud-piloto-api`: **Manual Deploy → Deploy a specific commit →
`5d74556e9e12e55f38e0056d0f19911f3e66f475`** (ou
`render deploys create <srv-api> --commit <sha> --wait --confirm`).

Depois de **Live**:

- o log do deploy mostra o SHA alvo;
- `curl -sS -o /dev/null -w "%{http_code}\n" "$API/"` dá `200`;
- `curl -sS -o /dev/null -w "%{http_code}\n" "$WEB/agenda_api/auth/me"` dá
  `401`;
- o dono entra pelo web atual (`8e8577d`), e a agenda e a tela de comissões
  de um profissional abrem;
- logs da API sem erro desde o Live.

Não grave nada para testar nesta etapa.

### 5. Publicar o web no alvo

Em `agenda-cloud-piloto-web`, o mesmo SHA. Depois de **Live**:

- `$WEB/login` dá `200`, e `$WEB/agenda_api/auth/me` sem cookie dá `401`;
- a origem nas escritas: o `POST $WEB/agenda_api/auth/logout` com
  `Origin: https://exemplo.invalid` dá `403`
  (`publicacao-piloto-render.md`, seção 7, passo 8);
- o Portal AC continua com o próprio manifest (`/portal/manifest.webmanifest`
  com 200);
- logs do web e da API sem erro desde o Live.

Rode de novo a fase `conferir` (passo 2.1). Esperado:
`after-commission-settings`.

### 6. Validação funcional das comissões

Use **somente** um estabelecimento de teste com o recurso de comissões,
escolhido pelo dono. Cada gravação é real e auditada. Antes, anote o estado
inicial: prints da tela de comissões de cada profissional usado e o total do
relatório de comissões do período.

Massa mínima: três profissionais ativos de teste (P1, P2 e P3), com pelo menos
uma exceção por serviço em P1 e em P2.

1. **Leitura.** Profissionais mostra o botão "Aplicar comissão a vários". As
   comissões de P1 mostram a regra geral, as exceções e a origem de cada
   serviço.
2. **Individual, manter.** Em P3, defina a regra geral e salve. Com exceção,
   a escolha padrão é "Manter" e as exceções continuam.
3. **Individual, remover.** Em P1:
   - escolha "Remover exceções por serviço";
   - confira a lista do que sai, confirme e use "Salvar e remover exceções";
   - todos os serviços passam a "regra geral".
   - Sem regra geral, remover fica indisponível.
4. **Em massa, PRESERVAR.** Alcance "Escolher" com P2 e P3:
   - a prévia mostra quem será alterado e quem será preservado;
   - aplique e confira o resultado por profissional;
   - as exceções de P2 continuam.
5. **Em massa, SUBSTITUIR + manter.** Mesmo alcance:
   - exige a caixa de confirmação;
   - a prévia diz "exceção mantida";
   - depois de aplicar, as exceções de P2 continuam e "Recebe comissão" fica
     ligado.
6. **Em massa, SUBSTITUIR + remover.** Só P2:
   - exige as duas confirmações;
   - a prévia diz "exceção será removida";
   - depois de aplicar, P2 fica sem exceções.
7. **Prévia desatualizada (opcional).** Gere a prévia, mude uma exceção de P2
   noutra aba e aplique. Esperado: aviso de prévia desatualizada e nova
   prévia, sem gravar nada.
8. **Histórico preservado.** O relatório de comissões do período tem o mesmo
   total e as mesmas linhas anotados antes: nenhuma apuração muda.
9. **Recusa.** Uma conta de gerente ou profissional, se houver no
   estabelecimento de teste, não vê nem consegue usar a comissão em massa.

Concluir atendimento para ver a apuração com a regra nova é **opcional** e
cria um registro financeiro permanente. Só faça com autorização expressa.

Ao terminar, devolva as configurações de teste ao que o dono quiser. As
exceções removidas não voltam sozinhas: recrie-as pela tela. O nome e o valor
de cada uma estão nos prints e na auditoria.

## Critérios de interrupção

Pare **antes** do deploy (nada a desfazer) quando:

- o Render não mostra API e web em `8e8577d`;
- a decisão de backup do passo 1 não foi tomada, ou a opção escolhida não
  validou;
- o passo 2 não dá exatamente o esperado.

Pare **depois** do deploy e avalie o rollback quando:

- a API ou o web não ficam Live (o Render mantém o anterior; nada a fazer
  além de investigar);
- `/` da API, `/login` ou `/agenda_api/auth/me` fogem do esperado;
- aparece erro 500 nos logs, nas comissões ou em outra área;
- a tela de comissões de um profissional não carrega com API e web no alvo;
- um item do passo 6 dá resultado diferente, especialmente:
  - exceções removidas sem confirmação ou de quem não estava no alcance;
  - regra de profissional fora do alcance alterada;
  - apuração antiga alterada (incidente de dados: não faça rollback às
    pressas; pare e investigue numa cópia).

## Rollback (compatível com o estado 16)

O schema não muda nesta publicação. O rollback é **só de código** e o banco
fica no estado 16.

- **Ordem:** primeiro o **web**, depois a **API**, os dois de volta a
  `8e8577d`, pelo **Rollback** do Render para os deploys anotados no passo 0
  (`publicacao-piloto-render.md`, seção 8). Depois, repita as verificações do
  passo 5 e a fase `conferir`.
- **Só o web com defeito:** volte só o web para `8e8577d`. O web anterior com
  a API nova funciona (ver "Compatibilidade"), sem as telas novas.
- **Nunca volte só a API e deixe o web novo:** a tela de comissões do
  profissional deixa de carregar.
- **Dados gravados pela versão nova continuam válidos** para a `8e8577d`: são
  configurações e regras nas mesmas tabelas. O rollback **não** restaura
  exceções removidas. Quem decide recriá-las é o dono, pela tela, com a
  auditoria como referência.
- **Nunca:**
  - voltar a API para `92cc6ae` ou `2656f69` (não respeitam o schema 16;
    ver "Voltar a API com o schema 16" no runbook da 16);
  - `migration:revert`;
  - restaurar backup por cima do piloto;
  - apagar apurações, configurações ou regras.
- **Corrigir para frente** é o caminho preferido para defeitos que não
  bloqueiam: commit novo, revisado, com CI verde, publicado na ordem API e
  depois web.

## Acompanhamentos conhecidos (não bloqueiam)

- `portal-instalavel-flow` falhou uma vez no CI (head `fd33111`) e passou
  nos heads seguintes. Fica em observação nos próximos PRs.
- Se a releitura depois de um 409 em "Comissão do profissional" falhar por
  rede, o cartão some com o erro e o botão "Tentar novamente", e o rascunho
  do cartão se perde. A perda não é silenciosa, o caminho já existia antes
  do PR #102 e fica fora deste escopo.
- O PR #101 (registros da 15 e da 16 e do C_final) continua aberto.
