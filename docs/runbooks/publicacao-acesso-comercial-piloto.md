# Runbook — Publicar planos e validade do acesso no piloto (PR #82)

Este runbook leva o piloto das onze migrations atuais até
`CommercialAccess1793232000000` e depois publica a API e o web do PR #82.
Regras do lote em `docs/plans/planos-e-validade-do-acesso.md`; estado entre
sessões em `continuidade-acesso-comercial-piloto.md`.

`docs/runbooks/migrations-production.md` **não** serve para esta migration:
ele cobre só as duas migrations do Lote 6B.2, por um workflow próprio.

## Estado em 02/11/2026

**Preparação concluída** neste repositório, sem tocar no piloto:

- Procedimento em `backend/scripts/`, no mesmo molde de TeamAccess e
  TeamManagerAccess e com as mesmas peças comuns (`operacao-piloto.mjs`,
  `entrada-oculta.mjs`, `equipe-piloto.mjs`):
  - `abrir-comercial-piloto.ps1`: lançador (por `-File`);
  - `aplicar-comercial-piloto.mjs`: fases `preparar`, `aplicar` e `conferir`;
  - `conferir-restauracao-comercial.mjs`: fase `restauracao`;
  - `comercial-piloto.mjs`: o que é desta operação (nome, frase, estados,
    comprovante, execução pendente, parada por exceção desligada);
  - `lib/acesso-comercial-schema.ts`: conferência `before`/`after`,
    levantamento e efeito de uma reversão.
- Consultas só leitura para revisão: `consultas/impacto-comercial-somente-leitura.sql`
  (antes e depois) e `consultas/validade-depois-somente-leitura.sql` (só
  depois).
- Ensaio completo em PostgreSQL 17.11 descartável (seção "Ensaio"), ensaio
  de compatibilidade com a candidata `0c44052` e ensaio do `down` numa cópia
  (seção "Recuperação").

**Operação no piloto: nada executado.** Nenhuma conexão com o piloto, nenhum
backup, **CommercialAccess não foi aplicada**, nenhuma consulta ao banco real
(nem a de exceções desligadas) e nada foi publicado no Render.

**Estado esperado do piloto:** onze migrations, até
`TeamManagerAccess1793145600000`. **Nenhuma delas deve ser repetida.** Este
procedimento só aceita `CommercialAccess1793232000000` como pendente; com
qualquer outro histórico (nome, ordem ou quantidade), para antes de escrever.

**A API nova só pode ser publicada depois de `ESTADO: after`.** Com o schema
anterior ela sobe, mas o dono e os funcionários não entram (500, `relation
"tenant_access_periods" does not exist`; ensaiado) e a ficha da administração
responde 500.

**SHA Live do Render não confirmado.** `0c44052` foi usado só como candidata
de ensaio da versão anterior; antes de publicar, confira no painel do Render
o commit que está no ar nos dois serviços.

## O que publicar

O commit de `integration/nestjs-typeorm-frontend` que contiver o PR #82 **e
este kit** (definido depois da aprovação e do merge deste PR). Use **o mesmo
SHA** em todas as fases e nos dois deploys. A fase `restauracao` recusa backup
de outro commit; a fase `aplicar` recusa backup ou restauração de outro
commit. Backups e comprovantes de ensaio feitos em outros SHAs não valem.

## Pré-requisitos (uma vez)

Os mesmos de `publicacao-equipe-piloto.md`: Windows Terminal, Node 24,
PostgreSQL para Windows com `pg_dump`, `pg_restore`, `initdb` e `pg_ctl` de
versão **igual ou maior que a do servidor do piloto** (`-PgBin`), `openssl.exe`
do Git, a URL direta do piloto, o Endpoint ID do piloto e o Endpoint ID
proibido, e a pasta `%USERPROFILE%\AgendaCloud-operacoes` fora do repositório.
A pasta guarda dumps completos, com hashes de senha.

Neste PC (casa) há o PostgreSQL **17.11**: a fase `restauracao` deste kit já
rodou com esses binários, pelo lançador oficial (seção "Ensaio"). A versão do
servidor do piloto não foi lida (última conhecida: 17.11); o `preparar`
mostra `SERVIDOR_ORIGEM` no manifesto.

