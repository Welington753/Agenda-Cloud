# Runbook — Publicar a gestão de contas no piloto (PRs #64 e #65)

Este runbook leva o piloto das seis migrations atuais até
`AccountsAdministration1792800000000` e publica a API e o web dos PRs #64
(backend, migration e e-mail) e #65 (telas, páginas públicas e cadastro
fechado). Ele complementa `publicacao-piloto-render.md`; a parte F de lá aponta
para cá.

## Estado em 23/10/2026

**Preparação concluída** (neste repositório, sem tocar no piloto):

- `integration/nestjs-typeorm-frontend` em `26d9d85` contém os dois PRs, com os
  checks verdes.
- Procedimento versionado em `backend/scripts/`:
  - `abrir-contas-piloto.ps1`: lançador;
  - `aplicar-contas-piloto.mjs`: fases `preparar`, `aplicar` e `conferir`;
  - `conferir-restauracao-piloto.mjs`: fase `restauracao`;
  - `operacao-piloto.mjs`: peças comuns;
  - `entrada-oculta.mjs`: entrada oculta.
- Ensaio completo contra um PostgreSQL descartável que imita o piloto (seção
  "Ensaio").

**Operação no piloto, executada em 23/10/2026** a partir de
`C:\Projetos\Agenda-Cloud-publicacao`, no commit
`f37cbc9947806d12d6705cd812e8043fcbcace67`:

- `preparar`: backup `contas-preparar-2026-10-23T17-49-14-052Z`. O piloto
  roda PostgreSQL 17.11 e tinha 6 migrations e 37 tabelas.
- `restauracao`: contagens e md5 iguais, e migration ensaiada na cópia.
- `aplicar`: `AccountsAdministration1792800000000` aplicada às 18:05:42 UTC
  e conferida (`aplicada_e_conferida`). O backup anterior a ela é
  `contas-aplicar-2026-10-23T17-59-40-736Z`, com ponto de recuperação
  18:01:11 UTC.

**Publicação (atualizado em 25/10/2026).** Esta seção dizia que o deploy não
tinha sido feito. O histórico de deployment do GitHub mostra os dois serviços
publicados com sucesso em `26d9d85` às 16:50 UTC (antes da migration) e em
`f37cbc9` às 18:48 UTC de 23/10/2026. As verificações HTTP de 25/10/2026
passaram: cadastro `404` direto e pelo proxy, `/auth/me` `401`, `/cadastro`
sem formulário e `/login` sem "Criar conta". Detalhes, e o que ainda depende
do painel do Render, em `continuidade-publicacao-contas.md`.

**Ainda não feito:** confirmação do Live e do Auto-Deploy no painel, teste
autenticado das abas da Administração e configuração de e-mail.

**Recuperação preparada:** a API de reserva com o cadastro fechado,
`5fe816626b7e891099f0c08ae8b309e1130234f9` (ver "API de reserva").

## O que publicar

- **API e web:** `f37cbc9947806d12d6705cd812e8043fcbcace67`, o commit de onde
  a migration foi aplicada. Commits posteriores da integration que só mudam
  `docs/` têm o mesmo código e também servem.
- **Só em recuperação:** a API de reserva `5fe8166`. Ela nunca é mesclada na
  integration.

Use o mesmo SHA na API e no web.

## Pré-requisitos (uma vez)

- Windows Terminal (`wt.exe`). No console clássico, Ctrl+V não cola enquanto a
  entrada está oculta.
- Node 24.
- PostgreSQL 18 para Windows em `C:\Program Files\PostgreSQL\18\bin`, com
  `pg_dump`, `pg_restore`, `initdb` e `pg_ctl`. Se estiver em outra pasta, use
  `-PgBin`. O instalador completo traz os quatro; o serviço do PostgreSQL
  instalado não é usado.
- `openssl.exe` do Git para Windows (`C:\Program Files\Git\usr\bin`), usado só
  para o certificado do banco descartável.
