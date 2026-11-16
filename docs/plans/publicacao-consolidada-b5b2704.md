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

Os roteiros da fila foram escritos supondo **API e web em `8e8577d`**. O web está 11 merges à frente. A fila só começa depois de o web voltar a `8e8577d` (etapa 0, seção 4), e cada etapa termina com API e web no mesmo SHA.

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
| Tela de comissões de um profissional no estado atual. Pelo código, o web atual exige `exceptionsFingerprint`, que a API `8e8577d` não envia: a tela deve mostrar "Não foi possível carregar". Não reproduzido | a etapa 0 confere: com o web em `8e8577d`, a tela precisa abrir |
| Quais estabelecimentos são de teste, quem são os proprietários reais do portal e onde ficam as duas cópias da chave TOTP | só o responsável sabe (seção 8). Nada disso é deduzido do banco nem escrito neste repositório |
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

## 4. Transição: API e web no SHA de cada etapa

**Decisão do responsável (16/11/2026):** cada etapa termina com API e web no mesmo SHA, como os roteiros mandam e como o CI validou. O web não fica em `438e598` durante as etapas 1 e 2: a combinação de web mais novo com API mais antiga não foi validada.

### 4.1 Sequência de estados

| Momento | API | Web | Banco | O que sustenta este par |
|---|---|---|---|---|
| Hoje | `8e8577d` | `438e598` | 16 | login confirmado pelo responsável em 16/11. Nenhum roteiro descreve este par e o CI não o exercitou |
| **Etapa 0**, fim | `8e8577d` | `8e8577d` | 16 | os dois serviços no mesmo SHA; é o ponto de partida que o roteiro das comissões exige e o alvo do roteiro de recuperação, que valeu de 13/11 16:23 a 14/11 14:15 UTC. O responsável ainda não confirmou este par: o passo 0.2 faz isso |
| Etapa 1, entre os deploys | `5d74556` | `8e8577d` | 16 | tabela de compatibilidade do roteiro das comissões: funciona (leitura de código) |
| **Etapa 1**, fim | `5d74556` | `5d74556` | 16 | CI no head `e862b32`, mesma árvore |
| Etapa 2, depois da migration | `5d74556` | `5d74556` | 17 | roteiro da 17, seção 1: banco 17 com API e web anteriores funcionam |
| Etapa 2, entre os deploys | `04c9a43` | `5d74556` | 17 | roteiro da 17, seção 1: funcionam, proteção contra indexação inativa |
| **Etapa 2**, fim | `04c9a43` | `04c9a43` | 17 | CI no head `edbeed0`, mesma árvore |
| Etapa 3, depois da migration e das variáveis | `04c9a43` | `04c9a43` | 18 | roteiro do 2FA, seção 2: a migration só acrescenta, nenhum acesso muda por ela |
| Etapa 3, entre os deploys | `b5b2704` | `04c9a43` | 18 | roteiro do 2FA, seção 3: quem não tem fator usa o portal como antes |
| **Etapa 3**, fim | `b5b2704` | `b5b2704` | 18 | CI no head `0329035`, mesma árvore |

