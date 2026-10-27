# Runbook — Publicar equipe e acessos no piloto (PRs #68 e #69)

Este runbook leva o piloto das sete migrations atuais até
`TeamAccess1792886400000` e depois publica a API e o web dos PRs #68 (API e
migration) e #69 (telas). Regras do lote em
`docs/plans/equipe-acessos-e-plano.md`.

> **Depois de 27/10/2026:** TeamAccess já está aplicada no piloto. O
> lançador passou a exigir `-Lote`; para repetir uma fase deste runbook (só
> `conferir` faz sentido agora), acrescente `-Lote equipe`. O próximo lote é
> `publicacao-acesso-recebimentos-piloto.md`.

## Estado em 27/10/2026

**Preparação concluída** (neste repositório, sem tocar no piloto):

- `integration/nestjs-typeorm-frontend` contém #67, #68 e #69 desde
  `b0539c57f244e127d9e08e6195a8fb69109bc196`.
- Procedimento versionado em `backend/scripts/`:
  - `abrir-equipe-piloto.ps1`: lançador (por `-File`);
  - `aplicar-equipe-piloto.mjs`: fases `preparar`, `aplicar` e `conferir`;
  - `conferir-restauracao-equipe.mjs`: fase `restauracao`;
  - `equipe-piloto.mjs`: regras puras (modo, comprovante, falha incerta);
  - `operacao-piloto.mjs` e `entrada-oculta.mjs`: as mesmas peças da
    publicação de contas (destino, TLS no socket, backup, entrada oculta).
- Levantamento do limite do plano em `backend/scripts/lib/equipe-acessos-schema.ts`.
- Ensaio completo contra PostgreSQL descartável (seção "Ensaio").

**Operação no piloto: nada executado.** Nenhuma conexão foi aberta com o
piloto, nenhum backup do piloto foi feito, **TeamAccess não foi aplicada** e
nada foi publicado no Render.

**A API nova só pode ser publicada depois de TeamAccess aplicada e conferida
(`ESTADO: after`).** Sem a migration, todo login na API nova responde 500
(ensaiado; ver "Compatibilidade").

### Auto-Deploy

- **Informado pelo usuário em 26/10/2026:** Auto-Deploy **Off** nos dois
  serviços (`agenda-cloud-piloto-api` e `agenda-cloud-piloto-web`). Não foi
  conferido no painel por quem escreveu este runbook.
- **Indício separado (registros de deployment do GitHub, 26/10/2026):** o
  último deploy dos dois serviços é `f37cbc9` (11:08 UTC). Os merges de #67
  (`fad3cc4`), #68 (`f6ccdb5`) e #69 (`b0539c5`) não geraram deployment.

Antes do passo 5, confira de novo no painel (Settings → Auto-Deploy) e em
Events qual commit está Live.

## O que publicar

O commit de `integration/nestjs-typeorm-frontend` que contiver este runbook.
Entre `b0539c5` e ele só mudam `backend/scripts/`, `backend/test/` e `docs/`;
o código da API e do web é o mesmo de `b0539c5`.

Use **o mesmo SHA** em todas as etapas. As fases recusam misturar commits:

- a fase `restauracao` recusa um backup feito com outro commit;
- a fase `aplicar` recusa um backup ou uma restauração de outro commit;
- use o mesmo SHA no deploy da API e do web.

## Pré-requisitos (uma vez)

- Windows Terminal (`wt.exe`). No console clássico, Ctrl+V não cola enquanto a
  entrada está oculta.
- Node 24.
- PostgreSQL para Windows com `pg_dump`, `pg_restore`, `initdb` e `pg_ctl`, em
  versão **igual ou maior que a do servidor do piloto** (o `pg_dump` recusa
  servidor mais novo). O padrão é `C:\Program Files\PostgreSQL\18\bin`; em outra
  pasta, use `-PgBin`. O PC de casa tem só o 17 (17.11). Se o piloto estiver no
  18, o `preparar` para em `ERR_BACKUP_FALHOU` antes de qualquer gravação;
  instale o 18.
- `openssl.exe` do Git para Windows (`C:\Program Files\Git\usr\bin`), só para o
  certificado do banco descartável da fase `restauracao`.
