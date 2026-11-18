# Plano consolidado: publicar no piloto o que está integrado em `b5b2704`

**Só planejamento. Este documento não autoriza nem executa nada.** Cada etapa depende de pedido explícito na hora: deploy, migration, backup, variável no Render e leitura do banco real.

Este plano **não substitui os roteiros**. Ele diz em que ordem usá-los, com qual SHA, e o que mudou desde que foram escritos. O procedimento de cada passo continua no roteiro citado.

Este documento nunca contém credencial, chave, URL de banco ou Endpoint ID.

> **Atualização de 16/11/2026, depois do merge do PR #117.** O alvo da etapa 3 deixou de ser `b5b2704` e passou a ser `9de722d1380fa55b6c588b63d01dea1a4ebdc1f2`, o merge do PR #117, para a API e para o web. A diferença entre os dois commits é a correção da recuperação após hibernação no proxy do web (`src/lib/api/proxy.ts`), os testes dela e documentação. **O código de `backend/` é idêntico** (`git diff b5b2704 9de722d -- backend` vazio). As etapas 0, 1 e 2 mantêm os alvos. O nome deste arquivo continua o mesmo para não quebrar os links dos roteiros.

> **Atualização de 17/11/2026, PR #120 (tema "Azul e branco" em todos os ambientes e menu agrupado do dono).** Por decisão do responsável, o alvo da etapa 3 passa a ser **o merge commit do PR #120**, para a API e para o web. Ele contém `9de722d`, o PR #118 (só documentação), o PR #119 (tema na Visão geral do portal) e o PR #120 (tema em todas as áreas adaptáveis, menu agrupado em `/conta` e o rótulo "Visão geral" no lugar de "Dashboard", sem mudar URL). **O `backend/` continua idêntico ao de `9de722d` e `b5b2704`** (`git diff 9de722d <head do #120> -- backend` vazio): migrations (18), variáveis (`PLATFORM_*`), conferência de inicialização e tudo o que este plano diz sobre a API da etapa 3 valem sem mudança. Onde o texto abaixo diz `9de722d` como alvo da etapa 3, leia o merge commit do PR #120; o SHA completo é o desse merge, com árvore igual à do head aprovado pelo CI. As etapas 0, 1 e 2 mantêm os alvos. O passo 3.11 passa a conferir também: o tema "Azul e branco" escolhido em Aparência, o menu agrupado do dono (Visão geral, Atendimento, Gestão do negócio, Administração) e a navegação entre as áreas.

> **Execução iniciada em 18/11/2026 (sessão em casa).** O responsável autorizou publicar até o merge do PR #122, `4585af099dafe4c0f6ad0232b6a2d4445b60c5e3`, passando por todas as etapas: 0, 1, 2 (migration 17), 3 (migration 18, merge do PR #120 `becc923f12165f7085e3de5a12b019b10e9b4bb0`), a etapa do #121 (`df535a19ffbf70355007171bec8f962937397f85`, sem migration) e a etapa do #122 (migration 19). **Só a etapa 0 foi feita.** O estado, os pendentes e a próxima ação estão na seção 1.3 e no fim de "Estado e retomada".

## 1. Ponto de partida

Leitura do Render em 16/11/2026, por volta de 12:15 UTC, e confirmação do responsável na mesma data ([`recuperacao-login-piloto-rollback.md`](../runbooks/recuperacao-login-piloto-rollback.md), seção 8).