- Do gerenciador de senhas:
  - a URL **direta** do piloto (host sem `-pooler`, banco `neondb`);
  - o Endpoint ID do piloto;
  - o Endpoint ID proibido (production).

  Os mesmos usados na promoção MASTER_OWNER.
- A pasta de operações, por padrão `%USERPROFILE%\AgendaCloud-operacoes`. É a
  mesma da promoção, fora do repositório e de pastas sincronizadas. Ela guarda
  dumps completos do piloto, com hashes de senha.

## Passo a passo

Cada passo depende do anterior. Qualquer `ERRO:` para o procedimento, e então
vale a seção "Recuperação".

### 0. Pasta limpa do commit

A pasta tem `node_modules` próprio, e **não** uma junção para o do clone
principal: remover um worktree com junção já apagou o `node_modules` do clone.

```powershell
git -C C:\Projetos\Agenda-Cloud fetch origin
git -C C:\Projetos\Agenda-Cloud worktree add C:\Projetos\Agenda-Cloud-publicacao <sha>
cd C:\Projetos\Agenda-Cloud-publicacao\backend
npm ci
```

O lançador compila `dist-migrations` e `dist-scripts` a cada execução.

### 1. Preparar: só leitura no piloto

```powershell
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File C:\Projetos\Agenda-Cloud-publicacao\backend\scripts\abrir-contas-piloto.ps1 -Fase preparar -PilotEndpointId <ep-piloto> -ProductionEndpointId <ep-proibido>
```

Na janela nova:

1. Cole a URL direta **uma vez** com Ctrl+V. Nada aparece na tela.
2. Pressione Enter uma vez.

Esperado:

```text
DESTINO_ENDPOINT_PILOTO: true
DIFERENTE_DO_PROIBIDO: true
--- PILOT_EXPECT=before-accounts-administration
TLS_CLIENTE: TLSv1.3 hostname=ok cadeia=...
MIGRATIONS_APPLIED: 6
SCHEMA_OBJECTS_OK: 0/40
BASELINE_FAILURES: none
RESULT: SUCCESS
BACKUP_OK: <bytes> bytes sha256=... tabelas=37
RESULTADO: preparado, nada gravado no piloto
```

Os nomes das tabelas e as contagens ficam em `manifesto.json`, na pasta
`contas-preparar-<horário>`, junto com o dump. Nenhum valor de linha é gravado
ali, só um md5 por tabela.

### 2. Restauração: sem conexão com o piloto

```powershell
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File C:\Projetos\Agenda-Cloud-publicacao\backend\scripts\abrir-contas-piloto.ps1 -Fase restauracao
```

A fase usa o backup `contas-*` mais recente; para escolher outro, passe
`-Pasta <nome>`. Ela não pede URL nem IDs e faz o seguinte:

1. Cria um PostgreSQL descartável em `127.0.0.1`, só com `hostssl`, um
   certificado gerado na hora (verificado) e uma senha aleatória.
2. Restaura o dump numa transação.
3. Compara a contagem e o md5 de cada tabela com o manifesto.
4. Aplica `AccountsAdministration` na cópia, pelo mesmo código da fase
   `aplicar`.
5. Confere o estado `after` e que nenhuma linha antiga mudou fora de `invites`,
   `sessions` e `audit_logs`, as três tabelas que ganham colunas.
6. Apaga o servidor e a cópia. Se uma execução anterior foi interrompida, o que
   ela deixou é removido no início.

Esperado:

```text
SHA256_CONFERE: true
RESTAURACAO: ok
CONTAGENS_IGUAIS: true
CONTEUDO_IGUAL_MD5: true
ENSAIO_BEFORE: ok
APLICADAS: AccountsAdministration1792800000000
ENSAIO_AFTER: ok
ENSAIO_DADOS_PRESERVADOS: true
DESCARTAVEL_APAGADO: true
RESULTADO: restauração conferida e migration ensaiada na cópia
```

Isso grava `restauracao-conferida.json` na pasta do backup. Sem esse arquivo, a
fase `aplicar` não começa.

### 3. Aplicar: única etapa que escreve no piloto