- Do gerenciador de senhas, os mesmos da publicação de contas:
  - a URL **direta** do piloto (host sem `-pooler`, banco `neondb`);
  - o Endpoint ID do piloto;
  - o Endpoint ID proibido (production).
- Pasta de operações `%USERPROFILE%\AgendaCloud-operacoes`, fora do repositório
  e de pastas sincronizadas. Guarda dumps completos do piloto, com hashes de
  senha. O ensaio usa outra pasta (`AgendaCloud-operacoes-ensaio`).

## Passo a passo

Cada passo depende do anterior. Qualquer `ERRO:` para o procedimento; então
vale a seção "Recuperação".

### 0. Pasta limpa do commit

A pasta precisa de `node_modules` próprio, **não** uma junção para o do clone
principal: remover um worktree com junção já apagou o `node_modules` do clone.

```powershell
git -C C:\Projetos\Agenda-Cloud fetch origin
git -C C:\Projetos\Agenda-Cloud worktree add --detach C:\Projetos\Agenda-Cloud-publicacao <sha>
cd C:\Projetos\Agenda-Cloud-publicacao\backend
npm ci
```

O lançador compila `dist-migrations` e `dist-scripts` a cada execução, sem rede.

### 1. Preparar: só leitura no piloto

```powershell
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File C:\Projetos\Agenda-Cloud-publicacao\backend\scripts\abrir-equipe-piloto.ps1 -Fase preparar -PilotEndpointId <ep-piloto> -ProductionEndpointId <ep-proibido>
```

A janela mostra `Modo: PILOTO (Neon real)`, a fase, o commit completo, a
pasta e a pasta de operações. Confira os quatro. Depois:

1. Cole a URL direta **uma vez** com Ctrl+V. Nada aparece na tela.
2. Pressione Enter uma vez.

Esperado:

```text
MODO: PILOTO (Neon real)
DESTINO_ENDPOINT_PILOTO: true
DIFERENTE_DO_PROIBIDO: true
--- PILOT_EXPECT=before-team-access
TLS_CLIENTE: TLSv1.3 hostname=ok cadeia=...
MIGRATIONS_APPLIED: 7
SCHEMA_OBJECTS_OK: 0/19
BASELINE_FAILURES: none
RESULT: SUCCESS
--- Limite de profissionais do plano (só leitura; nada é alterado)
ESTABELECIMENTOS: ...
ACIMA_DO_LIMITE_DE_PROFISSIONAIS: ...
BACKUP_OK: <bytes> bytes sha256=... tabelas=38
RESULTADO: preparado, nada gravado no banco
```

`before-team-access` exige o histórico com exatamente as sete migrations até
`AccountsAdministration1792800000000`, nenhuma coluna, constraint ou índice de
TeamAccess, e nenhum convite de `PROFISSIONAL` (a constraint nova o recusaria e
a migration falharia no meio). Os valores novos de enum não contam: o
PostgreSQL não os remove numa reversão.

A pasta `equipe-preparar-<horário>` recebe o dump, o `manifesto.json`
(contagens, um md5 por tabela, versão do servidor, histórico, cadeia TLS e
modo) e nenhum valor de linha.

### 2. Restauração: sem conexão com o piloto

```powershell
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File C:\Projetos\Agenda-Cloud-publicacao\backend\scripts\abrir-equipe-piloto.ps1 -Fase restauracao
```

Usa o backup `equipe-*` mais recente; para outro, `-Pasta <nome>`. Não pede URL
nem IDs. A fase:

1. recusa um backup de outra operação ou de outro commit;
2. confere o sha256 do dump;
3. cria um PostgreSQL descartável em `127.0.0.1`, só `hostssl`, com certificado
   gerado na hora (verificado) e senha aleatória;
4. restaura o dump numa transação e compara contagem e md5 de cada tabela com
   o manifesto;
5. roda `before-team-access` e o levantamento do limite na cópia;
6. aplica TeamAccess na cópia pelo mesmo código da fase `aplicar`;
7. roda `after-team-access` e confere que nada antigo mudou: md5 igual nas
   tabelas sem coluna nova; em `tenants`, `memberships` e `invites`, md5 igual
   das colunas antigas; todo vínculo `ACTIVE` sem autor de mudança; colunas
   novas vazias; levantamento igual ao de antes;
