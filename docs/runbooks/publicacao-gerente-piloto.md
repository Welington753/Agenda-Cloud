# Runbook — Publicar gerente e login interno no piloto (PR #77)

Este runbook leva o piloto das dez migrations atuais até
`TeamManagerAccess1793145600000` e depois publica a API e o web do PR #77.
Regras do lote em `docs/plans/equipe-gerente-login-interno.md`; estado entre
sessões em `continuidade-gerente-piloto.md`.

## Estado em 28/10/2026

**Preparação concluída** neste repositório, sem tocar no piloto:

- Procedimento em `backend/scripts/`, no mesmo molde de TeamAccess
  (`publicacao-equipe-piloto.md`) e com as mesmas peças comuns
  (`operacao-piloto.mjs`, `entrada-oculta.mjs`, `equipe-piloto.mjs`):
  - `abrir-gerente-piloto.ps1`: lançador (por `-File`);
  - `aplicar-gerente-piloto.mjs`: fases `preparar`, `aplicar` e `conferir`;
  - `conferir-restauracao-gerente.mjs`: fase `restauracao`;
  - `gerente-piloto.mjs`: o que é desta operação (nome, frase, estados,
    comprovante, execução pendente, colisão);
  - `lib/gerente-acessos-schema.ts`: conferência `before`/`after` e
    levantamento das vagas e das colisões.
- Consulta só leitura para revisão: `consultas/impacto-gerente-somente-leitura.sql`.
- Ensaio completo em PostgreSQL 17.11 descartável (seção "Ensaio") e ensaio
  de retorno com a versão publicada `96f5417` (seção "Recuperação").

**Operação no piloto: nada executado.** Nenhuma conexão com o piloto, nenhum
backup, **TeamManagerAccess não foi aplicada** e nada foi publicado no Render.