Escolha um momento de pouco uso. A migration leva menos de um segundo, mas
precisa de um lock curto em `sessions`, `invites` e `audit_logs`. Se uma
requisição segurar uma dessas tabelas, a migration desiste em 10 s
(`lock_timeout`) e desfaz tudo.

```powershell
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File C:\Projetos\Agenda-Cloud-publicacao\backend\scripts\abrir-contas-piloto.ps1 -Fase aplicar -PilotEndpointId <ep-piloto> -ProductionEndpointId <ep-proibido>
```

A sequência é esta:

1. O script exige um backup da fase `preparar` com a restauração conferida, do
   mesmo commit e endpoint, de até 24 h.
2. Repete destino, TLS e `before`.
3. Faz um **backup novo**: é o ponto de recuperação imediatamente anterior.
4. Pede a frase. Confira `RESULT: SUCCESS` e `BACKUP_OK` e digite:

   ```text
   APLICAR AccountsAdministration1792800000000
   ```

5. Aplica só a pendente esperada. O histórico precisa ser exatamente as seis
   migrations até `WebPush1792713600000`, e o build, exatamente essas mais
   `AccountsAdministration1792800000000`; senão, para antes de escrever.
6. Roda `after`.

Esperado:

```text
PENDENTE: AccountsAdministration1792800000000
APLICADAS: AccountsAdministration1792800000000
SESSAO_DA_MIGRATION: mesma=true lock_timeout=10s
COMMIT: ok
--- PILOT_EXPECT=after-accounts-administration
MIGRATIONS_APPLIED: 7
SCHEMA_OBJECTS_OK: 40/40
BASELINE_FAILURES: none
RESULT: SUCCESS
RESULTADO: AccountsAdministration1792800000000 aplicada e conferida
```

`CONTAGENS_DESDE_O_BACKUP` só informa. A API atual continua no ar e pode
gravar durante a operação.

Opcional: rode a fase `restauracao` de novo. Ela confere o backup novo, o
`contas-aplicar-*` mais recente.

### 4. Conferir: só leitura, quando quiser

```powershell
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File C:\Projetos\Agenda-Cloud-publicacao\backend\scripts\abrir-contas-piloto.ps1 -Fase conferir -Esperado after -PilotEndpointId <ep-piloto> -ProductionEndpointId <ep-proibido>
```

Com `-Esperado after`, também lista o que um `migration:revert` apagaria
(linhas `REVERSAO_AFETARIA_*`). Com `-Esperado before`, confere o estado
anterior.

### 5. Publicar a API

Antes, tenha à mão a seção "API de reserva" e as regras de Rollback em
"Recuperação". O Rollback publica o deploy que você escolher; na API, nunca
escolha um deploy anterior ao PR #65, porque ele reabre o cadastro público.

No Render, serviço `agenda-cloud-piloto-api`:

1. **Manual Deploy → Deploy a specific commit → `<sha>`**.
2. Espere ficar **Live**.
3. Confira as respostas:
   - `GET $API/` deve dar `200`;
   - `GET $WEB/agenda_api/auth/me` deve dar `401`;
   - `POST $WEB/agenda_api/auth/register` com `Origin: $WEB` deve dar `404`
     (cadastro fechado na API).

Não há variável nova obrigatória. Sem as de e-mail, a API sobe com o envio
desligado.

### 6. Publicar o web

Serviço `agenda-cloud-piloto-web`, mesmo `<sha>`. Depois:

1. Confira que `/login` responde `200` e mostra "Saiba como obter", sem
   "Criar conta".
2. Confira que `/cadastro` mostra só a explicação, sem formulário.
3. Entre com `wwluiz90@gmail.com`. Em **Minha conta → Administração**, confira
   as abas Estabelecimentos, Usuários, Convites, Papéis e permissões e
   Histórico.
4. Em **Usuários**, confira que as contas existentes aparecem e que nenhuma
   ficou bloqueada.

