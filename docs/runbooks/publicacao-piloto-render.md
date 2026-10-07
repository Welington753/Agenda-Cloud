# Runbook — Publicação do piloto no Render

Este roteiro cobre a primeira publicação do piloto do Agenda Cloud: frontend Next.js e API NestJS como dois web services no Render, nos **endereços gratuitos `*.onrender.com`** (sem domínio próprio), um banco Neon **exclusivo do piloto** e publicação **manual** de um commit validado.

**Este documento nunca contém, e nunca deve passar a conter, credencial, URL de banco, Endpoint ID ou endereço real.** Onde aparece `<web>`, `<api>`, `<sha>` ou `<endpoint-...>`, o valor real é digitado por quem opera, no painel ou no terminal, nunca aqui e nunca numa conversa com o Claude.

Nada deste roteiro foi executado ainda. A seção 9 separa o que já foi verificado no repositório do que só pode ser verificado com os serviços publicados.

## 1. Decisões pendentes antes de começar

| Decisão | Onde entra | Observação |
|---|---|---|
| Plano e consumo do workspace | `plan` nos dois serviços de `render.yaml` | Ver "Mesma conta, outro sistema" abaixo. Conferir no painel o plano do workspace e o consumo do mês **antes** de criar qualquer serviço. |
| Região do Render | `region` nos dois serviços | Valores aceitos: `oregon`, `ohio`, `virginia`, `frankfurt`, `singapore`. O Render não muda a região de um serviço depois de criado. Escolher perto da região do banco Neon do piloto, e a mesma para os dois serviços. |
| Projeto Neon do piloto | painel do Neon | Projeto ou branch **separado** do production existente e de qualquer banco de outro sistema, com Endpoint ID próprio. |
| Fonte do IP do cliente | `CLIENT_IP_SOURCE` nos dois serviços | Fica `socket` até a confirmação da seção 5. **Bloqueia a abertura do piloto**, ver seção 5. |

Os campos `region` e `plan` de `render.yaml` estão com `PENDENTE_REGIAO` e `PENDENTE_PLANO` de propósito: são valores fora da lista aceita pelo Render, então o Blueprint é recusado até alguém trocá-los conscientemente, num commit revisado.

Domínio próprio **não** é mais pré-requisito: o fluxo da seção 2 funciona nos endereços gratuitos. Um domínio próprio pode ser adicionado depois sem mudar código (ver seção 7, "Domínio próprio depois").

### Mesma conta, outro sistema

A conta do Render já hospeda o Central Performance E-commerce, com Blueprint, serviços, banco, variáveis e configurações próprios. Este piloto **não toca** em nada disso:

- os serviços se chamam `agenda-cloud-piloto-api` e `agenda-cloud-piloto-web`, nomes exclusivos deste sistema;
- `render.yaml` não declara banco do Render, grupo de variáveis (`envVarGroups`) nem referência a serviço que não seja deste Blueprint (o teste `src/lib/publicacao/render-blueprint.test.ts` confere isso);
- o Blueprint do Agenda Cloud é criado **novo**, a partir deste repositório. Nunca editar, sincronizar ou reaproveitar o Blueprint do outro sistema.

Antes de criar o Blueprint:

1. Confira na lista de serviços do workspace que **não existe** serviço chamado `agenda-cloud-piloto-api` nem `agenda-cloud-piloto-web`. Se existir, pare: o Render pode associar o Blueprint a um serviço existente com o mesmo nome.
2. Na tela de revisão do Blueprint, confirme que a lista mostra **só** a criação desses dois serviços. Qualquer alteração em serviço, banco ou variável de outro sistema: cancele.

**Consumo compartilhado no plano gratuito.** As horas de instância gratuitas são uma franquia **mensal do workspace**, somada entre todos os serviços gratuitos da conta, deste e de outros sistemas. Esgotada a franquia, o Render suspende os serviços gratuitos até o mês seguinte, inclusive os do outro sistema. Antes de escolher `plan: free`:

- confira no painel (Billing / uso do workspace) o plano do workspace, a franquia atual e quanto o Central Performance já consome;
- confira, na documentação atual do Render, os limites do plano gratuito (horas por mês, hibernação, banda). Não use números deste documento como referência de preço ou franquia.

Limitações do plano gratuito que o desenho deste piloto já considera:

- **Não recebe tráfego da rede privada.** Por isso o proxy do frontend chama a API pelo endereço público HTTPS (`API_PROXY_TARGET`), nunca pelo nome interno, e a API exige um segredo do proxy (seção 5).
- **Hiberna sem tráfego** e leva perto de um minuto para voltar. A primeira chamada depois de um período parado pode demorar: o proxy espera até 90 segundos antes de responder `504` (`src/lib/api/proxy.ts`). Os dois serviços hibernam de forma independente.
- **Uma instância**, que é o que o rate limit em memória exige (`numInstances: 1`).

## 2. Fluxo navegador → frontend → API → banco

O navegador fala com **uma origem só**, a do serviço web. A API também tem endereço público, mas a página nunca a chama diretamente.

1. O navegador abre `https://<web>.onrender.com`. O TLS termina na borda do Render (Cloudflare), que encaminha em HTTP ao `next start` do serviço **web**, escutando em `0.0.0.0:$PORT`. O frontend publicado não tem acesso a banco nenhum: não recebe `DATABASE_URL` nem `DIRECT_URL`.
2. O JavaScript da página chama `/agenda_api/<caminho>` na **mesma origem** (`NEXT_PUBLIC_API_URL=/agenda_api`, embutido no build; ver `src/lib/api/http-client.ts`).
3. O Route Handler `src/app/agenda_api/[...caminho]/route.ts` (lógica em `src/lib/api/proxy.ts`):
   - recusa escrita (`POST`, `PUT`, `PATCH`, `DELETE`) cujo `Origin` não seja exatamente a origem pública do frontend (`RENDER_EXTERNAL_URL`, ou `APP_PUBLIC_ORIGIN` quando definido), com `403`, sem chamar a API;
   - monta a URL em `API_PROXY_TARGET`, um valor **fixo do servidor**. Cada segmento do caminho é recodificado, `.` e `..` são recusados, e a origem final é conferida: nada que o navegador mande troca o host;
   - envia à API só `accept`, `accept-language`, `content-type`, `cookie` e `user-agent`. `X-Forwarded-For`, `CF-Connecting-IP`, `Origin` e os `X-Agenda-*` vindos do navegador nunca passam;
   - acrescenta `X-Agenda-Proxy-Secret` (o segredo compartilhado) e, só quando a fonte do IP está confirmada (seção 5), `X-Agenda-Client-IP`;
   - chama a API uma única vez, sem cache (`no-store`), sem seguir redirecionamento, com limite de 90 segundos.
4. A requisição sai do serviço web pela internet pública até `https://<api>.onrender.com`, passa pela borda do Render e chega ao NestJS, que escuta em `HOST=0.0.0.0` e no `PORT` do Render.
5. A resposta volta ao navegador com o **mesmo status e o mesmo corpo**, todos os `Set-Cookie` intactos, `Retry-After`/`RateLimit-*` do rate limit, e `Cache-Control: no-store`. Cabeçalhos de CORS, `Location` e os demais da API ficam de fora. Se a API não responder, o proxy devolve `502`/`504` com `X-Agenda-Proxy-Error: upstream-unavailable`, e o cliente HTTP do navegador trata isso como falha de rede (a API está fora do ar), nunca como resposta da API.
6. Login e cadastro respondem com o cookie `session_token`: `HttpOnly`, `Secure` (porque a API roda com `NODE_ENV=production`), `SameSite=Lax`, `Path=/`, sem `Domain`. Como a resposta chega pelo proxy, o navegador grava o cookie **no host do frontend**, e o reenvia nas chamadas seguintes a `/agenda_api`. O JavaScript da página nunca lê esse cookie. O logout (`POST /auth/logout`) devolve o `Set-Cookie` de remoção pelo mesmo caminho.
7. A API consulta o Neon pela URL **pooled** (`DATABASE_URL`) com TLS e verificação de certificado (`ssl: { rejectUnauthorized: true }`). A aplicação recusa subir se a URL tiver `sslmode=disable`, `allow`, `no-verify`, `ssl=false`/`ssl=0` ou `uselibpqcompat`, porque o driver `pg` aplica esses parâmetros por cima do código. Use `sslmode=verify-full`.

Por que o proxy é necessário: `onrender.com` está na Public Suffix List, então `<web>.onrender.com` e `<api>.onrender.com` são **sites diferentes** para o navegador, e um cookie `SameSite=Lax` da API nunca seria enviado pelo `fetch` da página. Na mesma origem, o cookie é do próprio frontend. O build continua recusando `NEXT_PUBLIC_API_URL` direto em `*.onrender.com` (`src/lib/publicacao/api-url.ts`).

