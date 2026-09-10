# Runbook — Migration guardada em production (Lote 6B.2)

Este runbook cobre o workflow manual `.github/workflows/apply-lote6b2-production.yml`, que aplica **só** as duas migrations pendentes do Lote 6B.2 (`AllowUndefinedPlanPrice`, `InitialPlanCatalog`) no banco de production, com uma série de guardas automáticas antes de qualquer escrita. Ele **nunca** roda sozinho — alguém sempre dispara manualmente pela interface do GitHub, digitando uma confirmação exata.

**Este documento nunca contém, e nunca deve passar a conter, um valor real de credencial, URL de conexão, Endpoint ID ou senha.** Onde um valor real é necessário, o texto diz isso explicitamente e a ação fica para quem está operando, pela interface do GitHub — nunca aqui, nunca colado numa conversa com o Claude.

## 1. Criar o GitHub Environment `production`

1. No repositório, vá em **Settings → Environments → New environment**.
2. Nomeie exatamente `production` (o workflow referencia esse nome; um nome diferente quebra a associação com os secrets).
3. (Opcional, recomendado) Configure **required reviewers** — ver seção 3.

## 2. Adicionar os cinco secrets

Dentro do environment `production` criado acima, em **Environment secrets → Add secret**, crie estes cinco, um de cada vez:

| Nome | Conteúdo |
|---|---|
| `L6B2_PRODUCTION_DIRECT_URL` | URL de conexão **direta** (sem `-pooler` no host) do banco de production |
| `L6B2_BACKUP_DIRECT_URL` | URL de conexão **direta** do branch de backup do Neon |
| `L6B2_PRODUCTION_ENDPOINT_ID` | Endpoint ID (`ep-...`) correspondente à URL de production acima |
| `L6B2_BACKUP_ENDPOINT_ID` | Endpoint ID correspondente à URL de backup acima |
| `L6B2_VALIDATION_ENDPOINT_ID` | Endpoint ID de um terceiro branch/endpoint de validação, **distinto** dos dois acima |

Os três Endpoint IDs precisam ser **três valores diferentes entre si** — o script recusa a execução (`ERR_BACKUP_AS_PRODUCTION` / `ERR_VALIDATION_AS_PRODUCTION` / `ERR_ENDPOINTS_NOT_DISTINCT`) se dois deles forem iguais. Isso existe para pegar o erro mais perigoso possível: copiar/colar a URL errada e a "production" apontar, na prática, para o backup ou para o banco de validação.

Além dos cinco secrets, crie também, em **Environment variables** (não secret — é só um nome, não uma credencial):

| Nome | Conteúdo |
|---|---|
| `L6B2_BACKUP_BRANCH_NAME` | Nome do branch de backup no Neon (ex.: `backup-lote-6b2`) |

**Onde encontrar a URL direta e o Endpoint ID:** no painel do Neon, a URL "pooled connection" tem `-pooler` no host — **não é essa**; use a "direct connection". O Endpoint ID é o primeiro segmento do host (`ep-...`, antes do primeiro ponto).

**Nunca cole nenhum desses valores numa conversa com o Claude ou em qualquer outro chat/documento/ticket.** Se algum desses valores já foi exposto (colado num chat, num log, num commit, numa captura de tela), trate como comprometido: **rotacione imediatamente** pelo painel do Neon (gera uma nova senha/URL) e atualize o secret no GitHub com o novo valor.

## 3. Configurar aprovação manual (se disponível no seu plano do GitHub)

Em **Settings → Environments → production → Deployment protection rules**, se a opção estiver disponível:

1. Marque **Required reviewers** e adicione pelo menos uma pessoa (pode ser você mesmo, em repositório pessoal).
2. Isso faz o workflow **pausar** depois de disparado, esperando alguém aprovar a execução antes de rodar de fato — uma segunda checagem humana, independente da frase de confirmação.

Se seu plano do GitHub não tiver essa opção disponível para repositórios privados, a frase de confirmação exata (seção 4) continua sendo a barreira manual obrigatória.

## 4. Disparar o workflow