Não crie empresa de teste no piloto: não existe exclusão de estabelecimento.
Para ver o convite sem e-mail configurado, use **Convites → Convidar para a
administração** com um endereço seu. Confira "envio não configurado" e depois
**Revogar**. O convite e a revogação ficam no histórico.

### 7. E-mail (quando decidir)

Ver "E-mail" no fim deste runbook e `docs/plans/administracao-contas-convites.md`.

### 8. Limpeza

- Feche as janelas do procedimento.
- `git -C C:\Projetos\Agenda-Cloud worktree remove C:\Projetos\Agenda-Cloud-publicacao`.
  O `node_modules` é próprio da pasta, então pode ir junto.
- Mantenha a pasta de operações. Apague dumps antigos quando não precisar
  mais deles; eles têm hashes de senha.

## Códigos de parada

| Código | Fase | Significado | Gravou algo? |
| --- | --- | --- | --- |
| `ERR_URL_*`, `ERR_ENDPOINT_*`, `ERR_POOLER`, `ERR_HOST_NAO_NEON`, `ERR_BANCO_DIFERENTE_DE_NEONDB`, `ERR_TLS_AFROUXADO` | todas | URL recusada antes da rede (`MOTIVO:` diz a categoria) | não |
| `ERR_CERTIFICADO_NAO_CONFIAVEL`, `ERR_HOSTNAME_DO_CERTIFICADO`, `ERR_CONEXAO_SEM_TLS` | todas | TLS não comprovado no socket | não |
| `ERR_BACKEND_COM_ALTERACOES_LOCAIS` | preparar, aplicar | a pasta tem alteração em `backend/` | não |
| `ERR_BUILD_AUSENTE`, `ERR_BUILD_DESATUALIZADO` | todas | build não feito ou de outro commit | não |
| `ERR_ESTADO_ANTES_DIVERGENTE` | preparar, aplicar | o piloto não está em `before` (ex.: migration já aplicada) | não |
| `ERR_BACKUP_FALHOU`, `ERR_BACKUP_VAZIO` | preparar, aplicar | `pg_dump` falhou | não |
| `ERR_PG_RESTORE`, `ERR_RESTAURACAO_DIFERENTE_DO_MANIFESTO` | restauracao | o backup não restaura ou não bate | não (só no descartável) |
| `ERR_ENSAIO_*` | restauracao | a migration falhou ou mudou dados na cópia | não |
| `ERR_SEM_BACKUP_COM_RESTAURACAO_CONFERIDA` | aplicar | falta o passo 2 para este commit e endpoint | não |
| `RESULTADO: abortado, nada gravado` | aplicar | frase vazia ou diferente | não |
| `ERR_HISTORICO_DE_MIGRATIONS_INESPERADO`, `ERR_MIGRATIONS_COMPILADAS_INESPERADAS` | aplicar | haveria outra migration além da esperada | não |
| `ERR_MIGRATION_FALHOU` | aplicar | a migration falhou; `ESTADO_APOS_FALHA` diz se o `before` está intacto | não, se `before intacto` |

## Compatibilidade

| Combinação | Situação | Base |
| --- | --- | --- |
| API atual + schema antigo | estado de hoje | — |
| API atual + schema novo | funciona | ensaio: a API de `35f4713` (backend igual ao de `9847c6a`) contra o banco migrado: cadastro, `/auth/me`, criar e listar serviço, logout e login, sem erro no log |
| API nova + schema antigo | **não publicar** | login e agenda continuam, mas convites, ficha de usuário, histórico, reautenticação e redefinição de senha falham, porque leem as colunas e a tabela novas (leitura do código) |
| API nova + schema novo | alvo | CI do PR #65 e suítes de navegador |
| web novo + API atual | evitar | login funciona; a administração nova chama rotas que a API atual não tem |
| web atual + API nova | janela curta e aceitável | o formulário antigo de `/cadastro` recebe 404 (cadastro fechado) |
| API de reserva + schema novo + web novo | recuperação | ensaio de 23/10/2026: cadastro 404 direto e pelo proxy, login, sessão, bloqueio, restrição e agenda funcionam; a administração nova fica indisponível (seção "API de reserva") |