8. apaga o servidor e a cópia (também as sobras de uma execução interrompida).

Esperado:

```text
SHA256_CONFERE: true
CONTAGENS_IGUAIS: true
CONTEUDO_IGUAL_MD5: true
ENSAIO_BEFORE: ok
APLICADAS: TeamAccess1792886400000
ENSAIO_AFTER: ok
ENSAIO_DADOS_PRESERVADOS: true
ENSAIO_COLUNAS_ANTIGAS_IGUAIS: true (tenants,memberships,invites)
ENSAIO_VINCULOS_ATIVOS: <n>/<n>
ENSAIO_COLUNAS_NOVAS_VAZIAS: true
ENSAIO_LEVANTAMENTO_IGUAL: true
ENSAIO_HISTORICO_MAIS_UMA: true
DESCARTAVEL_APAGADO: true
RESULTADO: restauração conferida e TeamAccess1792886400000 ensaiada na cópia
```

Grava `restauracao-conferida.json` na pasta do backup, com o commit e o sha256
do manifesto. Sem ele, a fase `aplicar` não começa.

### 3. Aplicar: única etapa que escreve no piloto

Escolha um momento de pouco uso. A migration leva menos de um segundo, mas
precisa de lock exclusivo curto em `tenants`, `memberships` e `invites`, e as
chaves estrangeiras novas bloqueiam por um instante gravações em `users` e
`professionals`. Se uma requisição segurar uma dessas tabelas, a migration
desiste em 10 s (`lock_timeout`) e o banco desfaz tudo.

```powershell
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File C:\Projetos\Agenda-Cloud-publicacao\backend\scripts\abrir-equipe-piloto.ps1 -Fase aplicar -PilotEndpointId <ep-piloto> -ProductionEndpointId <ep-proibido>
```

A sequência é esta:

1. Antes de pedir a URL, o script recusa se uma execução anterior começou a
   migration e não teve desfecho (`ERR_RESULTADO_ANTERIOR_INCERTO`; ver
   "Resultado incerto") e exige um backup da fase `preparar` com a restauração
   conferida: mesmo modo, endpoint e commit, dump e manifesto inalterados, de
   até 24 h.
2. Repete destino, TLS, `before-team-access` e o levantamento.
3. Faz um **backup novo**, o ponto de recuperação imediatamente anterior, e
   confere que ele vem do mesmo servidor do backup conferido (mesma raiz TLS,
   versão e histórico). Um comprovante feito no ensaio nunca passa aqui.
4. Pede a frase. Confira `RESULT: SUCCESS`, `BACKUP_OK` e
   `MESMO_SERVIDOR_DO_BACKUP_CONFERIDO: sim`, e digite:

   ```text
   APLICAR TeamAccess1792886400000
   ```

5. Registra `migration_iniciada` e aplica só a pendente esperada, numa
   transação, com `lock_timeout` de 10 s e `statement_timeout` de 120 s. O
   histórico precisa ser exatamente as sete migrations, e o build, exatamente
   essas mais TeamAccess; senão, para antes de escrever.
6. Roda `after-team-access`.

Esperado:

```text
PENDENTE: TeamAccess1792886400000
APLICADAS: TeamAccess1792886400000
SESSAO_DA_MIGRATION: mesma=true lock_timeout=10s
COMMIT: ok
MIGRATION_APLICADA: TeamAccess1792886400000 em <horário>
--- PILOT_EXPECT=after-team-access
MIGRATIONS_APPLIED: 8
SCHEMA_OBJECTS_OK: 19/19
BASELINE_FAILURES: none
RESULT: SUCCESS
RESULTADO: TeamAccess1792886400000 aplicada e conferida
```

`CONTAGENS_DESDE_O_BACKUP` só informa. A API atual continua no ar e pode gravar
durante a operação; diferença de contagem ali é uso normal, não perda.

Duas mensagens finais são diferentes e não pedem a mesma ação:

| Mensagem | Significado | Ação |
| --- | --- | --- |
| `RESULTADO: ... aplicada e conferida` | migration gravada e `after` ok | seguir para o passo 5 |
| `RESULTADO: ... FOI APLICADA (COMMIT confirmado), mas a conferência posterior falhou` | a migration **está** gravada; só a leitura depois falhou | **não** rode `aplicar` de novo; rode `conferir` |

Opcional: rode `restauracao` de novo. Ela confere o backup novo, o
`equipe-aplicar-*` mais recente.

### 4. Conferir: só leitura, quando quiser

```powershell
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File C:\Projetos\Agenda-Cloud-publicacao\backend\scripts\abrir-equipe-piloto.ps1 -Fase conferir -PilotEndpointId <ep-piloto> -ProductionEndpointId <ep-proibido>
```

Identifica o estado sem gravar nada no banco:

| Saída | Significado |
| --- | --- |
| `ESTADO: before` | TeamAccess **não** aplicada |
| `ESTADO: after` | TeamAccess aplicada e conferida; lista também `REVERSAO_AFETARIA_*` |
| `ESTADO: divergente` | nem before nem after: não aplique nem publique; investigue |
| `ERRO: ERR_CONFERENCIA_SEM_LEITURA` | uma conferência não chegou a ler o banco (conexão/TLS); repita |
| `SESSOES_DA_MIGRATION_ATIVAS: n>0` | a migration ainda está rodando no banco; espere e repita |

Também mostra o levantamento do limite do plano.

### 5. Publicar a API

Só depois de `ESTADO: after` (ou `aplicada e conferida`).

No Render, serviço `agenda-cloud-piloto-api`:

1. **Manual Deploy → Deploy a specific commit → `<sha>`**.
2. Espere ficar **Live**.
3. Confira:
   - `GET $API/` dá `200`;
   - `GET $WEB/agenda_api/auth/me` sem cookie dá `401`;
   - entrar com a conta do dono funciona (com o web atual).

Não há variável nova.

### 6. Publicar o web

Serviço `agenda-cloud-piloto-web`, mesmo `<sha>`. Depois:

1. `/login` responde `200`.
2. Entre como dono: **Equipe e acessos** mostra vagas e profissionais.
3. Entre como `MASTER_OWNER`: **Administração → Estabelecimentos → ficha**
   mostra situação, plano e uso.

Não crie estabelecimento de teste no piloto, e não convide funcionário real
só para testar: o convite ocupa vaga.

### 7. Limpeza

- Feche as janelas do procedimento.
- `git -C C:\Projetos\Agenda-Cloud worktree remove C:\Projetos\Agenda-Cloud-publicacao`.
- Mantenha a pasta de operações. Apague dumps antigos quando não precisar mais
  deles; eles têm hashes de senha.

## Estabelecimentos acima do limite do plano

O levantamento roda nas fases `preparar`, `restauracao`, `aplicar` e
`conferir`. É **só leitura**: não suspende, não exclui e não altera
profissional, vínculo ou convite. Usa a mesma regra da aplicação:

- limite: `plans.max_professionals` do plano do estabelecimento. É `NOT NULL`
  no schema e o catálogo tem 2, 5 e 20; **não existe plano sem limite**;
- profissionais ativos: `professionals.active = true`
  (`professionals.service.ts`);
- vagas de funcionário: vínculos `PROFISSIONAL` ativos + convites de
  `PROFISSIONAL` pendentes e no prazo (`team/seats.ts`). Antes da migration,
  todo vínculo conta como ativo, porque é isso que a migration grava.

Saída: totais (`ACIMA_DO_LIMITE_DE_PROFISSIONAIS`, `NO_LIMITE_DE_PROFISSIONAIS`,
`VAGAS_DE_FUNCIONARIO_ACIMA_DO_LIMITE`, `VINCULOS_POR_PAPEL`,
`FUNCIONARIOS_SEM_PROFISSIONAL`) e, para cada estabelecimento acima do limite
(até 50), só `tenant`, `slug`, situação, plano, limite e as duas contagens.
Nenhum nome de pessoa, cliente, telefone ou e-mail.

