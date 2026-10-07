# Runbook — Publicação do piloto no Render

Este roteiro cobre a primeira publicação do piloto do Agenda Cloud: frontend Next.js e API NestJS como dois web services no Render, um banco Neon **exclusivo do piloto** e publicação **manual** de um commit validado.

**Este documento nunca contém, e nunca deve passar a conter, credencial, URL de banco, Endpoint ID ou domínio real.** Onde aparece `<dominio>`, `<sha>` ou `<endpoint-...>`, o valor real é digitado por quem opera, no painel ou no terminal, nunca aqui e nunca numa conversa com o Claude.

Nada deste roteiro foi executado ainda. A seção 9 separa o que já foi verificado no repositório do que só pode ser verificado com os serviços publicados.

## 1. Decisões pendentes antes de começar

| Decisão | Onde entra | Observação |
|---|---|---|
| Região do Render | `region` nos dois serviços de `render.yaml` | Valores aceitos: `oregon`, `ohio`, `virginia`, `frankfurt`, `singapore`. O Render não muda a região de um serviço depois de criado. Escolher perto da região do banco Neon do piloto. |
| Plano do Render | `plan` nos dois serviços | Decisão de custo. O plano `free` hiberna sem tráfego, o que não serve a um piloto com cliente real. |
| Domínio | painel do Render e DNS | Dois subdomínios do **mesmo** domínio próprio, por exemplo `app.<dominio>` (frontend) e `api.<dominio>` (API). Ver seção 3. |
| Projeto Neon do piloto | painel do Neon | Projeto ou branch **separado** do production existente, com Endpoint ID próprio. |
| Fonte do IP do cliente | `CLIENT_IP_SOURCE` | Fica `socket` até a confirmação da seção 5. **Bloqueia a abertura do piloto**, ver seção 5. |

Os campos `region` e `plan` de `render.yaml` estão com `PENDENTE_REGIAO` e `PENDENTE_PLANO` de propósito: são valores fora da lista aceita pelo Render, então o Blueprint é recusado até alguém trocá-los conscientemente, num commit revisado.

## 2. Fluxo navegador → API → banco

1. O navegador abre `https://app.<dominio>`. O TLS termina na borda do Render, que encaminha a requisição em HTTP ao `next start` do serviço **web**, escutando em `0.0.0.0:$PORT`. O frontend publicado não tem acesso a banco nenhum: não recebe `DATABASE_URL` nem `DIRECT_URL`.
2. O JavaScript da página chama `https://api.<dominio>` (o valor de `NEXT_PUBLIC_API_URL`, embutido no build) com `credentials: "include"` (ver `src/lib/api/http-client.ts`).
3. Na borda, o TLS termina de novo e a requisição segue em HTTP ao NestJS do serviço **api**, que escuta em `HOST=0.0.0.0` e no `PORT` do Render.
4. O CORS só libera a origem exata de `FRONTEND_URL` (`https://app.<dominio>`), com `credentials: true`. Qualquer outra origem não recebe `Access-Control-Allow-Origin`.
5. Login e cadastro respondem com o cookie `session_token`: `HttpOnly`, `Secure` (porque `NODE_ENV=production`), `SameSite=Lax`, `Path=/`, sem `Domain` (fica só no host `api.<dominio>`). O JavaScript da página nunca lê esse cookie. O navegador o reenvia nas chamadas seguintes à API.
6. A API consulta o Neon pela URL **pooled** (`DATABASE_URL`) com TLS e verificação de certificado (`ssl: { rejectUnauthorized: true }`). A aplicação recusa subir se a URL tiver `sslmode=disable`, `allow`, `no-verify`, `ssl=false`/`ssl=0` ou `uselibpqcompat`, porque o driver `pg` aplica esses parâmetros por cima do código. Use `sslmode=verify-full`.

Por que `SameSite=Lax` funciona: `app.<dominio>` e `api.<dominio>` são o **mesmo site** para o navegador (mesmo domínio registrável), então o cookie acompanha o `fetch` da página para a API. Isso **não** vale para `*.onrender.com`, que está na Public Suffix List: `x.onrender.com` e `y.onrender.com` são sites diferentes, e o cookie nunca seria enviado. Por isso o piloto só funciona nos domínios próprios, e o build do frontend recusa `NEXT_PUBLIC_API_URL` em `*.onrender.com`.