O CORS da API (`FRONTEND_URL`, origem exata e `credentials: true`) continua ligado: ele só importa para chamadas diretas de navegador à API, que este fluxo não faz. O proxy nunca repassa `Origin` à API.

O prefixo `/agenda_api` não colide com a página pública de um estabelecimento (`/[slug]`): o slug só tem letras minúsculas, dígitos e hífen (`backend/src/auth/slug.ts`), nunca sublinhado.

## 3. Configuração versionada

| Arquivo | O que define |
|---|---|
| `render.yaml` | Os dois web services: `rootDir`, branch `integration/nestjs-typeorm-frontend`, comandos, health check, uma instância, auto-deploy desligado e as variáveis (as secretas com `sync: false`; o segredo do proxy gerado pelo Render). |
| `package.json` e `backend/package.json` | `engines.node: ">=24 <25"`, a mesma versão maior do CI. O Render usa `engines` quando não há `NODE_VERSION`, `.node-version` nem `.nvmrc`. |
| `next.config.ts` + `src/lib/publicacao/api-url.ts` | Num build do Render (`RENDER=true`), o build falha se `NEXT_PUBLIC_API_URL` estiver ausente, ou se não for exatamente `/agenda_api` (com `API_PROXY_TARGET` HTTPS) nem uma origem HTTPS fora de `*.onrender.com`. |
| `src/lib/api/proxy-config.ts` | As variáveis de servidor do proxy, validadas a cada requisição. Configuração inválida responde `500` sem chamar a API. |
| `src/lib/api/proxy.ts` + `src/app/agenda_api/[...caminho]/route.ts` | O encaminhamento descrito na seção 2. |
| `backend/src/config/env.validation.ts` | A API recusa subir sem as variáveis obrigatórias, com URL de banco que desliga a verificação TLS, com `API_PROXY_SECRET` curto ou, em production, com `FRONTEND_URL` diferente de uma origem HTTPS exata. |
| `backend/src/config/client-ip.ts` | A fonte do IP usado no rate limit e na auditoria da sessão (seção 5). |
| `backend/scripts/run-check-pilot-database.ts` | A conferência só de leitura do banco do piloto (seção 6). |

Comandos de cada serviço:

| Serviço | Diretório | Build | Start | Health check |
|---|---|---|---|---|
| api | `backend/` | `npm ci --include=dev && npm run build` | `node dist/main.js` | `GET /` (responde 200 sem tocar no banco) |
| web | raiz | `npm ci --include=dev && npm run build` | `npm run start -- -H 0.0.0.0` (`next start`, que lê `PORT` do ambiente) | `GET /login` |

`--include=dev` é necessário porque o build usa ferramentas que estão em `devDependencies` (`@nestjs/cli`, TypeScript, Tailwind). Uma variável `NODE_ENV=production` definida no serviço também vale durante o build, e sem esse parâmetro o `npm ci` deixaria essas ferramentas de fora.

O build normal do backend (`nest build`) gera só `backend/dist/`. Ele **não** compila o runtime de migrations (`backend/dist-migrations/`, de `npm run build:migrations-runtime`), e nenhum comando do deploy aplica migration. O banco é inicializado à parte, na seção 6.

## 4. Variáveis por serviço

O Render disponibiliza as variáveis do serviço tanto no build quanto no runtime, salvo exceções que ele documenta (por exemplo, o `NODE_ENV=production` que ele mesmo define vale só no runtime). A coluna "Usada em" diz onde o **código** de fato lê a variável.

### Serviço api (`agenda-cloud-piloto-api`)