O que a API nova faz com quem está acima (já implementado em #68):

- continua operando: agenda, clientes, reservas e profissionais existentes
  não mudam;
- não cria nem reativa profissional até caber: `409 LIMITE_DE_PROFISSIONAIS`;
- não convida funcionário sem vaga livre: `LIMITE_DO_PLANO`;
- a troca para um plano menor é recusada com o detalhe do excesso
  (`PLANO_EXCEDIDO`).

Vínculos `GERENTE` e `RECEPCIONISTA` aparecem em `VINCULOS_POR_PAPEL`. Eles já
não tinham acesso operacional na API atual (ensaio: agenda geral 403) e, no web
novo, ficam só com "Minha conta". `FUNCIONARIOS_SEM_PROFISSIONAL` são vínculos
`PROFISSIONAL` sem profissional ligado: a API nova não lhes mostra agenda.

## Códigos de parada

| Código | Fase | Significado | Gravou algo no piloto? |
| --- | --- | --- | --- |
| `ERR_URL_*`, `ERR_ENDPOINT_*`, `ERR_POOLER`, `ERR_HOST_NAO_NEON`, `ERR_BANCO_DIFERENTE_DE_NEONDB`, `ERR_TLS_AFROUXADO` | todas | URL recusada antes da rede | não |
| `ERR_AJUSTE_DE_ENSAIO_NO_PILOTO`, `ERR_CA_EXTRA_NO_PILOTO`, `ERR_OPCOES_DO_NODE_NO_PILOTO`, `ERR_ENDPOINT_DE_ENSAIO_NO_PILOTO` | todas | resto de ensaio no modo piloto | não |
| `ERR_CERTIFICADO_NAO_CONFIAVEL`, `ERR_HOSTNAME_DO_CERTIFICADO`, `ERR_CONEXAO_SEM_TLS` | todas | TLS não comprovado | não |
| `ERR_SEM_CONEXAO`, `ERR_CONFERENCIA_SEM_LEITURA` | todas | banco inalcançável ou não lido | não |
| `ERR_TERMINAL_NAO_INTERATIVO` | todas | rodado fora de um terminal interativo | não |
| `ERR_BACKEND_COM_ALTERACOES_LOCAIS` | preparar, restauracao, aplicar | a pasta tem alteração em `backend/` | não |
| `ERR_BUILD_AUSENTE`, `ERR_BUILD_DESATUALIZADO` | todas | build não feito ou de outra migration | não |
| `ERR_ESTADO_ANTES_DIVERGENTE` | preparar, aplicar | o piloto não está em `before` | não |
| `ERR_TEAMACCESS_JA_APLICADA` | preparar, aplicar | o piloto já está em `after` | não |
| `ERR_BACKUP_FALHOU`, `ERR_BACKUP_VAZIO` | preparar, aplicar | `pg_dump` falhou (ex.: versão menor que a do servidor) | não |
| `ERR_BACKUP_DE_OUTRO_COMMIT`, `ERR_BACKUP_DE_OUTRA_OPERACAO`, `ERR_PG_RESTORE`, `ERR_RESTAURACAO_DIFERENTE_DO_MANIFESTO`, `ERR_ENSAIO_*` | restauracao | backup não serve ou a migration mudou dados na cópia | não (só no descartável) |
| `ERR_SEM_BACKUP_COM_RESTAURACAO_CONFERIDA` | aplicar | falta o passo 2 para este commit, modo e endpoint; `BACKUP_CONFERIDO:` diz o motivo | não |
| `ERR_BACKUP_CONFERIDO_DE_OUTRO_SERVIDOR` | aplicar | o backup conferido não é deste servidor | não |
| `RESULTADO: abortado, nada gravado` | aplicar | frase vazia ou diferente | não |
| `ERR_HISTORICO_DE_MIGRATIONS_INESPERADO`, `ERR_MIGRATIONS_COMPILADAS_INESPERADAS` | aplicar | haveria outra migration além de TeamAccess | não |
| `ERR_MIGRATION_FALHOU` | aplicar | o banco recusou (ex.: `55P03` lock timeout) e `before` foi confirmado intacto | não |
| `ERR_RESULTADO_INCERTO` | aplicar | conexão perdida depois do início | **talvez**: rode `conferir` |
| `ERR_RESULTADO_ANTERIOR_INCERTO` | aplicar | há execução sem desfecho no registro | não |

## Resultado incerto

Se a conexão cair perto do COMMIT, o banco pode ter gravado a migration sem que
o script saiba. O ensaio provou isso: com a conexão derrubada logo depois do
COMMIT, o script recebeu erro e o banco tinha as oito migrations. Por isso:

1. O script **nunca** conclui "nada aplicado" depois de uma queda: registra
   `resultado_incerto` e mostra `NAO_REPITA`.
2. A próxima fase `aplicar` para em `ERR_RESULTADO_ANTERIOR_INCERTO`, antes de
   pedir a URL. O mesmo vale se a janela for fechada no meio
   (`migration_iniciada` sem desfecho).
3. Rode `conferir`. Só uma `conferir` posterior com `ESTADO: before` ou
   `ESTADO: after` e `SESSOES_DA_MIGRATION_ATIVAS: 0` libera o registro.
   - `ESTADO: after`: a migration entrou. Siga para o passo 5. `aplicar` recusa
     reaplicar (`ERR_TEAMACCESS_JA_APLICADA`).
   - `ESTADO: before`: nada entrou. Pode repetir `aplicar` em outro momento.
   - `divergente` ou `SESSOES_DA_MIGRATION_ATIVAS` acima de 0: não faça nada;
     espere, repita `conferir` e investigue.

O registro fica em `%USERPROFILE%\AgendaCloud-operacoes\operacoes.jsonl`.

## Compatibilidade

Ensaio de 27/10/2026, com as duas APIs contra o banco do ensaio já migrado e
com estados que só a API nova grava (funcionário suspenso, funcionária ativa
com "iniciar" liberado, estabelecimento arquivado, outro suspenso, convite de
funcionário pendente):

| Combinação | Situação | Base |
| --- | --- | --- |
| API atual (`f37cbc9`) + schema antigo | estado de hoje | — |
| API atual + schema novo | funciona | login, `/auth/me`, agenda geral (6 itens), serviços, criar profissional, administração (lista, ficha, histórico, usuários, convites), agendamento público; nenhum erro no log |
| API nova + schema antigo | **não publicar** | todo login responde 500: `column Membership.status does not exist` |
| API nova + schema novo | alvo | suíte de CI de #68 e #69 e o ensaio abaixo |
| web novo + API atual | evitar | o web novo chama rotas que a API atual não tem (`/team` → 404) |

Por isso a ordem é: **backup e restauração conferidos → `before-team-access` →
migration → `after-team-access` → API → web**, todos do mesmo SHA.

## Recuperação

**Regra geral:** não apague contas, vínculos, convites nem histórico. Nenhuma
situação abaixo pede `migration:revert` nem restaurar o backup por cima do
piloto.

- **Falha em `preparar` ou `restauracao`.** Nada foi gravado no piloto.
  Corrija a causa e repita.
- **`ERR_MIGRATION_FALHOU`.** O banco desfez a transação e `before` foi
  confirmado. A API atual segue funcionando. Repita `aplicar` em outro momento.
- **`ERR_RESULTADO_INCERTO`, janela fechada no meio ou
  `ERR_RESULTADO_ANTERIOR_INCERTO`.** Ver "Resultado incerto".
- **Aplicada, mas a conferência posterior falhou.** A migration está gravada.
  Rode `conferir`. Com `ESTADO: after`, siga. Não rode `aplicar` de novo (ele
  recusa).
- **Deploy da API falhou antes de ficar Live.** O Render mantém a API atual,
  que funciona com o schema novo. Investigue e publique de novo.
- **API nova Live com defeito: voltar para `f37cbc9` funciona, mas não é um
  retorno seguro por muito tempo.** O ensaio mostrou o que a API antiga faz com
  os dados novos:
  - **continua bloqueado:** estabelecimento suspenso ou arquivado fica fora da
    sessão do dono e do agendamento público (404); conta bloqueada continua
    bloqueada;
  - **volta a valer o que deveria estar bloqueado:** funcionário com acesso
    **suspenso** volta a entrar e a sessão mostra o estabelecimento (nome,
    slug, plano). Todas as rotas operacionais respondem 403 (agenda geral,
    serviços, profissionais, solicitações), então ele não lê dados, mas o
    acesso suspenso deixa de estar cortado;
  - **deixa de funcionar:** funcionário ativo perde "Minha agenda" (404);
  - **limite do plano some:** o dono cria profissional acima do limite (201 num
    plano de 2 com 3 ativos);
  - **convite de funcionário vira vínculo errado:** a API antiga aceita um
    convite de funcionário criado pela API nova e cria vínculo `PROFISSIONAL`
    **sem profissional** e sem conferir vaga. Quando a API nova volta, esse
    vínculo ocupa vaga e não tem agenda; o dono precisa remover o acesso e
    convidar de novo.

  Portanto: volte o **web junto** (o web novo depende das rotas novas), fique
  o menor tempo possível e, depois, confira em "Equipe e acessos" vínculos sem
  profissional, profissionais acima do limite e acessos que deveriam estar
  suspensos. Não ensaiado: revogar os convites de funcionário pendentes pela
  administração da API antiga antes de voltar.
- **Web novo com defeito.** Volte só o web para `f37cbc9`; as telas de equipe
  somem até a correção. Não ensaiado: web antigo com a API nova; confira login
  e agenda do dono logo depois.
- **`reserva/api-cadastro-fechado`** não é recuperação deste lote: é baseada
  em `35f4713`, anterior a AccountsAdministration, e não foi avaliada contra o
  schema novo. Preserve a branch e nunca a mescle na integration.

**`migration:revert`: não use.** O `down` apaga `memberships.status` (todas as
suspensões de acesso), `invites.professional_id` (a ligação dos convites de
funcionário) e `tenants.restore_status`. Os valores novos de enum ficam, e um
estabelecimento `ARCHIVED` continua fora de operação. Com a API nova no ar,
todo login passa a responder 500. `conferir` mostra `REVERSAO_AFETARIA_*` com
o que se perderia.

**Restaurar o backup:** nunca por cima do piloto. Isso apagaria tudo o que foi
gravado depois do ponto de recuperação. Para consultar o estado anterior, use a
fase `restauracao` (descartável) ou um branch novo do Neon, com decisão
explícita.

## Ensaio (27/10/2026)

Nada foi executado contra o Neon, o piloto ou `agenda_dev`, e nenhum `.env` foi
lido (`IGNORE_DOTENV_FILE=true`).

### Ambiente

- PostgreSQL 17.11 descartável em `127.0.0.1`, só `hostssl` com
  `scram-sha-256`, certificado de uma CA descartável para o host fictício
  `ep-ensaio-piloto-111.c-2.us-east-1.aws.neon.tech`.
- Banco `neondb` com dono não superusuário (`neondb_owner`).
- As sete migrations aplicadas pelo runtime compilado.
- Dados: três estabelecimentos (um acima do limite: plano de 2 com 3
  profissionais ativos e 1 inativo; um em TRIAL; um suspenso), dono, vínculo
  `PROFISSIONAL` antigo, gerente, conta de plataforma, convites pendente,
  aceito, revogado e de plataforma, agenda com cliente, sessões e histórico.
- Procedimento no commit `2069214e2894daa91e3a9865dd2806ad8013ef25` (os
  scripts não mudam depois dele), pasta `node_modules` própria do clone.
- API `f37cbc9` num worktree próprio com `npm ci` (sem junção), removido no fim.

### Modo ensaio e harness

O modo ensaio é parte do procedimento: `-Ensaio -EnsaioCa <ca>` no lançador.
O script conecta em `127.0.0.1`, confere o certificado pelo host da URL e confia
só na CA dada. Destino, TLS no socket, banco, histórico, comprovante e frase
rodam como no piloto.

Um harness fora do repositório, carregado por `--import`, simulou o terminal
(uma entrada por leitura) e derrubou conexões nos casos de queda. O modo piloto
recusa `--import` (`ERR_OPCOES_DO_NODE_NO_PILOTO`), então o harness não roda
contra o piloto.

### Resultados

| Caso | Resultado |
| --- | --- |
| `preparar` | `before` SUCCESS (7, 0/19); levantamento: 1 acima do limite; backup de 132 KB, 38 tabelas, 90 linhas |
| `restauracao` | contagens e md5 iguais nas 38 tabelas; TeamAccess na cópia; colunas antigas iguais; 5/5 vínculos ativos; levantamento igual; descartável apagado |
| `aplicar` sem restauração conferida / sem backup | `ERR_SEM_BACKUP_COM_RESTAURACAO_CONFERIDA` antes da URL |
| backup ou restauração de outro commit | `restauracao`: `ERR_BACKUP_DE_OUTRO_COMMIT`; `aplicar`: recusado |
| dump alterado; manifesto editado à mão (modo trocado) | recusados (`dump alterado`; `manifesto alterado depois da conferência`) |
| modo piloto com o comprovante do ensaio | recusado (`backup do modo ensaio, outro endpoint`) |
| modo piloto com CA do ensaio, `NODE_EXTRA_CA_CERTS`, `--import` ou endpoint `ep-ensaio-` | recusado antes da URL |
| outro endpoint, proibido no host ou em `options`, pooler, `sslmode=no-verify`, `uselibpqcompat`, `agenda_dev`, URL vazia, URL com `psql` | recusados antes da rede |
| CA errada | `ERR_CERTIFICADO_NAO_CONFIAVEL` |
| frase vazia / diferente | abortado, nada gravado (7 migrations) |
| outra sessão segurando `memberships` | `55P03` em 11 s; `before` intacto; `ERR_MIGRATION_FALHOU` |
| conexão derrubada antes do último comando | `ERR_RESULTADO_INCERTO`; `aplicar` seguinte bloqueado; `conferir`: `before` (nada entrou) |
| `aplicar` | só TeamAccess; `after` SUCCESS (8, 19/19); dados iguais fora das três tabelas; 5/5 vínculos ativos |
| `aplicar` de novo | `ERR_TEAMACCESS_JA_APLICADA` |
| `conferir` after | `ESTADO: after`, `REVERSAO_AFETARIA_*` = 0 |
| conexão derrubada logo depois do COMMIT | `ERR_RESULTADO_INCERTO`; o banco tinha 8 migrations; `aplicar` bloqueado; `conferir`: `after`; `aplicar` depois: `ERR_TEAMACCESS_JA_APLICADA` |
| COMMIT ok e conferência posterior sem conexão | `FOI APLICADA ... conferência posterior falhou`, saída 2; `aplicar`: recusa; `conferir`: `after` |
| banco fora do ar | `conferir`: `ERR_SEM_CONEXAO`; `preparar`: `ERR_CONFERENCIA_SEM_LEITURA`, sem gravar |
| `migration:revert` seguido de nova aplicação | `down` e reaplicação ok (valores de enum já existentes) |
| lançador: ID inválido, `-Ensaio` sem CA | recusa antes de rodar |
| lançador piloto com `NODE_EXTRA_CA_CERTS` e `NODE_OPTIONS` herdados | removidos pelo lançador; o script seguiu até a entrada oculta |
| lançador pelo `wt.exe`, fase `restauracao`, modo ensaio | conferência gravada em `operacoes.jsonl` |

### Outros resultados

- Nenhuma senha apareceu na saída, em `operacoes.jsonl` ou nos manifestos.
- Nenhum processo ou pasta descartável sobrou.
- `equipe-piloto.spec.ts`, `operacao-piloto.spec.ts` e `entrada-oculta.spec.ts`:
  103 testes. `pilot-accounts-check.db-e2e-spec.ts` ganhou o levantamento
  contra o PostgreSQL descartável do CI. `oxlint` sem avisos.
- A entrada oculta é a mesma da promoção MASTER_OWNER e da publicação de
  contas. As colagens reais no Windows Terminal foram ensaiadas lá e não foram
  repetidas aqui; neste lote nenhuma janela pediu URL real.

### Limitações

- PostgreSQL 17.11 no ensaio. A versão do servidor do piloto não foi lida.
- A queda "perto do COMMIT" foi simulada no cliente (socket derrubado), não por
  falha de rede real do Neon.
- Os estados novos da compatibilidade foram gravados por SQL igual ao da API
  nova, não pelas telas.