| Item | Estado |
|---|---|
| API live | `8e8577d698fd3d2b9eb2a42b6945fbd3cb3205d2` (`dep-dbreqklckfvc73e2loag`, desde 13/11 10:59:21 UTC) |
| Web live | `438e598bcc98dfa13aa45087fbfaafdfb1b33a0e` (`dep-dbs6p8qfngtc73bsm7sg`, desde 14/11 14:15:48 UTC) |
| Integração | `b5b27046369b2b36ad339a41d44ff405fcb44c43` (merge do PR #115) |
| Banco do piloto | **16 migrations na última conferência, de 13/11 10:55 UTC; reconfirmar antes da execução.** Não é leitura de hoje |
| Auto-Deploy | desligado nos dois serviços; nenhum deploy em fila |

Os roteiros da fila foram escritos supondo **API e web em `8e8577d`**. O web está à frente (em `438e598` quando esta seção foi escrita; em `b5b2704` na releitura da seção 1.1). A fila só começa depois de o web voltar a `8e8577d` (etapa 0, seção 4), e cada etapa termina com API e web no mesmo SHA.

### 1.1 Releitura de 16/11/2026, por volta de 17:15 UTC

Só leitura do Render (lista de serviços e de deploys), depois do merge do PR #117. O banco não foi lido.

| Item | Estado |
|---|---|
| API live | `8e8577d698fd3d2b9eb2a42b6945fbd3cb3205d2`, o mesmo deploy da tabela acima. Houve uma tentativa manual em `b5b2704` (`dep-dbtfreek1f9s73cfh6q0`, 12:58 UTC) que terminou em `update_failed` |
| Web live | **`b5b27046369b2b36ad339a41d44ff405fcb44c43`** (`dep-dbtfrftg1s2s73b0d090`, manual, desde 16/11 12:59:26 UTC). Não é mais `438e598` |
| Integração | `9de722d1380fa55b6c588b63d01dea1a4ebdc1f2` (merge do PR #117) |
| Auto-Deploy | desligado nos dois serviços (`autoDeploy: no`, `autoDeployTrigger: off`); nenhum deploy em andamento |

**O web live mudou depois que este plano foi escrito, e a etapa 0 foi corrigida por decisão do responsável (16/11/2026):** o estado de partida passa a ser web `b5b2704` com API `8e8577d`, o alvo continua `8e8577d` e o retorno, se a validação falhar, é o web de volta a `b5b2704` (seção 4.2). `438e598` fica como histórico: é o web do par que teve o login confirmado em 16/11. O par atual, web `b5b2704` com API `8e8577d`, **não teve login confirmado**.

Entre `438e598` e `b5b2704` só entrou o PR #115 (conferência de migrations na inicialização da API e `GET /health`); `git diff 438e598 b5b2704 -- src` é vazio, então o que a seção 4.3 diz sobre as telas do web vale para os dois.

**Esta leitura tem de ser refeita antes da execução** (passo 0.0). Um estado diferente deste exige reavaliar a etapa 0 antes de qualquer deploy.

### 1.2 Releitura de 17/11/2026, por volta de 14:30 UTC

Só leitura do Render (serviços, deploys e log de inicialização da API). O banco não foi lido.

| Item | Estado |
|---|---|
| API live | `8e8577d698fd3d2b9eb2a42b6945fbd3cb3205d2`, o mesmo deploy (`dep-dbreqklckfvc73e2loag`). Depois da seção 1.1 houve três tentativas manuais que terminaram em `update_failed`: `9de722d` (16/11 17:53 e 18:24 UTC) e `68e5eed` (17/11 13:35 UTC). A de 17/11 caiu em `validateEnv`: `Configuração de ambiente inválida ou incompleta. Campos com problema: PLATFORM_2FA_ENFORCEME...` (as variáveis do passo 3.7 continuam ausentes) |
| Web live | **`68e5eed`** (`dep-dbu5gep42hec73bku1c0`, manual, desde 17/11 13:35 UTC). Não é mais `b5b2704` |
| Integração | `68e5eed` (merge do PR #118); o PR #120 está aberto |
| Auto-Deploy | desligado nos dois serviços (`autoDeploy: no`, `autoDeployTrigger: off`); nenhum deploy em andamento |

**O passo 0.0 não confere mais:** o web live é `68e5eed`, não `b5b2704`. Pela regra da seção 4.2, a etapa 0 tem de ser reavaliada pelo responsável antes de qualquer deploy. O alvo continua `8e8577d`; o que muda é o estado de partida e, portanto, o destino do retorno se o passo 0.2 falhar (web `68e5eed`, par sem login confirmado). Entre `b5b2704` e `68e5eed` só entraram no web o PR #117 (proxy) e o PR #119 (tema na Visão geral); `git diff b5b2704 68e5eed -- backend` é vazio.

### 1.3 Execução de 18/11/2026, entre 02:30 e 02:50 UTC

**Decisões do responsável registradas para esta execução (17/11/2026):**

- Publicar até `4585af0`, seguindo os roteiros e as verificações de cada etapa, com backup e migrations autorizados.
- Ainda não há clientes usando o sistema. Os registros existentes são preservados; isso não autoriza limpar o banco.
- Nenhum preço é cadastrado em produção. O responsável preenche os preços pelo portal depois; preço pendente continua impedindo a contratação e a criação modular (`PRECO_BASE_PENDENTE`).
- A chave TOTP da etapa 3 terá **temporariamente uma cópia só**, protegida no PC de casa. A segunda cópia (pendrive) fica pendente por decisão do responsável. **O requisito de duas cópias do passo 3.2 não está cumprido**; é uma exceção registrada, não uma conclusão.
- Os proprietários reais foram informados pelo responsável (fora deste repositório). Contas e papéis são conferidos pelo fluxo existente; nenhum e-mail é fixado no código e ninguém é dado como já cadastrado no 2FA.
- **O teste de login autenticado fica para o final**, feito pelo responsável. Os portões humanos intermediários (passos 0.2, 1.3 e 1.5, e o login dos passos 2.5 e 3.9) foram adiados por essa decisão. As verificações HTTP sem login (200, 401, 403) não comprovam login.

**Leitura do Render (só leitura), 02:43 UTC**, depois da manutenção programada do Render (02:00 a 03:00 UTC; status "All Systems Operational" às 02:43):

| Item | Estado |
|---|---|
| API live | `8e8577d698fd3d2b9eb2a42b6945fbd3cb3205d2` (`dep-dbreqklckfvc73e2loag`, desde 13/11). As tentativas posteriores estão todas em `update_failed`, a última em `68e5eed` (17/11 13:35 UTC) |
| Web live antes da etapa 0 | `becc923f12165f7085e3de5a12b019b10e9b4bb0` (`dep-dbu74he8bjmc73ah7c1g`, desde 17/11 15:29 UTC). Não era mais `68e5eed` (seção 1.2) |
| Auto-Deploy | desligado nos dois serviços (`autoDeploy: no`, `autoDeployTrigger: off`); nada em andamento |
| `healthCheckPath` | API `/`, web `/login` (mantidos) |
| Variáveis da API (só nomes) | nenhuma `PLATFORM_*` (as três do passo 3.7 ainda precisam ser criadas). `EMAIL_PROVIDER`, `EMAIL_FROM`, `EMAIL_FROM_NAME` e `EMAIL_API_KEY` definidas. A conexão com o banco está em duas variáveis: `DATABASE_URL` (com pooler) e `DIRECT_URL` (direta), com o mesmo usuário |
| Variáveis do web (só nomes) | `API_PROXY_SECRET`, `API_PROXY_TARGET`, `CLIENT_IP_SOURCE`, `NEXT_PUBLIC_API_URL`. Nenhuma conexão com o banco |

**Leitura do banco do piloto (só leitura), 02:35 UTC:**

| Item | Estado |
|---|---|
| Servidor | PostgreSQL **17.12**. Isto resolve o limite citado na conferência do estado 18 (ensaio em PostgreSQL 18): as consultas foram ensaiadas também em PostgreSQL 17 (abaixo) |
| `pilot:check-database` com `PILOT_EXPECT=before-tenant-test-flag` | `MIGRATIONS_APPLIED: 16`, `SCHEMA_OBJECTS_OK: 0/2`, `ESTABELECIMENTOS: 3`, `MARCADOS_COMO_TESTE: coluna ainda não existe`, `BASELINE_FAILURES: none`, `RESULT: SUCCESS`. Destino conferido: endpoint do piloto, diferente do proibido, TLS verificado |
| Histórico | 16 migrations, a última `ProfessionalCommissionSettings1793577600000` |
| Contas `MASTER_OWNER` ativas | **três**. Duas conferem com os proprietários informados pelo responsável, ambas com e-mail verificado. **A terceira não foi citada pelo responsável e está com e-mail não verificado**; o reconhecimento dela está pendente ("Estado e retomada"). Nenhuma conta foi alterada |
| Estabelecimentos | três, nenhum marcado como teste (a coluna ainda não existe). A classificação está pendente ("Estado e retomada"). Nenhum foi alterado |

**Backup inicial, com restauração conferida:**

- `pg_dump -Fc` no snapshot de uma transação `REPEATABLE READ READ ONLY`, com contagem e md5 de cada tabela no mesmo snapshot (manifesto). Ponto de recuperação: 18/11/2026 02:37:12 UTC, estado 16.
- Pasta: `%USERPROFILE%\AgendaCloud-operacoes\inicial-16-backup-2026-11-18T02-36-44Z`, **só no PC de casa**. Nunca vai para o Git.
- Restauração num PostgreSQL 17.11 descartável local, com TLS: sha256 confere com o manifesto, `pg_restore` completo numa transação, 45 tabelas, **contagens e md5 iguais**. O servidor descartável foi apagado no fim.
- **Ensaio das migrations na cópia restaurada** (PostgreSQL descartável, nunca o piloto): 17 a partir de uma cópia limpa em `04c9a43`, 18 a partir de `becc923` e 19 a partir de `4585af0`. Cada uma aplicou uma migration, sem erro, de 16 para 19. A conferência do estado 18 (as sete consultas do passo 3.6) e a do estado 19 saíram como esperado, com a migration 19 sem criar o plano modular e sem preços.
- **`seatTransitionReport` no ensaio:** três estabelecimentos, nenhum acima do limite e nenhum com ocupação diferente entre a regra anterior e a nova. **Isto não substitui o relatório exigido antes da migration 19**, que é rodado na restauração de um backup feito logo antes dela.

**Etapa 0 concluída (18/11/2026):**

| Item | Resultado |
|---|---|
| Deploy | web em `8e8577d698fd3d2b9eb2a42b6945fbd3cb3205d2`, por commit (`dep-dbuh1skipgvc738tcfvg`), criado 02:44:02 UTC, live 02:47:03 UTC |
| Estado ao final | **API e web em `8e8577d`**, banco 16 |
| Verificações HTTP sem login, depois do live | API `GET /` 200 (`Hello World!`); API `GET /health` 404 (esperado nesta API); web `/login` 200, com o nome anterior do produto (esperado até a etapa 3, seção 4.3); web `/agenda_api/auth/me` sem cookie 401; `POST /agenda_api/auth/logout` com `Origin: https://exemplo.invalid` 403; `/portal/manifest.webmanifest` 200 |
| **Login autenticado** | **não testado.** O passo 0.2 (entrar, recarregar, sair e entrar, abrir as telas e a tela de comissões de um profissional) fica para o teste final do responsável |

**Senha do banco do piloto exposta.** Em 18/11/2026 a senha do usuário do banco do piloto apareceu acidentalmente numa captura de tela. Ela é tratada como exposta, e a **rotação ainda não foi feita**. Usam essa senha: `DATABASE_URL` e `DIRECT_URL` no serviço da API do Render e a cópia cifrada da URL direta no PC de operação. Nenhum arquivo do repositório e nenhum segredo do GitHub a usam. Neon, as duas variáveis da API e a cópia de operação precisam ficar sincronizados (procedimento em "Estado e retomada").

### 1.4 Sessão de 18/11/2026 no PC do trabalho, entre 11:00 e 12:00 UTC

**Deploys inesperados, autoria não confirmada.** Às 03:01 UTC, três minutos depois do checkpoint `6c0876c`, alguém disparou deploys manuais de `4585af0` nos dois serviços pelo painel do Render. Eles não estão neste plano e a autoria não foi confirmada.

| Serviço | Deploy | Resultado |
|---|---|---|
| API | `dep-dbuha8c9v7es738ini2g` | `update_failed` em `validateEnv` (`Campos com problema: PLATFORM_2FA_ENFORCEMENT, PLATFORM_TOTP_KEYS`). A API continuou em `8e8577d` (`dep-dbreqklckfvc73e2loag`). Nenhuma migration foi aplicada |
| Web | `dep-dbuha9g8v5cc7393tn0g` | ficou live. De 03:04 a 11:17 UTC o piloto rodou o par **web `4585af0` com API `8e8577d`**, não validado |

**Correção, autorizada pelo responsável:**

| Item | Resultado |
|---|---|
| Releitura antes do deploy | API `8e8577d`, web `4585af0`, Auto-Deploy desligado nos dois, nada em fila |
| Deploy | web em `8e8577d698fd3d2b9eb2a42b6945fbd3cb3205d2`, por commit (`dep-dbuohgk9v7es7396tnp0`), criado 11:15:14 UTC, live 11:17:41 UTC. API e Auto-Deploy sem mudança |
| Verificações HTTP sem login | as mesmas da etapa 0, com os mesmos resultados (API `GET /` 200, `/health` 404, web `/login` 200, `auth/me` sem cookie 401, logout com origem estranha 403, manifest do portal 200). **Não comprovam login autenticado** |
| Destino das variáveis do banco na API (sem ler credencial) | `DATABASE_URL` (pooler) e `DIRECT_URL` (direta) apontam para o endpoint do piloto, com o mesmo usuário e `sslmode=verify-full`. Nenhuma aponta para o endpoint proibido |
| `pilot:check-database` com `PILOT_EXPECT=after-commission-settings` (11:2x UTC e de novo depois da decisão abaixo) | `MIGRATIONS_APPLIED: 16`, `SCHEMA_OBJECTS_OK: 7/7`, `BASELINE_FAILURES: none`, `RESULT: SUCCESS`; endpoint do piloto, diferente do proibido, TLS verificado |

**Rotação da senha adiada por decisão do responsável (18/11/2026).** A troca chegou a ser preparada, mas nada foi alterado: a senha no Neon, `DATABASE_URL`, `DIRECT_URL` e a cópia cifrada no PC de casa continuam as mesmas e sincronizadas. A senha continua tratada como exposta. A pendência e as condições para fazê-la depois estão em "Estado e retomada".

## 2. Comprovado e pendente

### Comprovado

| Fato | Evidência |
|---|---|
| Login, recarga com sessão, sair e entrar, e acesso às telas funcionam com web `438e598` e API `8e8577d` | confirmação do responsável em 16/11/2026, sem horário e sem leitura de log correspondente. Este par não está mais no ar (seção 1.1) |
| SHAs live, Auto-Deploy desligado, branch dos serviços, nada em fila | lista de deploys e de serviços do Render, 16/11 |
| Uma API a partir de `b5e5586` não sobe no piloto como ele está | log do deploy `dep-dbs6p6ec6qcc738b5qg0` (14/11): `Campos com problema: PLATFORM_2FA_ENFORCEMENT, PLATFORM_TOTP_KEYS` |
| O que cada SHA da fila exige (tabela da seção 3) | leitura do código em cada commit: migrations, `env.validation.ts`, manifesto |
| `5d74556`, `04c9a43` e `b5b2704` têm a mesma árvore do head que o CI aprovou | `5d74556` = head `e862b32`; `04c9a43` = head `edbeed0`; `b5b2704` = head `0329035`. CI com sucesso nos três heads |
| `9de722d` (alvo da etapa 3) tem a mesma árvore do head que o CI aprovou, e o mesmo `backend/` de `b5b2704` | `9de722d` = head `6a9da3f` (`git diff` vazio); CI com sucesso nesse head (run 43912909010, primeira tentativa); `git diff b5b2704 9de722d -- backend` vazio |
| Com a hospedagem respondendo 429 no lugar da API, o navegador pede a partida, a leitura se repete e o login fica disponível, **em ambiente local com a borda simulada** | suíte `test:browser:proxy` no head `6a9da3f`, local e no CI. Limite na seção 4.4 |
| Autoria dos deploys manuais de 12/11 a 16/11 | declaração do responsável em 16/11/2026: foram feitos por ele, para tentar recuperar o acesso depois de um período de inatividade (decisão D2, seção 8) |
| A API `8e8577d` aceita o schema 17 | tabela de compatibilidade de [`publicacao-tenant-teste-slugs.md`](../runbooks/publicacao-tenant-teste-slugs.md), seção 1 (leitura de código) |

### Pendente (conferir na hora, nunca presumir)

| Item | Onde se confere |
|---|---|
| Quantidade e nomes das migrations no piloto hoje | `pilot:check-database`, no passo de conferência de cada etapa |
| Nomes das variáveis no serviço da API. Em 12/11 não havia nenhuma `PLATFORM_*`; o erro de 14/11 cita duas das três, e a terceira (`PLATFORM_TOTP_KEY_CURRENT`) não foi conferida | painel do Render, aba Environment |
| Tela de comissões de um profissional no estado atual. Pelo código, o web atual exige `exceptionsFingerprint`, que a API `8e8577d` não envia: a tela deve mostrar "Não foi possível carregar". Não reproduzido | a etapa 0 confere: com o web em `8e8577d`, a tela precisa abrir |
| Quais estabelecimentos são de teste, quem são os proprietários reais do portal e onde ficam as duas cópias da chave TOTP | só o responsável sabe (seção 8). Nada disso é deduzido do banco nem escrito neste repositório |
| Funcionalidades novas do web: comissão em massa, relatórios do portal, marca de teste, Segurança da conta, cabeçalhos e `noindex` do SEO | validação de cada etapa. Nenhuma está validada no piloto |
| Login com o par que está no ar, web `b5b2704` e API `8e8577d` | ninguém confirmou. Não é pré-requisito da etapa 0, mas pesa no retorno dela (seção 4.2) |
| Migrations 17 e 18 num banco com dados reais | só foram aplicadas em banco descartável |
| Recuperação após hibernação no Render, sem deploy manual | passo 3.12. Só foi provada com a borda simulada (seção 4.4) |
| Se a resposta real da borda ao proxy traz `Retry-After` ou algum cabeçalho `RateLimit*`. Esses cabeçalhos nunca foram observados diretamente | passo 3.12 e seção 4.4. Se estiverem presentes, a correção não age nesse caso |
| Requisitos do 2FA que só existem na hora: quantos `MASTER_OWNER` ativos, e-mail configurado e chegando, e-mails verificados | [`publicacao-2fa-administrativo.md`](../runbooks/publicacao-2fa-administrativo.md), seção 0 |
| Plano do Neon, janela de histórico, limite e custo de branches | console do Neon ([`publicacao-comissoes-em-massa-piloto.md`](../runbooks/publicacao-comissoes-em-massa-piloto.md), passo 1.1) |
| `EMAIL_FROM_NAME` ainda com o nome antigo do produto | painel do Render, na etapa 3 |
| Queda silenciosa de rede no `/health` | [`publicacao-segura.md`](publicacao-segura.md), seção 4. Fora desta fila (seção 7) |
| Backup automático (lote O1) | não configurado, segundo [`backup-piloto-automatico.md`](../runbooks/backup-piloto-automatico.md). Não é pré-requisito desta fila (seção 6) |

## 3. Etapas e SHAs

| Etapa | SHA alvo | O que entra | Migrations exigidas | Variáveis novas na API |
|---|---|---|---|---|
| 1. Comissões em massa | `5d74556e9e12e55f38e0056d0f19911f3e66f475` | PR #102 | 16 (nenhuma nova) | nenhuma |
| 2. Migration 17 e o pacote dela | `04c9a4382decea6c175ffdfb28cc722cb8ad6092` (último commit antes do 2FA) | #104 SEO e cabeçalhos, #105 marca de teste e slugs reservados, #106 portal separa clientes de internos, #108 relatórios do portal, #110 manifesto único do portal | 17 | nenhuma |
| 3. 2FA com os demais lotes | **merge commit do PR #120** (desde 17/11; antes `9de722d1380fa55b6c588b63d01dea1a4ebdc1f2`, merge do PR #117), **na API e no web** | #109 segundo fator, #111 página inicial e nome TimVix, #112 limpeza do login, #113 preços na página inicial, #114 menu do dono, #115 conferência de migrations na inicialização e `GET /health`, #117 recuperação após hibernação quando a hospedagem responde 429 (só web) | 18 | `PLATFORM_TOTP_KEYS`, `PLATFORM_TOTP_KEY_CURRENT`, `PLATFORM_2FA_ENFORCEMENT` |

Os SHAs abreviados no resto do documento são estes três. Até 16/11/2026 o alvo da etapa 3 era `b5b27046369b2b36ad339a41d44ff405fcb44c43`; a troca está explicada abaixo.

Por que esses SHAs:

- **`5d74556`** é o alvo fixado no roteiro das comissões.
- **`04c9a43`** é o último commit da integração que exige 17 migrations e nenhuma variável `PLATFORM_*`. O commit seguinte (`b5e5586`) já é o 2FA.
- **`9de722d`** é a ponta da integração depois do merge do PR #117. Em relação a `b5b2704`, o alvo anterior, acrescenta só a correção do proxy do web para a API hibernada, os testes dela e documentação (#116 e #117). O `backend/` é idêntico ao de `b5b2704`, então as migrations, as variáveis, a conferência de inicialização e tudo o que este plano diz sobre a API de `b5b2704` valem sem mudança. A API também vai a `9de722d`, mesmo sem código novo, para a etapa terminar com os dois serviços no mesmo SHA.
- Publicar o 2FA em `b5e5586` e depois subir de novo seriam dois deploys a mais sem ganho: os commits seguintes só acrescentam lotes sem migration e a conferência de inicialização, que protege justamente esta etapa.

Nenhuma etapa pode usar um SHA mais novo que o dela antes de o banco e as variáveis estarem prontos: a API de `b5b2704` em diante (inclusive `9de722d`) recusa subir com 16 ou 17 migrations, e a partir de `b5e5586` recusa sem as três variáveis.

## 4. Transição: API e web no SHA de cada etapa

**Decisão do responsável (16/11/2026):** cada etapa termina com API e web no mesmo SHA, como os roteiros mandam e como o CI validou. O web não fica à frente da API (em `438e598` quando a decisão foi tomada, em `b5b2704` hoje) durante as etapas 1 e 2: a combinação de web mais novo com API mais antiga não foi validada.

### 4.1 Sequência de estados

| Momento | API | Web | Banco esperado | O que sustenta este par |
|---|---|---|---|---|
| Histórico, até 16/11 12:59 UTC | `8e8577d` | `438e598` | 16 na última conferência de 13/11 | login confirmado pelo responsável em 16/11. Nenhum roteiro descreve este par e o CI não o exercitou. Não está mais no ar |
| Hoje (leitura de 16/11, 17:15 UTC; reconferir no passo 0.0) | `8e8577d` | `b5b2704` | 16 na última conferência de 13/11; reconfirmar antes da execução | **nada**: login não confirmado, nenhum roteiro descreve este par e o CI não o exercitou |
| **Etapa 0**, fim | `8e8577d` | `8e8577d` | 16 | os dois serviços no mesmo SHA; é o ponto de partida que o roteiro das comissões exige e o alvo do roteiro de recuperação, que valeu de 13/11 16:23 a 14/11 14:15 UTC. O responsável ainda não confirmou este par: o passo 0.2 faz isso |
| Etapa 1, entre os deploys | `5d74556` | `8e8577d` | 16 | tabela de compatibilidade do roteiro das comissões: funciona (leitura de código) |
| **Etapa 1**, fim | `5d74556` | `5d74556` | 16 | CI no head `e862b32`, mesma árvore |
| Etapa 2, depois da migration | `5d74556` | `5d74556` | 17 | roteiro da 17, seção 1: banco 17 com API e web anteriores funcionam |
| Etapa 2, entre os deploys | `04c9a43` | `5d74556` | 17 | roteiro da 17, seção 1: funcionam, proteção contra indexação inativa |
| **Etapa 2**, fim | `04c9a43` | `04c9a43` | 17 | CI no head `edbeed0`, mesma árvore |
| Etapa 3, depois da migration e das variáveis | `04c9a43` | `04c9a43` | 18 | roteiro do 2FA, seção 2: a migration só acrescenta, nenhum acesso muda por ela |
| Etapa 3, entre os deploys | `9de722d` | `04c9a43` | 18 | roteiro do 2FA, seção 3: quem não tem fator usa o portal como antes. A API de `9de722d` é a de `b5b2704` (`backend/` idêntico) |
| **Etapa 3**, fim | `9de722d` | `9de722d` | 18 | CI no head `6a9da3f`, mesma árvore |

A coluna do banco é o estado esperado, não uma leitura: cada etapa reconfirma com a conferência dela antes de qualquer escrita ou deploy.

Limite desta tabela: só os pares de fim de etapa passaram pelo CI. Os estados "entre os deploys" duram o tempo de um deploy e seguem a ordem que cada roteiro manda (API e depois web).

### 4.1.1 Gravações durante os pares transitórios

**A pausa do operador não bloqueia ninguém.** Durante um deploy o piloto continua no ar: clientes agendam pela página pública e quem está logado em `/conta` continua gravando. O plano não supõe o contrário. O que o operador controla é só o que ele mesmo faz: não valida funcionalidade nova e não faz ação administrativa no portal entre o deploy da API e o do web.

Por isso a compatibilidade de cada par transitório foi conferida pelos contratos, com `git diff` da API entre os SHAs e leitura dos validadores do web. Não foi feito teste por HTTP: a leitura não deixou dúvida concreta que pedisse um.

| Par transitório | O que muda na API em relação ao web que está no ar | Gravações |
|---|---|---|
| API `5d74556`, web `8e8577d`, banco 16 | só `backend/src/commissions`: duas rotas novas (`POST bulk-settings` e `bulk-settings/preview`) e três campos **opcionais** no `PUT` das configurações. Agendamento público, agenda e login sem mudança | compatíveis. O `PUT` do web antigo, sem os campos novos, mantém as exceções como estão |
| API e web `5d74556`, banco 17 (depois da migration) | nenhuma mudança de código. A coluna `is_test` nasce com padrão `false` e a API em serviço não a lê | compatíveis. Um cadastro novo recebe o padrão |
| API `04c9a43`, web `5d74556`, banco 17 | agendamento público: só um campo a mais na resposta (`indexable`). Cadastro: o gerador de slug pula os reservados. Portal: rotas novas (relatórios, marca de teste) e filtros novos opcionais, com padrão | compatíveis. Nenhum campo foi removido nem passou a ser obrigatório |
| API `04c9a43`, web `04c9a43`, banco 18 (depois da migration e das variáveis) | nenhuma mudança de código. Tabelas e colunas novas, anuláveis ou com padrão, que a API em serviço não lê | compatíveis |
| API `9de722d` (`optional`; mesmo `backend/` de `b5b2704`), web `04c9a43`, banco 18 | agendamento público e agenda sem mudança. `auth/me` ganha um campo (`tenantCategory`). As rotas do portal passam pelo guarda do segundo fator, que na fase `optional` libera quem não tem fator | compatíveis para o uso comum. Restrição só administrativa, abaixo |

Os validadores do web conferem os campos que usam e ignoram os que não conhecem (nenhum `.strict()` em `src/` nos três SHAs), então um campo a mais na resposta não quebra o web anterior.

**Nenhum par exige bloqueio de gravações**, e este plano não propõe modo de manutenção. A única restrição é de operação, no último par: até o web de `9de722d` estar no ar, ninguém convida nem promove conta de plataforma e ninguém cadastra o aplicativo. Uma conta de plataforma nova nasce obrigada a cadastrar o fator, e o web anterior não tem a tela para isso: ela ficaria bloqueada no portal, nunca liberada (roteiro do 2FA, seção 3).

Limite desta conferência: é leitura de código e de contrato. Os lotes #104, #106, #108, #110 e #111 a #115 não têm tabela de compatibilidade própria nos roteiros; a conclusão acima vem do `diff`, não de execução. O #117 não muda a API nem o contrato entre o web e ela: só o que o proxy do web faz com um 429 que veio da hospedagem.

### 4.2 Etapa 0: o retorno do web a `8e8577d`

O retorno é necessário para que todo estado da fila seja um que algum roteiro descreve:

- **Sem ele**, a etapa 1 passaria por API `5d74556` com web `b5b2704`, par que nenhum roteiro avalia. A alternativa de levar o web direto de `b5b2704` para `5d74556` antes da API dá web `5d74556` com API `8e8577d`, que o roteiro das comissões registra como defeituoso e que inverte a ordem dele.
- **Com ele**, o passo 0 do roteiro das comissões (API e web em `8e8577d`) fica verdadeiro, e o rollback da etapa 1 tem um destino conhecido.

É um deploy só do web, sem banco, sem variável e sem migration.

| Passo | O que fazer | Continuar se | Parar se |
|---|---|---|---|
| 0.0 | Render, só leitura. Reconfere a leitura da seção 1.1 | API `8e8577d`, web `b5b2704`, Auto-Deploy desligado, nada em fila. Anote os IDs dos deploys live | qualquer outro SHA live, em qualquer dos dois serviços. Estado diferente exige reavaliar a etapa antes de qualquer deploy |
| 0.1 | Web em `8e8577d698fd3d2b9eb2a42b6945fbd3cb3205d2`, por commit | live no SHA; `/login` 200; `/agenda_api/auth/me` sem cookie 401 (com a API acordada) | o deploy não fica live: o Render mantém `b5b2704`, leia o log |
| 0.2 | O responsável repete os quatro testes de 16/11 (entrar, recarregar com sessão, sair e entrar, abrir as telas) e abre a tela de comissões de um profissional | os quatro funcionam e a tela de comissões abre | qualquer um falha |

- **Ponto de recuperação:** nenhum no banco, porque nada é escrito. O retorno é o web de volta a `b5b27046369b2b36ad339a41d44ff405fcb44c43` (o deploy live anotado em 0.0), que é o estado anterior à etapa.
- **Critério de parada:** se 0.2 falhar, volte o web a `b5b2704` e **não comece a etapa 1**. O par `8e8577d` com `8e8577d` nunca foi confirmado pelo responsável depois da recuperação; a etapa 0 é essa confirmação.
- **O retorno não é uma recuperação comprovada.** Ele só restaura o que estava no ar antes da etapa: web `b5b2704` com API `8e8577d`, par que ainda não teve login confirmado. Se 0.2 falhar e o web voltar a `b5b2704`, o piloto fica num estado não validado; a fila para ali e a situação é reavaliada com o responsável antes de qualquer outro passo.
- **Histórico:** o último par com login confirmado pelo responsável foi web `438e598` com API `8e8577d` (16/11). Ele fica registrado como referência; não é o destino do retorno desta etapa.
- **API hibernada não é falha da etapa:** antes de conferir 0.1 e 0.2, acorde a API pelo endereço dela (seção 4.4).
- **Janela:** de preferência a mesma da etapa 1. Entre as duas há validação e parada: a etapa 1 só começa com o passo 0.2 aprovado pelo responsável, e o passo 1.0 relê o Render antes de qualquer coisa.

### 4.3 O que fica temporariamente indisponível

Do fim da etapa 0 até a etapa indicada. Lido no código de cada merge, não testado no piloto.

**Mudanças que estão no ar hoje e saem** (só dependem do web):

| O que sai | Lote | Volta na |
|---|---|---|
| Cabeçalhos de segurança, `noindex` das áreas privadas e `canonical` das páginas públicas | #104 | etapa 2 |
| Manifesto único do portal, que corrige o redirecionamento em aparelho lento | #110 | etapa 2 |
| Página inicial nova e o nome TimVix. As telas voltam a mostrar o nome anterior do produto | #111 | etapa 3 |
| Limpeza da tela de login e o aviso preciso de erro do servidor | #112 | etapa 3 |
| Preços aprovados na seção de planos da página inicial | #113 | etapa 3 |
| Menu do dono e Configurações organizados por assunto | #114 | etapa 3 |

**Telas que existem hoje no web, mas dependem de uma API que não está no ar.** Não foram validadas e, pelo código, não funcionam hoje. Com o retorno, as telas somem em vez de falhar:

| Tela ou função | Lote | Chega completa na |
|---|---|---|
| Comissão em massa | #102 | etapa 1 |
| Marca de teste e controle "Busca na internet" no portal | #105 | etapa 2 |
| Portal separando clientes de contas internas | #106 | etapa 2 |
| Relatórios do portal por período | #108 | etapa 2 |
| Segurança da conta (segundo fator) | #109 | etapa 3 |

**O que volta a funcionar com o retorno:** a tela de comissões de um profissional, se a hipótese da seção 2 estiver certa (passo 0.2).

**O que não muda:** login, agenda, agendamento público, notificações e os dados. Nenhuma etapa antes da 2 escreve no schema.

Outra mudança de comportamento, no sentido contrário: o web atual responde 503 temporário na página pública quando a API está lenta ou dormindo (roteiro da 17, seção 3.1). Do fim da etapa 0 até a etapa 2, a página volta a abrir como antes desse lote.

### 4.4 Acesso após hibernação: contorno nas etapas 0 a 2, correção na etapa 3

No plano gratuito a API hiberna depois de um tempo sem acesso. Desde 16/11/2026 a hospedagem responde 429 ao servidor do web no lugar da API hibernada, e esse pedido não a acorda ([`recuperacao-apos-hibernacao-continuidade.md`](recuperacao-apos-hibernacao-continuidade.md), atualização de 16/11). Nenhum SHA das etapas 0, 1 e 2 (`8e8577d`, `5d74556`, `04c9a43`) reconhece esse 429: a tela mostra "O servidor respondeu com um erro" ou fica em "Aguardando o servidor...", e "Tentar novamente" não resolve sozinho.

**Contorno, válido da etapa 0 ao fim da etapa 2** (e hoje):

1. Abra no navegador o endereço público da API (`https://agenda-cloud-piloto-api.onrender.com/`).
2. Espere aparecer `Hello World!`. Na medição de 16/11 levou cerca de 32 s.
3. Volte ao web e use "Tentar novamente" ou recarregue a página.

**Não faça deploy nem reinício para recuperar o acesso.** Este é o procedimento adotado (decisão D2, seção 8). Um deploy fora do plano muda os SHAs live e faz o passo 0 de cada etapa parar; os deploys manuais de 12/11 a 16/11 nasceram dessa tentativa.

O contorno também vale para as verificações de cada etapa: antes de conferir `/agenda_api/auth/me` ou de o responsável testar o login, acorde a API pelo passo 1. Um 429 ou a tela de erro com a API hibernada não é falha do deploy.

**A correção (PR #117) só entra no web da etapa 3.** Ela não é levada aos SHAs das etapas 0 a 2: isso criaria versões que o CI não validou.

**Limite da correção, a confirmar no piloto (passo 3.12):**

- Os testes locais e do CI usam uma **borda simulada**: um relé local que devolve os dois corpos capturados no piloto em 16/11 (texto puro `Too Many Requests` e a página de desafio), sem cabeçalho de limite. Nenhum teste falou com a borda real do Render.
- A regra só trata o 429 como hospedagem quando ele vem **sem** `Retry-After` e **sem** cabeçalhos `RateLimit*`. A ausência deles na resposta real foi deduzida (o proxy repassa esses cabeçalhos ao navegador quando existem, e eles não chegaram em 16/11), não lida diretamente na resposta da borda ao proxy.
- **Se a resposta real trouxer `Retry-After` ou algum `RateLimit*`, a heurística preserva o 429 como veio e pode não recuperar esse caso.** O mesmo vale se a borda mudar o texto ou a página. Nesses casos a tela volta a mostrar o erro de hoje, o contorno acima continua valendo, e a regra precisa de ajuste em outro lote.

## 5. Sequência

Uma etapa por sessão. A etapa 0 fica, de preferência, na mesma janela da etapa 1, com a validação do passo 0.2 e uma parada entre elas. Não comece uma etapa sem a anterior encerrada e validada.

Regras para todas as etapas:

- **Passo 0, só leitura:** `render deploys list` mostra exatamente os SHAs live esperados para o início da etapa, nos dois serviços, com Auto-Deploy desligado e nada em fila. Se houver deploy que este plano não previu, **pare**.
- **Ordem fixa dentro da etapa:** ponto de recuperação, conferência do banco, migration (se houver), conferência do banco, variáveis (se houver), API, web no mesmo SHA, validação.
- **Migration sempre de uma cópia limpa no SHA da etapa**, nunca da ponta da integração. `migration:run:compiled` aplica todas as pendentes que o build contém: rodado do SHA da etapa 3 (`9de722d`, ou `b5b2704`) num banco com 16, aplicaria a 17 e a 18 juntas.
- **Nunca no piloto:** `migration:revert`, `migration:show`, restauração de backup por cima, `Reset from parent`.
- **Deploy por commit:** `render deploys create <serviço> --commit <sha completo> --wait --confirm`, ou "Deploy a specific commit" no painel. Nunca "Deploy latest commit".
- Uma falha de deploy antes de ficar live não exige ação: o Render mantém a versão anterior. Leia o log antes de tentar de novo.
- Entre o deploy da API e o do web de uma etapa, o operador não valida funcionalidade nova nem faz ação administrativa no portal. Isso não bloqueia o uso: clientes e equipes continuam gravando, e os pares transitórios aceitam essas gravações (seção 4.1.1).
- **Etapas 0, 1 e 2:** se o web mostrar erro do servidor depois de um tempo sem acesso, use o contorno da seção 4.4 (acordar a API pelo navegador). Nunca um deploy ou reinício.

### Etapa 1: comissões em massa (`5d74556`)

Roteiro: [`publicacao-comissoes-em-massa-piloto.md`](../runbooks/publicacao-comissoes-em-massa-piloto.md), seguido sem desvio.

| Passo | O que fazer | Continuar se | Parar se |
|---|---|---|---|
| 1.0 | Render, só leitura | API e web em `8e8577d` (fim da etapa 0) | qualquer outro SHA live |
| 1.1 | Ponto de recuperação: branch do Neon (roteiro, passo 1) | branch criada, com endpoint diferente do piloto, e conferida no estado 16 | custo não autorizado, limite de branches esgotado ou branch que não confere |
| 1.2 | Conferência do banco, só leitura (roteiro, passo 2: fase `conferir` do kit e `PILOT_EXPECT=after-commission-settings`) | `MIGRATIONS_APPLIED: 16`, `SCHEMA_OBJECTS_OK: 7/7`, `BASELINE_FAILURES: none`, `RESULT: SUCCESS` | qualquer outro resultado. A tabela do passo 3 do roteiro diz o que cada um significa |
| 1.3 | API em `5d74556` (roteiro, passo 4) | live no SHA; `GET /` 200; `/agenda_api/auth/me` sem cookie 401; log sem erro; o responsável entra pelo web `8e8577d` e abre a agenda e as comissões de um profissional | deploy falha, 500 no log ou tela de comissões que não carrega |
| 1.4 | Web em `5d74556` (roteiro, passo 5) | live no SHA; `/login` 200; `auth/me` 401; `POST` de logout com origem estranha 403; manifest do portal 200; fase `conferir` de novo com o mesmo resultado | qualquer verificação fora do esperado |
| 1.5 | Validação funcional (roteiro, passo 6), só no estabelecimento de teste indicado pelo responsável | os nove itens como descritos; o relatório do período com o mesmo total | exceção removida sem confirmação, regra alterada fora do alcance ou apuração antiga alterada (este último é incidente de dados: não faça rollback às pressas) |

- **Estado ao final:** API e web em `5d74556`, banco 16.
- **Ponto de recuperação:** a branch do Neon do passo 1.1, mantida por pelo menos 7 dias depois da validação. O schema não muda nesta etapa.
- **Critério de parada:** os "Critérios de interrupção" do roteiro. Antes do deploy, parar não deixa nada a desfazer.
- **Retorno:** só código, web primeiro e API depois, os dois a `8e8577d`. Nunca voltar só a API. Exceções removidas não voltam sozinhas (roteiro, "Recuperar dados da branch").

### Etapa 2: migration 17 e o pacote dela (`04c9a43`)

Roteiro: [`publicacao-tenant-teste-slugs.md`](../runbooks/publicacao-tenant-teste-slugs.md).

| Passo | O que fazer | Continuar se | Parar se |
|---|---|---|---|
| 2.0 | Render, só leitura | API e web em `5d74556` | qualquer outro SHA live |
| 2.1 | `pg_dump` com restauração validada (seção 6) | restauração em banco descartável com a mesma contagem de linhas por tabela; horário anotado | backup que não restaura igual. Sem restauração validada, a migration não é aplicada |
| 2.2 | Conferência antes: `PILOT_EXPECT=before-tenant-test-flag` | `MIGRATIONS_APPLIED: 16`, `SCHEMA_OBJECTS_OK: 0/2`, `MARCADOS_COMO_TESTE: coluna ainda não existe`, `BASELINE_FAILURES: none`, `RESULT: SUCCESS` | qualquer outro resultado |
| 2.3 | Aplicar a 17, de uma cópia limpa em `04c9a43` (roteiro, seção 2, passo 3) | o TypeORM aplica uma migration, `TenantTestFlag1793664000000` | o comando lista outra migration, falha ou a conexão cai. **Não repita**: rode a conferência para ver o estado real |
| 2.4 | Conferência depois: `PILOT_EXPECT=after-tenant-test-flag` | `MIGRATIONS_APPLIED: 17`, `SCHEMA_OBJECTS_OK: 2/2`, `MARCADOS_COMO_TESTE: 0`, `RESULT: SUCCESS` | qualquer outro resultado |
| 2.5 | Conferir que a API e o web em serviço (`5d74556`) continuam funcionando no schema 17 | login e agenda normais; log sem erro | erro de schema no log |
| 2.6 | API em `04c9a43` | live no SHA; `GET /public/<slug>` de um **estabelecimento real** traz `"indexable": true`; log sem erro | deploy falha ou 500 em leitura de estabelecimento |
| 2.7 | Web em `04c9a43` | live no SHA; para um estabelecimento real, `curl -sI` de `/agendar/<slug>` sem `x-robots-tag` e HTML com `canonical` | `noindex` na página de um estabelecimento real, ou 503 que não passa com a API acordada |
| 2.8 | Classificar os estabelecimentos de teste no portal (roteiro, seção 4, **obrigatório**), pela lista do responsável | `MARCADOS_COMO_TESTE` igual ao tamanho da lista; para cada marcado, `"indexable": false` na API e `x-robots-tag: noindex, nofollow` no web, e a página abre normalmente | contagem diferente da lista, ou um marcado ainda indexável |
| 2.9 | Colisões de slug, só leitura: `npm run pilot:check-reserved-slugs` (roteiro, seção 5) | saída anotada; renomear é decisão caso a caso | não bloqueia |

- **Estado ao final:** API e web em `04c9a43`, banco 17.
- **`indexable: true` vale só para os estabelecimentos reais.** O valor é o inverso da marca de teste: os de teste ficam com `indexable: false` e `noindex`, e assim permanecem. A migration cria a marca com padrão `false`, então entre os passos 2.6 e 2.8 **todos** respondem `true`, inclusive os de teste, como já acontece hoje. A proteção só existe depois do passo 2.8, e o passo 2.8 depende da lista do responsável (seção 8).
- **Ponto de recuperação:** o `pg_dump` do passo 2.1, com a restauração validada. Ele serve para recuperar dados numa cópia; nunca é restaurado por cima do piloto.
- **Critério de parada:** qualquer resultado diferente do esperado nos passos 2.1 a 2.4 para a etapa antes de qualquer deploy. Uma migration que falha roda em transação: confira o estado real antes de decidir.
- **Retorno:** só código, web e API de volta a `5d74556` (os dois aceitam o schema 17); o banco fica em 17. O `down` da migration não é usado.
- **Muda para quem usa:** a página pública volta a responder 503 temporário quando a API está lenta ou dormindo, em vez de abrir (roteiro, seção 3.1).

### Etapa 3: 2FA com os demais lotes (`9de722d`)

Roteiro: [`publicacao-2fa-administrativo.md`](../runbooks/publicacao-2fa-administrativo.md). Fase inicial `optional`.

SHA completo, para a API e para o web: `9de722d1380fa55b6c588b63d01dea1a4ebdc1f2`. Os requisitos desta etapa não mudaram com a troca do alvo: backup com restauração validada, migration 18, as três variáveis `PLATFORM_*` e os critérios de parada são os mesmos, porque o `backend/` é o de `b5b2704`.

| Passo | O que fazer | Continuar se | Parar se |
|---|---|---|---|
| 3.0 | Render, só leitura | API e web em `04c9a43` | qualquer outro SHA live |
| 3.1 | Requisitos da hora (roteiro, seção 0): proprietários ativos, e-mail configurado e chegando, e-mails verificados | os proprietários reais indicados pelo responsável conferem com o que o banco mostra: dois, ou um só com a emergência (roteiro, seção 6) ensaiada antes em banco descartável; e-mail conferido | um só proprietário sem o ensaio, ou proprietário ativo que o responsável não reconhece. Sem e-mail conferido a etapa pode seguir, mas a liberação pelo portal fica indisponível e a recuperação depende da seção 6 do roteiro |
| 3.2 | Gerar a chave TOTP e guardar em dois lugares fora do banco e fora do Render (roteiro, seção 1, passos 1 e 2). Os lugares são escolha do responsável | as duas cópias guardadas e conferidas pelo responsável | chave guardada em um lugar só, ou lugares ainda não definidos |
| 3.3 | `pg_dump` com restauração validada (seção 6) | como no passo 2.1 | como no passo 2.1 |
| 3.4 | Conferência antes: `PILOT_EXPECT=after-tenant-test-flag` | `MIGRATIONS_APPLIED: 17`, `SCHEMA_OBJECTS_OK: 2/2`, `MARCADOS_COMO_TESTE` igual à lista do passo 2.8 | qualquer outro resultado |
| 3.5 | Aplicar a 18, de uma cópia limpa em `9de722d` (mesmas migrations de `b5b2704`) | o TypeORM aplica uma migration, `AdminSecondFactor1793750400000` | o comando lista outra migration, falha ou a conexão cai. Não repita |
| 3.6 | Conferência do estado 18 (bloco abaixo), só leitura | os sete resultados exatamente como esperado | qualquer diferença. Nenhuma variável e nenhum deploy antes de entender a diferença |
| 3.7 | Variáveis no serviço da API (roteiro, seção 1, passo 3): as três `PLATFORM_*`, com `optional`. Salvar **sem** disparar deploy, se o painel oferecer essa escolha | as três presentes; o web sem nenhuma delas | um deploy inesperado começa: espere terminar e releia o passo 3.0 |
| 3.8 | API em `9de722d` | live no SHA; log com `18 de 18 registradas no banco` e `Nest application successfully started`; `GET /` 200; `GET /health` 200 | `[SchemaReadiness] A API não vai iniciar` (falta migration) ou `Configuração de ambiente inválida` (falta variável). A versão anterior continua no ar: corrija a causa, não insista no deploy |
| 3.9 | Web em `9de722d`, logo em seguida | live no SHA; `/login` 200; `auth/me` 401; o responsável entra em `/conta` e no portal | qualquer verificação fora do esperado. Ninguém cadastra o aplicativo antes de o web novo estar no ar |
| 3.10 | Cadastro de cada proprietário real (roteiro, seção 4) | aplicativo, códigos de recuperação guardados, entrada com código e com um código de recuperação, e-mail de aviso recebido | um proprietário sem conseguir entrar com o fator |
| 3.11 | Conferir `EMAIL_FROM_NAME` e as telas dos lotes #111 a #114 (página inicial, login, preços, menu do dono) | como aprovado em cada plano | não bloqueia; vira correção para a frente |
| 3.12 | **Acesso após hibernação**, sem deploy e sem reinício (detalhe abaixo). Última validação da fila | o navegador pede a partida da API sozinho, a leitura se recupera e o login funciona | não bloqueia a etapa nem pede rollback: o contorno da seção 4.4 continua valendo. Anote o que a tela mostrou e os cabeçalhos do 429; a regra do proxy é ajustada em outro lote |

- **Estado ao final:** API e web em `9de722d`, banco 18, `PLATFORM_2FA_ENFORCEMENT=optional`.
- **Ponto de recuperação:** o `pg_dump` do passo 3.3, com a restauração validada, **mais** as duas cópias da chave TOTP do passo 3.2. Um sem o outro não recupera o segundo fator.
- **Critério de parada:** antes do passo 3.8, parar deixa o piloto em `04c9a43` funcionando, com o banco em 17 ou 18 (a API `04c9a43` ignora as tabelas novas). Depois do primeiro cadastro (3.10), não há retorno seguro de código.
- **Retorno:** o roteiro do 2FA, seção 7, vale inteiro. Depois que alguém cadastrar o fator, voltar a API a um SHA sem 2FA abre o portal só com a senha. A preferência é correção para a frente.
- **`required` não faz parte desta etapa.** É a seção 5 do roteiro do 2FA, com data própria, depois de todos os proprietários cadastrados.

#### Acesso após hibernação (passo 3.12)

Só depois de os passos 3.8 a 3.11 estarem aprovados. Nenhum deploy, reinício ou mudança de variável faz parte deste passo.

1. Deixe o piloto sem nenhum acesso por mais de 15 minutos: nem o web, nem o endereço da API, nem monitor. Anote o horário do último acesso.
2. Abra `/login` no navegador, **sem** abrir antes o endereço da API. Com as ferramentas do navegador abertas na aba de rede.
3. **Despertar pelo navegador:** a primeira leitura de `/agenda_api/auth/me` volta 502 com os cabeçalhos `X-Agenda-Proxy-Error: upstream-unavailable` e `X-Agenda-Acordar-Api`, e o navegador faz sozinho um `GET /` ao endereço da API. No log da API no Render, a partida começa logo depois desse pedido.
4. **Recuperação da leitura:** sem recarregar a página e sem clicar em nada, a leitura se repete até a API responder 401. O aviso de espera some e o formulário de login fica disponível. Esperado em cerca de 30 a 40 s, dentro do prazo de 100 s das leituras.
5. **Login:** o responsável entra normalmente. O login não é repetido automaticamente: só é enviado quando ele clica em "Entrar".
6. Confira na lista de deploys do Render que nenhum deploy novo apareceu.

**Se não recuperar,** antes de usar o contorno da seção 4.4 anote, na aba de rede, o status, o `Content-Type`, o corpo e os cabeçalhos da resposta de `/agenda_api/auth/me`, em especial `Retry-After` e `RateLimit*`. Um 429 que chega ao navegador com algum desses cabeçalhos é o caso que a heurística preserva de propósito (seção 4.4). Um 429 sem eles, mas com outro texto ou outra página, é mudança de formato da borda.

Limite deste passo: uma recuperação bem-sucedida prova o formato que a borda devolveu naquele momento. Em 16/11 ela alternou entre dois formatos; o passo pode ser repetido em outro dia para ver o outro.

#### Conferência do estado 18 (passo 3.6)

O `pilot:check-database` não tem expectativa para o estado 18, e nenhum lote de código será criado para isso. Depois da migration, `after-tenant-test-flag` passa a reprovar com `migration_history`, porque exige exatamente 17: é esperado. A contagem e o log da API **não bastam**: a conferência é o bloco abaixo, só de leitura, no `psql` com a URL direta do piloto, no molde de [`publicacao-piloto-render.md`](../runbooks/publicacao-piloto-render.md), seção 6.D, passo 4.

As consultas foram escritas a partir do código da migration (`backend/src/migrations/1793750400000-AdminSecondFactor.ts`) e **executadas em 16/11/2026 num PostgreSQL 18.6 local e descartável**, com TLS, as 18 migrations aplicadas pelo `migration:run` da árvore de `b5b2704` (mesmo `backend/` de `9de722d`) e dados fictícios (três usuários e duas sessões). Os sete resultados saíram como na tabela abaixo. Depois, com um fator, um código de recuperação e uma sessão verificada fictícios, a consulta 7 deixou de dar zero e as consultas 1 a 6 não mudaram.

Limite do ensaio: o banco local é PostgreSQL 18, e a versão do Neon no piloto não foi lida. A consulta 4 filtra `contype` para não depender da versão (o PostgreSQL 18 registra `NOT NULL` em `pg_constraint`).

**Quando cada resultado vale:**

- **Consultas 1 a 6 (histórico e estrutura):** valem logo depois da migration e continuam valendo em qualquer momento posterior.
- **Consulta 7 (contagens):** só é conferida no passo 3.6, entre a migration (3.5) e o deploy da API (3.8). Nesse intervalo nenhum código em serviço escreve nessas tabelas e colunas. **Depois do passo 3.8 não se exige zero:** a API nova registra tentativas, cadastros, fatores, códigos e liberações, marca sessões verificadas e marca contas de plataforma novas como obrigadas. Um número diferente de zero depois disso é uso normal, não divergência.

```sql
BEGIN TRANSACTION READ ONLY;

-- 1. Histórico, por nome
SELECT name FROM typeorm_migrations ORDER BY "timestamp";

-- 2. Tabelas novas
SELECT to_regclass('user_second_factors')          AS fatores,
       to_regclass('second_factor_enrollments')    AS cadastros,
       to_regclass('second_factor_recovery_codes') AS codigos,
       to_regclass('second_factor_grants')         AS liberacoes,
       to_regclass('second_factor_attempts')       AS tentativas;

-- 3. Colunas novas em tabelas antigas
SELECT table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = current_schema()
   AND ((table_name = 'sessions' AND column_name IN
          ('second_factor_verified_at', 'second_factor_method', 'second_factor_enrollment_allowed_until'))
     OR (table_name = 'users' AND column_name = 'second_factor_enrollment_required'))
 ORDER BY table_name, column_name;

-- 4. Restrições das tabelas novas e a restrição nova de sessions
SELECT conrelid::regclass::text AS tabela, contype, count(*) AS quantidade
  FROM pg_constraint
 WHERE conrelid IN ('user_second_factors'::regclass, 'second_factor_enrollments'::regclass,
                    'second_factor_recovery_codes'::regclass, 'second_factor_grants'::regclass,
                    'second_factor_attempts'::regclass)
   AND contype IN ('p', 'u', 'f', 'c')
 GROUP BY 1, 2 ORDER BY 1, 2;
SELECT conname FROM pg_constraint
 WHERE conrelid = 'sessions'::regclass AND conname = 'ck_sessions_second_factor_method';

-- 5. Índices de second_factor_grants
SELECT indexname FROM pg_indexes
 WHERE schemaname = current_schema() AND tablename = 'second_factor_grants' ORDER BY indexname;

-- 6. Ações de auditoria novas
SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
 WHERE t.typname = 'audit_action'
   AND e.enumlabel IN ('SECOND_FACTOR_ENABLED', 'SECOND_FACTOR_REPLACED', 'SECOND_FACTOR_LOCKED',
                       'SECOND_FACTOR_GRANT_ISSUED', 'SECOND_FACTOR_GRANT_USED',
                       'RECOVERY_CODE_USED', 'RECOVERY_CODES_REGENERATED')
 ORDER BY e.enumlabel;

-- 7. Nada foi preenchido pela migration
SELECT (SELECT count(*) FROM user_second_factors)          AS fatores,
       (SELECT count(*) FROM second_factor_enrollments)    AS cadastros,
       (SELECT count(*) FROM second_factor_recovery_codes) AS codigos,
       (SELECT count(*) FROM second_factor_grants)         AS liberacoes,
       (SELECT count(*) FROM second_factor_attempts)       AS tentativas,
       (SELECT count(*) FROM users WHERE second_factor_enrollment_required) AS contas_obrigadas,
       (SELECT count(*) FROM sessions
         WHERE second_factor_verified_at IS NOT NULL OR second_factor_method IS NOT NULL
            OR second_factor_enrollment_allowed_until IS NOT NULL)          AS sessoes_marcadas;

ROLLBACK;
```

Resultados esperados:

| Consulta | Esperado |
|---|---|
| 1 | Exatamente 18 linhas, nesta ordem: `InitialSchema1788782400000`, `AllowUndefinedPlanPrice1788782450000`, `InitialPlanCatalog1788782460000`, `NotificationJobs1792540800000`, `PublicBooking1792627200000`, `WebPush1792713600000`, `AccountsAdministration1792800000000`, `TeamAccess1792886400000`, `StaffLogin1792972800000`, `AppointmentPayments1793059200000`, `TeamManagerAccess1793145600000`, `CommercialAccess1793232000000`, `PlatformPortal1793318400000`, `AppointmentServiceSnapshots1793404800000`, `ProfessionalCommissions1793491200000`, `ProfessionalCommissionSettings1793577600000`, `TenantTestFlag1793664000000`, `AdminSecondFactor1793750400000`. Nenhum nome a mais, nenhum repetido |
| 2 | Os cinco nomes de tabela, nenhuma coluna vazia |
| 3 | Quatro linhas. `sessions.second_factor_enrollment_allowed_until` e `sessions.second_factor_verified_at`: `timestamp with time zone`, `YES`, sem padrão. `sessions.second_factor_method`: `character varying`, `YES`, sem padrão. `users.second_factor_enrollment_required`: `boolean`, `NO`, padrão `false` |
| 4 | `second_factor_attempts`: c 1, f 1, p 1. `second_factor_enrollments`: c 1, f 2, p 1, u 1. `second_factor_grants`: c 4, f 2, p 1, u 1. `second_factor_recovery_codes`: f 1, p 1, u 1. `user_second_factors`: c 5, f 1, p 1. A segunda consulta devolve uma linha, `ck_sessions_second_factor_method` |
| 5 | Quatro linhas: `idx_second_factor_grants_user`, `pk_second_factor_grants`, `uq_second_factor_grants_request_key`, `uq_second_factor_grants_token_hash` |
| 6 | Sete linhas: `RECOVERY_CODES_REGENERATED`, `RECOVERY_CODE_USED`, `SECOND_FACTOR_ENABLED`, `SECOND_FACTOR_GRANT_ISSUED`, `SECOND_FACTOR_GRANT_USED`, `SECOND_FACTOR_LOCKED`, `SECOND_FACTOR_REPLACED` |
| 7 | Sete zeros, **só no passo 3.6** (depois da migration e antes do deploy da API). Depois do passo 3.8 estes números mudam com o uso e não são mais conferidos contra zero |

As consultas da seção 2 do roteiro do 2FA (proprietários com fator e segredos por versão de chave) continuam servindo depois do passo 3.10. O log `18 de 18 registradas no banco` do passo 3.8 é uma segunda prova, não a única.

## 6. Backup

O que os roteiros exigem e como isso se encaixa na preferência registrada do responsável: **backup real feito no computador de casa**, restauração só em PostgreSQL descartável, nunca por cima do piloto, e nenhum backup existente é apagado.

| Etapa | Ponto de recuperação | Como fazer |
|---|---|---|
| 0 | nenhum no banco: só o web muda | o deploy live anotado no passo 0.0 |
| 1 | Branch do Neon com dados, conferida no estado 16, mantida por pelo menos 7 dias depois da validação (decisão de 09/11/2026, roteiro das comissões) | console do Neon. Não escreve nos dados do piloto, mas é escrita no projeto: pede autorização na hora |
| 2 e 3 | **`pg_dump -Fc` com restauração validada**: restaurado em PostgreSQL descartável, com a mesma contagem de linhas por tabela ([`publicacao-piloto-render.md`](../runbooks/publicacao-piloto-render.md), seção 6.C, passo 1). Obrigatório antes de cada migration | em casa, guardado em `%USERPROFILE%\AgendaCloud-operacoes`, restaurado no descartável local |
| 2 e 3, opcional | Branch do Neon a mais | soma ao `pg_dump`, nunca o substitui. Só se o plano do Neon permitir sem custo não autorizado |
| 3, emergência | Antes de usar o script de liberação de emergência: backup conferido e `pilot:check-database` (roteiro do 2FA, seção 6, passo 1) | igual às etapas 2 e 3 |

Consequências para o agendamento:

- As etapas 1, 2 e 3 pedem a sessão em casa: o roteiro das comissões já lista o computador de casa nos pré-requisitos, e as etapas 2 e 3 têm backup real.
- A partir da migration 18, o backup do banco contém os segredos TOTP cifrados e os códigos de recuperação em hash. **A chave TOTP não está no backup, de propósito.** Sem as duas cópias da chave (passo 3.2), um banco restaurado não valida o aplicativo de ninguém.

**Backup automático diário (lote O1).** Pelo roteiro [`backup-piloto-automatico.md`](../runbooks/backup-piloto-automatico.md), o código está integrado e nada está configurado: repositório de operação, bucket, chave age, papel `agenda_backup` e monitor. Nenhum roteiro desta fila depende dele, então ele não bloqueia a publicação. Enquanto não existir, o único ponto de recuperação fora do Neon é o backup manual de cada etapa. Configurar antes ou depois da fila é decisão D7; a criação do papel `agenda_backup` é escrita de configuração no piloto e tem autorização própria (roteiro, seção 3.4).

## 7. `/health`: fora desta fila

A etapa 3 publica uma API que tem `GET /health`, e o passo 3.8 confere que ela responde 200. Isso cumpre só a primeira condição. O `healthCheckPath` do Render **continua em `/`** durante toda a fila.

A troca segue [`publicacao-segura.md`](publicacao-segura.md), seção 5, e só acontece com as três condições:

1. API com a rota no ar e respondendo 200 no piloto (sai da etapa 3).
2. Queda silenciosa de rede reproduzida em ambiente descartável, com o tempo que `/health` leva para voltar a 200 medido, e a decisão tomada com esse número (seção 4 do mesmo plano). Se a sonda precisar de prazo próprio de conexão e de consulta, isso é um lote de código antes da troca.
3. Pedido explícito. A troca é um PR próprio em `render.yaml`; o merge sincroniza o Blueprint e reimplanta a API.

Enquanto a API puder voltar a um commit sem a rota (`04c9a43` ou anterior), a troca não deve ser feita.

## 8. O que depende do responsável

### Informações que só o responsável tem

**Nenhuma foi fornecida até agora.** São pré-condições da execução, não fatos confirmados: sem cada uma, o passo indicado não começa. Nenhuma é deduzida do banco, de nome ou de plano, e nenhuma é escrita neste repositório.

| Informação | Usada em |
|---|---|
| Qual estabelecimento de teste serve para validar as comissões | passo 1.5 |
| A lista dos estabelecimentos de teste a marcar. Tudo o que ficar fora da lista é tratado como real e continua indexável | passo 2.8 |
| Quem são os proprietários reais do portal (`MASTER_OWNER`) | passos 3.1 e 3.10 |
| Onde ficam as duas cópias da chave TOTP, fora do banco e fora do Render | passo 3.2 |

### Decisões em aberto

| # | Decisão | Recomendação |
|---|---|---|
| D5 | 2FA com um só proprietário real: ensaiar a emergência antes em banco descartável, ou esperar um segundo | não criar conta só para chegar a dois |
| D7 | Backup automático (O1): configurar antes da fila, entre etapas ou depois | antes da etapa 3, que é a que mais aumenta o valor do que está no banco |
| D8 | Datas: uma sessão em casa por etapa; quando passar o 2FA para `required`; quando fazer a validação do `/health` | uma etapa por sessão, sem acumular |

### Decididas em 16/11/2026

- **D1:** API e web no SHA de cada etapa. O web volta a `8e8577d` antes da etapa 1 (seção 4).
- **D2:** autoria esclarecida. Os deploys manuais de 12/11 a 16/11 foram feitos pelo responsável, tentando recuperar o acesso depois da inatividade. **O procedimento adotado passa a ser despertar a API pelo endereço dela (seção 4.4), sem deploy para essa finalidade.** Durante a fila só há deploy pelo plano; um deploy não previsto continua fazendo o passo 0 parar a etapa.
- **Etapa 0 corrigida:** parte de web `b5b2704` com API `8e8577d`, a reconferir no passo 0.0; o alvo continua `8e8577d`; se 0.2 falhar, o web volta a `b5b2704`, sem que isso seja recuperação comprovada, e a etapa 1 não começa (seção 4.2).
- **D3:** etapas 2 e 3 com `pg_dump` e restauração validada; branch do Neon a mais é opcional (seção 6).
- **D4:** a identificação dos estabelecimentos de teste é informação do responsável (tabela acima).
- **D6:** a conferência do estado 18 é feita por consultas só de leitura com resultado esperado (etapa 3). Nenhum lote de código para isso.
- **D9:** a tela de comissões de um profissional é conferida no passo 0.2.

## Estado e retomada

- **Feito (16/11/2026):** este plano e o registro do resultado no roteiro de recuperação. Só documentação.
- **Feito depois (16/11/2026):** PR #117 integrado em `9de722d` (correção do proxy para a API hibernada, com CI aprovado no head `6a9da3f`). Este plano passou a apontar a etapa 3 para `9de722d`, ganhou o contorno das etapas 0 a 2 (seção 4.4) e a validação do acesso após hibernação (passo 3.12). Nada foi publicado.
- **Não feito:** nenhum deploy, migration, backup, variável no Render ou leitura do banco real.
- **Feito depois (16/11/2026):** D2 respondida e etapa 0 corrigida para o estado lido na seção 1.1 (web `b5b2704`, API `8e8577d`). Só o texto do roteiro; nenhum desses deploys foi feito.
- **Continuidade:** PR #117 integrado em `9de722d1380fa55b6c588b63d01dea1a4ebdc1f2`; a correção ainda não está publicada; o PR #118 (esta atualização do plano) aguarda revisão; a execução da fila não começou.
- **Próximo passo:** a revisão do PR #118 e as informações da seção 8. Depois, a etapa 0 e a etapa 1, com pedido explícito, de preferência na mesma janela em casa, com parada entre elas.
- **Integração depois deste plano (17/11/2026):** o PR #119 (tema opcional "Azul e branco", só no web do portal) foi integrado em `3da4855b42e495a1ffbeef727f5d5d6f7fc4def7`. **O alvo da etapa 3 continua `9de722d1380fa55b6c588b63d01dea1a4ebdc1f2`**; `3da4855` não entra na fila. Incluir o tema numa publicação é decisão separada do responsável. *(Superado pela atualização de 17/11 logo abaixo.)*
- **Atualização de 17/11/2026:** por decisão do responsável, o tema e o menu entram no alvo final. O alvo da etapa 3 passa a ser o merge commit do PR #120 (nota no topo), que inclui `3da4855`. A releitura da seção 1.2 encontrou o web em `68e5eed`, então a etapa 0 precisa de reavaliação antes de qualquer deploy. As informações da seção 8 e as decisões D5, D7 e D8 continuam pendentes. Nada foi publicado.
- **Se o estado mudar antes da etapa 0** (deploy novo no Render, commit novo na integração), releia a seção 1 e ajuste os SHAs antes de qualquer passo. Commit novo na integração não troca sozinho o alvo de nenhuma etapa: a troca exige decisão explícita, como a do PR #117.
- **Execução de 18/11/2026 (seção 1.3):** etapa 0 concluída, com **API e web em `8e8577d`** e o web no deploy `dep-dbuh1skipgvc738tcfvg`. Verificações HTTP sem login aprovadas; **o login autenticado não foi testado**. Backup inicial do estado 16 feito e restaurado com contagens e md5 iguais, e ensaio de 16 para 19 aprovado numa cópia restaurada. Nenhuma migration aplicada no piloto, nenhuma variável alterada e nenhum outro deploy. **O alvo final continua pendente: `4585af099dafe4c0f6ad0232b6a2d4445b60c5e3`.** A sessão foi encerrada pelo responsável antes da etapa 1.

### Pendências para retomar (18/11/2026)

1. **Rotação da senha exposta do banco do piloto: adiada por decisão do responsável (18/11/2026).** Não foi feita; a senha continua exposta e válida. Ela deixou de ser pré-requisito da etapa 1 por essa decisão. Condições para quando for feita:
   - numa janela própria, **entre duas etapas**, nunca no meio de uma etapa, junto com uma migration ou junto com o deploy de outro SHA;
   - com `pilot:check-database` antes e depois, e o deploy da API **no SHA que estiver live naquele momento**, nunca "latest";
   - a cópia cifrada da URL direta no PC de operação atualizada na mesma janela, porque backups e conferências dependem dela; enquanto ela estiver desatualizada, nenhuma etapa com backup começa;
   - um backup feito antes da rotação continua restaurável (a restauração é num PostgreSQL descartável, sem a senha do piloto).
2. **Terceira conta `MASTER_OWNER` ativa**, não citada pelo responsável e com e-mail não verificado (o endereço está na mensagem da sessão e no banco, não neste repositório público). **Reconhecimento pendente:** o responsável ainda não disse se a reconhece. Sem isso, o passo 3.1 manda parar a etapa 3. Ninguém altera essa conta.
3. **Classificação dos três estabelecimentos** (passo 2.8): a lista de quais são teste é do responsável. A marcação é feita pelo portal depois da etapa 2. Ninguém altera os estabelecimentos antes disso.
4. **Login autenticado** dos pares intermediários e do estado final, pelo responsável, no fim.
5. **Segunda cópia da chave TOTP** (passo 3.2): pendente por decisão do responsável. A chave ainda nem foi gerada; quando for, terá uma cópia só, no PC de operação.
6. **Preços** do Agendamento essencial e dos adicionais: o responsável preenche pelo portal depois da etapa do #122. Até lá, a criação modular mostra a pendência.
7. D5, D7 e D8 seguem como na seção 8; nenhuma bloqueia a etapa 1.
8. **Autoria dos deploys de `4585af0` de 18/11 03:01 UTC** (seção 1.4): não confirmada. Enquanto não for esclarecida, qualquer deploy fora do plano continua parando o passo 0 de cada etapa, e o responsável decide se a etapa 1 pode começar antes do esclarecimento.

### Backups: estado comprovado

| Backup | Onde | Estado | Uso |
|---|---|---|---|
| `inicial-16-backup-2026-11-18T02-36-44Z` | PC de casa, `%USERPROFILE%\AgendaCloud-operacoes` | restauração conferida (45 tabelas, contagens e md5 iguais); estado 16, 18/11 02:37 UTC | recuperação de dados numa cópia. **Não serve como o backup do passo 2.1 nem do 3.3**: cada migration exige um `pg_dump` novo, com restauração validada, feito logo antes dela |

Backups mais antigos continuam em `%USERPROFILE%\AgendaCloud-operacoes` e `%USERPROFILE%\AgendaCloud-backups` no PC de casa, sem alteração. Nenhum backup é restaurado por cima do piloto.

### Próxima ação exata para retomar

1. **Passo 0, só leitura:** Render com API e web live em `8e8577d698fd3d2b9eb2a42b6945fbd3cb3205d2`, o web no deploy `dep-dbuohgk9v7es7396tnp0` (desde 18/11 11:17 UTC; o `dep-dbuh1skipgvc738tcfvg` foi substituído pelos deploys da seção 1.4), a API no `dep-dbreqklckfvc73e2loag`, Auto-Deploy desligado e nada em fila. Qualquer outro estado: pare e reavalie.
2. **Rotação da senha: adiada** (pendência 1). Quando o responsável decidir fazê-la, o procedimento é este, nesta ordem, numa janela entre etapas:
   1. No Neon, **projeto do piloto** (não o projeto proibido; os dois têm uma branch chamada `production`, então diferencie pelo projeto e pelo endpoint), troque a senha do usuário do banco com "Reset password".
   2. No serviço da **API** do Render, troque **só a senha** em `DATABASE_URL` e em `DIRECT_URL`, mantendo host, pooler e parâmetros. Salve **sem** disparar deploy. Se um deploy começar sozinho, espere terminar e releia o passo 1.
   3. Faça o deploy da API por commit **no SHA que estiver live** (hoje `8e8577d698fd3d2b9eb2a42b6945fbd3cb3205d2`), nunca "latest", para não subir uma versão incompatível com o banco.
   4. Confira: API `GET /` 200; web `/agenda_api/auth/me` sem cookie 401; log da API sem erro de conexão.
   5. Atualize a cópia cifrada da URL direta no PC de operação. Ela é usada pelos backups e pelas conferências.
   6. Rode `pilot:check-database` com a expectativa do estado do banco naquele momento (no estado 16, `PILOT_EXPECT=after-commission-settings`: `MIGRATIONS_APPLIED: 16`, `SCHEMA_OBJECTS_OK: 7/7`, `BASELINE_FAILURES: none`, `RESULT: SUCCESS`; no estado 18 ou 19, as consultas de conferência da etapa correspondente).
3. **Etapa 1** (seção 5), com API e depois web em `5d74556e9e12e55f38e0056d0f19911f3e66f475`. Antes de começar: o responsável decide sobre a pendência 8 (autoria dos deploys de 03:01). Ponto de recuperação: um backup novo com restauração conferida (ou a branch do Neon do passo 1.1); o backup inicial de 18/11 não substitui esse. A etapa 1 não muda schema nem variável, e a senha atual é a que o backup e a conferência usam.
4. Depois, na ordem e sem pular:
   - **Etapa 2:** backup novo conferido e migration 17 de uma cópia limpa em `04c9a43`; API e web em `04c9a4382decea6c175ffdfb28cc722cb8ad6092`.
   - **Etapa 3:** chave TOTP, backup novo conferido, migration 18 de uma cópia limpa em `becc923`, as sete consultas do estado 18 e as três `PLATFORM_*` com `optional`; API e web em `becc923f12165f7085e3de5a12b019b10e9b4bb0`.
   - **Etapa do #121:** API e web em `df535a19ffbf70355007171bec8f962937397f85`.
   - **Etapa do #122:** backup novo conferido e `seatTransitionReport` na restauração dele; migration 19 de uma cópia limpa em `4585af0`; API e web em `4585af099dafe4c0f6ad0232b6a2d4445b60c5e3`.

**Limites de retorno:** não voltar a API a um SHA sem 2FA depois que um proprietário cadastrar o fator, nem a API para antes do #122 depois da primeira assinatura modular.

**Ferramentas de operação:** os scripts auxiliares usados nesta sessão (cliente da API do Render, backup, conferências) e o cofre cifrado ficam só no PC de casa, fora do Git. Em outro computador, siga os roteiros citados em cada etapa. As credenciais precisam ser providenciadas lá sem passar por chat, Git ou log.