## Passo a passo

Qualquer `ERRO:` para o procedimento; vale então "Recuperação".

### 0. Pasta limpa do commit

```powershell
git -C C:\Projetos\Agenda-Cloud fetch origin
git -C C:\Projetos\Agenda-Cloud worktree add --detach C:\Projetos\Agenda-Cloud-publicacao-comercial <sha>
cd C:\Projetos\Agenda-Cloud-publicacao-comercial\backend
npm ci
```

`node_modules` próprio, nunca junção para o do clone principal.

### 1. Preparar: só leitura no piloto

```powershell
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File C:\Projetos\Agenda-Cloud-publicacao-comercial\backend\scripts\abrir-comercial-piloto.ps1 -Fase preparar -PilotEndpointId <ep-piloto> -ProductionEndpointId <ep-proibido> -PgBin 'C:\Program Files\PostgreSQL\17\bin'
```

Confira `Modo: PILOTO (Neon real)`, a fase, o commit, as pastas e o
`pg_dump`. Cole a URL direta uma vez (nada aparece) e pressione Enter uma
vez. Esperado (números do piloto no lugar dos `...`):

```text
--- PILOT_EXPECT=before-commercial-access
MIGRATIONS_APPLIED: 11
SCHEMA_OBJECTS_OK: 0/28
DISABLED_FEATURE_OVERRIDES: 0
BASELINE_FAILURES: none
RESULT: SUCCESS
--- Planos, exceções de recurso e validade (só leitura; nada é alterado)
ESTABELECIMENTOS: ...
POR_SITUACAO: ...
PLANO: id=plan_equipe codigo=equipe estabelecimentos=...
PLANO: id=plan_essencial codigo=essencial estabelecimentos=...
PLANO: id=plan_pro codigo=pro estabelecimentos=...
EM_PLANO_FORA_DO_CATALOGO: ...
EXCECOES_DE_RECURSO: ... (ligadas=... desligadas=0)
EXCECOES_DESLIGADAS: 0
LINHAS_DO_CATALOGO_PREVISTAS: 4
EXCECOES_PREVISTAS_DA_MIGRATION: ...
EXCECOES_GRAVADAS_PELA_MIGRATION: 0
RECURSOS_EXISTENTES_NEGADOS: 0
MARCADOS_COMO_ANTERIORES: ainda não existe
...
BACKUP_OK: <bytes> bytes sha256=... tabelas=40
RESULTADO: preparado, nada gravado no banco
```

`before-commercial-access` exige:

- exatamente as onze migrations, **na ordem e com os nomes** (a contagem não
  basta);
- os objetos das migrations anteriores de que esta depende (a conferência
  `after-team-manager`, reaproveitada: gatilho de login, formato do login,
  StaffLogin, AppointmentPayments), `btree_gist`, a constraint única de
  `plan_features` e as seis linhas de recurso que a migration usa;
- nenhum objeto novo (valores de `audit_action`, tipos, tabela, coluna,
  linhas `pf_ca_*`, exceções `tfo_ca_*`);
- os três planos com id, código e nome anteriores (`Essencial`, `Gestão`,
  `Rede`): um nome editado à mão para a fase (a migration o sobrescreveria);
- **nenhuma exceção de recurso desligada.**

**Exceção desligada:** antes deste lote nenhum código lia
`tenant_feature_overrides`; com a API nova, uma exceção `enabled = false`
passa a retirar o recurso. A fase para em `ERR_EXCECOES_DE_RECURSO_DESLIGADAS`
**antes do backup**, lista só os pares de ids
(`EXCECAO_DESLIGADA: tenant=... recurso=...`) e não altera nada: não liga,
não apaga e não ignora. Cada caso é decidido por uma pessoa, fora deste
procedimento, com autorização própria; depois, rode `preparar` de novo.
`ERR_RECURSO_EXISTENTE_SERIA_NEGADO` é a mesma parada para qualquer outro
motivo de um recurso já usado ficar negado.

Leia o levantamento antes de seguir (seção "Levantamento").

### 2. Restauração: sem conexão com o piloto

```powershell
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File C:\Projetos\Agenda-Cloud-publicacao-comercial\backend\scripts\abrir-comercial-piloto.ps1 -Fase restauracao -PgBin 'C:\Program Files\PostgreSQL\17\bin'
```

