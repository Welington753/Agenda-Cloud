# Diagnóstico de falha nos testes de navegador (CI)

Quando um passo `Run real browser flows (...)` falha no workflow
`Test — frontend auth + gestão real de serviços (PostgreSQL descartável)`, o
Playwright grava o trace da falha e o CI o publica como artefato.

## Onde baixar

Na página do run no GitHub Actions, seção **Artifacts**, o arquivo
`playwright-traces-<run_id>-<run_attempt>` (retenção de 7 dias).

Pela linha de comando:

```bash
gh run download <run_id> --name playwright-traces-<run_id>-<run_attempt> --dir diagnostico
```

O artefato traz um subdiretório por invocação do Playwright
(`availability/`, `appointments/`, `auth/`, ...) e, dentro do diretório do teste
que falhou:

- `trace.zip` — a gravação completa (passos, DOM, rede, console, screenshots);
- `error-context.md` — a asserção que falhou e o snapshot da página em texto,
  útil para ler o estado da tela sem abrir a interface gráfica.

O artefato só é publicado quando uma das invocações de navegador falha. Falha em
lint ou em teste de unidade não gera trace, e o passo de coleta é ignorado de
propósito — por isso ele usa `if-no-files-found: error`: se ele rodar e não
achar arquivo, isso é problema de coleta, não ausência normal.

## Como abrir o trace

```bash
npx playwright show-trace diagnostico/<invocação>/<nome-do-teste>/trace.zip
```

Abre o visualizador local (não envia nada para fora). A linha do tempo permite
parar em cada passo e ver o DOM daquele instante, a requisição/resposta
correspondente e o console — é o que responde "a tela recebeu o quê" sem ter de
reproduzir a falha na máquina.

Para ler só o resumo, sem interface:

```bash
cat diagnostico/<invocação>/<nome-do-teste>/error-context.md
```

## Reproduzir localmente

O CI nunca usa banco real. Para reproduzir, suba um PostgreSQL **descartável**
(nunca `agenda_dev`, nunca Neon), aplique as migrations versionadas e rode a
invocação específica — por exemplo `npm run test:browser:availability` — com
`IGNORE_DOTENV_FILE=true` para o backend não ler o `.env` local. Os traces
aparecem em `test-results/` (ignorado pelo Git).
