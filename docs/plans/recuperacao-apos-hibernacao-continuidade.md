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

## Pendente (resultado não presumido)

- Terceira sondagem agendada para pegar os serviços hibernados: resultado não registrado nesta máquina. Verificar se rodou e qual foi a resposta.
- Logs do Render indisponíveis (sem chave de API/CLI nesta máquina): qual serviço estava subindo no incidente relatado continua sem prova.

## Hipóteses abertas

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

## Próximo passo

1. Repetir a sondagem somente leitura depois de mais de 15 min sem tráfego, medindo tempo e corpo das respostas de `/login` e `/agenda_api/auth/me`.
2. Se possível, ler os logs do Render no painel para o horário do incidente.
3. Revisar e decidir o merge do PR #59. Deploy só do web (`agenda-cloud-piloto-web`); pela regra do PR #45, ambos os serviços saem do mesmo commit, o que implica redeploy da API sem mudança de código e com as mesmas variáveis VAPID.