Restaura o backup `comercial-*` mais recente num PostgreSQL descartável local
(TLS verificado, senha aleatória), compara contagem e md5 de cada tabela com o
manifesto, roda `before`, aplica CommercialAccess na cópia pelo mesmo código
da fase `aplicar`, confere `after` e compara os dados antes e depois,
**permitindo só as mudanças do lote**. Esperado:

```text
SHA256_CONFERE: true
CONTAGENS_IGUAIS: true
CONTEUDO_IGUAL_MD5: true
ENSAIO_BEFORE: ok
APLICADAS: CommercialAccess1793232000000
ENSAIO_AFTER: ok
ENSAIO_DADOS_PRESERVADOS: true
ENSAIO_CONTAS_PAPEIS_RESERVAS_RECEBIMENTOS_IGUAIS: true (users,credentials,sessions,memberships,membership_permission_overrides,invites,appointments,appointment_payments,audit_logs)
ENSAIO_COLUNAS_INTOCADAS_IGUAIS: true (tenants,plans)
ENSAIO_LINHAS_ANTIGAS_IGUAIS: true (plan_features,tenant_feature_overrides)
ENSAIO_TODOS_MARCADOS_COMO_ANTERIORES: true (marcados=N sem=0)
ENSAIO_NOMES_DOS_PLANOS: true (plan_essencial:essencial:Básico plan_equipe:equipe:Pro plan_pro:pro:Max)
ENSAIO_LINHAS_DO_CATALOGO: true (gravadas=4 previstas=4)
ENSAIO_EXCECOES_DA_MIGRATION: true (gravadas=X previstas=X desligadas=0)
ENSAIO_NENHUM_PERIODO_CRIADO: true (periodos=0)
ENSAIO_NENHUM_RECURSO_NEGADO: true (negados=0)
ENSAIO_HISTORICO_MAIS_UMA: true
DESCARTAVEL_APAGADO: true
```

O que cada linha prova:

| Linha | Mudança permitida | Todo o resto |
| --- | --- | --- |
| `ENSAIO_DADOS_PRESERVADOS` | — | todas as outras tabelas com contagem e md5 iguais, linha a linha (contas, papéis globais, vínculos, permissões, convites, reservas, recebimentos, auditoria, sessões...) |
| `ENSAIO_COLUNAS_INTOCADAS_IGUAIS` | `tenants` ganha `access_legacy_since`; `plans` muda só `name`, `short_description` e `updated_at` | as outras colunas das duas tabelas com md5 igual |
| `ENSAIO_LINHAS_ANTIGAS_IGUAIS` | `plan_features` ganha linhas `pf_ca_*`; `tenant_feature_overrides`, linhas `tfo_ca_*` | as linhas antigas das duas com md5 igual |
| `ENSAIO_EXCECOES_DA_MIGRATION` | exceções **ligadas**, só onde o levantamento previu | nenhuma exceção desligada criada |
| `ENSAIO_NENHUM_PERIODO_CRIADO` | — | nenhum teste, pagamento ou cortesia criado para regularizar alguém |

### 3. Aplicar: única etapa que escreve no piloto

Escolha um momento de pouco uso. A migration leva cerca de um segundo, mas
precisa de lock exclusivo curto em `tenants` (coluna nova e marca em todas as
linhas) e escreve em `plans`, `plan_features` e `tenant_feature_overrides`. Se
uma requisição segurar `tenants`, a migration desiste em 10 s
(`lock_timeout`) e o banco desfaz tudo.

```powershell
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File C:\Projetos\Agenda-Cloud-publicacao-comercial\backend\scripts\abrir-comercial-piloto.ps1 -Fase aplicar -PilotEndpointId <ep-piloto> -ProductionEndpointId <ep-proibido> -PgBin 'C:\Program Files\PostgreSQL\17\bin'
```

1. Antes da URL: recusa execução anterior sem desfecho
   (`ERR_RESULTADO_ANTERIOR_INCERTO`) e exige o backup do passo 1 com a
   restauração do passo 2 conferida (mesmo modo, endpoint e commit, de até
   24 h; manifesto, dump e comprovante sem alteração).
