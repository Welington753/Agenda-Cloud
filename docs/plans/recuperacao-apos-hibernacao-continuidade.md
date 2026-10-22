# Continuidade — PR #59 (recuperação após hibernação)

Nota de passagem de trabalho registrada em 2026-10-22. Branch `fix/recuperacao-apos-hibernacao`, PR #59 aberto, sem merge e sem deploy.

## Diagnóstico

- Sintoma: ao abrir o Agenda Cloud depois que o plano gratuito do Render hiberna, aparecia erro; o contorno era um deploy manual.
- Causa provável: a primeira requisição recebe 502 ou página HTML da borda do Render, ou fica pendurada enquanto o serviço sobe. Antes do PR, só a leitura de sessão de `/conta` tinha nova tentativa (5 tentativas, só 502/503/504, sem limite de tempo por requisição).
- Três casos separados:
  1. Web hibernado: o Render responde antes do nosso HTML/JS; nenhum código nosso atua. Fora do escopo.
  2. Web ativo e API hibernada: tratado pelo PR (laço `leitura-com-recuperacao` via proxy `/agenda_api`).
  3. Erros reais (401, 403, 429, JSON de erro da API, 500 JSON do proxy): nunca repetidos, nunca exibidos como "conectando".

## Experimentos concluídos

- Testes locais com PostgreSQL 17 descartável (TLS, 6 migrations, `IGNORE_DOTENV_FILE=true`): `vitest` 786 aprovados; nova suíte `test:browser:recuperacao` 10/10; suítes de navegador existentes verdes. Contra `4c57512` a nova suíte falha (confirma que reproduz o problema).
- Sondagens somente leitura, sem credenciais, em 2026-10-22 às 02:11 e 02:28 UTC: os dois serviços já estavam ativos (`/login` 200 em 0,19 s; `/agenda_api/auth/me` 401 JSON em 0,5 s). Portanto não demonstram recuperação a partir da hibernação.
- Observado: o cabeçalho `x-render-origin-server: Render` aparece também em respostas normais do Next.js; não identifica erro de borda.

## Pendente (registro original; respondido na atualização abaixo)

- Terceira sondagem agendada para pegar os serviços hibernados: resultado não registrado nesta máquina. Verificar se rodou e qual foi a resposta.
- Logs do Render indisponíveis (sem chave de API/CLI nesta máquina): qual serviço estava subindo no incidente relatado continua sem prova.

## Hipóteses abertas (registro original; respondidas na atualização abaixo)

- No incidente original, era a API (caso 2, coberto) ou o web (caso 1, não coberto por código)?
- O tempo real de subida do plano gratuito cabe no prazo total de 100 s do laço?
- Algo externo mantém os serviços acordados (as duas sondagens os encontraram ativos)?

## Atualização 2026-10-22 (manhã, outro computador)

Relatos recebidos (não reproduzidos aqui):

- O web acordou depois de mostrar a página 503 do próprio Render.
- Pelo proxy, requisições receberam 502 em menos de 1 s durante quatro minutos, sem acordar a API.
- Uma chamada direta à API esperou 31 s e a acordou.
- Às ~11:46 UTC, ao clicar em Entrar no piloto (código publicado `4c57512`), apareceu "Não foi possível entrar agora. Tente novamente em instantes." Sem deploy.

Conferências de código:

- `src/lib/api/proxy.ts` e a rota `/agenda_api` são idênticos em `4c57512` e no PR. O proxy espera a API por até 90 s e só gera 502 próprio (com `X-Agenda-Proxy-Error`) quando o `fetch` lança.
- O limite de 30 s por tentativa existe só no PR, que não está publicado. Ele não explica os 502 em menos de 1 s.
- Em `4c57512`, essa mensagem do login corresponde à falha `indisponivel`: resposta HTTP sem o marcador do proxy, com status diferente de 401/429 (ou corpo fora do contrato). Uma falha do `fetch` no proxy daria "Não foi possível conectar ao servidor". Indício (ainda não prova): quem respondeu ao proxy com erro foi algo à frente da API, e o proxy repassou o status.
- Ainda no PR: o cancelamento da requisição do navegador é repassado à chamada do proxy para a API (`requisicao.signal`). Com o corte de 30 s do PR e uma subida de 31 s, isso também poderia impedir a recuperação. Fica registrado como risco do PR, não como causa do incidente.