| Variável | Usada em | Valor | Origem |
|---|---|---|---|
| `NODE_ENV` | runtime | `production` | `render.yaml`. Liga o cookie `Secure` e a exigência de `FRONTEND_URL` HTTPS. |
| `PORT` | runtime | definido pelo Render (padrão `10000`) | plataforma; não definir à mão |
| `HOST` | runtime | `0.0.0.0` | `render.yaml`. O Render exige escuta em `0.0.0.0`. |
| `DATABASE_URL` | runtime | URL **pooled** do Neon do piloto, com `sslmode=verify-full` | **secreto**, digitado no painel (`sync: false`) |
| `DIRECT_URL` | validação na inicialização | URL **direta** do mesmo banco do piloto, com `sslmode=verify-full` | **secreto**, digitado no painel. A aplicação não a usa para consultas, mas exige o valor. |
| `FRONTEND_URL` | runtime (CORS) | `https://<web>.onrender.com` (origem exata, sem barra final) | digitado no painel (`sync: false`) |
| `API_PROXY_SECRET` | runtime | gerado pelo Render | `render.yaml` (`generateValue: true`). Ninguém digita, copia ou vê o valor. |
| `CLIENT_IP_SOURCE` | runtime | `socket` | `render.yaml`. Vale só para chamadas que **não** vêm do proxy. Ver seção 5. |

### Serviço web (`agenda-cloud-piloto-web`)

| Variável | Usada em | Valor | Origem |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | **build** (embutida no JavaScript) | `/agenda_api` | `render.yaml`. Mudar o valor exige um novo deploy com build, nunca só um restart. |
| `API_PROXY_TARGET` | runtime (e conferida no build) | `https://<api>.onrender.com` (origem exata) | digitado no painel (`sync: false`). Só o servidor lê; o navegador nunca vê. |
| `API_PROXY_SECRET` | runtime | o mesmo valor da api | `render.yaml` (`fromService`, copiado da api). |
| `CLIENT_IP_SOURCE` | runtime | `socket` | `render.yaml`. **Pendente**, ver seção 5. |
| `RENDER_EXTERNAL_URL` | runtime | `https://<web>.onrender.com` | plataforma. É a origem exigida no `Origin` das escritas. |
| `APP_PUBLIC_ORIGIN` | runtime | não definir agora | Só com domínio próprio (seção 7). Tem precedência sobre `RENDER_EXTERNAL_URL`. |
| `RENDER` | build e runtime | `true` | plataforma; liga a guarda de build e torna HTTPS e `API_PROXY_SECRET` obrigatórios no proxy |
| `PORT` | runtime | definido pelo Render | plataforma |

O serviço web nunca recebe `DATABASE_URL`, `DIRECT_URL` nem segredo de banco.

`sync: false` só faz o Render pedir o valor na **criação** do Blueprint. Depois disso, valores novos ou trocados são editados no painel de cada serviço, em **Environment**.

`<web>` e `<api>` normalmente são os próprios nomes dos serviços. Se o Render acrescentar um sufixo (nome já usado na plataforma), use o endereço que aparece no painel de cada serviço.

## 5. IP do cliente, rate limit e o salto pelo Next.js

`POST /auth/login` e `POST /auth/register` têm limite de 5 tentativas a cada 15 minutos **por IP**. O limite só protege se o IP for o do cliente de verdade e não puder ser escolhido por quem chama.

Com o proxy, há dois saltos: navegador → borda → **web** → internet → borda → **api**. Para a API, toda requisição do proxy vem do serviço web. Se ela usasse o endereço da conexão, todos os usuários dividiriam o mesmo limite.

### Como a API reconhece o proxy confiável

- O Express continua com `trust proxy` **desligado**. `X-Forwarded-For` nunca é lido, em nenhum modo e em nenhum dos dois serviços.
- O proxy envia `X-Agenda-Proxy-Secret` com o valor de `API_PROXY_SECRET`. A API compara esse valor em tempo constante com o seu `API_PROXY_SECRET`. Só quando confere, ela lê `X-Agenda-Client-IP`, e só se for **um** endereço IP válido.
- Sem o segredo, com segredo errado ou com o cabeçalho de IP ausente/malformado, a API ignora `X-Agenda-Client-IP` e usa a fonte de `CLIENT_IP_SOURCE`, como antes. Uma chamada direta à API com `X-Agenda-Client-IP` forjado cai, portanto, num limite que o chamador não escolhe.
- O segredo é gerado pelo Render (`generateValue: true`) no serviço api e copiado para o web (`fromService`). Ele só existe nas variáveis dos dois serviços. O proxy nunca o devolve ao navegador, e a validação de ambiente nunca o ecoa em mensagem de erro.
- O proxy nunca repassa `X-Agenda-*` vindo do navegador: ele monta os próprios.

### De onde o proxy tira o IP do cliente