## 3. Configuração versionada

| Arquivo | O que define |
|---|---|
| `render.yaml` | Os dois web services: `rootDir`, branch `integration/nestjs-typeorm-frontend`, comandos, health check, uma instância, auto-deploy desligado e as variáveis (as secretas com `sync: false`). |
| `package.json` e `backend/package.json` | `engines.node: ">=24 <25"`, a mesma versão maior do CI. O Render usa `engines` quando não há `NODE_VERSION`, `.node-version` nem `.nvmrc`. |
| `next.config.ts` + `src/lib/publicacao/api-url.ts` | Num build do Render (`RENDER=true`), o build falha se `NEXT_PUBLIC_API_URL` estiver ausente, não for uma origem HTTPS exata ou estiver em `*.onrender.com`. |
| `backend/src/config/env.validation.ts` | A API recusa subir sem as variáveis obrigatórias, com URL de banco que desliga a verificação TLS ou, em production, com `FRONTEND_URL` diferente de uma origem HTTPS exata. |
| `backend/src/config/client-ip.ts` | A fonte do IP usado no rate limit e na auditoria da sessão (seção 5). |
| `backend/scripts/run-check-pilot-database.ts` | A conferência só de leitura do banco do piloto (seção 6). |

Comandos de cada serviço:

| Serviço | Diretório | Build | Start | Health check |
|---|---|---|---|---|
| api | `backend/` | `npm ci --include=dev && npm run build` | `node dist/main.js` | `GET /` (responde 200 sem tocar no banco) |
| web | raiz | `npm ci --include=dev && npm run build` | `npm run start` (`next start`) | `GET /login` |

`--include=dev` é necessário porque o build usa ferramentas que estão em `devDependencies` (`@nestjs/cli`, TypeScript, Tailwind). Uma variável `NODE_ENV=production` definida no serviço também vale durante o build, e sem esse parâmetro o `npm ci` deixaria essas ferramentas de fora.

O build normal do backend (`nest build`) gera só `backend/dist/`. Ele **não** compila o runtime de migrations (`backend/dist-migrations/`, de `npm run build:migrations-runtime`), e nenhum comando do deploy aplica migration. O banco é inicializado à parte, na seção 6.

## 4. Variáveis por serviço

O Render disponibiliza as variáveis do serviço tanto no build quanto no runtime, salvo exceções que ele documenta (por exemplo, o `NODE_ENV=production` que ele mesmo define vale só no runtime). A coluna "Usada em" diz onde o **código** de fato lê a variável.

### Serviço api

| Variável | Usada em | Valor | Origem |
|---|---|---|---|
| `NODE_ENV` | runtime | `production` | `render.yaml`. Liga o cookie `Secure` e a exigência de `FRONTEND_URL` HTTPS. |
| `PORT` | runtime | definido pelo Render (padrão `10000`) | plataforma; não definir à mão |
| `HOST` | runtime | `0.0.0.0` | `render.yaml`. O Render exige escuta em `0.0.0.0`. |
| `DATABASE_URL` | runtime | URL **pooled** do Neon do piloto, com `sslmode=verify-full` | **secreto**, digitado no painel (`sync: false`) |
| `DIRECT_URL` | validação na inicialização | URL **direta** do mesmo banco do piloto, com `sslmode=verify-full` | **secreto**, digitado no painel. A aplicação não a usa para consultas, mas exige o valor. |
| `FRONTEND_URL` | runtime | `https://app.<dominio>` (origem exata, sem barra final) | digitado no painel; **pendente** até o domínio existir |
| `CLIENT_IP_SOURCE` | runtime | `socket` | `render.yaml`. **Pendente**, ver seção 5. |

### Serviço web

| Variável | Usada em | Valor | Origem |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | **build** (embutida no JavaScript) | `https://api.<dominio>` (origem exata) | digitado no painel (`sync: false`); **pendente** até o domínio existir. Mudar o valor exige um novo deploy com build, nunca só um restart. |
| `RENDER` | build | `true` | plataforma; liga a guarda de build |
| `PORT` | runtime | definido pelo Render | plataforma |

O serviço web nunca recebe `DATABASE_URL`, `DIRECT_URL` nem qualquer segredo.