Por isso a ordem é: **migration → API → web**, todos do mesmo SHA.

## Recuperação

**Regra geral:** não apague contas, convites nem histórico. Nenhuma situação
abaixo exige `migration:revert` nem restaurar o backup por cima do piloto.

- **Falha em `preparar` ou `restauracao`.** Nada foi gravado no piloto.
  Corrija a causa (código acima) e repita.
- **`ERR_MIGRATION_FALHOU` com `before intacto`.** A transação foi desfeita
  (ensaiado com `lock_timeout`). A API atual segue funcionando. Repita a fase
  `aplicar` em outro momento.
- **Conexão caiu durante o commit, ou `ESTADO_APOS_FALHA` não confirmado.**
  Rode `conferir` com `before` e com `after`. Exatamente um dos dois passa: ele
  diz se a migration entrou. Não repita `aplicar` antes disso.
- **`after` divergente depois do `COMMIT: ok`.** Não publique a API. Rode
  `conferir -Esperado after`, guarde a saída e investigue. A API atual funciona
  com o schema novo, então não há urgência para desfazer.
- **Deploy da API falhou antes de ficar Live.** O Render mantém o deploy
  anterior, que funciona com o schema novo. Investigue e publique de novo.
- **API nova Live com defeito que não dá para corrigir na hora.** Publique a
  **API de reserva** (seção abaixo). O web novo continua no ar. Depois corrija
  a API nova e publique de novo pela integration.
- **Rollback na API: o alvo é escolhido por você** na lista de deploys do
  serviço; o Render não volta para um deploy fixo.
  - Só servem deploys de `26d9d85` ou `f37cbc9`. Os dois têm o mesmo runtime
    (a diferença é só `backend/scripts/` e `docs/`) e o cadastro fechado.
    Por isso, um Rollback entre eles não corrige defeito do runtime; nesse
    caso, use a reserva.
  - **Nunca** escolha `35f4713`, `9847c6a` ou anterior: eles aceitam
    `POST /auth/register`, direto e pelo proxy. Esconder o formulário no web
    não fecha o cadastro.
- **Web novo com defeito.** Rollback só do web, ou deploy de outro commit do
  web. A API nova atende o web antigo, e o formulário de cadastro antigo
  recebe 404.

### API de reserva (cadastro fechado)

- **Branch:** `reserva/api-cadastro-fechado`. Nunca mesclar na integration.
- **SHA:** `5fe816626b7e891099f0c08ae8b309e1130234f9`.
- **Base:** `35f4713`, a API publicada antes dos PRs #64 e #65, cujo backend é
  igual ao de `9847c6a`.
- **Mudança única:** a rota `POST /auth/register` e o limitador dela foram
  removidos. O cadastro responde `404` direto e pelo proxy, não emite cookie e
  não chama o serviço. O resto é o código de `35f4713`.
- **Quando usar:** só se o runtime de `f37cbc9` tiver defeito. Rollback para
  um deploy de `26d9d85` não ajuda nesse caso, porque o runtime é o mesmo.
- **Variáveis:** as mesmas do serviço. As variáveis de e-mail, se existirem,
  são ignoradas.

#### Publicar a reserva

1. No serviço `agenda-cloud-piloto-api`: **Manual Deploy → Deploy a specific
   commit** com o SHA completo `5fe816626b7e891099f0c08ae8b309e1130234f9`.
   A documentação do Render diz que o commit vem do repositório ligado, por
   SHA. Ela não diz se o commit precisa estar na branch ligada, e isso não foi
   testado aqui.
2. **Se o Render não aceitar o SHA:** em **Settings → Build & Deploy →
   Branch**, troque temporariamente para `reserva/api-cadastro-fechado` e
   faça **Manual Deploy → Deploy latest commit**. Antes, confira o
   Auto-Deploy no painel: o histórico do GitHub sugere que ele está ligado
   (deploys 3 a 4 minutos depois dos merges de 23/10/2026). Se estiver, a
   troca de branch já publica a reserva, e a volta para a integration
   publica o último commit dela.