2. Repete destino, TLS, `before-commercial-access` e o levantamento (para de
   novo com exceção desligada).
3. Faz um **backup novo** e confere que vem do mesmo servidor do backup
   conferido.
4. Pede a frase. Confira `RESULT: SUCCESS`, `BACKUP_OK` e
   `MESMO_SERVIDOR_DO_BACKUP_CONFERIDO: sim`, e digite:

   ```text
   APLICAR CommercialAccess1793232000000
   ```

5. Registra `migration_iniciada` e aplica só a pendente esperada, numa
   transação, com `lock_timeout` de 10 s e `statement_timeout` de 120 s.
6. Roda `after-commercial-access`.

Esperado:

```text
PENDENTE: CommercialAccess1793232000000
APLICADAS: CommercialAccess1793232000000
SESSAO_DA_MIGRATION: mesma=true lock_timeout=10s
COMMIT: ok
--- PILOT_EXPECT=after-commercial-access
MIGRATIONS_APPLIED: 12
SCHEMA_OBJECTS_OK: 28/28
BASELINE_FAILURES: none
RESULT: SUCCESS
CONTAGENS_DESDE_O_BACKUP: iguais
...
MARCADOS_COMO_ANTERIORES: <todos>
SEM_MARCA_DE_ANTERIOR: 0
PERIODOS_DE_ACESSO: 0
RESULTADO: CommercialAccess1793232000000 aplicada e conferida
```

| Mensagem final | Significado | Ação |
| --- | --- | --- |
| `... aplicada e conferida` | gravada e `after` ok | passo 5 |
| `... FOI APLICADA (COMMIT confirmado), mas a conferência posterior falhou` (saída 2) | gravada; só a leitura depois falhou | **não** rode `aplicar`; rode `conferir` |
| `ERR_RESULTADO_INCERTO` | conexão perdida depois do início | **não** rode `aplicar`; rode `conferir` |
| `ERR_MIGRATION_FALHOU` | o banco recusou (ex.: `55P03`) e `before` foi confirmado intacto | nada gravado; escolha outro momento e repita a partir do passo 3 |

### 4. Conferir: só leitura, quando quiser

```powershell
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File C:\Projetos\Agenda-Cloud-publicacao-comercial\backend\scripts\abrir-comercial-piloto.ps1 -Fase conferir -PilotEndpointId <ep-piloto> -ProductionEndpointId <ep-proibido>
```

| Saída | Significado |
| --- | --- |
| `ESTADO: before` | CommercialAccess **não** aplicada |
| `ESTADO: after` | aplicada e conferida; mostra também `REVERSAO_AFETARIA_*` |
| `ESTADO: divergente` | nem before nem after (ex.: exceção desligada antiga, nome de plano editado): não aplique nem publique |
| `ERRO: ERR_CONFERENCIA_SEM_LEITURA` / `ERR_SEM_CONEXAO` | o banco não foi lido; repita |
| `SESSOES_DA_MIGRATION_ATIVAS: n>0` | a migration ainda roda; espere e repita |

### 5. Publicar a API

Só depois de `ESTADO: after`. Render, `agenda-cloud-piloto-api`: **Manual
Deploy → Deploy a specific commit → `<sha>`**. Espere **Live** e confira:

- `GET $WEB/agenda_api/auth/me` sem cookie: `401`;
- o dono entra pelo e-mail (com o web atual) e a agenda e os serviços abrem;
- a lista de estabelecimentos da administração abre.

**Entre este passo e o 6, a ficha de um estabelecimento na administração não
abre no web atual** (ensaiado: o validador do web anterior exige o campo
`billing`, que a API nova não devolve mais; a tela mostra o erro de leitura e
nada é gravado). Publique o web logo em seguida e não use a ficha nesse
intervalo. Nenhum estabelecimento fica bloqueado nesse momento: todos estão
marcados como anteriores e não há período.

Não há variável nova.

### 6. Publicar o web

`agenda-cloud-piloto-web`, mesmo `<sha>`. Testes manuais:

1. `/login` responde `200`.
2. Administração → ficha de um estabelecimento: cartão **Validade do acesso**
   com "Validade ainda não definida"; planos com os nomes **Básico, Pro e
   Max** (códigos inalterados).
