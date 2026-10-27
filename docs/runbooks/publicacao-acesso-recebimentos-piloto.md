# Runbook — Publicar acesso de funcionário e recebimentos no piloto (PRs #71, #72 e #73)

Este runbook leva o piloto das oito migrations atuais (até
`TeamAccess1792886400000`) até `StaffLogin1792972800000` e
`AppointmentPayments1793059200000`, aplicadas juntas numa transação. Depois
publica a API e o web de #71 (operação diária), #72 (acesso de funcionário
por usuário) e #73 (recebimentos manuais). Regras dos lotes em
`docs/plans/operacao-diaria-configuracoes.md`.

O procedimento é o mesmo da TeamAccess (`publicacao-equipe-piloto.md`), com
`-Lote acesso-recebimentos`. Pré-requisitos, pasta limpa, entrada oculta,
validação do destino, TLS, backup, restauração e resultado incerto funcionam
como lá. Este documento traz só o que muda.

## Estado em 27/10/2026

**Preparação concluída**, sem tocar no piloto:

- `integration/nestjs-typeorm-frontend` contém #71, #72 e #73 desde
  `0f7bfd30a7b9962dac9aba3a24af2aeda8604f0d`.
- Procedimento na branch `chore/publicacao-staff-pagamentos-piloto`:
  - `backend/scripts/abrir-equipe-piloto.ps1`, agora com `-Lote` obrigatório;
  - `aplicar-equipe-piloto.mjs` e `conferir-restauracao-equipe.mjs`, guiados
    pelo lote (`equipe-piloto.mjs`, `LOTES`);
  - `backend/scripts/lib/acesso-recebimentos-schema.ts`: conferências
    `before-staff-payments` e `after-staff-payments`, levantamento, dados
    novos e o que uma reversão afetaria.
- Ensaio completo contra PostgreSQL descartável (seção "Ensaio").

**Operação no piloto: nada executado nesta rodada.** Nenhuma conexão com o
piloto, nenhum backup, nenhuma migration e nenhum deploy.

### Deploy inesperado (aberto)