3. Espere ficar **Live** e confira:
   - `POST $API/auth/register` deve dar `404`;
   - `POST $WEB/agenda_api/auth/register` com `Origin: $WEB` deve dar `404`;
   - `GET $WEB/agenda_api/auth/me` deve dar `401`;
   - o login de uma conta existente pelo web deve funcionar.

#### Voltar para a API nova

Depois de corrigida a API nova:

1. Se a branch do serviço foi trocada, volte-a para
   `integration/nestjs-typeorm-frontend`.
2. Faça **Deploy a specific commit** com o SHA corrigido da integration.
3. Repita as conferências da etapa 5.

#### Durante a reserva

**Continua funcionando**, com dados de todos:

- login, sessão, saída e restauração de sessão, inclusive as sessões criadas
  pela API nova;
- agenda, serviços, profissionais, jornadas, disponibilidade, clientes,
  solicitações e agendamento público;
- a consulta de estabelecimentos na administração (`/platform/establishments`).

**Continua valendo**, porque a reserva lê as mesmas tabelas:

- contas bloqueadas (`SUSPENDED`) não entram, e as sessões antigas delas são
  recusadas;
- restrições por estabelecimento (`DENIED`);
- vínculos removidos;
- papéis de plataforma.

**Fica indisponível** (a reserva não tem as rotas; o web novo mostra erro):

| Tela ou ação do web novo | O que aparece | Rota sem resposta |
| --- | --- | --- |
| Administração → Usuários | "Estabelecimento não encontrado." | `GET /platform/users`, `/platform/establishment-options` |
| Administração → Convites | o mesmo aviso | `GET /platform/invites` |
| Administração → Papéis e permissões | o mesmo aviso | `GET /platform/roles` |
| Administração → Histórico | o mesmo aviso | `GET /platform/audit` |
| Novo estabelecimento | "Sua conta pode consultar, mas não criar estabelecimentos." | `GET /platform/plans`, `POST /platform/establishments` |
| `/convite` (aceitar convite) | "Convite indisponível" | `POST /invites/preview`, `/invites/accept` |
| `/redefinir-senha` | link inválido | `POST /password-resets/preview`, `/password-resets/complete` |
| Bloquear, reativar, restringir, desvincular, mudar papel, reautenticação | não há como acionar | rotas `/platform/users/*`, `/platform/memberships/*`, `/platform/reauth` |

O aviso "Estabelecimento não encontrado." é a mensagem genérica de 404 do web.
Durante a reserva, ele significa que a função não existe nessa API.

**Pendências durante a reserva:**

- Convites e redefinições já enviados não podem ser usados. Eles vencem em
  24 h; depois da volta da API nova, use **Reenviar** ou peça um link novo.
- Não há como bloquear uma conta pela tela. Se for urgente, só por operação
  manual no banco, com decisão explícita.
- Nenhum dado gravado pela API nova é apagado ou alterado pela reserva.

#### Testes executados (23/10/2026)

**Ambiente:**

- PostgreSQL 18.6 descartável em `localhost:55433`, com TLS verificado e as 7
  migrations;
- `IGNORE_DOTENV_FILE=true`;
- dados de testes anteriores: cerca de 600 usuários e 539 tenants.

**Dados criados pela API nova** (código de `f37cbc9`), pelo caminho real:

- três contas ativadas por convite;
- uma promovida a `MASTER_OWNER`, só no banco descartável;
- reautenticação, bloqueio de uma conta e restrição `SERVICOS_GERENCIAR` de
  outra.

**Na reserva**, direto e pelo proxy do web novo (`next start` com
`API_PROXY_TARGET`):

- cadastro `404` em 7 tentativas diretas e 3 pelo proxy, sem cookie, com as
  contagens de `users`, `tenants`, `units`, `memberships`, `credentials` e
  `audit_logs` iguais;
- login e sessão pelo proxy `200/200`, e a sessão criada pela API nova é
  aceita;