3. Dono → Configurações: "Validade ainda não definida"; agenda, clientes,
   equipe e recebimentos abrem como antes.
4. Um gerente e um profissional entram e veem o mesmo que antes.
5. O link público `/agendar/<slug>` de um estabelecimento abre.
6. **Não registre pagamento, prorrogação ou cortesia só para testar:** cada
   registro é real, auditado e só pode ser anulado, nunca apagado. Não crie
   estabelecimento de teste no piloto.

Os preços continuam como proposta: o catálogo segue com preço nulo e nada
neste procedimento os altera. A regularização dos estabelecimentos com
"Validade ainda não definida" é decisão individual, posterior.

### 7. Limpeza

Feche as janelas, remova a worktree
(`git -C C:\Projetos\Agenda-Cloud worktree remove C:\Projetos\Agenda-Cloud-publicacao-comercial`)
e mantenha a pasta de operações.

## Levantamento

O levantamento (fases `preparar`, `restauracao`, `aplicar` e `conferir`, e a
consulta `consultas/impacto-comercial-somente-leitura.sql`) é **só leitura**
e só mostra ids, códigos e contagens. Regra do recurso de
`commercial/commercial-gate.ts`: exceção individual primeiro, senão o catálogo
do plano.

| Saída | Significado |
| --- | --- |
| `EM_PLANO_FORA_DO_CATALOGO` | estabelecimentos num plano que não é Básico, Pro ou Max |
| `EXCECOES_DESLIGADAS` | precisa ser 0 antes da migration |
| `LINHAS_DO_CATALOGO_PREVISTAS` | linhas `pf_ca_*` que a migration grava (4 num catálogo intocado) |
| `EXCECOES_PREVISTAS_DA_MIGRATION` | exceções ligadas `tfo_ca_*` que a migration grava: recurso já usado que o plano do estabelecimento não tem no catálogo |
| `RECURSOS_EXISTENTES_NEGADOS` | precisa ser 0: nenhum recurso já usado é retirado |
| `MARCADOS_COMO_ANTERIORES` / `SEM_MARCA_DE_ANTERIOR` | depois da migration: todos marcados; um sem marca só existe se criado depois (pela API nova, com teste, ou pela anterior, sem teste) |
| `PERIODOS_DE_ACESSO` | depois da migration: 0 até a administração registrar algo |

## Códigos de parada próprios deste lote

| Código | Fase | Significado | Gravou algo no piloto? |
| --- | --- | --- | --- |
| `ERR_EXCECOES_DE_RECURSO_DESLIGADAS` | preparar, aplicar | há exceção de recurso desligada | não |
| `ERR_RECURSO_EXISTENTE_SERIA_NEGADO` | preparar, aplicar | um recurso já usado ficaria negado | não |
| `ERR_COMMERCIALACCESS_JA_APLICADA` | preparar, aplicar | o piloto já está em `after` | não |
| `ERR_ESTADO_ANTES_DIVERGENTE` | preparar, aplicar | histórico, schema ou nomes fora de `before-commercial-access` | não |
| `ERR_MIGRATION_FALHOU` | aplicar | o banco recusou (ex.: `55P03`) e `before` foi confirmado intacto | não |
| `ERR_RESULTADO_INCERTO` | aplicar | conexão perdida depois do início | **talvez**: rode `conferir` |

Os demais (`ERR_AJUSTE_DE_ENSAIO_NO_PILOTO`, `ERR_OPCOES_DO_NODE_NO_PILOTO`,
`ERR_CERTIFICADO_NAO_CONFIAVEL`, `ERR_SEM_BACKUP_COM_RESTAURACAO_CONFERIDA`,
`ERR_RESULTADO_ANTERIOR_INCERTO`, `ERR_BACKEND_COM_ALTERACOES_LOCAIS`...) são
os de `publicacao-equipe-piloto.md`.

## Resultado incerto

Igual a TeamAccess e TeamManagerAccess: depois de uma queda, o script nunca
conclui "nada aplicado"; a próxima `aplicar` para antes da URL; só uma
`conferir` posterior com `ESTADO: before` ou `after` e nenhuma sessão da
migration ativa libera o registro. Ensaiado nos dois sentidos (queda no lugar
do COMMIT: `before`; queda logo depois do COMMIT: `after`).