Ferramentas neste computador: `gh` ausente (PR lido pela API pública), CLI `render` instalado com token expirado (precisa de `render login` pela pessoa), Docker parado e PostgreSQL 18 instalado. `vitest` em `75d9dfe`: 786 aprovados.

Experimentos:

- A primeira série (iniciada às 11:30 UTC) foi descartada: o acesso das ~11:46 tocou a API antes da sondagem das 11:50.
- A segunda série, iniciada às ~11:48 UTC, tem dois ciclos. Cada um começa depois de 20 min sem requisição à API; nesse intervalo o web recebe só `GET /login`, que não chama a API.
  - Ciclo 1: `GET /agenda_api/auth/me` pelo proxy, depois um único `POST /agenda_api/auth/login` (e-mail inexistente, nunca repetido), depois `GET /auth/me` direto com o User-Agent de navegador que o proxy repassa.
  - Ciclo 2: proxy, de novo o proxy 60 s depois, e por fim direto com o User-Agent do curl.
  - Cada requisição espera até 150 s. Os resultados serão registrados abaixo quando saírem.

### Logs do Render (CLI autenticado às ~12:00 UTC)

Logs do tipo `app` dos dois serviços (o plano gratuito não trouxe logs de requisição). A partida da API aparece como `==> Running 'node dist/main.js'` seguida de `Nest application successfully started`, sem build. Isso já ocorreu antes, por exemplo em 2026-10-21 às 21:29 e às 22:37 UTC.

- API: o último deploy subiu às 03:08 UTC. Entre 03:13 e 12:08 UTC não há **nenhuma** linha de log. Ou seja, o clique em Entrar das ~11:46, feito pelo proxy, não provocou partida da API.
- Web: partida às 11:19:11 UTC (`next start`, pronto em 1,3 s), sem build. A origem desse acesso não está identificada.

### Ciclo 1 (sondagens às 12:08 UTC, depois de 20 min sem requisição à API)

| Horário (UTC) | Requisição | Resultado |
| --- | --- | --- |
| 12:08:09 | `GET /agenda_api/auth/me` pelo proxy | 502 em 0,90 s, página HTML "502" do Render (fonte Roobert) |
| 12:08:10 | `POST /agenda_api/auth/login` pelo proxy, uma vez | 502 em 0,95 s, mesma página |
| 12:08:12 | `GET /auth/me` direto, mesmo User-Agent e `accept` que o proxy repassa | 401 JSON da API em 32,6 s |
| 12:08:29 | log da API: `Running 'node dist/main.js'` (instância `c7nbn`) | |
| 12:08:39 | log da API: `Nest application successfully started` | |

Leitura:

- As respostas 502 do proxy têm `vary: rsc, next-router-state-tree, …` e `cache-control: no-store`, ou seja, passaram pelo Next.js, e não têm `X-Agenda-Proxy-Error`. Portanto o `fetch` do proxy **recebeu** essa página 502 do Render e a repassou; ela não foi gerada pelo nosso proxy. Isso também explica a mensagem do login em `4c57512` (`indisponivel`, porque http-client tratava 502 como erro HTTP comum).
- A API estava de fato parada: houve partida registrada em log às 12:08:29, e não só demora.
- A partida veio 20 s depois do 1º pedido pelo proxy e 17 s depois do pedido direto. Só com este ciclo não dá para dizer qual dos dois a provocou. A ausência de partida às ~11:46, quando houve apenas tráfego pelo proxy, indica que foi o direto. O ciclo 2 testa isso separadamente: dois pedidos pelo proxy com 60 s entre eles e só depois o direto.
- Diferenças entre o pedido do proxy e o direto, além da rede de origem: o proxy usa o `fetch` do Node (undici), que acrescenta `accept-encoding`, `accept-language: *` e `sec-fetch-mode: cors`, e envia `x-agenda-proxy-secret`. Caminho, método (GET e POST falharam) e User-Agent foram iguais. O ciclo 3 repete o pedido com o mesmo `fetch` do Node e os mesmos cabeçalhos, porém a partir deste PC.

### Ciclo 2 (12:28 UTC, depois de 20 min sem requisição à API)