**Estado esperado do piloto:** dez migrations, até
`AppointmentPayments1793059200000` (registrado no PR #74). `StaffLogin` e
`AppointmentPayments` **já estão aplicadas: não as repita.** Este procedimento
só aceita `TeamManagerAccess1793145600000` como pendente; com qualquer outro
histórico, para antes de escrever.

**A API nova só pode ser publicada depois de `ESTADO: after`.** Com o schema
anterior ela sobe e o dono entra, mas a tela de equipe e o login de um gerente
antigo com ajuste `GRANTED` respondem 500 (`column permissions_confirmed_at
does not exist`; ensaiado).

## O que publicar

O commit de `integration/nestjs-typeorm-frontend` que contiver o PR #77. Use
**o mesmo SHA** em todas as fases e nos dois deploys. A fase `restauracao`
recusa backup de outro commit; a fase `aplicar` recusa backup ou restauração
de outro commit.

## Pré-requisitos (uma vez)

Os mesmos de `publicacao-equipe-piloto.md`: Windows Terminal, Node 24,
PostgreSQL para Windows com `pg_dump`, `pg_restore`, `initdb` e `pg_ctl` de
versão **igual ou maior que a do servidor do piloto** (`-PgBin`), `openssl.exe`
do Git, a URL direta do piloto, o Endpoint ID do piloto e o Endpoint ID
proibido, e a pasta `%USERPROFILE%\AgendaCloud-operacoes` fora do repositório.
A pasta guarda dumps completos, com hashes de senha.

## Passo a passo

Qualquer `ERRO:` para o procedimento; vale então "Recuperação".

### 0. Pasta limpa do commit

```powershell
git -C C:\Projetos\Agenda-Cloud fetch origin
git -C C:\Projetos\Agenda-Cloud worktree add --detach C:\Projetos\Agenda-Cloud-publicacao-gerente <sha>
cd C:\Projetos\Agenda-Cloud-publicacao-gerente\backend
npm ci
```

`node_modules` próprio, nunca junção para o do clone principal.

### 1. Preparar: só leitura no piloto

```powershell
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File C:\Projetos\Agenda-Cloud-publicacao-gerente\backend\scripts\abrir-gerente-piloto.ps1 -Fase preparar -PilotEndpointId <ep-piloto> -ProductionEndpointId <ep-proibido>
```

Confira `Modo: PILOTO (Neon real)`, a fase, o commit e as pastas. Cole a URL
direta uma vez (nada aparece) e pressione Enter uma vez. Esperado:

```text
--- PILOT_EXPECT=before-team-manager
MIGRATIONS_APPLIED: 10
SCHEMA_OBJECTS_OK: 0/9
LOGIN_IDENTIFIER_COLLISIONS: 0
BASELINE_FAILURES: none
RESULT: SUCCESS
--- Vagas de equipe e colisões de login (só leitura; nada é alterado)
GERENTES_ATIVOS: ...
PASSAM_ACIMA_DO_LIMITE: ...
COLISOES_DE_LOGIN: 0
BACKUP_OK: <bytes> bytes sha256=... tabelas=40
RESULTADO: preparado, nada gravado no banco
```

`before-team-manager` exige exatamente as dez migrations, os objetos de
StaffLogin e AppointmentPayments de que a migration depende, nenhum objeto
novo, o formato anterior de `ck_users_username_format` e **nenhuma colisão**
(login de uma conta igual ao e-mail de outra). Com colisão, a fase para em
`ERR_COLISAO_DE_LOGIN` **antes do backup**, lista só os pares de ids
(`COLISAO: login_user=... email_user=...`) e não altera nada. Cada caso é
decidido por uma pessoa; nenhum script resolve colisão. Pelo formato anterior,
um login nunca tem `@`, então só um e-mail gravado sem `@` (fora da aplicação)
pode colidir.

Leia o levantamento das vagas antes de seguir (seção "Vagas").

### 2. Restauração: sem conexão com o piloto

```powershell
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File C:\Projetos\Agenda-Cloud-publicacao-gerente\backend\scripts\abrir-gerente-piloto.ps1 -Fase restauracao -PgBin <pasta bin>
```

Restaura o backup `gerente-*` mais recente num PostgreSQL descartável local
(TLS verificado, senha aleatória), compara contagem e md5 de cada tabela com o
manifesto, roda `before`, aplica TeamManagerAccess na cópia pelo mesmo código
da fase `aplicar` e confere `after`. Esperado:

```text
SHA256_CONFERE: true
CONTAGENS_IGUAIS: true
CONTEUDO_IGUAL_MD5: true
ENSAIO_BEFORE: ok
APLICADAS: TeamManagerAccess1793145600000
ENSAIO_AFTER: ok
ENSAIO_DADOS_PRESERVADOS: true
ENSAIO_COLUNAS_ANTIGAS_IGUAIS: true (memberships)
ENSAIO_USERS_IGUAL: true
ENSAIO_NADA_CONFIRMADO_NEM_CONCEDIDO: true (confirmados=0 ajustesNovos=0)
ENSAIO_LEVANTAMENTO_IGUAL: true
ENSAIO_HISTORICO_MAIS_UMA: true
DESCARTAVEL_APAGADO: true
```

`ENSAIO_USERS_IGUAL` prova que a constraint e o gatilho novos não reescrevem
nenhuma conta; `ENSAIO_NADA_CONFIRMADO_NEM_CONCEDIDO`, que nenhum gerente
ganha acesso sozinho.

### 3. Aplicar: única etapa que escreve no piloto

Escolha um momento de pouco uso. A migration leva menos de um segundo, mas
precisa de lock exclusivo curto em `memberships` e `users`. Se uma requisição
segurar uma delas, a migration desiste em 10 s (`lock_timeout`) e o banco
desfaz tudo.

```powershell
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File C:\Projetos\Agenda-Cloud-publicacao-gerente\backend\scripts\abrir-gerente-piloto.ps1 -Fase aplicar -PilotEndpointId <ep-piloto> -ProductionEndpointId <ep-proibido>
```

1. Antes da URL: recusa execução anterior sem desfecho
   (`ERR_RESULTADO_ANTERIOR_INCERTO`) e exige o backup do passo 1 com a
   restauração do passo 2 conferida (mesmo modo, endpoint e commit, de até
   24 h).
2. Repete destino, TLS, `before-team-manager` e o levantamento (para de novo
   com colisão).
3. Faz um **backup novo** e confere que vem do mesmo servidor do backup
   conferido.
4. Pede a frase. Confira `RESULT: SUCCESS`, `BACKUP_OK` e
   `MESMO_SERVIDOR_DO_BACKUP_CONFERIDO: sim`, e digite:

   ```text
   APLICAR TeamManagerAccess1793145600000
   ```

5. Registra `migration_iniciada` e aplica só a pendente esperada, numa
   transação, com `lock_timeout` de 10 s e `statement_timeout` de 120 s.
6. Roda `after-team-manager`.

Esperado:

```text
PENDENTE: TeamManagerAccess1793145600000
APLICADAS: TeamManagerAccess1793145600000
SESSAO_DA_MIGRATION: mesma=true lock_timeout=10s
COMMIT: ok
--- PILOT_EXPECT=after-team-manager
MIGRATIONS_APPLIED: 11
SCHEMA_OBJECTS_OK: 9/9
BASELINE_FAILURES: none
RESULT: SUCCESS
RESULTADO: TeamManagerAccess1793145600000 aplicada e conferida
```

| Mensagem final | Significado | Ação |
| --- | --- | --- |
| `... aplicada e conferida` | gravada e `after` ok | passo 5 |
| `... FOI APLICADA (COMMIT confirmado), mas a conferência posterior falhou` (saída 2) | gravada; só a leitura depois falhou | **não** rode `aplicar`; rode `conferir` |
| `ERR_RESULTADO_INCERTO` | conexão perdida depois do início | **não** rode `aplicar`; rode `conferir` |

### 4. Conferir: só leitura, quando quiser

```powershell
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File C:\Projetos\Agenda-Cloud-publicacao-gerente\backend\scripts\abrir-gerente-piloto.ps1 -Fase conferir -PilotEndpointId <ep-piloto> -ProductionEndpointId <ep-proibido>
```

| Saída | Significado |
| --- | --- |
| `ESTADO: before` | TeamManagerAccess **não** aplicada |
| `ESTADO: after` | aplicada e conferida; mostra também `REVERSAO_AFETARIA_*` |
| `ESTADO: divergente` | nem before nem after (ex.: colisão antiga): não aplique nem publique |
| `ERRO: ERR_CONFERENCIA_SEM_LEITURA` / `ERR_SEM_CONEXAO` | o banco não foi lido; repita |
| `SESSOES_DA_MIGRATION_ATIVAS: n>0` | a migration ainda roda; espere e repita |

### 5. Publicar a API

Só depois de `ESTADO: after`. Render, `agenda-cloud-piloto-api`: **Manual
Deploy → Deploy a specific commit → `<sha>`**. Espere **Live** e confira:

- `GET $WEB/agenda_api/auth/me` sem cookie: `401`;
- o dono entra pelo e-mail (com o web atual);
- **Equipe e acessos** do web atual continua listando os profissionais.

Não há variável nova.

### 6. Publicar o web

`agenda-cloud-piloto-web`, mesmo `<sha>`. Confira:

1. `/login` responde `200` e mostra "E-mail ou login".
2. Como dono: **Equipe e acessos** mostra os acessos, as vagas (gerentes
   contando) e "Permissões a confirmar" nos gerentes antigos.
3. Não crie conta real só para testar: cada acesso ocupa vaga.

### 7. Limpeza

Feche as janelas, remova a worktree
(`git -C C:\Projetos\Agenda-Cloud worktree remove C:\Projetos\Agenda-Cloud-publicacao-gerente`)
e mantenha a pasta de operações.

## Vagas

O levantamento (fases `preparar`, `restauracao`, `aplicar` e `conferir`, e a
consulta `consultas/impacto-gerente-somente-leitura.sql`) é **só leitura**.
Regra de `team/seats.ts`: ocupam vaga os vínculos `PROFISSIONAL` e `GERENTE`
**ativos**, inclusive gerentes antigos, mais os convites de funcionário
pendentes no prazo, contra `plans.max_professionals`. O dono não conta.

| Saída | Significado |
| --- | --- |
| `VAGAS_ACIMA_DO_LIMITE_ANTES` | já acima pela regra anterior |
| `PASSAM_ACIMA_DO_LIMITE` | ficam acima só porque gerentes passam a contar |
| `PASSAM_AO_LIMITE` | ficam exatamente no limite: o próximo é recusado |
| `GERENTES_COM_AJUSTES_CONCEDIDOS` | `GRANTED` antigo gravado, que continua sem valer até o dono confirmar |
| `VAGAS: tenant=... slug=... antes=... depois=...` | um estabelecimento com gerente ou acima (só ids, slug e contagens) |

Acima do limite, nada é cortado nem concedido (`team-manager-postgres.db-e2e-spec.ts`):
acessos, suspensões e permissões ficam como estão; confirmar permissões
funciona; **criar acesso, convidar e reativar** são recusados com
`LIMITE_DO_PLANO` até sobrar vaga. A decisão de liberar vaga é do dono.

## Códigos de parada próprios deste lote

| Código | Fase | Significado | Gravou algo no piloto? |
| --- | --- | --- | --- |
| `ERR_COLISAO_DE_LOGIN` | preparar, aplicar | login de uma conta igual ao e-mail de outra | não |
| `ERR_TEAMMANAGERACCESS_JA_APLICADA` | preparar, aplicar | o piloto já está em `after` | não |
| `ERR_ESTADO_ANTES_DIVERGENTE` | preparar, aplicar | histórico ou schema fora de `before-team-manager` | não |
| `ERR_MIGRATION_FALHOU` | aplicar | o banco recusou (ex.: `55P03`) e `before` foi confirmado intacto | não |
| `ERR_RESULTADO_INCERTO` | aplicar | conexão perdida depois do início | **talvez**: rode `conferir` |

Os demais (`ERR_AJUSTE_DE_ENSAIO_NO_PILOTO`, `ERR_CERTIFICADO_NAO_CONFIAVEL`,
`ERR_SEM_BACKUP_COM_RESTAURACAO_CONFERIDA`, `ERR_RESULTADO_ANTERIOR_INCERTO`,
`ERR_BACKEND_COM_ALTERACOES_LOCAIS`...) são os de `publicacao-equipe-piloto.md`.

## Resultado incerto

Igual a TeamAccess: depois de uma queda, o script nunca conclui "nada
aplicado"; a próxima `aplicar` para antes da URL; só uma `conferir` posterior
com `ESTADO: before` ou `after` e nenhuma sessão da migration ativa libera o
registro. Ensaiado nos dois sentidos (queda antes do último comando: `before`;
queda logo depois do COMMIT: `after`).

## Recuperação

**Regra geral:** não apague contas, vínculos, permissões, convites nem
histórico; não use `migration:revert`; nunca restaure o backup por cima do
piloto.

Ensaio de 28/10/2026, com o schema novo e dados gravados pela API nova
(dono por e-mail; gerentes `recepcao@retorno.test`, `maria@retorno` com senha
temporária, `gerente.retorno` e um suspenso; profissionais `bia@retorno.test`
e `rui.retorno`; sessões abertas de todos; permissões confirmadas; um
estabelecimento de 2 vagas com 2 acessos).

### Voltar só o web para `96f5417` (API nova continua)

Comprovado no navegador, web `96f5417` contra a API nova:

- **Entrar continua funcionando** para todos: dono por e-mail, logins sem `@`
  e logins com `@`, com ou sem domínio de e-mail (o web antigo manda o corpo
  `email`; a API nova o confere como e-mail **ou** login). Senha temporária
  continua levando à troca obrigatória.
- **Profissionais:** "Minha agenda" funciona.
- **Gerentes:** o web antigo mostra só Configurações ("Este papel não tem área
  liberada"). **Isso não revoga nada no servidor:** com a mesma sessão, a API
  nova continua respondendo 200 na agenda geral para quem tem a permissão, com
  o mesmo recorte de telefone, observações e preço.
- **Dono:** a tela antiga de equipe mostra só os profissionais; as vagas já
  contam os gerentes. Gerentes **não aparecem** e não podem ser suspensos,
  removidos nem ter permissões alteradas por ela.

Use para um defeito só do web. Se for preciso cortar o acesso de um gerente
nesse período, volte o web novo; nenhum outro caminho foi ensaiado.

### Voltar a API (e o web) para `96f5417`

O web novo depende das rotas novas; volte os dois. Comprovado com a API
`96f5417` no schema novo:

- **continua valendo:** sessões abertas (inclusive criadas pela API nova);
  suspensão; troca obrigatória; profissionais com sessão aberta mantêm a
  agenda própria;
- **gerentes ficam sem acesso (falha fechada):** 403 em agenda, clientes,
  recebimentos, solicitações e equipe; nenhum telefone, observação ou preço
  sai. As permissões continuam gravadas e confirmadas e voltam a valer com a
  API nova;
- **deixa de entrar:** logins com `@` (`401` com domínio, `400` sem). Logins
  sem `@` e o dono entram;
- **vagas:** a API antiga conta só `PROFISSIONAL`. No ensaio, o dono criou um
  acesso que deixou o estabelecimento com 3 acessos para 2 vagas. Com a API
  nova de volta, o acesso extra continua, nada é cortado e novas criações são
  recusadas (`LIMITE_DO_PLANO`);
- **convite para um e-mail igual a um login interno:** 500 (o gatilho recusa;
  a API antiga não reconhece a recusa). Nada é gravado;
- **gerentes na tela de equipe:** suspender ou gerar senha responde 404.

Depois de voltar a API nova: confira em **Equipe e acessos** os
estabelecimentos acima do limite e os acessos criados no meio-tempo.

### Migration

**`migration:revert`: não use.** O `down` tira o gatilho (o mesmo texto
voltaria a poder ser e-mail de uma conta e login de outra) e a coluna de
confirmação (todos os gerentes voltariam a "a confirmar"), e **recusa** voltar o
formato antigo se existir login com `@`: `conferir` mostra
`REVERSAO_AFETARIA_loginsForaDoFormatoAnterior`. Com a API nova no ar, a
equipe e os gerentes passariam a responder 500.

## Ensaio (28/10/2026)

Nada foi executado contra o Neon, o piloto ou `agenda_dev`;
`IGNORE_DOTENV_FILE=true`; só dados fictícios.

### Ambiente

- **Destino:** PostgreSQL **17.11** (imagem `postgres:17`, Docker local),
  `hostssl` com `scram-sha-256`, certificado de uma CA descartável para o host
  fictício `ep-ensaio-piloto-222.c-2.us-east-1.aws.neon.tech`, banco `neondb`
  com dono não superusuário, dez migrations pelo runtime compilado.
- **Dados:** dono, gerente antigo com `GRANTED`, login sem `@`, convite de
  funcionário pendente, sessões, conta de plataforma, um estabelecimento que
  passa acima do limite (2 vagas, 2 profissionais e 1 gerente).
- **Procedimento:** commit `98c0d968ca03a0c8ebd600368d1cc2b4839a7645`, modo
  ensaio, harness fora do repositório por `--import` (terminal simulado e
  quedas de conexão). Os scripts do procedimento e a migration não mudaram
  depois dele.

### Resultados

| Caso | Resultado |
| --- | --- |
| `conferir` antes | `ESTADO: before`, 10 migrations, 0/9 |
| colisão antiga (`preparar`) | `ERR_COLISAO_DE_LOGIN` antes do backup; só ids; md5 de `users` e `memberships` iguais |
| colisão antiga (migration direta, outro banco) | a migration para com a lista; md5, histórico e objetos iguais |
| `preparar` | `before` SUCCESS; `PASSAM_ACIMA_DO_LIMITE: 1`; backup de 144 KB, 40 tabelas |
| `restauracao` | 40 tabelas iguais; migration na cópia; `users` igual; nada confirmado nem concedido; levantamento igual |
| frase errada | abortado, nada gravado |
| outra sessão segurando `memberships` | `55P03` em ~10 s; `before` intacto; nenhum valor de enum gravado |
| queda antes do último comando | `ERR_RESULTADO_INCERTO`; `aplicar` bloqueada antes da URL; `conferir`: `before` |
| `aplicar` | só TeamManagerAccess; `after` 11, 9/9; contagens iguais ao backup |
| `aplicar` de novo | `ERR_TEAMMANAGERACCESS_JA_APLICADA` |
| `conferir` depois | `ESTADO: after`; `REVERSAO_AFETARIA_*` |
| queda logo depois do COMMIT (banco recriado) | `ERR_RESULTADO_INCERTO` com 11 migrations no banco; `aplicar` bloqueada; `conferir`: `after`; `aplicar`: recusa |
| COMMIT ok e conferência posterior sem conexão | `FOI APLICADA ... conferência posterior falhou`, saída 2; `aplicar`: recusa; `conferir`: `after` |
| banco fora do ar | `conferir`: `ERR_SEM_CONEXAO`; `preparar`: `ERR_CONFERENCIA_SEM_LEITURA` |
| modo piloto com CA do ensaio / com `--import` | `ERR_AJUSTE_DE_ENSAIO_NO_PILOTO` / `ERR_OPCOES_DO_NODE_NO_PILOTO`, antes da URL |
| senha do banco em `operacoes.jsonl` e manifestos | nenhuma ocorrência |

### Limitações

- A fase `restauracao` rodou com os binários do PostgreSQL **18.6** desta
  máquina (cópia em 18; destino em 17.11). Os binários Windows do 17 não
  estavam instalados e o download foi bloqueado. No piloto, use `-PgBin` com a
  versão do servidor ou maior.
- A versão do servidor do piloto não foi lida (última conhecida: 17.11).
- As quedas foram simuladas no cliente, não por falha de rede do Neon.
- O lançador `.ps1` não foi aberto pelo `wt.exe` nesta rodada; os scripts
  foram chamados com o mesmo ambiente que ele define. A entrada oculta é a
  mesma ensaiada nas publicações anteriores.
- Web novo com a API antiga não foi ensaiado (por isso: volte os dois).