## Recuperação

**Regra geral:** não apague períodos, pagamentos, anulações, exceções nem
estabelecimentos; não use `migration:revert`; nunca restaure o backup por cima
do piloto. **Nenhuma dessas é recuperação padrão.** O backup serve para
restaurar numa cópia e consultar, ou para uma decisão excepcional e explícita
do dono, sabendo que tudo gravado depois dele se perde.

**Ordem:** publicar é **migration → API → web**; um retorno conjunto é
**web → API**. Nunca deixe o web novo no ar com a API anterior (não
validado: o web novo exige `access` na ficha).

Ensaio de 02/11/2026, no schema novo, com dados gravados pela API nova:
pago em curso (Pro), cortesia vencida (Max, deslocada para o passado no banco
descartável para simular o tempo), pago anulado por correção (Básico, volta a
"Validade ainda não definida"), estabelecimento criado pela API nova (com
teste) e um num plano fora do catálogo com as exceções da migration.

Versão anterior usada: **`0c44052` (candidata de ensaio, não confirmada como
a versão Live do Render).**

### Voltar só o web para a versão anterior (API nova continua)

- **Administração:** a ficha de estabelecimento não abre (o web anterior
  recusa a resposta sem `billing`). Suspender, reativar, arquivar e trocar de
  plano pela ficha ficam indisponíveis; registrar pagamento, prorrogação e
  cortesia não existem no web anterior.
- **Estabelecimento vencido:** a API nova continua bloqueando (403
  `ACESSO_VENCIDO`); o web anterior não conhece o código e mostra a mensagem
  genérica de falta de permissão. Nada é liberado nem apagado.
- Os demais (dono em validade, gerente, profissional, link público) seguem
  funcionando: a API nova só **acrescenta** campos à sessão (`access`).

Use só para defeito de tela fora da administração e do aviso de validade.

### Voltar a API (e o web) para a versão anterior

O web novo depende das rotas novas; volte os dois, **o web antes da API**.
Comprovado com a API `0c44052` no schema novo:

- **Estabelecimento vencido volta a ter acesso total** (agenda, serviços,
  recebimentos, 200 em tudo) e **grava** dados (no ensaio, criou um serviço).
  A API anterior não lê validade nem catálogo: o bloqueio comercial some para
  todos, e o recurso fora do plano também deixa de ser conferido (como era
  antes do lote).
- **Registros comerciais continuam gravados, mas ficam invisíveis:** a ficha
  da API anterior mostra `billing: { available: false }`; ninguém vê, registra
  nem anula período nesse intervalo.
- **Estabelecimento criado pela API anterior nasce sem a marca e sem teste.**
  Com a API nova de volta, ele fica **bloqueado** ("Sem validade registrada",
  `MISSING`; ensaiado). Precisa de regularização individual pela
  administração. Liste-os com `consultas/validade-depois-somente-leitura.sql`
  (linha `sem_validade`), com autorização para a leitura.
- Os planos aparecem com os nomes novos (Básico, Pro, Max) na API anterior:
  o catálogo foi renomeado no banco.
- **Com a API nova de volta:** quem estava vencido volta a ser bloqueado; o
  que foi gravado no meio-tempo continua (ensaiado); os períodos continuam
  iguais.

**Não é uma combinação segura**: tira o controle de validade de todos
enquanto durar e cria estabelecimentos que depois ficam bloqueados. Só para
um defeito grave da API nova que impeça o uso geral, com decisão do dono e
consciência dessas consequências.

### Migration

**`migration:revert`: não use.** Lido em
`src/migrations/1793232000000-CommercialAccess.ts` e ensaiado numa cópia com
5 períodos (2 pagos, 1 deles anulado, 2 cortesias, 1 teste):

| O `down` faz | Consequência |
| --- | --- |
| `DROP TABLE tenant_access_periods` | **apaga todos os períodos**: testes dos estabelecimentos novos, pagamentos com valor contratado, forma, data e referência, cortesias e anulações com motivo. Sem recuperação, salvo o que ficou em `audit_logs.new_data` e nos backups |
| apaga `tenants.access_legacy_since` | perde a marca; se a migration for aplicada de novo, **todo** estabelecimento existente vira "anterior", inclusive os criados depois e os vencidos (que deixam de ser bloqueados) |
| apaga as exceções `tfo_ca_*` | estabelecimentos fora do catálogo perdem a exceção ligada (com a API nova, perderiam os recursos) |
| apaga as linhas `pf_ca_*` e volta os nomes Essencial, Gestão e Rede | catálogo anterior |
| mantém os valores `ACCESS_*` de `audit_action` e os registros de auditoria | o histórico continua legível |