Limite desta tabela: só os pares de fim de etapa passaram pelo CI. Os estados "entre os deploys" duram o tempo de um deploy, seguem a ordem que cada roteiro manda (API e depois web) e foram avaliados nos roteiros por leitura de código, cada um para o lote dele. As etapas 2 e 3 trazem outros lotes junto (#104, #106, #108, #110 e #111 a #115), que nenhuma tabela de compatibilidade cobre nesse intervalo. Por isso ninguém valida nem grava nada entre os dois deploys de uma etapa.

### 4.2 Etapa 0: o retorno do web a `8e8577d`

O retorno é necessário para que todo estado da fila seja um que algum roteiro descreve:

- **Sem ele**, a etapa 1 passaria por API `5d74556` com web `438e598`, par que nenhum roteiro avalia. A alternativa de levar o web direto de `438e598` para `5d74556` antes da API dá web `5d74556` com API `8e8577d`, que o roteiro das comissões registra como defeituoso e que inverte a ordem dele.
- **Com ele**, o passo 0 do roteiro das comissões (API e web em `8e8577d`) fica verdadeiro, e o rollback da etapa 1 tem um destino conhecido.

É um deploy só do web, sem banco, sem variável e sem migration.

| Passo | O que fazer | Continuar se | Parar se |
|---|---|---|---|
| 0.0 | Render, só leitura | API `8e8577d`, web `438e598`, Auto-Deploy desligado, nada em fila. Anote os IDs dos deploys live | qualquer outro SHA live |
| 0.1 | Web em `8e8577d698fd3d2b9eb2a42b6945fbd3cb3205d2`, por commit | live no SHA; `/login` 200; `/agenda_api/auth/me` sem cookie 401 (com a API acordada) | o deploy não fica live: o Render mantém `438e598`, leia o log |
| 0.2 | O responsável repete os quatro testes de 16/11 (entrar, recarregar com sessão, sair e entrar, abrir as telas) e abre a tela de comissões de um profissional | os quatro funcionam e a tela de comissões abre | qualquer um falha |

- **Ponto de recuperação:** nenhum no banco, porque nada é escrito. O retorno é o web de volta a `438e598` (o deploy live anotado em 0.0), que é o estado confirmado em 16/11.
- **Critério de parada:** se 0.2 falhar, volte o web a `438e598` e não comece a etapa 1. O par `8e8577d` com `8e8577d` nunca foi confirmado pelo responsável depois da recuperação; a etapa 0 é essa confirmação.
- A etapa 0 pode ser feita na mesma sessão da etapa 1, antes dela.

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

## 5. Sequência

Uma etapa por sessão (a etapa 0 pode ir junto com a 1). Não comece uma etapa sem a anterior encerrada e validada.

Regras para todas as etapas:

- **Passo 0, só leitura:** `render deploys list` mostra exatamente os SHAs live esperados para o início da etapa, nos dois serviços, com Auto-Deploy desligado e nada em fila. Se houver deploy que este plano não previu, **pare**.
- **Ordem fixa dentro da etapa:** ponto de recuperação, conferência do banco, migration (se houver), conferência do banco, variáveis (se houver), API, web no mesmo SHA, validação.
- **Migration sempre de uma cópia limpa no SHA da etapa**, nunca da ponta da integração. `migration:run:compiled` aplica todas as pendentes que o build contém: rodado de `b5b2704` num banco com 16, aplicaria a 17 e a 18 juntas.
- **Nunca no piloto:** `migration:revert`, `migration:show`, restauração de backup por cima, `Reset from parent`.
- **Deploy por commit:** `render deploys create <serviço> --commit <sha completo> --wait --confirm`, ou "Deploy a specific commit" no painel. Nunca "Deploy latest commit".
- Uma falha de deploy antes de ficar live não exige ação: o Render mantém a versão anterior. Leia o log antes de tentar de novo.
- Entre o deploy da API e o do web de uma etapa, ninguém valida nem grava nada (seção 4.1).

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

### Etapa 3: 2FA com os demais lotes (`b5b2704`)

Roteiro: [`publicacao-2fa-administrativo.md`](../runbooks/publicacao-2fa-administrativo.md). Fase inicial `optional`.

| Passo | O que fazer | Continuar se | Parar se |
|---|---|---|---|
| 3.0 | Render, só leitura | API e web em `04c9a43` | qualquer outro SHA live |
| 3.1 | Requisitos da hora (roteiro, seção 0): proprietários ativos, e-mail configurado e chegando, e-mails verificados | os proprietários reais indicados pelo responsável conferem com o que o banco mostra: dois, ou um só com a emergência (roteiro, seção 6) ensaiada antes em banco descartável; e-mail conferido | um só proprietário sem o ensaio, ou proprietário ativo que o responsável não reconhece. Sem e-mail conferido a etapa pode seguir, mas a liberação pelo portal fica indisponível e a recuperação depende da seção 6 do roteiro |
| 3.2 | Gerar a chave TOTP e guardar em dois lugares fora do banco e fora do Render (roteiro, seção 1, passos 1 e 2). Os lugares são escolha do responsável | as duas cópias guardadas e conferidas pelo responsável | chave guardada em um lugar só, ou lugares ainda não definidos |
| 3.3 | `pg_dump` com restauração validada (seção 6) | como no passo 2.1 | como no passo 2.1 |
| 3.4 | Conferência antes: `PILOT_EXPECT=after-tenant-test-flag` | `MIGRATIONS_APPLIED: 17`, `SCHEMA_OBJECTS_OK: 2/2`, `MARCADOS_COMO_TESTE` igual à lista do passo 2.8 | qualquer outro resultado |
| 3.5 | Aplicar a 18, de uma cópia limpa em `b5b2704` | o TypeORM aplica uma migration, `AdminSecondFactor1793750400000` | o comando lista outra migration, falha ou a conexão cai. Não repita |
| 3.6 | Conferência do estado 18 (bloco abaixo), só leitura | os sete resultados exatamente como esperado | qualquer diferença. Nenhuma variável e nenhum deploy antes de entender a diferença |
| 3.7 | Variáveis no serviço da API (roteiro, seção 1, passo 3): as três `PLATFORM_*`, com `optional`. Salvar **sem** disparar deploy, se o painel oferecer essa escolha | as três presentes; o web sem nenhuma delas | um deploy inesperado começa: espere terminar e releia o passo 3.0 |
| 3.8 | API em `b5b2704` | live no SHA; log com `18 de 18 registradas no banco` e `Nest application successfully started`; `GET /` 200; `GET /health` 200 | `[SchemaReadiness] A API não vai iniciar` (falta migration) ou `Configuração de ambiente inválida` (falta variável). A versão anterior continua no ar: corrija a causa, não insista no deploy |
| 3.9 | Web em `b5b2704`, logo em seguida | live no SHA; `/login` 200; `auth/me` 401; o responsável entra em `/conta` e no portal | qualquer verificação fora do esperado. Ninguém cadastra o aplicativo antes de o web novo estar no ar |
| 3.10 | Cadastro de cada proprietário real (roteiro, seção 4) | aplicativo, códigos de recuperação guardados, entrada com código e com um código de recuperação, e-mail de aviso recebido | um proprietário sem conseguir entrar com o fator |
| 3.11 | Conferir `EMAIL_FROM_NAME` e as telas dos lotes #111 a #114 (página inicial, login, preços, menu do dono) | como aprovado em cada plano | não bloqueia; vira correção para a frente |

- **Estado ao final:** API e web em `b5b2704`, banco 18, `PLATFORM_2FA_ENFORCEMENT=optional`.
- **Ponto de recuperação:** o `pg_dump` do passo 3.3, com a restauração validada, **mais** as duas cópias da chave TOTP do passo 3.2. Um sem o outro não recupera o segundo fator.
- **Critério de parada:** antes do passo 3.8, parar deixa o piloto em `04c9a43` funcionando, com o banco em 17 ou 18 (a API `04c9a43` ignora as tabelas novas). Depois do primeiro cadastro (3.10), não há retorno seguro de código.
- **Retorno:** o roteiro do 2FA, seção 7, vale inteiro. Depois que alguém cadastrar o fator, voltar a API a um SHA sem 2FA abre o portal só com a senha. A preferência é correção para a frente.
- **`required` não faz parte desta etapa.** É a seção 5 do roteiro do 2FA, com data própria, depois de todos os proprietários cadastrados.

#### Conferência do estado 18 (passo 3.6)

O `pilot:check-database` não tem expectativa para o estado 18, e nenhum lote de código será criado para isso. Depois da migration, `after-tenant-test-flag` passa a reprovar com `migration_history`, porque exige exatamente 17: é esperado. A contagem e o log da API **não bastam**: a conferência é o bloco abaixo, só de leitura, no `psql` com a URL direta do piloto, no molde de [`publicacao-piloto-render.md`](../runbooks/publicacao-piloto-render.md), seção 6.D, passo 4.

As consultas foram escritas a partir do código da migration (`backend/src/migrations/1793750400000-AdminSecondFactor.ts`) e **não foram executadas**. Rode o bloco primeiro num PostgreSQL descartável com as 18 aplicadas e confirme os resultados antes de usar no piloto.

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
| 7 | Sete zeros. Vale logo depois da migration, antes do passo 3.8: depois que a API nova sobe e alguém cadastra o fator, estes números mudam |

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

Sem elas, o passo indicado não começa. Nenhuma é deduzida do banco, de nome ou de plano, e nenhuma é escrita neste repositório.

| Informação | Usada em |
|---|---|
| Qual estabelecimento de teste serve para validar as comissões | passo 1.5 |
| A lista dos estabelecimentos de teste a marcar. Tudo o que ficar fora da lista é tratado como real e continua indexável | passo 2.8 |
| Quem são os proprietários reais do portal (`MASTER_OWNER`) | passos 3.1 e 3.10 |
| Onde ficam as duas cópias da chave TOTP, fora do banco e fora do Render | passo 3.2 |

### Decisões em aberto

| # | Decisão | Recomendação |
|---|---|---|
| D2 | Deploys manuais fora do plano: identificar na aba Events quem fez os de 13/11 e 14/11 e combinar que, durante a fila, só há deploy pelo plano. Um deploy não previsto faz o passo 0 parar a etapa | combinar antes da etapa 0 |
| D5 | 2FA com um só proprietário real: ensaiar a emergência antes em banco descartável, ou esperar um segundo | não criar conta só para chegar a dois |
| D7 | Backup automático (O1): configurar antes da fila, entre etapas ou depois | antes da etapa 3, que é a que mais aumenta o valor do que está no banco |
| D8 | Datas: uma sessão em casa por etapa; quando passar o 2FA para `required`; quando fazer a validação do `/health` | uma etapa por sessão, sem acumular |

### Decididas em 16/11/2026

- **D1:** API e web no SHA de cada etapa. O web volta a `8e8577d` antes da etapa 1 (seção 4).
- **D3:** etapas 2 e 3 com `pg_dump` e restauração validada; branch do Neon a mais é opcional (seção 6).
- **D4:** a identificação dos estabelecimentos de teste é informação do responsável (tabela acima).
- **D6:** a conferência do estado 18 é feita por consultas só de leitura com resultado esperado (etapa 3). Nenhum lote de código para isso.
- **D9:** a tela de comissões de um profissional é conferida no passo 0.2.

## Estado e retomada

- **Feito (16/11/2026):** este plano e o registro do resultado no roteiro de recuperação. Só documentação.
- **Não feito:** nenhum deploy, migration, backup, variável no Render ou leitura do banco real.
- **Próximo passo:** a decisão D2. Depois, a etapa 0 e a etapa 1, com pedido explícito, numa sessão em casa.
- **Se o estado mudar antes da etapa 0** (deploy novo no Render, commit novo na integração), releia a seção 1 e ajuste os SHAs antes de qualquer passo.