- **Registro do GitHub (deployments):** API e web do piloto receberam
  `824463c` (merge de #72) em 27/10/2026, 18:19:50–18:21:53 UTC, com status
  `success`. O título do merge tinha `[skip render]`, o `render.yaml` declara
  `autoDeployTrigger: "off"` e o usuário informou Auto-Deploy Off. A origem
  não foi esclarecida.
- **Ensaio:** `824463c` contra o schema de oito migrations responde
  `GET /` 200 e **login 500** (`StaffLogin` ausente). Contra o schema final,
  login 200.
- **Não conferido:** o que está Live hoje e se o login do piloto está fora.

**Não mescle este PR, não publique e não aplique nada** até conferir no
painel do Render (Events e Settings → Auto-Deploy) o commit Live e a origem
do deploy de 18:19.

## O que publicar

- **Código da API e do web:** o de `0f7bfd30a7b9962dac9aba3a24af2aeda8604f0d`.
- **SHA a usar em todas as etapas:** o commit de
  `integration/nestjs-typeorm-frontend` que contiver este runbook (o merge
  deste PR). Entre `0f7bfd3` e ele só mudam `backend/scripts/` e `docs/`.
  Confira antes de começar:

  ```powershell
  git -C C:\Projetos\Agenda-Cloud diff --stat 0f7bfd30a7b9962dac9aba3a24af2aeda8604f0d <sha> -- . ':!backend/scripts' ':!docs'
  ```

  A saída precisa ser vazia.

Use o mesmo SHA no procedimento e nos dois deploys. As fases recusam backup
ou restauração de outro commit (ensaiado).

## Publicação direta ou em etapas

**Direta.** Aplique as duas migrations e depois publique uma única versão
final da API e, em seguida, do web. Não há deploy intermediário.

Motivos (ver "Compatibilidade"):

- a API publicada antes do incidente (`c77c313`) funciona com o schema de
  dez migrations: ela continua no ar durante a janela entre aplicar e
  publicar;
- `824463c`, se for ela a Live, também funciona com o schema final; aplicar
  as migrations devolve o login a ela;
- as duas migrations só acrescentam e relaxam (`email` opcional, colunas e
  tabelas novas); nenhuma linha existente é reescrita;
- aplicar só `StaffLogin` e publicar `824463c` antes não traz nada que a
  publicação direta não traga, e dobra a janela de operação.

## Sequência

0. **Render:** confira o commit Live dos dois serviços e o Auto-Deploy.
   - Se a API Live for `824463c` e o login estiver fora: o caminho mais curto
     para devolver o login, sem tocar no banco, é Manual Deploy de `c77c313`
     na API e no web. Decisão do usuário.
   - Se Auto-Deploy estiver On em algum serviço, desligue antes do merge
     deste PR.
1. Pasta limpa do `<sha>` com `npm ci` (passo 0 de `publicacao-equipe-piloto.md`).
2. `preparar` → 3. `restauracao` → 4. `aplicar` → 5. `conferir`, todos com
   `-Lote acesso-recebimentos`, no mesmo `<sha>`.
6. Só com `ESTADO: after`: Manual Deploy da API em `<sha>`; quando Live,
   Manual Deploy do web em `<sha>`.
7. Teste manual (seção "Teste manual").

### Comandos

```powershell
$l = 'C:\Projetos\Agenda-Cloud-publicacao\backend\scripts\abrir-equipe-piloto.ps1'
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File $l -Lote acesso-recebimentos -Fase preparar -PilotEndpointId <ep-piloto> -ProductionEndpointId <ep-proibido>
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File $l -Lote acesso-recebimentos -Fase restauracao
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File $l -Lote acesso-recebimentos -Fase aplicar -PilotEndpointId <ep-piloto> -ProductionEndpointId <ep-proibido>
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File $l -Lote acesso-recebimentos -Fase conferir -PilotEndpointId <ep-piloto> -ProductionEndpointId <ep-proibido>
```

Cada janela mostra `Lote: acesso-recebimentos`, o modo, a fase e o commit
completo. Confira antes de colar a URL.

Frase da fase `aplicar`:

```text
APLICAR StaffLogin1792972800000 AppointmentPayments1793059200000
```

### Saídas esperadas

`preparar`:

```text
LOTE: acesso-recebimentos
--- PILOT_EXPECT=before-staff-payments
MIGRATIONS_APPLIED: 8
SCHEMA_OBJECTS_OK: 0/28
BASELINE_FAILURES: none
RESULT: SUCCESS
CONTAS: <n>
ATENDIMENTOS: <n>
SESSOES_ABERTAS: <n>
BACKUP_OK: <bytes> bytes sha256=... tabelas=38
RESULTADO: preparado, nada gravado no banco
```

`before-staff-payments` exige exatamente as oito migrations até TeamAccess,
nenhuma coluna, tabela, constraint ou índice novo e `users.email` ainda
obrigatório. Valores de enum já presentes não contam (`ADD VALUE IF NOT
EXISTS`). Nenhum dado existente faz as migrations falharem: toda conta antiga
tem e-mail e nenhuma tem usuário.

`restauracao`:

```text
ENSAIO_BEFORE: ok
PENDENTES: StaffLogin1792972800000,AppointmentPayments1793059200000
APLICADAS: StaffLogin1792972800000,AppointmentPayments1793059200000
ENSAIO_AFTER: ok
ENSAIO_DADOS_PRESERVADOS: true
ENSAIO_COLUNAS_ANTIGAS_IGUAIS: true (users)
ENSAIO_DADOS_NOVOS_VAZIOS: true
ENSAIO_TABELAS_NOVAS_VAZIAS: true (staff_account_requests,appointment_payments)
ENSAIO_LEVANTAMENTO_IGUAL: true
ENSAIO_HISTORICO_MAIS_2: true
DESCARTAVEL_APAGADO: true
RESULTADO: restauração conferida e StaffLogin + AppointmentPayments ensaiada na cópia
```

`aplicar`:

```text
PENDENTES: StaffLogin1792972800000,AppointmentPayments1793059200000
APLICADAS: StaffLogin1792972800000,AppointmentPayments1793059200000
SESSAO_DA_MIGRATION: mesma=true lock_timeout=10s
MIGRATION_APLICADA: StaffLogin1792972800000,AppointmentPayments1793059200000 em <horário>
--- PILOT_EXPECT=after-staff-payments
MIGRATIONS_APPLIED: 10
SCHEMA_OBJECTS_OK: 28/28
RESULT: SUCCESS
CONTAGENS_DESDE_O_BACKUP: iguais
RESULTADO: StaffLogin + AppointmentPayments aplicada e conferida
```

As duas migrations entram **numa única transação**: ou as duas, ou nenhuma.
O estado intermediário (só `StaffLogin`) não sai deste procedimento; se
aparecer, `conferir` mostra `ESTADO: divergente`.

`users` recebe um `ALTER TABLE` (lock exclusivo curto) e as tabelas novas
apontam para `users`, `tenants` e `appointments`. Se uma requisição segurar
`users`, a migration desiste em 10 s e o banco desfaz tudo (ensaiado:
`55P03`, `before` intacto, `ERR_MIGRATION_FALHOU`). Escolha um momento de
pouco uso.

`conferir` em `after` lista o que só a API nova grava:

```text
ESTADO: after
REVERSAO_AFETARIA_contasSemEmail: <n>
REVERSAO_AFETARIA_contasComUsuario: <n>
REVERSAO_AFETARIA_trocaDeSenhaPendente: <n>
REVERSAO_AFETARIA_pedidosDeAcesso: <n>
REVERSAO_AFETARIA_recebimentosAtivos: <n>
REVERSAO_AFETARIA_recebimentosEstornados: <n>
```

## Códigos de parada novos

Os demais códigos são os de `publicacao-equipe-piloto.md`.

| Código | Fase | Significado | Gravou algo? |
| --- | --- | --- | --- |
| `ERR_LOTE_INVALIDO` | todas | `--lote` ausente ou diferente de `equipe` e `acesso-recebimentos` | não |
| `ERR_LOTE_JA_APLICADO` | preparar, aplicar | o piloto já está em `after-staff-payments` | não |
| `ERR_TEAMACCESS_JA_APLICADA` | preparar, aplicar | rodou com `-Lote equipe` num piloto que já tem TeamAccess | não |
| `ERR_PENDENTES_INVALIDAS` | aplicar, restauracao | lista de pendentes vazia (erro de build) | não |

TeamAccess não se repete: com `-Lote equipe`, o `before-team-access` falha
(oito migrations) e o script para em `ERR_TEAMACCESS_JA_APLICADA` antes de
pedir backup ou frase (ensaiado).

## Compatibilidade

| Código | Schema | Resultado | Como foi visto |
| --- | --- | --- | --- |
| `c77c313` (publicada antes do incidente) | 8 migrations | db-e2e 175/175 | ensaio |
| `c77c313` | 9 e 10 migrations | db-e2e 173/175; as 2 falhas são testes de guarda do piloto que esperam 7/8 migrations | ensaio |
| `c77c313` | 10 migrations com dados novos | ver "Recuperação" | ensaio (`retorno-api-antiga.mjs`) |
| `824463c` (#72) | 8 migrations | `GET /` 200, **login 500** | ensaio (`sonda-login.mjs`) |
| `824463c` | 10 migrations | login 200, sem erro no log | ensaio |
| `3f46cbf` (= árvore de `0f7bfd3`) | 10 migrations com dados mistos | db-e2e 192/192 | ensaio e CI |

## Recuperação

### Nunca reverter as migrations depois da publicação

- `StaffLogin.down` recoloca `email NOT NULL` e falha assim que existir uma
  conta sem e-mail. `AppointmentPayments.down` apaga todos os recebimentos.
- Antes de a API nova gravar qualquer coisa (`REVERSAO_AFETARIA_*` todos 0),
  reverter não é necessário: a API antiga funciona com o schema novo.

### Antes de publicar a API nova

Se `aplicar` terminou com `after` e algo impedir a publicação, nada precisa
ser desfeito. A API e o web atuais continuam funcionando com o schema novo.

### Voltar o código para `c77c313` depois da publicação

Ensaiado com a API `c77c313` contra um banco com dez migrations e dados que
só a API nova grava:

| Fluxo na API antiga | Resultado |
| --- | --- |
| dono: login, `me`, equipe (lista o funcionário sem e-mail), agenda | funciona |
| dono cancela atendimento já quitado | funciona; o recebimento fica intacto (igual à API nova) |
| administração: usuários, ficha do funcionário sem e-mail, histórico com ações novas, membros, ficha do estabelecimento, reautenticação | funciona |
| funcionário sem e-mail entra | **não entra** (400: a API antiga só aceita e-mail). Volta a entrar quando a API nova voltar |
| sessão aberta com **senha temporária** | **continua válida e com acesso total**: a API antiga não conhece a troca obrigatória |
| redefinição de senha pela administração para conta sem e-mail | grava um link que não tem para onde ir; não use |
| recebimentos | ficam no banco e não aparecem; voltam com a API nova |

Procedimento:

1. Rode `conferir` e anote `REVERSAO_AFETARIA_trocaDeSenhaPendente`.
2. Se for maior que 0, as sessões dessas contas precisam ser encerradas
   antes do retorno. Não existe script protegido para isso; é uma gravação
   no piloto e exige decisão explícita. A consulta é:

   ```sql
   UPDATE sessions SET revoked_at = now()
    WHERE revoked_at IS NULL
      AND user_id IN (SELECT id FROM users WHERE must_change_password);
   ```

3. Manual Deploy de `c77c313` no web e depois na API.
4. Avise os donos: funcionários com acesso por usuário ficam sem entrar até a
   API nova voltar.
5. Para voltar: Manual Deploy de `<sha>` na API e depois no web. Nada no banco
   muda.

### Resultado incerto

Igual a `publicacao-equipe-piloto.md`: nunca rode `aplicar` de novo; rode
`conferir`. Ensaiado com a sessão da migration derrubada durante a espera de
lock: `ERR_RESULTADO_INCERTO`; `aplicar` seguinte para em
`ERR_RESULTADO_ANTERIOR_INCERTO`; `conferir` mostra `ESTADO: before`; só
então `aplicar` volta a ser aceito.

## Teste manual depois da publicação

Sem criar estabelecimento de teste e sem enviar mensagem real:

1. `GET $API/` dá 200; `GET $WEB/agenda_api/auth/me` sem cookie dá 401.
2. Dono entra por e-mail. **Início** mostra os cartões de recebido,
   estornado, líquido e ticket médio, sem rolagem lateral no celular.
3. **Agenda:** abrir um atendimento concluído → registrar recebimento (valor,
   forma, data). Apertar o botão duas vezes não cria dois.
4. **Recebimentos** do mês mostra o registro; estornar pede a senha de novo e
   preserva o original.
5. **Equipe e acessos:** criar acesso por usuário para um profissional real
   que vá usar. Entrar com o usuário e a senha temporária: a única tela é a
   troca de senha. Depois de trocar, só a própria agenda.
6. Administração (`MASTER_OWNER`): a ficha do funcionário mostra a conta sem
   e-mail; o histórico mostra `STAFF_ACCESS_CREATED`, `PAYMENT_RECORDED` e
   `PAYMENT_REFUNDED`.
7. Estornar o recebimento de teste do passo 3 se ele não for real.

## Ensaio (27/10/2026)

Nada foi executado contra o Neon, o piloto ou `agenda_dev`. Nenhum `.env` foi
lido (`IGNORE_DOTENV_FILE=true`).

### Ambiente

- PostgreSQL 18.6 descartável em `127.0.0.1`, só `hostssl` com
  `scram-sha-256`, certificado de uma CA descartável para o host fictício
  `ep-ensaio-piloto-111.c-2.us-east-1.aws.neon.tech`.
- Banco `neondb` com dono não superusuário (`neondb_owner`), oito migrations
  e dados fictícios: 11 contas (donos, gerentes, profissionais), 3
  estabelecimentos (um suspenso), 12 atendimentos em quatro situações,
  sessões abertas e histórico.
- Procedimento nos commits `a7f7d6d` e `a58d600` desta branch (o segundo só
  declara as tabelas que o lote cria). Os scripts não mudam depois de
  `a58d600`.
- Harness fora do repositório, por `--import`, simulou o terminal. O modo
  piloto recusa `--import`.

### Resultados

| Caso | Resultado |
| --- | --- |
| `preparar` | `before` SUCCESS (8, 0/28); backup de 135 KB, 38 tabelas |
| `restauracao` | contagens e md5 iguais nas 38 tabelas; as duas migrations na cópia numa transação; colunas antigas de `users` iguais; dados novos e tabelas novas vazios; levantamento igual; descartável apagado |
| frase errada; frase da TeamAccess | abortado, nada gravado |
| `-Lote equipe` no `preparar` | `ERR_TEAMACCESS_JA_APLICADA` |
| `-Lote equipe` no `aplicar` | `ERR_SEM_BACKUP_COM_RESTAURACAO_CONFERIDA` (backups de um lote não valem para o outro) |
| lote inválido | `ERR_LOTE_INVALIDO` antes da URL |
| backup e restauração do commit anterior | recusados (`backup de outro commit`) |
| sessão da migration derrubada na espera de lock | `ERR_RESULTADO_INCERTO`; `aplicar` bloqueado; `conferir`: `before` |
| outra sessão segurando `users` | `55P03` em 13 s; `before` intacto; `ERR_MIGRATION_FALHOU` |
| `aplicar` | as duas migrations; `after` SUCCESS (10, 28/28); contagens iguais ao backup |
| `aplicar` de novo | `ERR_LOTE_JA_APLICADO` |
| `conferir` after, sem e com dados novos | `ESTADO: after`; `REVERSAO_AFETARIA_*` 0 e depois 1 conta sem e-mail com troca pendente e 1 recebimento |
| `conferir` com `-Lote equipe` no after | `ESTADO: divergente` |

Também:

- nenhuma senha apareceu na saída, em `operacoes.jsonl` ou nos manifestos;
- testes unitários de `equipe-piloto`, `operacao-piloto`, `entrada-oculta`,
  `pilot-database-check` e `acesso-recebimentos-schema`: 152 na primeira
  rodada, todos passando; `oxlint` sem avisos.

### Limitações

- PostgreSQL 18.6 no ensaio. A versão do servidor do piloto não foi lida.
- A queda "logo depois do COMMIT" e a conferência posterior sem conexão foram
  ensaiadas só na TeamAccess. O código desses caminhos é o mesmo.
- As APIs `c77c313` e `824463c` rodaram contra o PostgreSQL descartável em
  `localhost`, não contra o host que imita o Neon.
- O web antigo com conta sem e-mail foi avaliado por leitura de código, não
  em navegador.
- Os dados novos do ensaio de retorno foram gravados por SQL igual ao da API
  nova, não pelas telas.