Com a API nova no ar sobre o schema revertido (ensaiado): **o dono não
entra** (500, `relation "tenant_access_periods" does not exist`) e a ficha da
administração responde 500. A fase `conferir` mostra
`REVERSAO_AFETARIA_*` com as contagens reais antes de qualquer decisão.

## Ensaio (02/11/2026)

Nada foi executado contra o Neon, o piloto ou `agenda_dev`;
`IGNORE_DOTENV_FILE=true`; só dados fictícios.

### Ambiente

- **Destino:** PostgreSQL **17.11** local (binários do Windows deste PC,
  cluster criado no scratchpad da sessão, sem Docker), só `hostssl` com
  `scram-sha-256`, certificado de uma CA descartável para o host fictício
  `ep-ensaio-piloto-333.c-2.us-east-1.aws.neon.tech` (conexão desviada para
  127.0.0.1 pelo modo ensaio), banco `neondb` com dono **não superusuário**,
  onze migrations pelo runtime compilado.
- **Dados:** cinco estabelecimentos (um em cada plano, um num plano fora do
  catálogo, um suspenso com `restore_status`), contas com papel global
  (`MASTER_OWNER`, `MASTER_SUPPORT`), dono, gerente confirmado com concessão,
  profissional com acesso, reservas passadas e futuras, recebimentos (um
  estornado), uma exceção manual **ligada** (fica intocada) e um registro de
  auditoria.
- **Commit do procedimento:** `9d542aedf2f941e1b60c663fe89f4798ce6c5c65`.
  Os commits seguintes só mudam documentação e testes; os scripts do
  procedimento e a migration são iguais no SHA final do PR (conferir com
  `git diff 9d542ae <sha> -- backend/scripts backend/src/migrations`, que
  deve listar só testes).

### Execução oficial, harness e limitações

- **Lançador oficial** (`abrir-comercial-piloto.ps1`, sem nada no meio):
  - fase `restauracao` completa, com os binários **17.11**: primeira execução
    do script oficial de restauração com binários 17 (a lacuna do kit do
    gerente não se repete aqui);
  - fase `conferir` num Windows Terminal real, com a URL entrada por teclas
    simuladas (SendKeys), sem eco; terminou com `ESTADO: after`, registro em
    `operacoes.jsonl` e "Script terminou com codigo 0".
- **Scripts oficiais com terminal simulado** (harness fora do repositório,
  carregado por `node --import`, que o modo piloto recusa): fases `preparar`,
  `aplicar` e `conferir` de todos os casos abaixo. O harness só substitui o
  terminal e, nos casos de queda, derruba o socket no cliente. **Não é prova
  do lançador** nessas fases.
- O script de restauração também rodou direto (sem lançador) no caso de
  backup de outro commit.

### Resultados

