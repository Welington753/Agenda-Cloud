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
- Console do Neon com permissão para criar branches no projeto do piloto
  (passo 1).
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

### 1. Ponto de recuperação: branch do Neon

**Decisão (09/11/2026): branch do Neon.** Antes da publicação, cria-se uma branch do
Neon com dados e estrutura do piloto. O kit da 16 não muda: a fase `preparar`
continua recusando o estado 16 (`ERR_MIGRATION_JA_APLICADA`) e não é usada
aqui. Os backups de 09/11 ficam no PC do trabalho, são de **antes** da 16 e
servem só para consulta.

Esta publicação não escreve no schema. A branch protege contra gravações
erradas da API nova (por exemplo, exceções removidas por engano). Não é
pré-requisito de migration.

Faça os passos 1, 2 e 3 em sequência, sem pausa longa antes do passo 4. Criar
a branch é uma escrita no **projeto** do Neon, não nos dados do piloto, e
precisa de autorização do dono na hora.

**1.1 Confirmar projeto e origem (só leitura, console do Neon).**

- O projeto aberto é o do piloto. O Endpoint ID da branch padrão é
  `<ep-piloto>`, e nenhum endpoint do projeto é `<ep-proibido>`.
- Anote a **branch de origem**: a branch padrão do projeto, onde está o
  endpoint `<ep-piloto>`. Anote o nome e o ID. Não presuma o nome; confira
  no console.
- Em **Settings**, anote o plano do projeto e a janela de histórico
  (*history window* / *instant restore*). No Free, o padrão é 6 h.
- Em **Billing** / **Usage**, anote quantas branches existem, o limite do
  plano e se uma branch nova gera cobrança. Se o console indicar custo que
  o dono não autorizou, ou se o limite de branches estiver esgotado, **pare**.
  Não apague branch antiga para abrir espaço sem decisão do dono.

**1.2 Criar a branch (escrita no projeto, com autorização).**

Em **Branches → New branch**:

- **Parent:** a branch de origem anotada em 1.1.
- **Dados:** o ponto atual (*Current point in time* / *head*), com dados.
  **Nunca** *Schema only* e nunca um horário passado.
- **Nome:** `pre-publicacao-5d74556-AAAAMMDD-HHMM`, com a hora em UTC.
- **Compute:** crie com compute (o tamanho mínimo basta). Ele é necessário
  para conferir a branch.
- **Expiração:** deixe **sem expiração**. A branch precisa existir durante
  toda a validação e no período de observação depois dela (veja 1.4).

Anote na pasta de operações deste computador (`AgendaCloud-operacoes`),
**nunca no repositório, num PR ou numa conversa**:

- ID do projeto, nome e ID da branch de origem;
- nome e ID da branch nova, e o Endpoint ID dela (`<ep-backup>`);
- o horário de criação em UTC e o ponto de origem que o console mostrar
  (horário e, se aparecer, o LSN);
- o plano, a janela de histórico e o que o console disse sobre custo.

`<ep-backup>` precisa ser diferente de `<ep-piloto>` e de `<ep-proibido>`.
Se não for, pare.

**1.3 Conferir que a branch está acessível e no estado 16 (só leitura).**

Em Git Bash, na worktree do alvo. A conferência abre uma transação
`READ ONLY` e termina com `ROLLBACK`, então não grava nada:

```bash
cd /c/Projetos/Agenda-Cloud-publicacao-5d74556/backend
read -rs PILOT_DIRECT_URL && export PILOT_DIRECT_URL   # cole a URL direta DA BRANCH NOVA, Enter (não ecoa)
export PILOT_ENDPOINT_ID=<ep-backup> PRODUCTION_ENDPOINT_ID=<ep-proibido>
PILOT_EXPECT=after-commission-settings npm run pilot:check-database
unset PILOT_DIRECT_URL PILOT_ENDPOINT_ID
```

`PILOT_ENDPOINT_ID` recebe aqui o endpoint **da branch**. A guarda compara a
URL com esse ID e recusa a conexão se a URL for de outro endpoint.

O esperado é o mesmo do passo 2.2: `TARGET_ENDPOINT_MATCH: true`,
`DISTINCT_FROM_PRODUCTION: true`, `TLS_VERIFICATION: true`,
`MIGRATIONS_APPLIED: 16`, `SCHEMA_OBJECTS_OK: 7/7`,
`BASELINE_FAILURES: none`, `RESULT: SUCCESS`.

Se a branch não conectar ou não der o esperado, pare. Sem ponto de
recuperação conferido, não há deploy.

Não rode a fase `conferir` do kit contra a branch: ela grava no
`operacoes.jsonl` como se fosse o piloto.

**1.4 Preservar a branch.**

- A API e o web **nunca** apontam para ela.
- Nenhum teste que grave dados usa a branch, incluindo o passo 6.
- Não use *Reset from parent* nela: isso trocaria o ponto de recuperação
  pelo estado atual do piloto.