| Horário (UTC) | Requisição | Resultado |
| --- | --- | --- |
| 12:28:47 | `GET /agenda_api/auth/me` pelo proxy | 502 HTML do Render em 0,90 s |
| 12:29:48 | o mesmo pedido, 61 s depois | 502 HTML do Render em 0,28 s |
| 12:29:49 | `GET /auth/me` direto, User-Agent do curl | 401 JSON em 31,3 s |
| 12:30:04 | log da API: `Running 'node dist/main.js'` (instância `pmsvw`) | |
| 12:30:14 | log da API: `Nest application successfully started` | |

Nenhuma partida foi registrada nos 61 s depois do 1º pedido pelo proxy. A partida começou 15 s depois do pedido direto.

### Comprovado até aqui

- Com a API hibernada, pedidos que saem do serviço web pelo proxy (`fetch` do Node para `https://<api>.onrender.com`) recebem em menos de 1 s uma página HTML 502 do Render e **não** provocam a partida da API. Vale para GET e para o POST de login, em três ocasiões: ~11:46 (clique real), ciclo 1 e ciclo 2.
- Um pedido direto à API, feito deste PC (curl, com User-Agent de navegador ou de curl), provoca a partida (log `Running 'node dist/main.js'` 15–17 s depois) e é respondido em 31–33 s.
- Em `4c57512`, o login mostra "Não foi possível entrar agora" porque recebe essa 502 HTML repassada pelo proxy. Repetir pelo proxy não resolve, pois o proxy nunca acorda a API. Isso vale também para o laço do PR #59 do jeito que está: ele repete só pelo proxy.

### Descartado

- O User-Agent não é a causa: o direto acorda a API tanto com o User-Agent de navegador quanto com o do curl, e o proxy falha com o User-Agent de navegador.
- O método também não: GET e POST falham da mesma forma pelo proxy.
- O limite de 30 s do PR não causou o incidente: ele não está publicado e as 502 chegam em menos de 1 s.
- A falha não é do nosso proxy: não há `X-Agenda-Proxy-Error`, e a página é do Render.

### Ciclo 3 (12:50 UTC): mesmo `fetch` do Node, mesmos cabeçalhos, saindo deste PC

| Horário (UTC) | Requisição | Resultado |
| --- | --- | --- |
| 12:50:30 | `GET /auth/me` direto com o `fetch` do Node 24 (undici, o mesmo do proxy), `accept: */*`, User-Agent de navegador e `x-agenda-proxy-secret` (valor inválido), `redirect: manual`, `cache: no-store` | 401 JSON em 32,6 s |
| 12:50:48 | log da API: `Running 'node dist/main.js'` (instância `xjc9l`) | |

O cliente, o transporte do lado do cliente e os cabeçalhos do proxy, quando saem de fora do Render, acordam a API. Ficam descartados como causa.

### Ciclo 4 (13:11 UTC): Chromium real, página do web, mecanismo da correção

| Horário (UTC) | Requisição | Resultado |
| --- | --- | --- |
| 13:11:09 | Chromium em `https://<web>/login`: `fetch("https://<api>/", { mode: "no-cors", credentials: "omit" })` | resposta opaca em 32,4 s |
| 13:11:24 | log da API: `Running 'node dist/main.js'` (instância `ntfc6`) | |

### Causa (comprovada)

Com a API hibernada no plano gratuito, o Render responde aos pedidos que saem do serviço web (o proxy `/agenda_api`) com uma página HTML 502 em menos de 1 s e não inicia a API. Pedidos vindos de fora do Render iniciam a API, com partida registrada em log 15–18 s depois e resposta em 31–33 s.

Como no código publicado só o proxy fala com a API, nenhum acesso pelo site acorda a API. O login mostra "Não foi possível entrar agora". Antes, o contorno era o deploy manual, porque o deploy sobe a API.

### Descartado

- User-Agent (ciclos 1 e 2).
- Método HTTP (GET e POST, ciclo 1).
- Cliente e transporte do lado do cliente (`fetch` do Node/undici, cabeçalhos do proxy, `x-agenda-proxy-secret`: ciclo 3).
- Caminho (`/auth/me` em todos os cenários).
- Limite de 30 s do PR (não publicado; as 502 chegam em < 1 s).
- Erro do nosso proxy (sem `X-Agenda-Proxy-Error`; a página é do Render).

### Ainda incerto