- conta bloqueada: login `401` e sessão antiga `401`;
- conta restrita: ver serviços `200`, criar `403`, nenhum serviço gravado;
- agenda: serviço `201`, profissional `201`, jornada `200`, disponibilidade
  com 39 horários, agendamento `201`, listagem com o agendamento, e o mesmo
  horário recusado com `409`;
- navegador (Chromium):
  - login pela tela;
  - visão geral, agenda, serviços, profissionais, clientes, solicitações e
    estabelecimentos sem nenhuma chamada com erro;
  - as telas da administração nova com os avisos da tabela acima;
  - `/cadastro` sem formulário.

**Testes do próprio código da reserva:** 1.365 unitários, 117 HTTP e2e,
`oxlint` sem avisos e `tsc` do build.

**Limitações:**

- O deploy pelo Render não foi testado.
- O teste no navegador foi em HTTP local, com cookie sem `Secure`. O
  comportamento do cookie atrás da borda HTTPS é o de `35f4713`, já publicado.
- O CI não roda nesta branch (os workflows rodam em PRs para a integration, e
  não há PR); os testes acima foram locais.

**`migration:revert`: só depois de medir a perda.** Rode `conferir -Esperado
after` e leia `REVERSAO_AFETARIA_*`. O revert apaga:

- a tabela `password_resets`;
- as colunas de envio, idempotência e alvo de `invites`;
- `audit_logs.target_user_id`;
- `sessions.reauthenticated_at`.

Os valores novos do enum `audit_action` ficam, e linhas do histórico com essas
ações continuam existindo. Com a API nova no ar, ela para de funcionar. Como a
API antiga funciona com o schema novo, o revert não resolve nenhum dos casos
acima. Não o use sem uma decisão explícita e com as contagens à vista.

**Restaurar o backup:** nunca por cima do piloto. Isso apagaria tudo o que foi
gravado depois do ponto de recuperação: agendamentos, clientes, sessões e
contas. Se for preciso consultar o estado anterior, restaure num branch novo
do Neon ou no descartável (fase `restauracao`) e copie só o necessário, com
decisão explícita.

## E-mail

Resumo de 23/10/2026, com as fontes em `docs/plans/administracao-contas-convites.md`:

- **Por que API e não SMTP.** O Render gratuito bloqueia SMTP (25, 465 e
  587). Só envio por API HTTPS funciona, e o código já tem Brevo e Resend.
- **Sem domínio próprio, Resend não serve.** O remetente de teste
  (`onboarding@resend.dev`) só entrega no e-mail da própria conta Resend.
- **Sem domínio próprio, Brevo é a opção.** Ele entrega a destinatários
  quaisquer a partir de um remetente verificado, mas:
  - um remetente `@gmail.com` não pode ser autenticado, e o Brevo troca o
    domínio do remetente por `@brevosend.com`;
  - a entrega a Gmail, Outlook e outros é incerta, com spam provável. Isso
    serve para teste, não como garantia de entrega em produção.
- **O que configurar** no serviço `agenda-cloud-piloto-api` (todas `sync:
  false` no `render.yaml`; nunca no repositório):
  - `EMAIL_PROVIDER=brevo`;
  - `EMAIL_API_KEY`;
  - `EMAIL_FROM` (o remetente verificado no Brevo);
  - `EMAIL_FROM_NAME` (opcional).

  `FRONTEND_URL` precisa ser a origem pública do web. Depois, **Manual
  Deploy** da API.
- **Bloqueio de IP do Brevo.** O Brevo recusa chamadas de API vindas de IPs
  desconhecidos (ativado por padrão em contas novas). O Render usa faixas de
  IP de saída compartilhadas por região. Antes do primeiro envio, conforme a
  documentação do Brevo, faça um destes:
  - autorize as faixas do Render (painel do serviço → **Connect** →
    **Outbound**) em Brevo → **Security → Authorized IPs**;
  - ou desative o bloqueio, sabendo que reduz a proteção da chave.

  Se esquecer, o convite aparece como falha de envio (`HTTP_4XX`) e o log da
  API mostra `HTTP 401`.