- Um Route Handler do Next.js não expõe o endereço da conexão, e o `X-Forwarded-For` que o Next.js preenche só quando está **ausente** pode chegar pronto do navegador. Por isso o proxy nunca usa `X-Forwarded-For`.
- `CLIENT_IP_SOURCE=socket` (valor atual no web): o proxy **não repassa IP nenhum**. A API cai na própria fonte (`socket`), e todos os usuários do proxy dividem um limite só.
- `CLIENT_IP_SOURCE=cf-connecting-ip` no web: o proxy repassa `CF-Connecting-IP`, o cabeçalho que a borda do Render escreve na requisição que chega ao serviço web, só se for **um** IP válido. Cada cliente passa a ter o próprio limite na API.

### O que foi verificado e o que falta

- Um artigo do Render ([Host PocketBase on Render](https://render.com/articles/host-pocketbase-on-render), julho de 2026) afirma que o tráfego público chega ao serviço pela Cloudflare e pelo balanceador do Render, que a Cloudflare grava `CF-Connecting-IP` em toda requisição e **sobrescreve** o valor do cliente, e que ela **acrescenta** ao `X-Forwarded-For`.
- Essa garantia não aparece na documentação de referência (`render.com/docs`). Por isso ela não foi ligada por suposição, nem na API nem no web.

**Consequência para o piloto:** com `socket` no web, todos os clientes dividem o mesmo limite na API: seriam 5 logins **no total** a cada 15 minutos, contando todo mundo. Isso bloqueia a abertura do piloto até a troca do web para `cf-connecting-ip`.

**Dado exato que falta, a pedir por escrito ao suporte do Render** (ou a localizar na documentação de referência):

1. Para um web service, inclusive no endereço `*.onrender.com` e no plano gratuito, toda requisição pública passa pela borda Cloudflare do Render, e ela **sobrescreve** `CF-Connecting-IP` com o IP do cliente?
2. Existe algum caminho público até o serviço que não passe por essa borda?
3. Se um domínio próprio for adicionado depois, a garantia continua com o DNS atrás da Cloudflare **do cliente** (registro "Proxied")? Até a resposta, manter o DNS como **DNS only**.

Com a confirmação em mãos:

1. Troque `CLIENT_IP_SOURCE` para `cf-connecting-ip` **no serviço web** (`render.yaml`), num commit revisado, com a referência da resposta do Render no texto do commit. A API pode continuar em `socket`: o tráfego legítimo chega pelo proxy, com o IP no cabeçalho autenticado.
2. Publique esse commit.
3. Rode o teste da seção 7, passo 8.

### Teste local equivalente

`npm run test:browser:proxy` (seção 9) reproduz os dois saltos em HTTPS isolado: uma borda local (`tests/browser/support/borda-https.mjs`) sobrescreve `CF-Connecting-IP` como a do Render, o Next.js roda com `CLIENT_IP_SOURCE=cf-connecting-ip` e a API com `API_PROXY_SECRET`. O teste prova que cabeçalhos forjados não escapam do limite e que clientes de endereços diferentes têm limites diferentes. Ele **não** prova o comportamento da borda real do Render.

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
2. **Decisões da seção 1** aplicadas num commit revisado: `region` e `plan` em `render.yaml`, depois de conferir o plano e o consumo do workspace.
3. **Banco do piloto inicializado** (seção 6).
4. **Conferir o workspace** (seção 1, "Mesma conta, outro sistema"): nenhum serviço com os nomes `agenda-cloud-piloto-*`.
5. **Criar o Blueprint** no painel do Render (**New → Blueprint**), apontando para este repositório e a branch `integration/nestjs-typeorm-frontend`, com um nome próprio do Agenda Cloud.
   - Na revisão, confirme que só os dois serviços `agenda-cloud-piloto-*` serão criados.
   - O Render pede os valores `sync: false`:
     - `DATABASE_URL` e `DIRECT_URL` do piloto;
     - `FRONTEND_URL=https://agenda-cloud-piloto-web.onrender.com`;
     - `API_PROXY_TARGET=https://agenda-cloud-piloto-api.onrender.com`.

     Esses são os endereços esperados. Se o Render der outro endereço a algum serviço (sufixo no nome), corrija as duas variáveis em **Environment** com o endereço exibido no painel e faça um novo deploy dos dois serviços: `API_PROXY_TARGET` é conferido também no build do web.
   - `API_PROXY_SECRET` não é pedido: o Render gera e copia sozinho.

   A criação dispara o primeiro deploy. Depois dela, deploys só acontecem manualmente.
6. **Publicar o commit exato:** em cada serviço, **Manual Deploy → Deploy a specific commit → `<sha>`**. Publique a api primeiro e o web depois.
7. **Endereço gratuito:** o endereço público de cada serviço aparece no topo da página dele no painel. O do piloto, para o navegador, é só o do serviço **web**.
8. **Verificações em HTTPS** (com `WEB=https://<web>.onrender.com` e `API=https://<api>.onrender.com` no terminal). A primeira chamada depois de um período parado pode levar perto de um minuto no plano gratuito.
   - Saúde:
     - `curl -sS -o /dev/null -w "%{http_code}\n" "$API/"` deve dar `200`;
     - `curl -sS -o /dev/null -w "%{http_code}\n" "$WEB/login"` deve dar `200`;
     - `curl -sS -o /dev/null -w "%{http_code}\n" "$WEB/agenda_api/auth/me"` deve dar `401` (proxy configurado, API alcançada, sem sessão). `500` indica variável do proxy inválida; `502`/`504`, API inalcançável;
     - os dois serviços aparecem como **Live** no painel.
   - Origem nas escritas:
     - `curl -si -X POST "$WEB/agenda_api/auth/logout" -H "Origin: https://exemplo.invalid"` deve responder `403`, sem `Set-Cookie`;
     - sem `-H "Origin: ..."`, também `403`.
   - Login, sessão, operação autenticada e logout no navegador:
     1. Crie a conta em `$WEB/cadastro`. Não existe exclusão de conta: use a conta real do primeiro estabelecimento ou uma conta de teste claramente identificada.
     2. Em DevTools → Network, confirme que as chamadas vão para `$WEB/agenda_api/...` e **nenhuma** para `$API`.
     3. Em DevTools → Application → Cookies, confira em `$WEB` o cookie `session_token` com `HttpOnly`, `Secure`, `SameSite=Lax` e sem `Domain`. Em `$API` não deve haver cookie.
     4. Recarregue `/conta`: a sessão continua.
     5. Crie um serviço em `/conta/servicos` e recarregue: ele continua listado.
     6. Clique em **Sair**: `/conta` volta a pedir login e o cookie some.
     7. Entre de novo pelo `/login`.
   - Rate limit, só depois da seção 5:
     1. Da mesma máquina, faça 6 tentativas de login com um e-mail inexistente, cada uma com cabeçalhos forjados diferentes: `curl -s -o /dev/null -w "%{http_code}\n" -X POST "$WEB/agenda_api/auth/login" -H "Origin: $WEB" -H "Content-Type: application/json" -H "CF-Connecting-IP: 203.0.113.<n>" -H "X-Forwarded-For: 198.51.100.<n>" -H "X-Agenda-Client-IP: 192.0.2.<n>" -H "X-Agenda-Proxy-Secret: forjado" -d '{"email":"teste-limite@exemplo.invalid","password":"senha-errada-123"}'`.
     2. A sexta precisa responder `429`. Se não responder, os cabeçalhos do cliente estão sendo aceitos: volte `CLIENT_IP_SOURCE` do web para `socket` e trate como incidente.
     3. Na sequência, de outra rede (por exemplo, o celular fora do Wi-Fi), o login precisa funcionar, provando que os clientes não dividem o mesmo limite.
     4. Repita o passo 1 direto em `$API/auth/login` (sem `Origin`): a sexta também precisa responder `429`.

### Domínio próprio depois

Sem mudar código: adicione o domínio ao serviço **web** (só a ele; a API continua no endereço gratuito, atrás do proxy), defina `APP_PUBLIC_ORIGIN=https://<dominio>` no web e `FRONTEND_URL=https://<dominio>` na api, e faça um novo deploy dos dois. Mantenha o DNS como **DNS only** até a resposta da seção 5, pergunta 3. Os cookies emitidos no endereço `onrender.com` não valem no domínio novo: cada usuário entra de novo uma vez.

## 8. Retorno ao commit anterior

- **Deploy falhou antes de ficar Live:** o Render cancela sozinho quando o build falha ou o health check não passa. O deploy anterior continua no ar e não há nada a fazer além de investigar.
- **Ficou Live com defeito:** em cada serviço afetado, vá em **Deploys**, escolha o último deploy bom e clique em **Rollback**.
  - O rollback reutiliza o artefato daquele deploy, com as variáveis de ambiente e o comando de start da época.
  - Pelo painel, ele também desliga o auto-deploy, que já está desligado aqui.
  - O frontend volta com o `NEXT_PUBLIC_API_URL` embutido naquele build.
- **Primeiro deploy, sem anterior:** suspenda o serviço (**Suspend**) até corrigir.
- **Banco:** rollback do Render **não** desfaz migration. Para este primeiro deploy, o banco foi inicializado à parte (seção 6) e o código não aplica migration no deploy. Publicações futuras que tragam migration precisam de um roteiro próprio, com backup (branch do Neon) antes de escrever.
- Depois de qualquer rollback, refaça as verificações da seção 7, passo 8.

## 9. Evidência: o que já foi verificado e o que depende da publicação

### Verificado sem nenhum recurso externo

No repositório (testes unitários, `npm run test` na raiz e em `backend/`):

- validação de ambiente da API: recusa de URL sem verificação TLS, de `FRONTEND_URL` não-HTTPS em production, de `HOST` que não é IP, de `CLIENT_IP_SOURCE` desconhecido e de `API_PROXY_SECRET` curto, sem ecoar o valor;
- IP do cliente na API (`client-ip.spec.ts`, `client-ip-rate-limit.spec.ts`, `auth.module.spec.ts`): `X-Agenda-Client-IP` só com o segredo certo; segredo errado, repetido ou ausente ignorado; `X-Forwarded-For` nunca lido; rate limit por HTTP real (supertest) com cabeçalhos forjados nos três modos;
- proxy (`src/lib/api/proxy.test.ts`, contra um servidor HTTP real local no papel da API): destino fixo, caminho recodificado e sem `..`, lista fechada de cabeçalhos, `Origin` exigido nas escritas, status e corpo repassados (200, 204, 4xx, 429, 5xx), vários `Set-Cookie` intactos (inclusive o de remoção no logout), `no-store`, nenhuma nova tentativa, `502`/`504` marcados, corpo acima de 1 MiB recusado;
- configuração do proxy (`proxy-config.test.ts`), guarda de build (`api-url.test.ts`), cliente HTTP (`http-client.test.ts`) e invariantes de `render.yaml` (`render-blueprint.test.ts`, inclusive nomes próprios e nenhum recurso compartilhado com outro sistema);
- conferência do banco do piloto: lógica com cliente falso (só leitura, sem vazar URL, host ou Endpoint ID), mais o script compilado recusando destino errado sem abrir conexão.

No CI (`.github/workflows/test-frontend-auth.yml`, PostgreSQL descartável com TLS):

- os fluxos de navegador existentes, com chamada direta à API (modo de desenvolvimento);
- `npm run test:browser:proxy` (`playwright.proxy.config.ts`): frontend compilado com `NEXT_PUBLIC_API_URL=/agenda_api`, borda HTTPS local com certificado autoassinado gerado na hora, API em `NODE_ENV=production`. Prova cadastro, login pela tela, restauração de sessão, criação de serviço, erro da API repassado e logout **só pelo proxy** (nenhuma requisição do navegador à porta da API); o cookie `session_token` com `HttpOnly`, `Secure`, `SameSite=Lax`, sem `Domain`, na origem do frontend, e removido no logout; `403` para escrita de outra origem; cabeçalhos de IP forjados (`CF-Connecting-IP`, `X-Forwarded-For`, `X-Real-IP`, `X-Agenda-*`) sem escapar do limite; clientes de endereços diferentes com limites diferentes; chamada direta à API com `X-Agenda-Client-IP` forjado sem escapar do limite.

### Só verificável com o ambiente publicado

- escuta em `0.0.0.0:$PORT` aceita pelo Render, e health checks verdes;
- certificado público e endereço `*.onrender.com` de cada serviço;
- o proxy alcançando a API pelo endereço público, inclusive saindo da hibernação do plano gratuito dentro de 90 segundos;
- cookie `Secure`/`HttpOnly`/`SameSite=Lax` emitido atrás da borda real, e o ciclo login → sessão → logout;
- comportamento de `CF-Connecting-IP` na borda do Render (seção 5);
- conexão ao Neon do piloto com `sslmode=verify-full`;
- consumo da franquia gratuita do workspace;
- rollback pelo painel.
