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

## Próximo passo

1. Repetir a sondagem somente leitura depois de mais de 15 min sem tráfego, medindo tempo e corpo das respostas de `/login` e `/agenda_api/auth/me`.
2. Se possível, ler os logs do Render no painel para o horário do incidente.
3. Revisar e decidir o merge do PR #59. Deploy só do web (`agenda-cloud-piloto-web`); pela regra do PR #45, ambos os serviços saem do mesmo commit, o que implica redeploy da API sem mudança de código e com as mesmas variáveis VAPID.