## Ensaio (23/10/2026)

Nada foi testado contra o Neon.

### Ambiente

- PostgreSQL 18.6 descartável em `127.0.0.1:55440`, só `hostssl` com
  `scram-sha-256`.
- Certificado de uma CA descartável para o host fictício
  `ep-ensaio-piloto-111.c-2.us-east-1.aws.neon.tech`.
- Banco `neondb` com dono não superusuário.
- As seis migrations aplicadas pelo runtime compilado.
- Dados do banco descartável dos testes de navegador: 596 usuários, 536
  tenants, 217 agendamentos, 492 sessões e 177 registros de histórico.

### Harness (não versionado)

Rodou por `--import` e fez quatro coisas:

- resolveu o host fictício para `127.0.0.1`;
- passou a CA descartável ao `pg_dump`;
- simulou o terminal entregando uma entrada por leitura;
- passou a CA ao Node por `NODE_EXTRA_CA_CERTS`.

As conferências de destino, TLS no socket, banco, histórico e frase rodaram
como estão nos scripts.

### Resultados

| Caso | Resultado |
| --- | --- |
| `preparar` | `before` SUCCESS (6, 0/40), backup de 416 KB, 37 tabelas |
| `restauracao` de um backup com tenant apontando para plano inexistente (dado inconsistente do primeiro ensaio) | `ERR_PG_RESTORE` na FK; backup recusado, descartável apagado |
| `restauracao` do backup corrigido | contagens e md5 iguais nas 37 tabelas; migration ensaiada na cópia; dados preservados; descartável apagado |
| `aplicar` sem backup conferido | `ERR_SEM_BACKUP_COM_RESTAURACAO_CONFERIDA` antes da URL |
| `aplicar` com outro endpoint ou com o proibido em `options` | `ERR_ENDPOINT_DIFERENTE_DO_PILOTO` / `ERR_ENDPOINT_PROIBIDO`, antes da rede |
| `aplicar`, frase errada / Enter vazio | abortado, nada gravado |
| `aplicar` com outra sessão segurando `sessions` | `lock timeout` em 10 s; `before` intacto (6, 0/40); nada aplicado |
| `aplicar` | só `AccountsAdministration1792800000000`; `after` SUCCESS (7, 40/40) |
| `aplicar` de novo | `ERR_ESTADO_ANTES_DIVERGENTE`, nada gravado |
| `conferir` after / before | SUCCESS com `REVERSAO_AFETARIA_*` = 0 / FAILURE esperado |
| `restauracao` do backup da fase `aplicar` | igual ao manifesto e ensaio ok |
| API de `35f4713` contra o banco migrado | cadastro, `/auth/me`, criar e listar serviço, logout e login ok, sem erro |
| Lançador sem terminal interativo / ID inválido | `ERR_TERMINAL_NAO_INTERATIVO` / recusa antes de rodar; IDs removidos do ambiente |
| Lançador pelo `wt.exe`, fase `restauracao` | conferência gravada em `operacoes.jsonl` |

### Outros resultados

- Nenhuma senha apareceu em `operacoes.jsonl`, nos manifestos ou na saída.
- Nenhum processo ou pasta descartável sobrou.
- `entrada-oculta.spec.ts` e `operacao-piloto.spec.ts`: 62 testes. `oxlint`
  sem avisos.
- A entrada oculta é o módulo da promoção MASTER_OWNER (`6fdacc2`), sem
  mudança de lógica. As colagens reais no Windows Terminal e no conhost foram
  ensaiadas lá e não foram repetidas.

### Problema encontrado e corrigido no ensaio

O `pg_ctl start` chamado com pipe de stderr nunca terminava: o servidor herda
o pipe e o mantém aberto. Agora `pg_ctl` roda sem pipes, e a espera é pelo fim
do processo. A fase `restauracao` também remove sobras de execuções
interrompidas e trata Ctrl+C.