- O que exatamente, na origem dentro do Render, faz a borda não acordar a API: o IP de saída, a rota interna entre serviços da mesma região ou outra característica do ambiente de execução (DNS, versão de TLS/Node do servidor do Render). A correção não depende disso.
- Não há prova em produção do fluxo corrigido completo, porque isso exige deploy, que não foi feito. A parte externa do mecanismo (um pedido do navegador acorda a API) foi demonstrada no ciclo 4 contra o piloto real. A parte interna (proxy marca a página 502 e o navegador faz o pedido) foi demonstrada em testes locais.

## Correção (commit seguinte a `8f3a718`)

- `src/lib/api/proxy.ts`: resposta 5xx em `text/html` vinda da API passa a ser tratada como hospedagem respondendo no lugar dela. Ela vira 502 JSON com `X-Agenda-Proxy-Error: upstream-unavailable` e `X-Agenda-Acordar-Api: <origem de API_PROXY_TARGET>`, valor da configuração do servidor e nunca da resposta. Erros JSON da API continuam passando sem alteração. Falha de rede no `fetch` não leva o cabeçalho.
- `src/lib/api/acordar-api.ts` (novo): `pedirPartidaDaApi` faz no navegador **um** `GET <origem>/` com `mode: "no-cors"`, `credentials: "omit"`, `cache: "no-store"` e sem referrer. A resposta é descartada. O limite é de um pedido a cada 60 s, só HTTPS (HTTP apenas em `localhost`/`127.0.0.1`), e ele nunca lança erro nem espera.
- `src/lib/api/http-client.ts`: ao receber o marcador com o cabeçalho, pede a partida e devolve `network-error`. O pedido original nunca é repetido ali.
- Limites mantidos: partida só depois de um pedido da pessoa falhar (sem temporizador, sem keep-alive, sem cron), sem cookie nem escrita no pedido direto, proxy e sessão inalterados para todo o resto, push intocado e nenhum POST reenviado sozinho. O laço de leitura do PR (100 s de prazo) cobre a subida observada de ~32 s.

## Validação local (2026-10-22)

PostgreSQL 18.6 descartável no scratchpad, com TLS (`ssl = on`, certificado autoassinado de 1 dia, `NODE_EXTRA_CA_CERTS`), porta 45433, porque 55433 cai numa faixa reservada do Windows. As 6 migrations foram aplicadas com `migration:run:compiled`, com `IGNORE_DOTENV_FILE=true`. Não existe `.env` real neste computador.

- `vitest`: 68 arquivos, 796 testes aprovados (786 antes; inclui `acordar-api.test.ts`, `proxy-hospedagem.test.ts` e o novo caso em `http-client.test.ts`). `tsc --noEmit` limpo.
- `test:browser:recuperacao`: 12/12. Os dois testes novos, em "API hibernada que o proxy não acorda", simulam o comportamento observado (o proxy devolve 502 marcado e a API só sobe depois do pedido direto do navegador):
  - `/conta`: um único pedido de partida (`GET`, sem `Origin`, ou seja `no-cors`, e sem cookie), a sessão volta com o mesmo cookie, nenhuma escrita e nenhum pedido periódico em 10 min.
  - Clicar em Entrar com a API hibernada: um POST, nunca reenviado em 5 min, o digitado fica, a partida é pedida uma vez e o segundo clique entra.
- Controle negativo: com `http-client.ts` de `8f3a718` (sem a chamada de partida), os dois testes novos falham (`Expected: 1, Received: 0`).
- Outras suítes: `test:browser:proxy` (HTTPS, mesma origem) 5/5, `auth` 8/8, `agendamento-publico` 1/1, `avisos-solicitacoes` 1/1, `appointments` 4/4, `push` 1/1 (com chaves VAPID descartáveis geradas na hora, como no CI; as chaves do piloto não foram tocadas).

## Falta (evidência externa)

- Ver em produção o fluxo completo: hibernação, depois clique em Entrar ou abrir `/conta`, até a API acordar sem deploy. Exige publicar este PR, e nada foi publicado.
- Opcional: confirmar com o suporte do Render qual característica do pedido interno impede a partida.

## Próximo passo

1. Revisar o PR #59 com a correção da partida pelo navegador.
2. Decidir o merge e a publicação. Deploy só do web (`agenda-cloud-piloto-web`). Pela regra do PR #45, ambos os serviços saem do mesmo commit, o que implica redeploy da API sem mudança de código e com as mesmas variáveis VAPID.
3. Depois de publicar, repetir no piloto um ciclo frio (mais de 20 min sem acesso à API) clicando em Entrar e conferir no log da API a partida logo após o pedido do navegador.