`sync: false` só faz o Render pedir o valor na **criação** do Blueprint. Depois disso, valores novos ou trocados são editados no painel de cada serviço, em **Environment**.

## 5. IP do cliente e rate limit

`POST /auth/login` e `POST /auth/register` têm limite de 5 tentativas a cada 15 minutos **por IP**. O limite só protege se o IP for o do cliente de verdade e não puder ser escolhido por quem chama.

O que foi verificado:

- O Express continua com `trust proxy` **desligado**. Não usamos `trust proxy=true` nem uma contagem de saltos: a documentação de referência do Render não diz quantos proxies há entre o cliente e a aplicação.
- Um artigo do Render ([Host PocketBase on Render](https://render.com/articles/host-pocketbase-on-render), julho de 2026) afirma:
  - o tráfego público chega ao serviço passando pela Cloudflare e pelo balanceador do Render;
  - a Cloudflare grava `CF-Connecting-IP` em toda requisição que chega a um web service e **sobrescreve** o que o cliente mandou;
  - a Cloudflare **acrescenta** ao `X-Forwarded-For`, de modo que o valor mais à esquerda é controlado por quem chama.
- Essa garantia não aparece na documentação de referência (`render.com/docs`): está só nesse artigo. Por isso ela não foi ligada por suposição.

O que o código faz:

- `CLIENT_IP_SOURCE=socket` (padrão e valor atual de `render.yaml`): usa o endereço da conexão, exatamente como antes. Nenhum cabeçalho é lido. No Render, esse endereço é o do proxy, compartilhado por todos os clientes.
- `CLIENT_IP_SOURCE=cf-connecting-ip`: usa `CF-Connecting-IP` só se for **um** IP válido. Valor ausente, repetido ou malformado cai no endereço da conexão, o que deixa o limite mais restritivo, nunca mais frouxo.
- `X-Forwarded-For` nunca é lido, em nenhum modo.

**Consequência para o piloto:** com `socket` no Render, todos os clientes dividem o mesmo limite. Seriam 5 logins **no total** a cada 15 minutos, contando todo mundo. Isso bloqueia a abertura do piloto até a troca para `cf-connecting-ip`.

**Dado exato que falta, a pedir por escrito ao suporte do Render** (ou a localizar na documentação de referência):

1. Para um web service com domínio próprio, toda requisição pública passa pela borda Cloudflare do Render, e ela **sobrescreve** `CF-Connecting-IP` com o IP do cliente?
2. Existe algum caminho público até o serviço que não passe por essa borda? Isso inclui o subdomínio `onrender.com`.
3. A garantia continua se o DNS do domínio próprio também estiver atrás da Cloudflare **do cliente** (registro "Proxied")? Até a resposta, manter o DNS como **DNS only**.

Com a confirmação em mãos:

1. Troque `CLIENT_IP_SOURCE` para `cf-connecting-ip` num commit revisado, com a referência da resposta do Render no texto do commit.
2. Publique esse commit.
3. Rode o teste da seção 7, passo 7.

## 6. Inicializar o banco do piloto

O caminho são as migrations **compiladas** (`dist-migrations/`), o mesmo runtime usado em production, com conferência do destino **antes** de qualquer escrita. Rode a partir de uma cópia limpa do commit validado, fora da pasta de trabalho, onde não existe `.env` nenhum. O TypeORM CLI não carrega `.env`, e o script de conferência só lê variáveis do processo.

Pré-requisitos no painel do Neon (manual):

- projeto ou branch do piloto criado, com banco vazio;
- anotados, sem colar em lugar nenhum: a URL **direta** (host sem `-pooler`), o Endpoint ID do piloto (`ep-...`, primeiro trecho do host) e o Endpoint ID do production existente.

Comandos (Git Bash):

```bash
# 1. Cópia limpa do commit validado, fora do repositório de trabalho.
git -C <repositorio> fetch origin
git -C <repositorio> worktree add <pasta-temporaria> <sha>
cd <pasta-temporaria>/backend
ls -a            # confirmar que NÃO existe .env aqui
npm ci --include=dev
npm run build:migrations-runtime

# 2. Variáveis só nesta sessão do terminal. `read -rs` não ecoa o valor.
read -rs PILOT_DIRECT_URL && export PILOT_DIRECT_URL
read -r PILOT_ENDPOINT_ID && export PILOT_ENDPOINT_ID
read -r PRODUCTION_ENDPOINT_ID && export PRODUCTION_ENDPOINT_ID

# 3. Conferência ANTES de escrever: destino e banco vazio. Só leitura.
PILOT_EXPECT=empty npm run pilot:check-database
```

Só continue se a saída terminar em `RESULT: SUCCESS`, com estas linhas:

```text
TARGET_ENDPOINT_MATCH: true
DISTINCT_FROM_PRODUCTION: true
TLS_VERIFICATION: true
EXPECT: empty
PUBLIC_TABLES: 0
MIGRATIONS_TABLE: false
```

Qualquer `CODE:` diferente para tudo:

| Código | Significado |
|---|---|
| `ERR_PILOT_AS_PRODUCTION` | O Endpoint ID do piloto é igual ao do production. |
| `ERR_ENDPOINT_MISMATCH` | A URL é de outro endpoint. |
| `ERR_POOLER_FORBIDDEN` | A URL é a pooled, não a direta. |
| `ERR_TLS_VERIFICATION_DISABLED` | A URL desliga a verificação de certificado. |
| `ERR_TARGET_NOT_EMPTY` | O banco já tem tabelas. |

**Não rode `migration:show` antes desta conferência:** o TypeORM cria a tabela `typeorm_migrations` ao listar, ou seja, ele escreve.

```bash
# 4. Aplicar as migrations compiladas no banco conferido acima.
DIRECT_URL="$PILOT_DIRECT_URL" npm run migration:run:compiled

# 5. Conferência DEPOIS: 3 migrations, catálogo de planos, nenhum tenant.
PILOT_EXPECT=initialized npm run pilot:check-database

# 6. Limpar.
unset PILOT_DIRECT_URL PILOT_ENDPOINT_ID PRODUCTION_ENDPOINT_ID
cd <repositorio> && git worktree remove <pasta-temporaria>
```

O passo 5 precisa terminar em `RESULT: SUCCESS`, com `MIGRATIONS_APPLIED: 3` e `BASELINE_FAILURES: none`.

Se o passo 4 falhar no meio, **não** repita às cegas. Rode só o passo 5 para ver o estado, e investigue antes de qualquer nova tentativa. Num banco novo do piloto, sem dados, recriar o branch do Neon é uma saída aceitável.

## 7. Sequência de publicação

1. **Commit validado:** escolha o `<sha>` em `integration/nestjs-typeorm-frontend` com o CI verde. É o mesmo SHA da seção 6.
2. **Decisões da seção 1** aplicadas num commit revisado: `region` e `plan` em `render.yaml`.
3. **Banco do piloto inicializado** (seção 6).
4. **Criar o Blueprint** no painel do Render, apontando para o repositório e a branch `integration/nestjs-typeorm-frontend`. O Render pede os valores `sync: false`:
   - `DATABASE_URL` e `DIRECT_URL` do piloto;
   - `FRONTEND_URL=https://app.<dominio>` e `NEXT_PUBLIC_API_URL=https://api.<dominio>`, já com os domínios finais.

   A criação dispara o primeiro deploy. Depois dela, deploys só acontecem manualmente.
5. **Domínios:**
   - adicione `api.<dominio>` ao serviço api e `app.<dominio>` ao serviço web;
   - crie os CNAMEs pedidos pelo Render, em **DNS only**;
   - espere os certificados ficarem válidos.
6. **Publicar o commit exato:** em cada serviço, **Manual Deploy → Deploy a specific commit → `<sha>`**. Publique a api primeiro e o web depois.
7. **Verificações em HTTPS:**
   - Saúde:
     - `curl -sS -o /dev/null -w "%{http_code}\n" https://api.<dominio>/` deve dar `200`;
     - `curl -sS -o /dev/null -w "%{http_code}\n" https://app.<dominio>/login` deve dar `200`;
     - os dois serviços aparecem como **Live** no painel.
   - CORS:
     - `curl -si -X OPTIONS https://api.<dominio>/auth/login -H "Origin: https://app.<dominio>" -H "Access-Control-Request-Method: POST"` deve mostrar `Access-Control-Allow-Origin: https://app.<dominio>` e `Access-Control-Allow-Credentials: true`;
     - repetindo com `-H "Origin: https://exemplo.invalid"`, a resposta não pode ter `Access-Control-Allow-Origin`.
   - Login, sessão e logout no navegador:
     1. Crie a conta em `https://app.<dominio>/cadastro`. Não existe exclusão de conta: use a conta real do primeiro estabelecimento ou uma conta de teste claramente identificada.
     2. Em DevTools → Application → Cookies, confira em `https://api.<dominio>` o cookie `session_token` com `HttpOnly`, `Secure`, `SameSite=Lax` e sem `Domain`.
     3. Recarregue `/conta`: a sessão continua.
     4. Clique em **Sair**: `/conta` volta a pedir login e o cookie some.
     5. Entre de novo pelo `/login`.
   - Rate limit, só depois da seção 5:
     1. Da mesma máquina, faça 6 tentativas de login com um e-mail inexistente, cada uma com cabeçalhos forjados diferentes: `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://api.<dominio>/auth/login -H "Content-Type: application/json" -H "CF-Connecting-IP: 203.0.113.<n>" -H "X-Forwarded-For: 198.51.100.<n>" -d '{"email":"teste-limite@exemplo.invalid","password":"senha-errada-123"}'`.
     2. A sexta precisa responder `429`. Se não responder, os cabeçalhos do cliente estão sendo aceitos: volte `CLIENT_IP_SOURCE` para `socket` e trate como incidente.
     3. Na sequência, de outra rede (por exemplo, o celular fora do Wi-Fi), o login precisa funcionar, provando que os clientes não dividem o mesmo limite.

## 8. Retorno ao commit anterior

- **Deploy falhou antes de ficar Live:** o Render cancela sozinho quando o build falha ou o health check não passa. O deploy anterior continua no ar e não há nada a fazer além de investigar.
- **Ficou Live com defeito:** em cada serviço afetado, vá em **Deploys**, escolha o último deploy bom e clique em **Rollback**.
  - O rollback reutiliza o artefato daquele deploy, com as variáveis de ambiente e o comando de start da época.
  - Pelo painel, ele também desliga o auto-deploy, que já está desligado aqui.
  - O frontend volta com o `NEXT_PUBLIC_API_URL` embutido naquele build.
- **Primeiro deploy, sem anterior:** suspenda o serviço (**Suspend**) até corrigir.
- **Banco:** rollback do Render **não** desfaz migration. Para este primeiro deploy, o banco foi inicializado à parte (seção 6) e o código não aplica migration no deploy. Publicações futuras que tragam migration precisam de um roteiro próprio, com backup (branch do Neon) antes de escrever.
- Depois de qualquer rollback, refaça as verificações da seção 7, passo 7.

## 9. Evidência: o que já foi verificado e o que depende da publicação

Verificado no repositório e no CI, sem nenhum recurso externo:

- validação de ambiente: recusa de URL sem verificação TLS, de `FRONTEND_URL` não-HTTPS em production, de `HOST` que não é IP e de `CLIENT_IP_SOURCE` desconhecido. Testes unitários, mais o binário compilado `node dist/main.js` recusando subir com cada configuração errada, antes de tocar em banco;
- rate limit com cabeçalhos forjados (`X-Forwarded-For` e `CF-Connecting-IP`) nos dois modos, via HTTP real (supertest), inclusive pelo `AuthModule`;
- guarda de build do frontend e invariantes de `render.yaml` (testes unitários);
- conferência do banco do piloto: lógica com cliente falso (só leitura, sem vazar URL, host ou Endpoint ID), mais o script compilado recusando destino errado sem abrir conexão;
- build do backend (`dist/main.js`), do runtime de migrations (`dist-migrations/`) e dos scripts (`dist-scripts/`), e os fluxos completos de navegador contra PostgreSQL descartável no CI.

Só verificável com o ambiente publicado:

- escuta em `0.0.0.0:$PORT` aceita pelo Render, e health checks verdes;
- certificado e CORS nos domínios próprios;
- cookie `Secure`/`HttpOnly`/`SameSite=Lax` em HTTPS real, e o ciclo login → sessão → logout;
- comportamento de `CF-Connecting-IP` na borda do Render (seção 5);
- conexão ao Neon do piloto com `sslmode=verify-full`;
- rollback pelo painel.