1. Confirme que `integration/nestjs-typeorm-frontend` está com tudo que você quer aplicado (o workflow recusa rodar de qualquer outra branch — `ERR_WRONG_BRANCH`).
2. Vá em **Actions → Apply Lote 6B.2 — guarded production migration → Run workflow**.
3. Selecione o branch `integration/nestjs-typeorm-frontend` no seletor.
4. No campo `confirmation`, digite **exatamente**:
   ```
   APLICAR_LOTE_6B2_PRODUCTION
   ```
   Maiúsculas, minúsculas e espaços importam — qualquer diferença é recusada (`ERR_CONFIRMATION_MISMATCH`), inclusive um espaço extra no fim.
5. Clique **Run workflow**. Se você configurou required reviewers (seção 3), aprove a execução quando solicitado.

## 5. Acompanhar — só resultados sanitizados

O log do workflow mostra só:

- nomes das guardas e `true`/`false` (`BASELINE_BACKUP: true`, `BASELINE_PRODUCTION_PRE: true`, etc.);
- nomes das migrations aplicadas;
- `RESULT: SUCCESS` ou `RESULT: FAILURE` + um `CODE:` sanitizado (ex.: `ERR_BASELINE_MISMATCH`).

**Nunca aparece** no log: URL, hostname, usuário, senha, Endpoint ID, query string ou stack trace bruto de erro de conexão — tudo isso é filtrado antes de qualquer `console.log` (ver `backend/scripts/lib/sanitize.ts`). Se você vir algo que parece um pedaço de connection string no log de qualquer execução, trate como incidente de segurança: pare, rotacione as credenciais envolvidas (Neon) e investigue antes de rodar de novo.

## 6. Parar diante de divergência

Se qualquer guarda de baseline falhar (`CODE: ERR_BASELINE_MISMATCH`), o workflow **já parou sozinho** — nenhuma migration foi aplicada. Não tente rodar de novo esperando um resultado diferente sem antes entender por quê:

1. Olhe qual checagem falhou (`BASELINE_BACKUP` ou `BASELINE_PRODUCTION_PRE` ou `BASELINE_PRODUCTION_POST`).
2. Investigue manualmente (fora deste workflow) o estado real do banco correspondente.
3. Só dispare de novo depois de entender e corrigir a causa raiz — nunca "tentar de novo" às cegas.

Se o resultado for `CODE: ERR_AMBIGUOUS_RESULT` (o `migration:run` terminou com um código de saída inesperado), o workflow **nunca tenta de novo sozinho** — isso é deliberado: um estado ambíguo em production (a migration pode ter aplicado parcialmente, ou falhado antes de começar) exige investigação humana antes de qualquer nova tentativa, nunca um retry automático que poderia aplicar a mesma coisa duas vezes ou piorar um estado já inconsistente.

## 7. Restaurar usando o backup

Este workflow **nunca escreve no backup** — ele só lê o backup (dentro de uma transação `READ ONLY`, sempre terminando em `ROLLBACK`) para confirmar que o baseline esperado bate antes de tocar em production. O backup existe para uma restauração manual, fora deste workflow, se algo em production precisar ser revertido:

1. Pelo painel do Neon, localize o branch de backup (`L6B2_BACKUP_BRANCH_NAME`).
2. Use o mecanismo de restore/branch-reset do próprio Neon para promover o backup ou criar um novo branch de production a partir dele — isso é uma operação do painel do Neon, não deste workflow.
3. Depois de qualquer restauração, rode o workflow de novo só depois de confirmar manualmente (fora deste processo) que o estado do banco está como esperado.

## 8. Regras de segurança — sempre

- **Nunca** cole nenhuma URL de conexão, senha, Endpoint ID ou qualquer outra credencial numa conversa com o Claude, em qualquer chat, PR, issue ou commit.
- **Nunca** armazene qualquer um desses valores num arquivo temporário, `.env` local não versionado incluso — se precisar copiar um valor de um lugar para o GitHub, faça direto, sem passar por um arquivo ou editor que possa manter histórico.
- Se qualquer credencial deste runbook for exposta (colada em algum lugar por engano, aparecer num log, num screenshot compartilhado) — **rotacione imediatamente** no painel do Neon e atualize o secret correspondente no GitHub. Não espere confirmar que houve uso indevido; trate exposição como comprometimento.
- Este workflow nunca roda em `push` ou `pull_request` — só `workflow_dispatch` manual, só a partir de `integration/nestjs-typeorm-frontend`.