| Caso | Como | Resultado |
| --- | --- | --- |
| `conferir` antes | harness | `ESTADO: before`, 11 migrations, 0/28 |
| exceção desligada (`preparar`) | harness | `ERR_EXCECOES_DE_RECURSO_DESLIGADAS` antes do backup; só ids; exceções com md5 igual; nenhuma pasta de backup |
| histórico com o mesmo número e outro nome | harness | `migration_history`; `ERR_ESTADO_ANTES_DIVERGENTE` |
| nome de plano editado à mão | harness | `plan_names_or_codes_unexpected`; para |
| gatilho de login desabilitado | harness | `team_manager_login_guard_trigger_disabled`; para |
| `preparar` | harness | `before` SUCCESS; previstas 4 linhas do catálogo e 5 exceções; backup de 144 KB, 40 tabelas |
| `aplicar` sem restauração conferida | harness | `ERR_SEM_BACKUP_COM_RESTAURACAO_CONFERIDA`, antes da URL |
| `restauracao` | **lançador** | 40 tabelas iguais; migration na cópia; só as mudanças previstas (tabela acima); descartável apagado |
| manifesto editado depois da conferência | harness | recusado ("manifesto alterado depois da conferência") |
| comprovante de outro commit | harness | recusado ("restauração conferida com outro commit") |
| dump alterado | harness | recusado ("dump alterado") |
| restauração de backup de outro commit | script direto | `ERR_BACKUP_DE_OUTRO_COMMIT` |
| frase errada | harness | abortado; histórico, planos, exceções, colunas e enum iguais |
| outra sessão segurando `tenants` | harness | `55P03` em ~10 s; `before` intacto; nenhum valor de enum gravado |
| queda no lugar do COMMIT | harness | `ERR_RESULTADO_INCERTO`; `aplicar` bloqueada antes da URL; `conferir`: `before` |
| `aplicar` | harness | só CommercialAccess; `after` 12, 28/28; contagens iguais ao backup; 5 marcados, 0 períodos |
| `aplicar` de novo | harness | `ERR_COMMERCIALACCESS_JA_APLICADA` |
| `conferir` depois | harness e **lançador** | `ESTADO: after`; `REVERSAO_AFETARIA_*` |
| queda logo depois do COMMIT (banco recriado do dump) | harness | `ERR_RESULTADO_INCERTO` com 12 migrations no banco; `aplicar` bloqueada; `conferir`: `after`; `aplicar`: recusa |
| COMMIT ok e conferência posterior sem conexão | harness | `FOI APLICADA ... conferência posterior falhou`, saída 2; `aplicar`: recusa; `conferir`: `after` |
| banco fora do ar | harness | `conferir`: `ERR_SEM_CONEXAO`; `preparar`: `ERR_CONFERENCIA_SEM_LEITURA` |
| modo piloto com CA do ensaio / com `--import` / com endpoint de ensaio | script direto | `ERR_AJUSTE_DE_ENSAIO_NO_PILOTO` / `ERR_OPCOES_DO_NODE_NO_PILOTO` / `ERR_ENDPOINT_DE_ENSAIO_NO_PILOTO`, antes da URL |
| senhas do banco em `operacoes.jsonl`, manifestos e saídas | — | nenhuma ocorrência |

### Compatibilidade (harness HTTP, fora do repositório)

API nova (`a2d123b`) e anterior (`0c44052`, candidata) rodando ao mesmo tempo
contra o mesmo banco descartável com CommercialAccess:

| Caso | API nova | API anterior |
| --- | --- | --- |
| dono de estabelecimento vencido: serviços, agenda, recebimentos | 403 `ACESSO_VENCIDO` | **200** (e grava) |
| dono em validade, anterior ao controle ou fora do catálogo | 200 | 200 |
| ficha da administração | campos novos (`access`, `accessPeriods`), sem `billing` | sem períodos, `billing.available=false` |
| ficha da API nova no validador do web anterior | **recusada** | aceita |
| sessão (`/auth/me`) | só acrescenta `access` | — |
| estabelecimento criado | com teste gravado | **sem marca e sem teste** (bloqueado ao voltar a API nova) |
| API nova sobre o schema **anterior** (cópia em `before`) | dono e profissional: login 500; ficha: 500 | — |

O web anterior não foi aberto no navegador: a recusa da ficha foi provada com
a função de validação do próprio web anterior
(`src/lib/administracao/contratos.ts`) sobre as respostas reais das duas APIs,
e o resto pela comparação das formas das respostas.

### Limitações

- As quedas foram simuladas no cliente, não por falha de rede do Neon.
- O lançador foi exercido por inteiro na `restauracao` e, com teclas
  simuladas, na `conferir`; `preparar` e `aplicar` rodaram com terminal
  simulado. A colagem real com Ctrl+V é a ensaiada nas publicações
  anteriores.
- O banco descartável é PostgreSQL local no Windows, não o Neon.
- O web anterior não rodou no navegador contra a API nova (ver acima); o web
  novo com a API anterior não foi validado.
- `0c44052` não está confirmada como a versão Live.
- Os dados reais do piloto não foram lidos: quantas exceções desligadas,
  planos fora do catálogo e estabelecimentos existem só o `preparar` dirá.
