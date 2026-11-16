# Plano consolidado: publicar no piloto o que está integrado em `b5b2704`

**Só planejamento. Este documento não autoriza nem executa nada.** Cada etapa depende de pedido explícito na hora: deploy, migration, backup, variável no Render e leitura do banco real.

Este plano **não substitui os roteiros**. Ele diz em que ordem usá-los, com qual SHA, e o que mudou desde que foram escritos. O procedimento de cada passo continua no roteiro citado.

Este documento nunca contém credencial, chave, URL de banco ou Endpoint ID.

## 1. Ponto de partida

Leitura do Render em 16/11/2026, por volta de 12:15 UTC, e confirmação do responsável na mesma data ([`recuperacao-login-piloto-rollback.md`](../runbooks/recuperacao-login-piloto-rollback.md), seção 8).

| Item | Estado |
|---|---|
| API live | `8e8577d698fd3d2b9eb2a42b6945fbd3cb3205d2` (`dep-dbreqklckfvc73e2loag`, desde 13/11 10:59:21 UTC) |
| Web live | `438e598bcc98dfa13aa45087fbfaafdfb1b33a0e` (`dep-dbs6p8qfngtc73bsm7sg`, desde 14/11 14:15:48 UTC) |
| Integração | `b5b27046369b2b36ad339a41d44ff405fcb44c43` (merge do PR #115) |
| Banco do piloto | 16 migrations **na última conferência conhecida, de 13/11 10:55 UTC**. Não é leitura atual |
| Auto-Deploy | desligado nos dois serviços; nenhum deploy em fila |

Os roteiros da fila foram escritos supondo **API e web em `8e8577d`**. O web está 11 merges à frente. Essa é a diferença que este plano reconcilia (seção 4).

## 2. Comprovado e pendente

### Comprovado

| Fato | Evidência |
|---|---|
| Login, recarga com sessão, sair e entrar, e acesso às telas funcionam com web `438e598` e API `8e8577d` | confirmação do responsável em 16/11/2026, sem horário e sem leitura de log correspondente |
| SHAs live, Auto-Deploy desligado, branch dos serviços, nada em fila | lista de deploys e de serviços do Render, 16/11 |
| Uma API a partir de `b5e5586` não sobe no piloto como ele está | log do deploy `dep-dbs6p6ec6qcc738b5qg0` (14/11): `Campos com problema: PLATFORM_2FA_ENFORCEMENT, PLATFORM_TOTP_KEYS` |
| O que cada SHA da fila exige (tabela da seção 3) | leitura do código em cada commit: migrations, `env.validation.ts`, manifesto |
| `5d74556`, `04c9a43` e `b5b2704` têm a mesma árvore do head que o CI aprovou | `5d74556` = head `e862b32`; `04c9a43` = head `edbeed0`; `b5b2704` = head `0329035`. CI com sucesso nos três heads |
| A API `8e8577d` aceita o schema 17 | tabela de compatibilidade de [`publicacao-tenant-teste-slugs.md`](../runbooks/publicacao-tenant-teste-slugs.md), seção 1 (leitura de código) |

### Pendente (conferir na hora, nunca presumir)

| Item | Onde se confere |
|---|---|
| Quantidade e nomes das migrations no piloto hoje | `pilot:check-database`, no passo de conferência de cada etapa |
| Nomes das variáveis no serviço da API. Em 12/11 não havia nenhuma `PLATFORM_*`; o erro de 14/11 cita duas das três, e a terceira (`PLATFORM_TOTP_KEY_CURRENT`) não foi conferida | painel do Render, aba Environment |
| Quem fez os deploys manuais de 13/11 e 14/11 | painel do Render, aba Events de cada serviço. A lista de deploys só mostra o gatilho `manual` |
| Tela de comissões de um profissional no estado atual. Pelo código, o web atual exige `exceptionsFingerprint`, que a API `8e8577d` não envia: a tela deve mostrar "Não foi possível carregar". Não reproduzido | abrir `/conta/configuracoes/profissionais/<id>/comissoes` |
| Funcionalidades novas do web: comissão em massa, relatórios do portal, marca de teste, Segurança da conta, cabeçalhos e `noindex` do SEO | validação de cada etapa. Nenhuma está validada no piloto |
| Migrations 17 e 18 num banco com dados reais | só foram aplicadas em banco descartável |
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
| 3. 2FA com os demais lotes | `b5b27046369b2b36ad339a41d44ff405fcb44c43` | #109 segundo fator, #111 página inicial e nome TimVix, #112 limpeza do login, #113 preços na página inicial, #114 menu do dono, #115 conferência de migrations na inicialização e `GET /health` | 18 | `PLATFORM_TOTP_KEYS`, `PLATFORM_TOTP_KEY_CURRENT`, `PLATFORM_2FA_ENFORCEMENT` |

Os SHAs abreviados no resto do documento são estes três.

Por que esses SHAs:

- **`5d74556`** é o alvo fixado no roteiro das comissões.
- **`04c9a43`** é o último commit da integração que exige 17 migrations e nenhuma variável `PLATFORM_*`. O commit seguinte (`b5e5586`) já é o 2FA.
- **`b5b2704`** é a ponta da integração. Publicar o 2FA em `b5e5586` e depois subir de novo para `b5b2704` seriam dois deploys a mais sem ganho: `b5b2704` só acrescenta lotes sem migration e a conferência de inicialização, que protege justamente esta etapa.

Nenhuma etapa pode usar um SHA mais novo que o dela antes de o banco e as variáveis estarem prontos: a API de `b5b2704` recusa subir com 16 ou 17 migrations, e a partir de `b5e5586` recusa sem as três variáveis.

## 4. Reconciliação com o web em `438e598`

O roteiro das comissões manda parar se algum serviço não estiver em `8e8577d` (passo 0). Esta seção é essa reavaliação.

**Decisão pendente do responsável (D1, seção 8).** Duas formas de seguir:

| | Opção A: manter o web em `438e598` nas etapas 1 e 2 | Opção B: voltar o web a `8e8577d` e seguir os roteiros ao pé da letra |
|---|---|---|
| Deploys | etapa 1 e 2: só a API. Etapa 3: API e web | um deploy a mais do web antes de começar, e o web acompanha a API em cada etapa |
| Par API × web em cada etapa | web mais novo que a API até a etapa 3. Essas combinações não passaram pelo CI | sempre o mesmo SHA, a combinação que o CI validou |
| Efeito para quem usa | nada some; a página inicial nova e o nome TimVix continuam | a página inicial, o nome, os cabeçalhos de segurança e o `noindex` das áreas privadas saem até a etapa 2 ou 3 |
| Desvio dos roteiros | o passo "publicar o web no alvo" das etapas 1 e 2 não é feito | nenhum |

**Recomendação: opção A**, por três motivos apoiados em leitura de código:

1. O web `438e598` já contém o web de `5d74556` e o de `04c9a43`. Entre `5d74556` e `438e598`, a única mudança nas telas de comissões é uma linha em `src/app/conta/comissoes/page.tsx`.
2. Os campos que o web novo lê de uma API mais antiga são opcionais (`tenantCategory`, `secondFactor`, `isTest`), e o roteiro do 2FA já descreve "API antiga, web nova" como "o portal funciona como antes".
3. Cada etapa passa a mudar uma coisa só (a API), e o retorno de uma etapa é um único deploy.

O risco da opção A é o que a tabela diz: pares que o CI não exercitou. A validação de cada etapa (seção 5) é o que os cobre, e a etapa 3 termina com os dois serviços no mesmo SHA.

Na opção A, a regra do roteiro das comissões "nunca volte só a API e deixe o web novo" descreve o estado em que o piloto já está hoje. Voltar a API a `8e8577d` devolve o piloto a esse estado, que é o validado em 16/11, com a ressalva da tela de comissões do profissional (seção 2).

## 5. Sequência

Uma etapa por sessão. Não comece uma etapa sem a anterior encerrada e validada.

Regras para todas as etapas:

- **Passo 0, só leitura:** `render deploys list` mostra exatamente os SHAs live esperados para o início da etapa, Auto-Deploy desligado, nada em fila. Se houver deploy que este plano não previu, **pare**.
- **Ordem fixa dentro da etapa:** ponto de recuperação, conferência do banco, migration (se houver), conferência do banco, variáveis (se houver), API, web, validação.
- **Migration sempre de uma cópia limpa no SHA da etapa**, nunca da ponta da integração. `migration:run:compiled` aplica todas as pendentes que o build contém: rodado de `b5b2704` num banco com 16, aplicaria a 17 e a 18 juntas.
- **Nunca no piloto:** `migration:revert`, `migration:show`, restauração de backup por cima, `Reset from parent`.
- **Deploy por commit:** `render deploys create <serviço> --commit <sha completo> --wait --confirm`, ou "Deploy a specific commit" no painel. Nunca "Deploy latest commit".
- Uma falha de deploy antes de ficar live não exige ação: o Render mantém a versão anterior. Leia o log antes de tentar de novo.

### Etapa 1: comissões em massa (`5d74556`)

Roteiro: [`publicacao-comissoes-em-massa-piloto.md`](../runbooks/publicacao-comissoes-em-massa-piloto.md).

| Passo | O que fazer | Continuar se | Parar se |
|---|---|---|---|
| 1.0 | Render, só leitura | API `8e8577d`; web `438e598` (opção A) ou `8e8577d` (opção B) | qualquer outro SHA live |
| 1.1 | Ponto de recuperação: branch do Neon (roteiro, passo 1) | branch criada, com endpoint diferente do piloto, e conferida no estado 16 | custo não autorizado, limite de branches esgotado ou branch que não confere |
| 1.2 | Conferência do banco, só leitura (roteiro, passo 2: fase `conferir` do kit e `PILOT_EXPECT=after-commission-settings`) | `MIGRATIONS_APPLIED: 16`, `SCHEMA_OBJECTS_OK: 7/7`, `BASELINE_FAILURES: none`, `RESULT: SUCCESS` | qualquer outro resultado. A tabela do passo 3 do roteiro diz o que cada um significa |
| 1.3 | API em `5d74556` | live no SHA; `GET /` 200; `/agenda_api/auth/me` sem cookie 401; log sem erro; o responsável entra e abre a agenda e as comissões de um profissional | deploy falha, 500 no log ou tela de comissões que não carrega |
| 1.4 | Web: opção A, nenhum deploy. Opção B, web em `5d74556` e as verificações do passo 5 do roteiro | `/login` 200, `auth/me` 401, manifest do portal 200 | qualquer verificação fora do esperado |
| 1.5 | Validação funcional (roteiro, passo 6), só no estabelecimento de teste escolhido pelo responsável | os nove itens como descritos; o relatório do período com o mesmo total | exceção removida sem confirmação, regra alterada fora do alcance ou apuração antiga alterada (este último é incidente de dados: não faça rollback às pressas) |

- **Estado ao final:** API `5d74556`, banco 16.
- **Retorno:** só código. Opção A: API de volta a `8e8577d`. Opção B: web primeiro, API depois. O banco não muda. Exceções removidas não voltam sozinhas (roteiro, "Recuperar dados da branch").

### Etapa 2: migration 17 e o pacote dela (`04c9a43`)

Roteiro: [`publicacao-tenant-teste-slugs.md`](../runbooks/publicacao-tenant-teste-slugs.md).

| Passo | O que fazer | Continuar se | Parar se |
|---|---|---|---|
| 2.0 | Render, só leitura | API `5d74556` | qualquer outro SHA live na API |
| 2.1 | Backup real antes de escrever (seção 6) | restauração em banco descartável com a mesma contagem de linhas por tabela; horário anotado | backup que não restaura igual |
| 2.2 | Conferência antes: `PILOT_EXPECT=before-tenant-test-flag` | `MIGRATIONS_APPLIED: 16`, `SCHEMA_OBJECTS_OK: 0/2`, `MARCADOS_COMO_TESTE: coluna ainda não existe`, `BASELINE_FAILURES: none`, `RESULT: SUCCESS` | qualquer outro resultado |
| 2.3 | Aplicar a 17, de uma cópia limpa em `04c9a43` (roteiro, seção 2, passo 3) | o TypeORM aplica uma migration, `TenantTestFlag1793664000000` | o comando lista outra migration, falha ou a conexão cai. **Não repita**: rode a conferência para ver o estado real |
| 2.4 | Conferência depois: `PILOT_EXPECT=after-tenant-test-flag` | `MIGRATIONS_APPLIED: 17`, `SCHEMA_OBJECTS_OK: 2/2`, `MARCADOS_COMO_TESTE: 0`, `RESULT: SUCCESS` | qualquer outro resultado |
| 2.5 | Conferir que a API em serviço (`5d74556`) continua funcionando no schema 17 | login e agenda normais; log sem erro | erro de schema no log |
| 2.6 | API em `04c9a43` | live no SHA; `GET /public/<slug real>` traz `"indexable": true`; log sem erro | deploy falha ou 500 em leitura de estabelecimento |
| 2.7 | Web: opção A, nenhum deploy. Opção B, web em `04c9a43` | `curl -sI` de `/agendar/<slug real>` sem `x-robots-tag`, HTML com `canonical` | `noindex` numa página real, ou 503 que não passa com a API acordada |
| 2.8 | Classificar os testes antigos no portal (roteiro, seção 4, **obrigatório**) | `MARCADOS_COMO_TESTE` igual ao tamanho da lista; cada marcado responde `x-robots-tag: noindex, nofollow` | contagem diferente da lista |
| 2.9 | Colisões de slug, só leitura: `npm run pilot:check-reserved-slugs` (roteiro, seção 5) | saída anotada; renomear é decisão caso a caso | não bloqueia |

- **Estado ao final:** API `04c9a43`, banco 17.
- **Retorno:** só código. A API volta a `5d74556` (ela aceita o schema 17); o banco fica em 17. O `down` da migration não é usado.
- **Muda para quem usa:** a página pública passa a responder 503 temporário quando a API está lenta ou dormindo, em vez de abrir (roteiro, seção 3.1). Na opção A isso já vale hoje, porque o web atual já tem esse comportamento.

### Etapa 3: 2FA com os demais lotes (`b5b2704`)

Roteiro: [`publicacao-2fa-administrativo.md`](../runbooks/publicacao-2fa-administrativo.md). Fase inicial `optional`.

| Passo | O que fazer | Continuar se | Parar se |
|---|---|---|---|
| 3.0 | Render, só leitura | API `04c9a43` | qualquer outro SHA live na API |
| 3.1 | Requisitos da hora (roteiro, seção 0): proprietários ativos, e-mail configurado e chegando, e-mails verificados | dois proprietários reais, ou um só com a emergência (roteiro, seção 6) ensaiada antes em banco descartável; e-mail conferido | um só proprietário sem o ensaio. Sem e-mail conferido a etapa pode seguir, mas a liberação pelo portal fica indisponível e a recuperação depende da seção 6 do roteiro |
| 3.2 | Gerar a chave TOTP e guardar em dois lugares fora do banco e fora do Render (roteiro, seção 1, passos 1 e 2) | as duas cópias guardadas e conferidas | chave guardada em um lugar só |
| 3.3 | Backup real antes de escrever (seção 6) | como no passo 2.1 | como no passo 2.1 |
| 3.4 | Conferência antes: `PILOT_EXPECT=after-tenant-test-flag` | `MIGRATIONS_APPLIED: 17`, `SCHEMA_OBJECTS_OK: 2/2`, `MARCADOS_COMO_TESTE` igual à lista do passo 2.8 | qualquer outro resultado |
| 3.5 | Aplicar a 18, de uma cópia limpa em `b5b2704` | o TypeORM aplica uma migration, `AdminSecondFactor1793750400000` | o comando lista outra migration, falha ou a conexão cai. Não repita |
| 3.6 | Conferência depois (veja a observação abaixo) | histórico com 18 nomes, o último `AdminSecondFactor1793750400000`; consultas da seção 2 do roteiro respondem | histórico diferente |
| 3.7 | Variáveis no serviço da API (roteiro, seção 1, passo 3): as três `PLATFORM_*`, com `optional`. Salvar **sem** disparar deploy, se o painel oferecer essa escolha | as três presentes; o web sem nenhuma delas | um deploy inesperado começa: espere terminar e releia o passo 3.0 |
| 3.8 | API em `b5b2704` | live no SHA; log com `18 de 18 registradas no banco` e `Nest application successfully started`; `GET /` 200; `GET /health` 200 | `[SchemaReadiness] A API não vai iniciar` (falta migration) ou `Configuração de ambiente inválida` (falta variável). A versão anterior continua no ar: corrija a causa, não insista no deploy |
| 3.9 | Web em `b5b2704`, logo em seguida | live no SHA; `/login` 200; `auth/me` 401; o responsável entra em `/conta` e no portal | qualquer verificação fora do esperado. Ninguém cadastra o aplicativo antes de o web novo estar no ar |
| 3.10 | Cadastro de cada proprietário (roteiro, seção 4) | aplicativo, códigos de recuperação guardados, entrada com código e com um código de recuperação, e-mail de aviso recebido | um proprietário sem conseguir entrar com o fator |
| 3.11 | Conferir `EMAIL_FROM_NAME` e as telas dos lotes #111 a #114 (página inicial, login, preços, menu do dono) | como aprovado em cada plano | não bloqueia; vira correção para a frente |

- **Estado ao final:** API e web em `b5b2704`, banco 18, `PLATFORM_2FA_ENFORCEMENT=optional`.
- **Observação do passo 3.6:** o `pilot:check-database` não tem expectativa para o estado 18. Depois da migration, `after-tenant-test-flag` passa a reprovar com `migration_history` (ele exige exatamente 17), e isso é esperado. A conferência é a consulta só de leitura dentro de `BEGIN TRANSACTION READ ONLY`, no molde de [`publicacao-piloto-render.md`](../runbooks/publicacao-piloto-render.md), seção 6.D, passo 4, mais as consultas da seção 2 do roteiro do 2FA. A segunda prova é o passo 3.8: a API de `b5b2704` só sobe com as 18 registradas, pelo nome. Criar a expectativa automática é decisão D6.
- **Retorno:** o roteiro do 2FA, seção 7, vale inteiro. Depois que alguém cadastrar o fator, voltar a API a um SHA sem 2FA abre o portal só com a senha. A preferência é correção para a frente.
- **`required` não faz parte desta etapa.** É a seção 5 do roteiro do 2FA, com data própria, depois de todos os proprietários cadastrados.

## 6. Backup

O que os roteiros exigem e como isso se encaixa na preferência registrada do responsável: **backup real feito no computador de casa**, restauração só em PostgreSQL descartável, nunca por cima do piloto, e nenhum backup existente é apagado.

| Etapa | Exigência do roteiro | Como fazer |
|---|---|---|
| 1 | Branch do Neon com dados, conferida no estado 16, mantida por pelo menos 7 dias depois da validação (decisão de 09/11/2026) | console do Neon. Não escreve nos dados do piloto, mas é escrita no projeto: pede autorização na hora |
| 2 e 3 | Backup antes da migration: branch do Neon **ou** `pg_dump -Fc` restaurado em PostgreSQL descartável com a mesma contagem de linhas por tabela ([`publicacao-piloto-render.md`](../runbooks/publicacao-piloto-render.md), seção 6.C, passo 1) | `pg_dump` em casa, guardado em `%USERPROFILE%\AgendaCloud-operacoes`, restaurado no descartável local. A branch do Neon pode ser somada; não substitui o backup real (D3) |
| 3, emergência | Antes de usar o script de liberação de emergência: backup conferido e `pilot:check-database` (roteiro do 2FA, seção 6, passo 1) | igual |

Consequências para o agendamento:

- As três etapas pedem a sessão em casa: o roteiro das comissões já lista o computador de casa nos pré-requisitos, e as etapas 2 e 3 têm backup real.
- A partir da migration 18, o backup do banco contém os segredos TOTP cifrados e os códigos de recuperação em hash. **A chave TOTP não está no backup, de propósito.** Sem as duas cópias da chave (passo 3.2), um banco restaurado não valida o aplicativo de ninguém.

**Backup automático diário (lote O1).** Pelo roteiro [`backup-piloto-automatico.md`](../runbooks/backup-piloto-automatico.md), o código está integrado e nada está configurado: repositório de operação, bucket, chave age, papel `agenda_backup` e monitor. Nenhum roteiro desta fila depende dele, então ele não bloqueia a publicação. Enquanto não existir, o único ponto de recuperação fora do Neon é o backup manual de cada etapa. Configurar antes ou depois da fila é decisão D7; a criação do papel `agenda_backup` é escrita de configuração no piloto e tem autorização própria (roteiro, seção 3.4).

## 7. `/health`: fora desta fila

A etapa 3 publica uma API que tem `GET /health`, e o passo 3.8 confere que ela responde 200. Isso cumpre só a primeira condição. O `healthCheckPath` do Render **continua em `/`** durante toda a fila.

A troca segue [`publicacao-segura.md`](publicacao-segura.md), seção 5, e só acontece com as três condições:

1. API com a rota no ar e respondendo 200 no piloto (sai da etapa 3).
2. Queda silenciosa de rede reproduzida em ambiente descartável, com o tempo que `/health` leva para voltar a 200 medido, e a decisão tomada com esse número (seção 4 do mesmo plano). Se a sonda precisar de prazo próprio de conexão e de consulta, isso é um lote de código antes da troca.
3. Pedido explícito. A troca é um PR próprio em `render.yaml`; o merge sincroniza o Blueprint e reimplanta a API.

Enquanto a API puder voltar a um commit sem a rota (`04c9a43` ou anterior), a troca não deve ser feita.

## 8. Decisões que dependem do responsável

| # | Decisão | Recomendação |
|---|---|---|
| D1 | Web nas etapas 1 e 2: manter em `438e598` (opção A) ou voltar a `8e8577d` e acompanhar a API (opção B) | A (seção 4) |
| D2 | Deploys manuais fora do plano: identificar na aba Events quem fez os de 13/11 e 14/11 e combinar que, durante a fila, só há deploy pelo plano. Um deploy não previsto faz o passo 0 parar a etapa | combinar antes da etapa 1 |
| D3 | Ponto de recuperação das etapas 2 e 3: só `pg_dump` em casa, ou `pg_dump` mais branch do Neon | os dois, se o plano do Neon permitir sem custo |
| D4 | Estabelecimento de teste da validação das comissões (passo 1.5) e a lista dos testes antigos a marcar (passo 2.8) | o responsável indica; o sistema não deduz por nome |
| D5 | 2FA: quem são os proprietários (dois reais, ou um com a emergência ensaiada antes) e onde ficam as duas cópias da chave TOTP | dois administradores reais, se existirem. Não criar conta só para chegar a dois |
| D6 | Conferência depois da migration 18: consulta só de leitura mais a conferência de inicialização da API, ou um lote de código antes, criando a expectativa automática no `pilot:check-database` | a consulta basta para o piloto; a expectativa vale um lote próprio se o mesmo roteiro for usado em production |
| D7 | Backup automático (O1): configurar antes da fila, entre etapas ou depois | antes da etapa 3, que é a que mais aumenta o valor do que está no banco |
| D8 | Datas: uma sessão em casa por etapa; quando passar o 2FA para `required`; quando fazer a validação do `/health` | uma etapa por sessão, sem acumular |
| D9 | Conferir a tela de comissões de um profissional no estado atual (seção 2) | um minuto; não bloqueia, mas confirma ou derruba a hipótese antes da etapa 1 |

## Estado e retomada

- **Feito (16/11/2026):** este plano e o registro do resultado no roteiro de recuperação. Só documentação.
- **Não feito:** nenhum deploy, migration, backup, variável no Render ou leitura do banco real.
- **Próximo passo:** as decisões D1 e D2. Depois, a etapa 1, com pedido explícito, numa sessão em casa.
- **Se o estado mudar antes da etapa 1** (deploy novo no Render, commit novo na integração), releia a seção 1 e ajuste os SHAs antes de qualquer passo.