- Mantenha a branch durante toda a publicação e por pelo menos 7 dias depois
  do passo 6 sem incidente. Só o dono decide quando apagá-la. Se preferir
  expiração automática, defina-a só depois desse prazo (o Neon aceita no
  máximo 30 dias à frente).
- O compute da branch pode ficar suspenso; ele volta sozinho na próxima
  conexão. Se o plano cobrar por compute ou por branch, combine com o dono
  quanto tempo manter.

**Retenção, para registro.** Segundo a documentação do Neon (consultada em
09/11/2026; confira no console):

- A branch guarda os dados do ponto de origem enquanto existir,
  independentemente da janela de histórico do projeto.
- Expiração só existe se for definida; por padrão, não há.
- A janela de histórico (6 h no Free) vale para o restauro instantâneo e
  não substitui a branch.

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

Grave **somente** no estabelecimento de teste que o dono identificou e
autorizou para esta validação. Anote o nome dele na pasta de operações antes
de começar. Nenhuma escrita em outro estabelecimento e nenhuma escrita na
branch do passo 1. Cada gravação é real e auditada. Antes, anote o estado
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

**Fora da validação inicial:** concluir atendimento para ver a apuração com
a regra nova. Isso cria comissão permanente (registro financeiro que não se
edita). Fica para uma etapa posterior, com autorização expressa do dono.

Ao terminar, devolva as configurações de teste ao que o dono quiser. As
exceções removidas não voltam sozinhas: recrie-as pela tela. O nome e o valor
de cada uma estão nos prints e na auditoria.

## Critérios de interrupção

Pare **antes** do deploy (nada a desfazer) quando:

- o Render não mostra API e web em `8e8577d`;
- o projeto ou a branch de origem não conferem, a branch do passo 1 não foi
  criada, ou a conferência dela (1.3) não deu o esperado;
- a branch geraria custo não autorizado, ou o limite de branches do plano
  está esgotado;
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
  auditoria e a branch do passo 1 como referência (veja "Recuperar dados da
  branch").
- **Nunca:**
  - voltar a API para `92cc6ae` ou `2656f69` (não respeitam o schema 16;
    ver "Voltar a API com o schema 16" no runbook da 16);
  - `migration:revert`;
  - restaurar backup por cima do piloto;
  - apagar apurações, configurações ou regras.
- **Corrigir para frente** é o caminho preferido para defeitos que não
  bloqueiam: commit novo, revisado, com CI verde, publicado na ordem API e
  depois web.

## Recuperar dados da branch (sem sobrescrever o piloto)

A branch do passo 1 é **fonte de consulta**. O piloto continua recebendo
uso real depois dela, e trocar o piloto pela branch apagaria esse uso.

**Nunca**, no piloto ou na branch padrão do projeto:

- *Restore* / *Reset from parent* / restaurar a partir da branch do passo 1;
- promover a branch do passo 1 a padrão ou apontar a API para ela;
- `pg_restore`, `pg_dump` ou SQL de escrita copiado da branch.

**Caminho:**

1. No piloto, pela auditoria (`COMMISSION_RULE_CHANGED`) do estabelecimento
   de teste, identifique o que mudou por engano: profissional, serviço e
   horário.
2. Na branch, leia os valores anteriores **só leitura**, filtrando pelo
   estabelecimento. Use o SQL Editor do console com a branch do passo 1
   selecionada (confira o nome no seletor antes de rodar) ou `psql` em
   modo só leitura:

   ```bash
   read -rs BACKUP_URL   # URL direta DA BRANCH DO PASSO 1, Enter (não ecoa)
   PGOPTIONS='-c default_transaction_read_only=on' "<pasta bin>/psql" "$BACKUP_URL"
   unset BACKUP_URL
   ```

   Consultas só com `SELECT` em `professional_commission_settings` e
   `commission_rules`, sempre com `WHERE tenant_id = '<id do estabelecimento de teste>'`.
   Não copie a saída para o repositório, um PR ou uma conversa.
3. O dono recria os valores **pela tela**, como dono. Cada gravação passa
   pela API, pelas permissões e pela auditoria.
4. Se o volume ou a natureza do problema não couber na tela (por exemplo,
   apuração alterada), pare. Corrigir dados por SQL exige plano escrito,
   ensaio numa cópia descartável e autorização, em sessão própria.

## Acompanhamentos conhecidos (não bloqueiam)

- `portal-instalavel-flow` falhou uma vez no CI (head `fd33111`) e passou
  nos heads seguintes. Fica em observação nos próximos PRs.
- Se a releitura depois de um 409 em "Comissão do profissional" falhar por
  rede, o cartão some com o erro e o botão "Tentar novamente", e o rascunho
  do cartão se perde. A perda não é silenciosa, o caminho já existia antes
  do PR #102 e fica fora deste escopo.
- O PR #101 (registros da 15 e da 16 e do C_final) continua aberto.
