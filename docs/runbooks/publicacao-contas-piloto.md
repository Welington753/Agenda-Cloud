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

**Operação no piloto: nada executado.** Nenhuma conexão foi aberta com o
piloto, nenhum backup do piloto foi feito, a migration não foi aplicada e nada
foi publicado no Render.

## O que publicar

O commit de `integration/nestjs-typeorm-frontend` que contiver este runbook.
Entre `26d9d85` e ele só mudam `backend/scripts/` e `docs/`; o código da API e
do web é o mesmo de `26d9d85`.

Use **o mesmo SHA** em todas as etapas:

- nas fases do procedimento: a fase `aplicar` recusa um backup conferido de
  outro commit;
- no deploy da API e do web.

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
- **API nova Live com defeito.** **Rollback** no Render para o deploy anterior
  da API, e do web se ele já tiver sido publicado.
  - O schema novo continua, e a API antiga funciona com ele.
  - Convites, redefinições e histórico gravados pela API nova ficam no banco,
    intactos. A API antiga só os ignora.
  - Contas bloqueadas continuam bloqueadas: a API antiga também exige
    `ACTIVE` no login e na sessão.
  - Vínculos removidos continuam removidos.
  - Restrições por estabelecimento (`DENIED`) continuam valendo: a API antiga
    lê a mesma tabela de overrides.
  - Papéis de plataforma dados pela API nova continuam valendo, pelas mesmas
    regras de `platform_role` e `ESTABLISHMENTS_MANAGE`.
  - Convites pendentes não podem ser aceitos até a API nova voltar. Os links
    valem 24 h; depois, use **Reenviar**.
  - **Atenção:** a API antiga reabre `POST /auth/register`, o cadastro
    público. Mantenha o rollback pelo menor tempo possível.
- **Web novo com defeito.** Rollback só do web. A API nova atende o web antigo;
  só o formulário de cadastro antigo recebe 404.

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
