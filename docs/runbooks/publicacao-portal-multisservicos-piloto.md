# Runbook — Publicar o portal da plataforma e o agendamento com vários serviços no piloto (PRs #84 e #85)

Este runbook leva o piloto das doze migrations atuais (até
`CommercialAccess1793232000000`) às catorze, em **duas etapas**, e depois
publica a API e o web do mesmo commit:

1. `PlatformPortal1793318400000` (PR #84): preços do catálogo, preço
   contratado, origem do valor do período pago e acesso sem vencimento;
2. `AppointmentServiceSnapshots1793404800000` (PR #85): nome do serviço
   congelado em cada item da reserva.

Estado entre sessões em `continuidade-portal-multisservicos.md`.
`docs/runbooks/migrations-production.md` **não** serve para estas migrations.

## Estado em 03/11/2026

**Preparação concluída** neste repositório, sem tocar no piloto:

- Procedimento em `backend/scripts/`, no mesmo molde de CommercialAccess e com
  as mesmas peças comuns (`operacao-piloto.mjs`, `entrada-oculta.mjs`,
  `equipe-piloto.mjs`):
  - `abrir-portal-multisservicos-piloto.ps1`: lançador (por `-File`);
  - `aplicar-portal-multisservicos-piloto.mjs`: fases `preparar`, `aplicar` e
    `conferir`;
  - `conferir-restauracao-portal-multisservicos.mjs`: fase `restauracao`;
  - `portal-multisservicos-piloto.mjs`: as duas etapas, os três estados,
    comprovante, execução pendente e a parada sem proprietário ativo;
  - `lib/portal-multisservicos-schema.ts`: conferência dos três estados,
    levantamento e efeito de uma reversão;
  - `lib/pilot-database-check.ts`: as expectativas `before-platform-portal`,
    `after-platform-portal` e `after-appointment-snapshots` (também pelo
    `npm run pilot:check-database`).
- Consultas só leitura: `consultas/impacto-portal-multisservicos-somente-leitura.sql`
  (só ids, nos três estados) e `consultas/contas-com-papel-global-somente-leitura.sql`
  (**com nome e e-mail**, só com autorização; ver "Contas com papel global").
- Ensaio completo em PostgreSQL 17.11 descartável com TLS e dados fictícios,
  ensaio de compatibilidade das APIs e dos webs anterior e novo nos três
  estados do schema, e ensaio do `down` numa cópia (seções abaixo).

**Operação no piloto: nada executado.** Nenhuma conexão com o piloto, nenhum
backup, nenhuma das duas migrations aplicada, nada publicado no Render.

**Estado esperado do piloto:** doze migrations, até
`CommercialAccess1793232000000`, e a versão publicada `99242a6`. **Nenhuma
migration já aplicada é repetida:** cada etapa só aceita o seu estado "antes";
com qualquer outro histórico (nome, ordem ou quantidade), para antes de
escrever.

**A API nova só pode ser publicada no estado final** (`after-appointment-snapshots`,
catorze migrations). Com doze, o dono e o profissional não entram (500); com
treze, a agenda, a reserva e os recebimentos respondem 500 (ensaiado).

**Pendências antes de publicar** (fora deste kit):

- conferência **autorizada** das identidades das contas `MASTER_OWNER`
  (seção "Contas com papel global"); nenhum papel é alterado aqui;
- os preços continuam sem aprovação: nada neste procedimento grava preço, e
  depois da publicação só se cadastra preço aprovado;
- backup real, restauração conferida e operação no SHA operacional definitivo,
  com autorização expressa.

## Os três estados

| Estado | Migrations | O que tem | API e web que funcionam nele |
| --- | --- | --- | --- |
| `before-platform-portal` | 12 | o piloto de hoje | os anteriores (`99242a6`) |
| `after-platform-portal` (**intermediário**) | 13 | + preços, contratos, sem vencimento, origem do valor | os anteriores (ensaiado: leitura e escrita); a API nova **não** |
| `after-appointment-snapshots` (**final**) | 14 | + nome congelado do serviço | anteriores e novos (com as diferenças de "Compatibilidade") |

A fase `conferir` identifica um deles: exatamente uma das três conferências
precisa passar; com nenhuma ou duas, `ESTADO: divergente`.

## O que publicar

O commit de `integration/nestjs-typeorm-frontend` que contiver #84, #85 **e
este kit** (definido depois da aprovação e do merge deste PR). Use **o mesmo
SHA** nas duas etapas, em todas as fases e nos dois deploys. A fase
`restauracao` recusa backup de outro commit; a fase `aplicar` recusa backup ou
restauração de outro commit, de outra etapa ou de outro modo. Backups e
comprovantes feitos em ensaio (`-Ensaio`) **não valem** no modo piloto e não
são prova da operação real.

## Pré-requisitos (uma vez)

Os mesmos de `publicacao-acesso-comercial-piloto.md`: Windows Terminal, Node
24, PostgreSQL para Windows com `pg_dump`, `pg_restore`, `initdb` e `pg_ctl` de
versão **igual ou maior que a do servidor do piloto** (`-PgBin`; última versão
conhecida do piloto: 17.11), `openssl.exe` do Git, a URL direta do piloto, o
Endpoint ID do piloto e o Endpoint ID proibido, e a pasta
`%USERPROFILE%\AgendaCloud-operacoes` fora do repositório (guarda dumps
completos, com hashes de senha).

## Passo a passo

Qualquer `ERRO:` para o procedimento; vale então "Recuperação". Em todos os
comandos, `<lancador>` é
`C:\Projetos\Agenda-Cloud-publicacao-portal\backend\scripts\abrir-portal-multisservicos-piloto.ps1`
e `<ids>` é `-PilotEndpointId <ep-piloto> -ProductionEndpointId <ep-proibido>`:

```powershell
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File <lancador> -Fase <fase> [-Etapa <etapa>] <ids> -PgBin 'C:\Program Files\PostgreSQL\17\bin'
```

### 0. Pasta limpa do commit

```powershell
git -C C:\Projetos\Agenda-Cloud fetch origin
git -C C:\Projetos\Agenda-Cloud worktree add --detach C:\Projetos\Agenda-Cloud-publicacao-portal <sha>
cd C:\Projetos\Agenda-Cloud-publicacao-portal\backend
npm ci
```

`node_modules` próprio, nunca junção para o do clone principal.

### 1. Conferir o ponto de partida

`-Fase conferir` (sem `-Etapa`). Esperado: `ESTADO: before-platform-portal`,
`SESSOES_DAS_MIGRATIONS_ATIVAS: 0` e o levantamento. Leia o levantamento antes
de seguir (seção "Levantamento").

### Etapa 1 — `portal` (12 → 13)

#### 2. Preparar: só leitura

`-Fase preparar -Etapa portal`. Confere destino, TLS e
`before-platform-portal` e faz o backup. Esperado:

```text
--- PILOT_EXPECT=before-platform-portal
MIGRATIONS_APPLIED: 12
SCHEMA_OBJECTS_OK: 0/36
BASELINE_FAILURES: none
RESULT: SUCCESS
...
PROPRIETARIOS_ATIVOS: <1 ou mais>
...
BACKUP_OK: <bytes> bytes sha256=... tabelas=41
RESULTADO: preparado, nada gravado no banco
```

`before-platform-portal` exige:

- exatamente as doze migrations, **na ordem e com os nomes**;
- os objetos das anteriores (a conferência `after-commercial-access`,
  reaproveitada, que por sua vez reaproveita as de TeamManagerAccess e
  anteriores);
- nenhum objeto das duas novas: valores de `audit_action`, tabelas,
  constraints, índices, `tenant_access_periods.amount_source` e
  `appointment_items.service_name_snapshot`.

Sem nenhum `MASTER_OWNER` ativo, para em `ERR_SEM_PROPRIETARIO_ATIVO` antes do
backup: com a API nova, só proprietário ativo entra no portal. Promover alguém
é decisão do dono, pelo procedimento próprio de promoção; este kit nunca
altera papel.

#### 3. Restauração: sem conexão com o piloto

`-Fase restauracao -Etapa portal` (sem `<ids>`). Restaura o backup `portal-*`
mais recente num PostgreSQL descartável local (TLS verificado, senha
aleatória), compara contagem e md5 de cada tabela com o manifesto, aplica
**só** PlatformPortal na cópia pelo mesmo código da fase `aplicar` e confere
que só o previsto mudou. Esperado:

```text
SHA256_CONFERE: true
CONTAGENS_IGUAIS: true
CONTEUDO_IGUAL_MD5: true
ENSAIO_ANTES (before-platform-portal): ok
PENDENTE: PlatformPortal1793318400000
FORA_DESTA_ETAPA: AppointmentServiceSnapshots1793404800000
APLICADAS: PlatformPortal1793318400000
ENSAIO_DEPOIS (after-platform-portal): ok
ENSAIO_DADOS_PRESERVADOS: true
ENSAIO_CONTAS_PAPEIS_ESTABELECIMENTOS_RESERVAS_RECEBIMENTOS_IGUAIS: true (users,credentials,sessions,memberships,membership_permission_overrides,invites,tenants,plans,plan_features,tenant_feature_overrides,appointments,appointment_payments,audit_logs)
ENSAIO_COLUNAS_ANTIGAS_IGUAIS: true (tenant_access_periods)
ENSAIO_SO_AS_COLUNAS_PREVISTAS: true (tenant_access_periods+amount_source)
ENSAIO_COLUNAS_NOVAS_NULAS: true (tenant_access_periods=0)
ENSAIO_TABELAS_NOVAS_VAZIAS: true (plan_prices=0 tenant_contract_prices=0 tenant_no_expiry_grants=0)
ENSAIO_REGISTROS_COMERCIAIS_IGUAIS: true (...)
ENSAIO_CONTAS_COM_PAPEL_GLOBAL_IGUAIS: true (...)
ENSAIO_RESERVAS_E_RECEBIMENTOS_IGUAIS: true (...)
ENSAIO_HISTORICO_MAIS_UMA: true
DESCARTAVEL_APAGADO: true
```

| Linha | Mudança permitida | Todo o resto |
| --- | --- | --- |
| `ENSAIO_DADOS_PRESERVADOS` | — | todas as tabelas com contagem e md5 iguais, linha a linha |
| `ENSAIO_COLUNAS_ANTIGAS_IGUAIS` | `tenant_access_periods` ganha `amount_source` | as colunas antigas dos períodos com md5 igual (valores, datas, anulações) |
| `ENSAIO_COLUNAS_NOVAS_NULAS` | — | nenhum período ganha origem inventada |
| `ENSAIO_TABELAS_NOVAS_VAZIAS` | três tabelas novas | nenhum preço, contrato ou "sem vencimento" gravado pela migration |
| `ENSAIO_CONTAS_COM_PAPEL_GLOBAL_IGUAIS` | — | papéis e situações das contas globais iguais |

#### 4. Aplicar a etapa 1: única fase que escreve

`-Fase aplicar -Etapa portal`. A migration acrescenta valores a
`audit_action`, cria três tabelas (com chaves estrangeiras para `plans`,
`users`, `tenants` e `tenant_access_periods`) e acrescenta uma coluna e uma
constraint em `tenant_access_periods`: precisa de lock curto nessas tabelas.
Se uma requisição segurar uma delas, desiste em 10 s (`lock_timeout`) e o banco
desfaz tudo.

1. Antes da URL: recusa execução anterior sem desfecho **de qualquer das duas
   etapas** (`ERR_RESULTADO_ANTERIOR_INCERTO`) e exige o backup do passo 2 com a
   restauração do passo 3 conferida (mesmo modo, endpoint, commit e etapa, de
   até 24 h; manifesto, dump e comprovante sem alteração).
2. Repete destino, TLS, `before-platform-portal` e o levantamento.
3. Faz um **backup novo** e confere que vem do mesmo servidor do backup
   conferido.
4. Pede a frase. Confira `RESULT: SUCCESS`, `BACKUP_OK` e
   `MESMO_SERVIDOR_DO_BACKUP_CONFERIDO: sim`, e digite:

   ```text
   APLICAR PlatformPortal1793318400000
   ```

5. Registra `migration_iniciada` e aplica só PlatformPortal (a migration
   seguinte, compilada no mesmo commit, é conferida pelo nome e **retirada**
   antes de rodar: `FORA_DESTA_ETAPA`), numa transação, com `lock_timeout` de
   10 s e `statement_timeout` de 120 s.
6. Roda `after-platform-portal`.

Esperado:

```text
PENDENTE: PlatformPortal1793318400000
FORA_DESTA_ETAPA: AppointmentServiceSnapshots1793404800000
APLICADAS: PlatformPortal1793318400000
SESSAO_DA_MIGRATION: mesma=true lock_timeout=10s
COMMIT: ok
--- PILOT_EXPECT=after-platform-portal
MIGRATIONS_APPLIED: 13
SCHEMA_OBJECTS_OK: 35/36
RESULT: SUCCESS
CONTAGENS_DESDE_O_BACKUP: iguais
...
ESTADO: after-platform-portal
RESULTADO: PlatformPortal1793318400000 aplicada e conferida; estado INTERMEDIÁRIO (...)
```

**No intermediário a API e o web publicados continuam os anteriores** e
funcionam (ensaiado: dono, profissional, agenda, criação de reserva,
recebimentos, ficha administrativa e registro de pagamento). Não publique
nada aqui.

### Etapa 2 — `multisservicos` (13 → 14)

#### 5. Preparar, restaurar e aplicar

Os mesmos passos 2 a 4 com `-Etapa multisservicos`:

- `preparar`: `after-platform-portal` SUCCESS, `BACKUP_OK ... tabelas=44`;
- `restauracao`: `ENSAIO_ANTES (after-platform-portal): ok`,
  `APLICADAS: AppointmentServiceSnapshots1793404800000`,
  `ENSAIO_COLUNAS_ANTIGAS_IGUAIS: true (appointment_items)`,
  `ENSAIO_COLUNAS_NOVAS_NULAS: true (appointment_items=0)` e as demais linhas
  `true` (reservas antigas continuam sem nome congelado: o nome daquela época
  não foi gravado e não é inventado);
- `aplicar`: frase `APLICAR AppointmentServiceSnapshots1793404800000`; lock
  curto em `appointment_items` (coluna anulável, sem valor padrão). Esperado
  `MIGRATIONS_APPLIED: 14`, `SCHEMA_OBJECTS_OK: 36/36`, `ESTADO:
  after-appointment-snapshots`.

A etapa 2 recusa o estado `before-platform-portal`
(`ERR_ETAPA_ANTERIOR_PENDENTE`); as duas recusam um estado posterior ao delas
(`ERR_ETAPA_JA_APLICADA`).

| Mensagem final | Significado | Ação |
| --- | --- | --- |
| `... aplicada e conferida` | gravada e o estado "depois" ok | próximo passo |
| `... FOI APLICADA (COMMIT confirmado), mas a conferência posterior falhou` (saída 2) | gravada; só a leitura depois falhou | **não** rode `aplicar`; rode `conferir` |
| `ERR_RESULTADO_INCERTO` | conexão perdida depois do início | **não** rode `aplicar` (nenhuma etapa); rode `conferir` |
| `ERR_MIGRATION_FALHOU` | o banco recusou (ex.: `55P03`) e o estado "antes" foi confirmado intacto | nada gravado; escolha outro momento e repita a fase `aplicar` da mesma etapa |

### 6. Conferir: só leitura, quando quiser

`-Fase conferir`. Saídas:

| Saída | Significado |
| --- | --- |
| `ESTADO: before-platform-portal` | nenhuma das duas aplicada |
| `ESTADO: after-platform-portal` | intermediário: só PlatformPortal; mostra `REVERSAO_AFETARIA_*` |
| `ESTADO: after-appointment-snapshots` | final; mostra `REVERSAO_AFETARIA_*`; a API nova pode ser publicada |
| `ESTADO: divergente` | nenhum dos três (ou mais de um): não aplique nem publique |
| `ERRO: ERR_CONFERENCIA_SEM_LEITURA` / `ERR_SEM_CONEXAO` | o banco não foi lido; repita |
| `SESSOES_DAS_MIGRATIONS_ATIVAS: n>0` | uma migration ainda roda; espere e repita |

### 7. Publicar a API

Só com `ESTADO: after-appointment-snapshots`. Render,
`agenda-cloud-piloto-api`: **Manual Deploy → Deploy a specific commit →
`<sha>`**. Espere **Live** e confira:

- `GET $WEB/agenda_api/auth/me` sem cookie: `401`;
- o dono entra (com o web atual) e a agenda, os serviços e os recebimentos
  abrem;
- um `MASTER_OWNER` abre a lista e a ficha de um estabelecimento no web atual;
- `MASTER_ADMIN` e `MASTER_SUPPORT` passam a não ver a administração (é a
  regra nova; o papel continua gravado).

Entre a API nova e o web novo, **não** conceda "sem vencimento": o web atual
não abre a ficha de um estabelecimento nesse estado (ver "Compatibilidade").
O web atual não tem tela para isso, então só aconteceria por chamada direta.

Não há variável nova.

### 8. Publicar o web

`agenda-cloud-piloto-web`, mesmo `<sha>`. Testes manuais:

1. `/login` responde `200`.
2. Um `MASTER_OWNER` abre `/plataforma`: lista, ficha (validade, preço por
   ciclo como **pendente** enquanto não houver preço aprovado) e histórico.
3. Dono → agenda: uma reserva antiga abre com o nome atual do serviço; criar
   reserva com um serviço funciona como antes.
4. Um gerente e um profissional entram e veem o mesmo que antes.
5. O link público `/agendar/<slug>` abre.
6. **Não cadastre preço, contrato, pagamento ou "sem vencimento" só para
   testar:** cada registro é real e auditado. Preço, só o aprovado.

### 9. Limpeza

Feche as janelas, remova a worktree
(`git -C C:\Projetos\Agenda-Cloud worktree remove C:\Projetos\Agenda-Cloud-publicacao-portal`)
e mantenha a pasta de operações.

## Levantamento

Fases `preparar`, `restauracao`, `aplicar` e `conferir`, e a consulta
`consultas/impacto-portal-multisservicos-somente-leitura.sql`: **só leitura**,
só ids, papéis, situações e contagens.

| Saída | Significado |
| --- | --- |
| `MARCADOS_COMO_ANTERIORES`, `PERIODOS_DE_ACESSO` | registros comerciais existentes; iguais antes e depois de cada etapa |
| `PAGOS_SEM_ORIGEM_DO_VALOR` | depois da etapa 1: todos os pagos existentes, sem origem (não é inventada) |
| `PRECOS_DO_CATALOGO`, `PRECOS_CONTRATADOS`, `SEM_VENCIMENTO` | depois da etapa 1: 0 até a administração registrar algo |
| `RESERVAS`, `ITENS_DE_RESERVA`, `RESERVAS_COM_VARIOS_ITENS`, `RECEBIMENTOS` | iguais antes e depois de cada etapa; antes desta versão, nenhuma reserva com vários itens |
| `ITENS_SEM_NOME_CONGELADO` | depois da etapa 2: todos os itens existentes |
| `PROPRIETARIOS_ATIVOS` | `MASTER_OWNER` ativos: quem entra no portal com a API nova (precisa ser 1 ou mais) |
| `DELEGADOS_ATIVOS_QUE_PERDEM_O_PORTAL` | `MASTER_ADMIN`/`MASTER_SUPPORT` ativos: perdem o portal com a API nova |
| `CONVITES_DE_PLATAFORMA_PENDENTES` | por papel; um convite pendente com papel delegado, se aceito, grava um papel sem efeito na API nova |
| `CONTA_COM_PAPEL_GLOBAL` | uma linha por conta (id, papel, situação, vínculos de dono, data de criação) |

## Contas com papel global

O levantamento lista as contas com papel global **só por id**. A conferência
de quem são (nome e e-mail) é feita **à parte, com autorização expressa do
dono para essa leitura**, pela consulta
`consultas/contas-com-papel-global-somente-leitura.sql` (só leitura; não copie
o resultado para o repositório nem para notas). Nenhuma fase altera papel,
permissão, situação ou convite: promover, rebaixar ou bloquear é decisão do
dono, por procedimento próprio.

## Códigos de parada próprios deste kit

| Código | Fase | Significado | Gravou algo no piloto? |
| --- | --- | --- | --- |
| `ERR_ETAPA_INVALIDA` | todas menos `conferir` | etapa ausente ou desconhecida | não |
| `ERR_ETAPA_ANTERIOR_PENDENTE` | preparar, aplicar | etapa 2 com o banco ainda no estado antes | não |
| `ERR_ETAPA_JA_APLICADA` | preparar, aplicar | o banco já passou do estado "antes" da etapa | não |
| `ERR_ESTADO_ANTES_DIVERGENTE` | preparar, aplicar | nenhum dos três estados | não |
| `ERR_SEM_PROPRIETARIO_ATIVO` | preparar, aplicar (etapa 1) | nenhum `MASTER_OWNER` ativo | não |
| `ERR_MIGRATIONS_COMPILADAS_INESPERADAS` | aplicar, restauracao | o build não tem exatamente as catorze, na ordem | não |
| `ERR_MIGRATION_FALHOU` | aplicar | o banco recusou e o estado "antes" foi confirmado intacto | não |
| `ERR_RESULTADO_INCERTO` | aplicar | conexão perdida depois do início | **talvez**: rode `conferir` |

Os demais (`ERR_AJUSTE_DE_ENSAIO_NO_PILOTO`, `ERR_OPCOES_DO_NODE_NO_PILOTO`,
`ERR_CERTIFICADO_NAO_CONFIAVEL`, `ERR_SEM_BACKUP_COM_RESTAURACAO_CONFERIDA`,
`ERR_RESULTADO_ANTERIOR_INCERTO`, `ERR_BACKUP_DE_OUTRO_COMMIT`,
`ERR_BACKEND_COM_ALTERACOES_LOCAIS`...) são os de `publicacao-equipe-piloto.md`.

## Resultado incerto

Igual a CommercialAccess, com uma diferença: uma execução sem desfecho de
**qualquer** das duas etapas bloqueia as **duas** (a etapa 2 depende do
resultado da 1). Depois de uma queda, o script nunca conclui "nada aplicado";
a próxima `aplicar` para antes da URL; só uma `conferir` posterior que
identifique um dos três estados, sem sessão de migration ativa, libera o
registro. Ensaiado nos dois sentidos (queda no lugar do COMMIT da etapa 1:
`before-platform-portal`; queda logo depois do COMMIT da etapa 2:
`after-appointment-snapshots`).

## Compatibilidade

Ensaio de 03/11/2026: API anterior (`99242a6`, a publicada) e API nova
(integration `96415bc`, igual à do kit no backend da aplicação) contra o
mesmo banco descartável, nos três estados; os webs anterior e novo pelas
funções reais de cada um (`src/lib/api/*`, `src/lib/administracao/contratos.ts`)
contra as respostas reais de cada API. No estado final, a API nova gravou
antes: preço do catálogo, preço contratado, pagamento pelo valor contratado
(`amountSource: CONTRACT`), "sem vencimento" num estabelecimento com cortesia
vencida, reserva com dois serviços e renomeação de um serviço.

### API

| Estado | API anterior | API nova |
| --- | --- | --- |
| 12 | tudo 200 (situação de hoje) | login de dono e profissional **500**; ficha **500**: não use |
| 13 (intermediário) | tudo 200, inclusive criar reserva e registrar pagamento (fica sem origem do valor) | agenda, reserva e recebimentos **500**: não use |
| 14 (final) | funciona, com as diferenças abaixo | tudo 200; é o destino |

API anterior no estado final, **depois** de a API nova ter gravado:

- **"Sem vencimento" é ignorado:** o estabelecimento volta a ser bloqueado
  (403 `ACESSO_VENCIDO`) enquanto ela estiver no ar; volta a valer com a API
  nova (ensaiado).
- **Reserva com vários serviços aparece como se fosse só o primeiro:**
  duração e preço do primeiro serviço; o fim da ocupação continua o certo.
  Remarcar pela API anterior preserva a ocupação inteira (ensaiado: 50 min de
  atendimento + 5 de intervalo continuaram 55 min, com os dois itens).
- **`MASTER_ADMIN` e `MASTER_SUPPORT` voltam a entrar no portal** (regra
  anterior). Isso desfaz uma regra de acesso da versão nova.
- Preço do catálogo e contrato não existem para ela; o pagamento registrado
  por ela fica sem origem (a API nova mostra "não registrado").
- Nada é apagado: com a API nova de volta, reserva, nomes congelados,
  contrato, origem e "sem vencimento" continuam iguais (ensaiado).

### Web

| Combinação (estado final) | Resultado |
| --- | --- |
| web anterior × API nova | sessão, serviços, agenda, recebimentos, criar reserva de um serviço, lista e ficha do portal: ok. **A ficha de um estabelecimento com "sem vencimento" não abre** (o validador anterior não conhece o estado `NO_EXPIRY`). Reserva com vários serviços aparece com o primeiro serviço e o horário de fim certo. Não há como criar reserva múltipla nem cadastrar preço |
| web nova × API nova | tudo ok |
| web nova × API anterior | **criar reserva falha** (400: a API anterior exige `serviceId`); as telas de preço e "sem vencimento" chamam rotas que a API anterior não tem. Não use |
| web anterior × API anterior | igual a hoje, com as diferenças da API anterior acima |

### Combinações e recuperação

| Combinação | Funciona? | É recuperação segura? |
| --- | --- | --- |
| API e web anteriores no estado 13 (entre as etapas) | sim | é o estado de passagem previsto |
| API e web anteriores no estado 14, antes de publicar a API nova | sim | sim (nada novo foi gravado ainda) |
| API nova + web anterior (entre os dois deploys) | sim, menos a ficha com "sem vencimento" | sim, como janela curta e para **voltar só o web** |
| API nova + web novo | sim | destino |
| API anterior depois de usar a versão nova | parcialmente | **não**: tira o "sem vencimento" de quem o tem, mostra reserva múltipla errada e devolve o portal aos papéis delegados |
| web novo + API anterior | não | **não** |
| `down` das migrations | tecnicamente | **não** (ver "Migrations") |

## Recuperação

**Regra geral:** não apague preços, contratos, "sem vencimento", períodos,
reservas nem itens; não use `migration:revert`; nunca restaure o backup por
cima do piloto. **Nenhuma dessas é recuperação padrão.** O backup serve para
restaurar numa cópia e consultar, ou para uma decisão excepcional e explícita
do dono, sabendo que tudo gravado depois dele se perde.

**Ordem:** publicar é **etapa 1 → etapa 2 → API → web**. Nunca deixe o web
novo no ar com a API anterior.

| Sintoma | Ação | Pare e não siga se |
| --- | --- | --- |
| falha numa etapa, nada gravado (`ERR_MIGRATION_FALHOU`) | repetir a fase `aplicar` da mesma etapa em outro momento | — |
| resultado incerto | `conferir`; seguir a partir do estado lido | `divergente` |
| defeito de tela do web novo, API nova sã | **voltar só o web** para `99242a6` | houver estabelecimento com "sem vencimento" que precise ser administrado |
| defeito da API nova | **corrigir para frente** (commit novo, revisado, com checks, API → web) | a correção não estiver pronta: **interrupção controlada** (suspender a API no Render, como no runbook comercial; não ensaiado) |
| defeito grave da API nova e o dono decide voltar a API anterior | só com decisão explícita, sabendo das consequências em "Compatibilidade" | — |
| problema de dados depois de uma migration | **parar** e investigar numa cópia restaurada | sempre |

### Migrations

**`migration:revert`: não use.** Ensaiado numa cópia do estado final com os
dados gravados pela API nova (1 preço do catálogo, 1 preço contratado, 1 "sem
vencimento", 1 pagamento com origem, 1 reserva com dois serviços, 4 itens com
nome congelado):

| O `down` faz | Consequência |
| --- | --- |
| AppointmentServiceSnapshots: apaga `appointment_items.service_name_snapshot` | **perde os nomes congelados** (4 no ensaio): reservas passam a mostrar o nome atual do serviço. Os itens e a reserva com dois serviços **ficam** (as versões anteriores mostram só o primeiro) |
| PlatformPortal: `DROP TABLE tenant_no_expiry_grants` | **perde todo "sem vencimento"**, inclusive o histórico de concessão e retirada; o estabelecimento volta a depender da validade |
| `DROP TABLE tenant_contract_prices` | **perde todos os preços contratados** |
| `DROP TABLE plan_prices` | **perde o histórico de preços do catálogo** |
| apaga `tenant_access_periods.amount_source` | perde a origem do valor dos pagamentos; os períodos e valores ficam |
| mantém os valores novos de `audit_action` e os registros de auditoria | o histórico continua legível (o registro de "sem vencimento" guarda motivo e id, não a concessão) |

Aplicar de novo depois do `down` cria as tabelas **vazias**: o que foi
apagado não volta. A fase `conferir` mostra `REVERSAO_AFETARIA_*` com as
contagens reais antes de qualquer decisão.

## Ensaio (03/11/2026)

Nada foi executado contra o Neon, o piloto ou `agenda_dev`;
`IGNORE_DOTENV_FILE=true`; só dados fictícios.

### Ambiente

- **Destino:** PostgreSQL **17.11** local (binários oficiais para Windows,
  zip da EDB baixado por HTTPS, sem assinatura Authenticode; sha256
  `6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3`), só
  `hostssl` com `scram-sha-256`, certificado de uma CA descartável para o host
  fictício `ep-ensaio-piloto-444.c-2.us-east-1.aws.neon.tech` (conexão
  desviada para 127.0.0.1 pelo modo ensaio), banco `neondb` com dono **não
  superusuário**; doze migrations pelo runtime da versão publicada (`99242a6`).
- **Dados:** cinco estabelecimentos (anterior ao controle; pago em curso com um
  pago anulado; teste vencido, bloqueado; cortesia vencida, bloqueado;
  suspenso), contas `MASTER_OWNER` ativa e suspensa, `MASTER_ADMIN`,
  `MASTER_SUPPORT`, dono, gerente confirmado, profissional, serviços com e sem
  intervalo, reservas antigas passada e futuras (um item cada, sem nome
  congelado), recebimentos (um estornado), auditoria e um convite de
  plataforma pendente com papel delegado.
- **Commit do kit ensaiado:** `e0bdb77fc181aa017eb7f3b4d5bfaa325dde5e84`. Antes,
  em `f3552258d891e775ae33ade5cd5b7412286eb299`, rodaram `conferir`, `preparar`
  e as recusas; a restauração ali achou o defeito corrigido em `e0bdb77` (a
  etapa 1 carregava as duas migrations). Os commits depois de `e0bdb77` só
  mudam documentação: conferir com `git diff e0bdb77 <sha> -- backend`, que
  deve sair vazio.

### Execução oficial, harness e limitações

- **Lançador oficial** (`abrir-portal-multisservicos-piloto.ps1`, sem nada no
  meio): fase `restauracao` da etapa 1 completa, com os binários 17.11.
- **Scripts oficiais com terminal simulado** (harness fora do repositório,
  carregado por `node --import`, que o modo piloto recusa): `preparar`,
  `aplicar` e `conferir` de todos os casos abaixo e a restauração da etapa 2.
  O harness só substitui o terminal e, nos casos de queda, derruba o socket no
  cliente. **Não é prova do lançador** nessas fases.

### Resultados

| Caso | Como | Resultado |
| --- | --- | --- |
| `conferir` antes | harness | `ESTADO: before-platform-portal`, 12, 0/36; levantamento só com ids |
| etapa 2 com o banco no estado antes | harness | `ERR_ETAPA_ANTERIOR_PENDENTE`, nenhum backup |
| `preparar` etapa 1 | harness | SUCCESS; backup de 154 KB, 41 tabelas |
| `aplicar` sem restauração conferida | harness | `ERR_SEM_BACKUP_COM_RESTAURACAO_CONFERIDA`, antes da URL |
| restauração com o backup de outro commit | script direto | `ERR_BACKUP_DE_OUTRO_COMMIT` |
| restauração etapa 1 | **lançador** | 41 tabelas iguais; só PlatformPortal na cópia (`FORA_DESTA_ETAPA`); todas as linhas `ENSAIO_*` `true`; descartável apagado |
| frase errada | harness | abortado; 12 migrations, enum e tabelas intocados |
| outra sessão segurando `tenant_access_periods` | harness | `55P03` em ~10 s; `before-platform-portal` intacto; nenhum valor de enum gravado |
| queda no lugar do COMMIT (etapa 1) | harness | `ERR_RESULTADO_INCERTO`; `aplicar` das **duas** etapas bloqueada antes da URL; `conferir`: `before-platform-portal` |
| `aplicar` etapa 1 | harness | só PlatformPortal; `after-platform-portal` 13, 35/36; contagens iguais ao backup; 2 pagos sem origem; tabelas novas vazias |
| `aplicar` etapa 1 de novo | harness | `ERR_ETAPA_JA_APLICADA` |
| `conferir` intermediário | harness | `ESTADO: after-platform-portal`; `REVERSAO_AFETARIA_*` |
| `preparar` e restauração etapa 2 | harness | SUCCESS, 44 tabelas; só AppointmentServiceSnapshots na cópia; 3 itens sem nome congelado; demais linhas `true` |
| queda logo depois do COMMIT (etapa 2, numa cópia do intermediário) | harness | `ERR_RESULTADO_INCERTO` com 14 no banco; `aplicar` bloqueada; `conferir`: `after-appointment-snapshots`; `aplicar`: `ERR_ETAPA_JA_APLICADA` |
| `aplicar` etapa 2 (no intermediário original) | harness | só AppointmentServiceSnapshots; 14, 36/36; contagens iguais ao backup |
| `conferir` final | harness | `ESTADO: after-appointment-snapshots`; `REVERSAO_AFETARIA_*` |
| modo piloto com CA do ensaio / com `--import` / com endpoint de ensaio / etapa inválida | script direto | `ERR_AJUSTE_DE_ENSAIO_NO_PILOTO` / `ERR_OPCOES_DO_NODE_NO_PILOTO` / `ERR_ENDPOINT_DE_ENSAIO_NO_PILOTO` / `ERR_ETAPA_INVALIDA`, antes da URL |
| senhas do banco em `operacoes.jsonl`, manifestos e saídas | — | nenhuma ocorrência |

Testes automáticos: `portal-multisservicos-piloto.spec.ts` e
`lib/portal-multisservicos-schema.spec.ts` (regras puras e nomes conferidos
contra o texto das migrations), `operacao-piloto.spec.ts` (migrations
posteriores) e `test/pilot-portal-multisservicos-check.db-e2e-spec.ts` (a
conferência e as duas consultas contra o banco com as catorze migrations).

### Limitações

- As quedas foram simuladas no cliente, não por falha de rede do Neon.
- O lançador foi exercido por inteiro só na restauração da etapa 1; as outras
  fases rodaram com terminal simulado. A colagem real com Ctrl+V é a ensaiada
  nas publicações anteriores.
- O banco descartável é PostgreSQL local no Windows, não o Neon.
- A conferência posterior que falha depois de um COMMIT confirmado (saída 2)
  não foi repetida neste kit: o código é o mesmo de CommercialAccess, onde foi
  ensaiado.
- Os webs foram conferidos pelas funções reais de cada um contra respostas
  reais, **não no navegador**; nenhuma tela foi aberta neste ensaio.
- A troca de API no Render e a suspensão do serviço **não** foram ensaiadas.
- A versão Live do Render é registrada como `99242a6` na continuidade; confira
  no painel antes de publicar.
- Os dados reais do piloto não foram lidos: quantos estabelecimentos, períodos,
  reservas e contas com papel global existem só o `preparar` dirá.
