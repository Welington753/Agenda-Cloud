# Runbook — Publicação do piloto no Render

Este roteiro cobre a primeira publicação do piloto do Agenda Cloud: frontend Next.js e API NestJS como dois web services **gratuitos** no Render, região `virginia`, nos **endereços gratuitos `*.onrender.com`** (sem domínio próprio), um banco Neon **exclusivo do piloto**, no plano gratuito, e publicação **manual** de um commit validado.

**Este documento nunca contém, e nunca deve passar a conter, credencial, URL de banco, Endpoint ID ou endereço real.** Onde aparece `<web>`, `<api>`, `<sha>` ou `<endpoint-...>`, o valor real é digitado por quem opera, no painel ou no terminal, nunca aqui e nunca numa conversa com o Claude.

Nada deste roteiro foi executado ainda. A ordem completa está na seção 7. A seção 9 separa o que já foi verificado no repositório do que só pode ser verificado com os serviços publicados.

## 1. Decisões tomadas

| Decisão | Valor | Onde entra |
|---|---|---|
| Plano do Render | `free` nos dois serviços | `plan` em `render.yaml` |
| Região do Render | `virginia` nos dois serviços | `region` em `render.yaml`. O Render não muda a região de um serviço depois de criado. |
| Banco | projeto Neon **novo e exclusivo** do piloto, plano gratuito, região AWS **US East 1 (N. Virginia)**, a mais próxima de `virginia` | painel do Neon (seção 6) |
| Fonte do IP do cliente | `cf-connecting-ip` nos dois serviços | `CLIENT_IP_SOURCE` em `render.yaml`. Base documental e teste pendente na seção 5. |
| Endereços | `https://<web>.onrender.com` e `https://<api>.onrender.com`, com o proxy `/agenda_api` | seção 2 |

Mantidos de propósito: uma instância por serviço (`numInstances: 1`, exigido pelo rate limit em memória), publicação automática desligada (`autoDeployTrigger: "off"`), proxy pela internet pública em HTTPS, segredo compartilhado gerado pelo Render e nenhuma migration no deploy. O teste `src/lib/publicacao/render-blueprint.test.ts` confere todos esses pontos no texto de `render.yaml`.

### Workspace do Render

O workspace estava compartilhado com outro sistema (Central Performance), cujos serviços e Blueprint foram removidos. **Nada desse sistema é recriado por este roteiro.** O Blueprint do Agenda Cloud continua sem declarar banco do Render, grupo de variáveis (`envVarGroups`) ou referência a serviço fora dele.

Antes de criar o Blueprint (seção 7, passo 4):

1. Confira na lista de serviços do workspace que **não existe** serviço chamado `agenda-cloud-piloto-api` nem `agenda-cloud-piloto-web`. Se existir, pare: o Render pode associar o Blueprint a um serviço existente com o mesmo nome.
2. Na tela de revisão do Blueprint, confirme que a lista mostra **só** a criação desses dois serviços.

### Plano gratuito: o que o desenho já considera

- **Franquia mensal do workspace.** As horas de instância gratuitas são somadas entre todos os serviços gratuitos do workspace. Esgotada a franquia, o Render suspende os serviços gratuitos até o mês seguinte. Dois serviços acordados 24 horas por dia durante um mês inteiro consomem perto de 1.460 horas: confira o valor atual da franquia na documentação do Render e o consumo em **Billing** no painel. **Não** configure "ping" externo para manter os serviços acordados.
- **Hiberna sem tráfego** e leva perto de um minuto para voltar. O proxy espera até 90 segundos antes de responder `504` (`src/lib/api/proxy.ts`). Os dois serviços hibernam de forma independente.
- **Abrir o sistema depois da hibernação não exige deploy nem painel.** São duas fronteiras:
  - *Frontend dormindo:* antes do nosso HTML e JavaScript chegarem, quem responde é o Render (a documentação dele diz que mostra uma página de carregamento ao navegador enquanto o serviço sobe). Nenhum código nosso roda nesse momento, então nada aqui controla essa espera. O service worker (`public/sw.js`) continua só com Web Push: ele não guarda páginas nem respostas.
  - *Frontend no ar, API dormindo:* a primeira LEITURA da página (`/auth/me` na conta, no login e no cadastro; a página e os horários no link público) é o acesso que acorda a API. `src/lib/api/leitura-com-recuperacao.ts` repete só essa leitura enquanto a hospedagem responde no lugar da API (502/503/504 sem JSON ou página HTML, ver `src/lib/api/http-client.ts`): uma requisição por vez, 30 s no máximo cada, espera de 2, 4, 8 e depois 15 s, prazo total de 100 s contando o tempo das requisições. A tela mostra "Conectando ao servidor…"; esgotado o prazo, mostra o motivo e "Tentar novamente". Sem internet, nada é enviado até o navegador avisar que a conexão voltou. 401, 403, 429 e erro em JSON da própria API nunca são repetidos. Login, cadastro, pedido público e qualquer outra escrita nunca são reenviados sozinhos; login e cadastro só são enviados depois de a leitura alcançar a API.
  - *Aplicativo instalado (iPhone) voltando do segundo plano:* depois de 10 min oculto (ou ao voltar da memória do Safari), a sessão é conferida uma vez, com a mesma recuperação, sem trocar a tela: só aparece uma faixa, e o que foi digitado continua.
  - *Suspensão por franquia esgotada* não é distinguível de "acordando" pelo navegador: depois do prazo a tela diz que o servidor não respondeu e que pode estar fora do ar. Confira em **Billing** no painel.
- **Não recebe tráfego da rede privada.** Por isso o proxy chama a API pelo endereço público HTTPS (`API_PROXY_TARGET`), e a API exige o segredo do proxy (seção 5).
- **Uma instância**, que é o que o rate limit em memória exige. O contador do limite zera a cada deploy, restart ou hibernação.

Não use números deste documento como referência de preço ou franquia: confira na documentação atual do Render e do Neon.

Domínio próprio pode ser adicionado depois sem mudar código (seção 7, "Domínio próprio depois").

## 2. Fluxo navegador → frontend → API → banco

O navegador fala com **uma origem só**, a do serviço web. A API também tem endereço público, mas a página nunca a chama diretamente.

1. O navegador abre `https://<web>.onrender.com`. O TLS termina na borda do Render (Cloudflare), que encaminha em HTTP ao `next start` do serviço **web**, escutando em `0.0.0.0:$PORT`. O frontend publicado não tem acesso a banco nenhum: não recebe `DATABASE_URL` nem `DIRECT_URL`.
2. O JavaScript da página chama `/agenda_api/<caminho>` na **mesma origem** (`NEXT_PUBLIC_API_URL=/agenda_api`, embutido no build; ver `src/lib/api/http-client.ts`).
3. O Route Handler `src/app/agenda_api/[...caminho]/route.ts` (lógica em `src/lib/api/proxy.ts`):
   - recusa escrita (`POST`, `PUT`, `PATCH`, `DELETE`) cujo `Origin` não seja exatamente a origem pública do frontend (`RENDER_EXTERNAL_URL`, ou `APP_PUBLIC_ORIGIN` quando definido), com `403`, sem chamar a API;
   - monta a URL em `API_PROXY_TARGET`, um valor **fixo do servidor**. Cada segmento do caminho é recodificado, `.` e `..` são recusados, e a origem final é conferida: nada que o navegador mande troca o host;
   - envia à API só `accept`, `accept-language`, `content-type`, `cookie` e `user-agent`. `X-Forwarded-For`, `CF-Connecting-IP`, `Origin` e os `X-Agenda-*` vindos do navegador nunca passam;
   - acrescenta `X-Agenda-Proxy-Secret` (o segredo compartilhado) e `X-Agenda-Client-IP`, com o `CF-Connecting-IP` que a borda escreveu na requisição do navegador (seção 5);
   - chama a API uma única vez, sem cache (`no-store`), sem seguir redirecionamento, com limite de 90 segundos.
4. A requisição sai do serviço web pela internet pública até `https://<api>.onrender.com`, passa pela borda do Render e chega ao NestJS, que escuta em `HOST=0.0.0.0` e no `PORT` do Render.
5. A resposta volta ao navegador com o **mesmo status e o mesmo corpo**, todos os `Set-Cookie` intactos, `Retry-After`/`RateLimit-*` do rate limit, e `Cache-Control: no-store`. Cabeçalhos de CORS, `Location` e os demais da API ficam de fora. Se a API não responder, o proxy devolve `502`/`504` com `X-Agenda-Proxy-Error: upstream-unavailable`, e o cliente HTTP do navegador trata isso como falha de rede (a API está fora do ar), nunca como resposta da API.
6. Login e cadastro respondem com o cookie `session_token`: `HttpOnly`, `Secure` (porque a API roda com `NODE_ENV=production`), `SameSite=Lax`, `Path=/`, sem `Domain`. Como a resposta chega pelo proxy, o navegador grava o cookie **no host do frontend**, e o reenvia nas chamadas seguintes a `/agenda_api`. O JavaScript da página nunca lê esse cookie. O logout (`POST /auth/logout`) devolve o `Set-Cookie` de remoção pelo mesmo caminho.
7. A API consulta o Neon pela URL **pooled** (`DATABASE_URL`) com TLS e verificação de certificado (`ssl: { rejectUnauthorized: true }`). A aplicação recusa subir se a URL tiver `sslmode=disable`, `allow`, `no-verify`, `ssl=false`/`ssl=0` ou `uselibpqcompat`, porque o driver `pg` aplica esses parâmetros por cima do código. Use `sslmode=verify-full` (seção 6, passo A6).

Por que o proxy é necessário: `onrender.com` está na Public Suffix List, então `<web>.onrender.com` e `<api>.onrender.com` são **sites diferentes** para o navegador, e um cookie `SameSite=Lax` da API nunca seria enviado pelo `fetch` da página. Na mesma origem, o cookie é do próprio frontend. O build continua recusando `NEXT_PUBLIC_API_URL` direto em `*.onrender.com` (`src/lib/publicacao/api-url.ts`).

O CORS da API (`FRONTEND_URL`, origem exata e `credentials: true`) continua ligado: ele só importa para chamadas diretas de navegador à API, que este fluxo não faz. O proxy nunca repassa `Origin` à API.

O prefixo `/agenda_api` não colide com a página pública de um estabelecimento (`/[slug]`): o slug só tem letras minúsculas, dígitos e hífen (`backend/src/auth/slug.ts`), nunca sublinhado.

## 3. Configuração versionada

| Arquivo | O que define |
|---|---|
| `render.yaml` | Os dois web services: plano `free`, região `virginia`, `rootDir`, branch `integration/nestjs-typeorm-frontend`, comandos, health check, uma instância, auto-deploy desligado e as variáveis (as secretas com `sync: false`; o segredo do proxy gerado pelo Render). |
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
| `CLIENT_IP_SOURCE` | runtime | `cf-connecting-ip` | `render.yaml`. Vale só para chamadas **sem** o segredo do proxy. Ver seção 5. |
| `WEB_PUSH_VAPID_PUBLIC_KEY` | runtime | chave pública VAPID (base64url) | gerada uma vez (seção 6, parte D) e digitada no painel (`sync: false`). Não é segredo, mas precisa formar par com a privada. |
| `WEB_PUSH_VAPID_PRIVATE_KEY` | runtime | chave privada VAPID (base64url) | **secreta**, digitada só no painel da api (`sync: false`). Nunca no web, no repositório ou em log. Precisa ser a mesma entre deploys. |
| `WEB_PUSH_SUBJECT` | runtime | `mailto:<e-mail de contato>` | digitado no painel (`sync: false`). Os serviços de push usam para contato em caso de abuso. |

As três `WEB_PUSH_*` vão juntas ou nenhuma: sem elas, a API sobe com o push **desligado** (a tela diz que o servidor não envia notificações). Com uma faltando ou com o par trocado, a API **não sobe** e o log diz só o nome da variável.

### Serviço web (`agenda-cloud-piloto-web`)

| Variável | Usada em | Valor | Origem |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | **build** (embutida no JavaScript) | `/agenda_api` | `render.yaml`. Mudar o valor exige um novo deploy com build, nunca só um restart. |
| `API_PROXY_TARGET` | runtime (e conferida no build) | `https://<api>.onrender.com` (origem exata) | digitado no painel (`sync: false`). Só o servidor lê; o navegador nunca vê. |
| `API_PROXY_SECRET` | runtime | o mesmo valor da api | `render.yaml` (`fromService`, copiado da api). |
| `CLIENT_IP_SOURCE` | runtime | `cf-connecting-ip` | `render.yaml`. De onde o proxy tira o IP que repassa à API. Ver seção 5. |
| `RENDER_EXTERNAL_URL` | runtime | `https://<web>.onrender.com` | plataforma. É a origem exigida no `Origin` das escritas. |
| `APP_PUBLIC_ORIGIN` | runtime | não definir agora | Só com domínio próprio (seção 7). Tem precedência sobre `RENDER_EXTERNAL_URL`. |
| `RENDER` | build e runtime | `true` | plataforma; liga a guarda de build e torna HTTPS e `API_PROXY_SECRET` obrigatórios no proxy |
| `PORT` | runtime | definido pelo Render | plataforma |

O serviço web nunca recebe `DATABASE_URL`, `DIRECT_URL` nem segredo de banco.

`sync: false` só faz o Render pedir o valor na **criação** do Blueprint. Depois disso, valores novos ou trocados são editados no painel de cada serviço, em **Environment**.

`<web>` e `<api>` normalmente são os próprios nomes dos serviços. Se o Render acrescentar um sufixo (nome já usado na plataforma), use o endereço que aparece no painel de cada serviço.

## 5. IP do cliente, rate limit e o salto pelo Next.js

`POST /auth/login` e `POST /auth/register` têm limite de 5 tentativas a cada 15 minutos **por IP**. O limite só protege se o IP for o do cliente de verdade e não puder ser escolhido por quem chama. Todas as tentativas contam, inclusive as bem-sucedidas.

Com o proxy, há dois saltos: navegador → borda → **web** → internet → borda → **api**. Para a API, toda requisição do proxy vem do serviço web. Se ela usasse o endereço da conexão, todos os usuários dividiriam o mesmo limite.

### O que o Render documenta

Fonte: artigo do próprio Render, [Host PocketBase on Render](https://render.com/articles/host-pocketbase-on-render), de 8 de julho de 2026. Trechos:

- "Cloudflare writes that header on every request that reaches a Render web service", e o valor é "both accurate and outside the caller's control" (o cabeçalho é `CF-Connecting-IP`);
- "Cloudflare appends to `X-Forwarded-For` rather than replacing it, so a caller who sends their own copy of the header controls the leftmost entry";
- requisições a um **private service** chegam pela rede privada "and never pass through Cloudflare".

Limites desta fonte: é um artigo-guia (`render.com/articles`), não a referência da plataforma (`render.com/docs`), e não fala explicitamente de plano gratuito nem de endereço `*.onrender.com`. Ele fala de **todo** web service, sem exceção, o que inclui os dois serviços do piloto. Por isso a configuração foi ligada com base nele, e o comportamento real é conferido no ambiente publicado, antes de abrir o piloto (seção 7, passo 9).

### Aplicação à topologia do piloto

| Salto | Quem escreve `CF-Connecting-IP` | O que o código usa |
|---|---|---|
| navegador → borda → **web** | a borda do Render, com o IP do navegador | o proxy lê esse valor (`CLIENT_IP_SOURCE=cf-connecting-ip` no web) e o envia em `X-Agenda-Client-IP`, junto com o segredo |
| web → internet → borda → **api** | a borda, com o IP de saída do serviço web | ignorado: com o segredo certo, a API usa `X-Agenda-Client-IP` |
| chamada direta → borda → **api** | a borda, com o IP de quem chamou | sem o segredo, a API usa `CF-Connecting-IP` (`CLIENT_IP_SOURCE=cf-connecting-ip` na api) |

Nenhum dos dois serviços é private service, e o plano gratuito não recebe tráfego da rede privada: todo caminho até eles passa pela borda.

### Como a API reconhece o proxy confiável

- O Express continua com `trust proxy` **desligado**. `X-Forwarded-For` nunca é lido, em nenhum modo e em nenhum dos dois serviços.
- O proxy envia `X-Agenda-Proxy-Secret` com o valor de `API_PROXY_SECRET`. A API compara esse valor em tempo constante com o seu `API_PROXY_SECRET`. Só quando confere, ela lê `X-Agenda-Client-IP`, e só se for **um** endereço IP válido.
- Sem o segredo, com segredo errado ou com o cabeçalho de IP ausente/malformado, a API ignora `X-Agenda-Client-IP` e usa `CF-Connecting-IP`, também só se for um IP válido. Se nem esse servir, usa o endereço da conexão, que quem chama não escolhe.
- O segredo é gerado pelo Render (`generateValue: true`) no serviço api e copiado para o web (`fromService`). Ele só existe nas variáveis dos dois serviços. O proxy nunca o devolve ao navegador, e a validação de ambiente nunca o ecoa em mensagem de erro.
- O proxy nunca repassa `X-Agenda-*` nem `CF-Connecting-IP` vindos do navegador: ele monta os próprios.

Toda falha cai num limite **mais** restritivo, nunca num mais frouxo: se `CF-Connecting-IP` faltar no web, o proxy não repassa IP nenhum e os usuários passam a dividir um limite (o piloto fica difícil de usar, mas não fica aberto).

### O que só o ambiente publicado prova

O teste local (abaixo) reproduz a borda, mas não é a borda do Render. A seção 7, passo 9, confere no ambiente real:

1. cabeçalhos de IP forjados pelo cliente **não** escapam do limite, pelo proxy e direto na API;
2. dois clientes em redes diferentes **não** dividem o mesmo limite (prova que o `CF-Connecting-IP` chega ao web e é repassado).

### Quando acionar o suporte do Render

Hoje não há lacuna concreta: a fonte do provedor cobre a topologia, e o resto é teste. Acionar o suporte só se:

- o passo 9 falhar (forjado escapa do limite, ou o segundo cliente recebe `429`). Nesse caso, volte `CLIENT_IP_SOURCE` para `socket` nos dois serviços (seção 8) e envie ao suporte a sequência de status e os horários, **sem** segredo nem cookie;
- quiserem um domínio próprio com DNS **atrás da Cloudflare do cliente** (registro "Proxied"), uma topologia que a fonte não cobre. Até lá, domínio próprio só como **DNS only**.

### Teste local equivalente

`npm run test:browser:proxy` (seção 9) reproduz os saltos em HTTPS isolado: uma borda local (`tests/browser/support/borda-https.mjs`) na frente de cada serviço sobrescreve `CF-Connecting-IP` como a do Render, e os dois serviços rodam com `CLIENT_IP_SOURCE=cf-connecting-ip`, o valor de `render.yaml`. O teste prova que cabeçalhos forjados não escapam do limite, pelo proxy e direto na API, e que clientes de endereços diferentes têm limites diferentes. Ele **não** prova o comportamento da borda real do Render.

## 6. Criar e inicializar o banco do piloto (Neon)

O banco do piloto é um **projeto Neon novo**, só dele. Nunca reutilize o projeto do production existente, nem `agenda_dev`, nem branch de nenhum dos dois.

### A. Criar o projeto no painel do Neon

1. Entre em `console.neon.tech`. Em **Billing** da organização, confira que o plano é **Free**. Se a organização em uso for paga (por exemplo, a do production), crie uma organização nova no plano Free para o piloto: um projeto numa organização paga é cobrado pelo plano dela.
2. **New project**, com:
   - nome: `agenda-cloud-piloto`;
   - versão do Postgres: a mesma versão maior do production (confira no projeto do production; o CI testa com 17);
   - provedor e região: **AWS**, **US East 1 (N. Virginia)**;
   - Neon Auth e outros extras: desligados.
   O Neon cria um branch padrão (em projetos novos ele se chama `production`: é o branch **deste projeto do piloto**, não o production do Agenda Cloud), um banco (`neondb`, ou o nome escolhido no formulário) e um papel dono.
3. No painel do projeto, clique em **Connect**. Escolha o branch padrão, o banco e o papel. Anote, só num gerenciador de senhas, **nunca** no repositório, num `.env`, num chat ou em issue:
   - com **Connection pooling ligado**: a URL **pooled** (o host tem `-pooler`). Ela vai para `DATABASE_URL`;
   - com **Connection pooling desligado**: a URL **direta** (host sem `-pooler`). Ela vai para `DIRECT_URL` e `PILOT_DIRECT_URL`.
4. Anote também o **Endpoint ID do piloto**: o primeiro trecho do host da URL direta, começando em `ep-` (sem `-pooler`).
5. Anote o **Endpoint ID do production** existente, no projeto do production (**Branches** → branch principal → **Computes**). Ele só serve para a conferência provar que o destino é outro.
6. Nas duas URLs, troque tudo o que vem depois do `?` por exatamente `sslmode=verify-full`. O Neon sugere `sslmode=require&channel_binding=require`, mas o driver `pg` usado aqui (8.23) não implementa `channel_binding` e ignoraria o parâmetro. `verify-full` confere o certificado e o nome do host, o que já impede interceptação.

O plano gratuito do Neon suspende o banco sem uso e o acorda na conexão seguinte. A primeira consulta depois de um período parado é mais lenta.

### B. Inicializar o schema (terminal)

O caminho são as migrations **compiladas** (`dist-migrations/`), o mesmo runtime usado em production, com conferência do destino **antes** de qualquer escrita. Rode a partir de uma cópia limpa do commit validado, fora da pasta de trabalho, onde não existe `.env` nenhum. O TypeORM CLI não carrega `.env`, e o script de conferência só lê variáveis do processo.

Pré-requisitos: Git Bash, Node 24 e o `<sha>` validado (seção 7, passo 1).

```bash
# 1. Cópia limpa do commit validado, fora do repositório de trabalho.
git -C <repositorio> fetch origin
git -C <repositorio> worktree add <pasta-temporaria> <sha>
cd <pasta-temporaria>/backend
ls -a            # confirmar que NÃO existe .env aqui
npm ci --include=dev
npm run build:migrations-runtime

# 2. Variáveis só nesta sessão do terminal. `read -rs` não ecoa o valor:
#    cole e tecle Enter.
printf 'URL direta do piloto: '; read -rs PILOT_DIRECT_URL; echo; export PILOT_DIRECT_URL
printf 'Endpoint ID do piloto: '; read -r PILOT_ENDPOINT_ID; export PILOT_ENDPOINT_ID
printf 'Endpoint ID do production: '; read -r PRODUCTION_ENDPOINT_ID; export PRODUCTION_ENDPOINT_ID

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
| `ERR_ENDPOINT_UNRECOGNIZED` | O host não é de um endpoint Neon (por exemplo, um banco local). |
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

Se o passo 4 falhar no meio, **não** repita às cegas. Rode só o passo 5 para ver o estado, e investigue antes de qualquer nova tentativa. Num banco novo do piloto, sem dados, apagar e recriar o projeto do piloto (seção A) é uma saída aceitável.

### C. Aplicar NotificationJobs e PublicBooking num piloto com dados

Vale para o piloto que já tem as três migrations iniciais e dados de uso. As duas migrations (`1792540800000-NotificationJobs` e `1792627200000-PublicBooking`) só acrescentam: três colunas nulas em `consumers` e três tabelas novas. Nenhum cliente passa a ter autorização de WhatsApp.

Mesma cópia limpa e mesmas variáveis da seção B (passos 1 e 2). Depois:

1. **Backup antes de escrever.** De preferência, um branch do Neon criado a partir do branch do piloto. Sem acesso a isso, use `pg_dump -Fc` da URL direta, guardado fora do repositório e restaurado num PostgreSQL descartável, conferindo a mesma contagem de linhas por tabela que o piloto. Anote o horário do ponto de recuperação.
2. **Conferência antes**, só leitura:
   ```bash
   PILOT_EXPECT=before-notifications-public-booking npm run pilot:check-database
   ```
   Precisa terminar em `RESULT: SUCCESS`, com `MIGRATIONS_APPLIED: 3`, `SCHEMA_OBJECTS_OK: 0/54` e `BASELINE_FAILURES: none`. O histórico precisa ter exatamente `InitialSchema`, `AllowUndefinedPlanPrice` e `InitialPlanCatalog`, nessa ordem. Nenhum objeto das duas migrations pode existir, e o alvo das FKs compostas (`appointments (tenant_id, id)`) precisa existir.
3. **Aplicar**, no mesmo terminal:
   ```bash
   DIRECT_URL="$PILOT_DIRECT_URL" npm run migration:run:compiled
   ```
   O TypeORM aplica as duas numa única transação (`START TRANSACTION` … `COMMIT`): ou entram as duas, ou nenhuma.
4. **Conferência depois**, só leitura:
   ```bash
   PILOT_EXPECT=after-notifications-public-booking npm run pilot:check-database
   ```
   Precisa terminar em `RESULT: SUCCESS`, com `MIGRATIONS_APPLIED: 5`, `SCHEMA_OBJECTS_OK: 54/54` e `BASELINE_FAILURES: none`. São as cinco migrations pelo nome e na ordem, mais cada coluna, constraint e índice com a definição exata do PostgreSQL (lista em `backend/scripts/lib/notificacoes-agendamento-publico-schema.ts`). Nunca uma contagem nem um "pelo menos cinco".

Se o passo 3 falhar ou a conexão cair, **não** repita, não rode `migration:revert` e não restaure o backup sem decidir antes. Rode o passo 4 (ou o 2) para ver o estado real e investigue.

### D. Aplicar WebPush e configurar as chaves VAPID

Vale para o piloto que já está em `after-notifications-public-booking` (cinco migrations). A migration `1792713600000-WebPush` só acrescenta três tabelas novas (`push_subscriptions`, `booking_request_alerts`, `push_deliveries`); nenhuma tabela existente muda.

**Ordem de publicação: migration → API → web.** A API nova grava o evento de push na transação do pedido público: sem a migration, todo pedido público falharia. O web novo chama rotas que só a API nova tem.

1. **Backup antes de escrever**, como na parte C, passo 1.
2. **Conferência antes**, só leitura: `PILOT_EXPECT=after-notifications-public-booking npm run pilot:check-database` precisa dar `RESULT: SUCCESS` com `MIGRATIONS_APPLIED: 5`. Depois de aplicar a WebPush, esta mesma conferência passa a FALHAR (o histórico terá seis nomes) — é esperado.
3. **Aplicar**: `DIRECT_URL="$PILOT_DIRECT_URL" npm run migration:run:compiled`. Uma transação só.
4. **Conferência depois**, só leitura, no `psql` com a URL direta (ainda não há expectativa automática para este passo):
   ```sql
   BEGIN TRANSACTION READ ONLY;
   SELECT name FROM typeorm_migrations ORDER BY id;          -- 6 nomes, o último WebPush1792713600000
   SELECT to_regclass('push_subscriptions'), to_regclass('booking_request_alerts'), to_regclass('push_deliveries');
   ROLLBACK;
   ```
5. **Chaves VAPID** (uma vez, em máquina de confiança): `cd backend && npm run push:generate-vapid-keys`. Copie as três linhas para **Environment** do serviço **api** (nunca do web), troque o e-mail do `WEB_PUSH_SUBJECT` e não guarde o texto em arquivo do repositório nem em chat. O Render mantém as variáveis entre deploys. Trocar o par depois obriga cada aparelho a ativar de novo.
6. **Publicar a API** (mesmo commit), depois o **web** (mesmo commit, regra do PR #45).

Nenhum serviço pago, Cron Job ou conta de provedor é necessário: Web Push usa o serviço de push do próprio navegador (Google, Apple, Mozilla, Microsoft), sem cadastro.

**Se o processo morrer ou hibernar:** o evento fica no banco (`booking_request_alerts`, `PENDING` ou `PROCESSING` com concessão de 2 min). Ele é retomado quando a API sobe de novo (deploy ou primeira requisição depois da hibernação) e quando a área real consulta a lista de solicitações. Sem nenhum acesso, nada é enviado até alguém acessar; depois de 24 h (ou do início do atendimento) o evento expira sem aviso. Não há ping para manter o serviço acordado.

### E. Roteiro físico do Web Push (depois de publicar)

Os testes automáticos simulam o `PushManager` e um serviço de push falso: provam o conteúdo, o destino e as regras, **não** o recebimento num celular. Faça uma vez com aparelhos reais e anote o resultado:

1. **Android (Chrome):** entre na área real, Solicitações → "Ativar notificações neste dispositivo" → aceitar. Estado "Ativado".
2. **iPhone (iOS 16.4+):** no Safari, Compartilhar → "Adicionar à Tela de Início"; abra pelo ícone, entre e ative. No Safari comum, a tela deve mostrar as instruções, não o botão.
3. Bloqueie a tela dos dois. De outro aparelho, faça um pedido pela página pública.
4. Esperado: em segundos, "Nova solicitação de agendamento. Toque para analisar.", **sem** nome ou telefone do cliente.
5. Toque: abre a solicitação certa (após login, se a sessão tiver acabado). Confira que ela continua **Aguardando confirmação**.
6. Desative num aparelho e repita o pedido: só o outro recebe. Saia da conta no outro e repita: nenhum recebe.
7. Com o serviço hibernado (15 min sem acesso), faça um pedido: o próprio pedido acorda a API e o aviso deve chegar. Anote o tempo.
8. Se algo não chegar: em `push_deliveries`, `ACCEPTED` quer dizer que o serviço de push aceitou (não que o aparelho mostrou); `GONE` = inscrição expirada; `RETRY`/`FAILED` com o status HTTP. Economia de bateria e modo foco do aparelho podem segurar a notificação.

### F. Aplicar AccountsAdministration (convites e gestão de contas)

**Roteiro operacional: `docs/runbooks/publicacao-contas-piloto.md`.** Ele traz
o procedimento guardado e ensaiado: lançador no Windows Terminal, URL oculta,
TLS no socket, backup com restauração conferida em banco descartável, só a
migration pendente, conferência `after`, compatibilidade e recuperação. O
resumo abaixo continua valendo como referência.

Vale para o piloto que já está com as seis migrations até `WebPush1792713600000`. A migration `1792800000000-AccountsAdministration` só acrescenta: valores no enum `audit_action`, uma coluna em `audit_logs` e em `sessions`, colunas e constraints em `invites` (tabela que nenhum código escrevia) e a tabela `password_resets`. Nenhuma conta existente muda de situação; nenhum e-mail é marcado como verificado. Detalhes em `docs/plans/administracao-contas-convites.md`.

**Ordem: backup → conferência antes → migration → conferência depois → API → web.** A API atual funciona com o schema novo (as colunas novas são nulas ou têm padrão); a API nova não funciona sem ele.

1. **Backup antes de escrever**, como na parte C, passo 1 (branch do Neon a partir do piloto, ou `pg_dump -Fc` restaurado num PostgreSQL descartável com a mesma contagem de linhas por tabela). Anote o horário.
2. **Conferência antes**, só leitura: `PILOT_EXPECT=before-accounts-administration npm run pilot:check-database` precisa dar `RESULT: SUCCESS`, `MIGRATIONS_APPLIED: 6`, `SCHEMA_OBJECTS_OK: 0/40` e `BASELINE_FAILURES: none`. A conferência também recusa convites que as constraints novas não aceitariam (`invites_incoherent_rows`, `invites_duplicated_pending`); se aparecer, pare e investigue antes de aplicar.
3. **Aplicar**: `DIRECT_URL="$PILOT_DIRECT_URL" npm run migration:run:compiled`. Uma transação só.
4. **Conferência depois**: `PILOT_EXPECT=after-accounts-administration npm run pilot:check-database` precisa dar `RESULT: SUCCESS`, `MIGRATIONS_APPLIED: 7`, `SCHEMA_OBJECTS_OK: 40/40` e `BASELINE_FAILURES: none`.
5. **E-mail (opcional nesta hora)**: no serviço **api**, `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM` e `EMAIL_FROM_NAME` (ver o plano, seção "E-mail"). Sem elas, a API sobe com o envio desligado: convites ficam com "envio não configurado" e ninguém novo é ativado.
6. **Publicar a API**, depois o **web**, do mesmo commit.

Se o passo 3 falhar, não repita nem reverta sem decidir antes: rode o passo 2 ou o 4 para ver o estado real. `migration:revert` desta migration apaga convites e redefinições registrados depois dela; os valores novos do enum ficam.

## 7. Sequência de publicação

Faça os passos nesta ordem. Cada um depende do anterior.

1. **Commit validado:** escolha o `<sha>` em `integration/nestjs-typeorm-frontend` com o CI verde e com `render.yaml` em `plan: free` e `region: virginia`. Ele precisa ser o **último** commit da branch no momento do passo 5, porque a criação do Blueprint publica o último commit.
2. **Criar o banco Neon** (seção 6, parte A).
3. **Inicializar o schema** com o mesmo `<sha>` (seção 6, parte B), até `RESULT: SUCCESS` no passo 5 de lá.
4. **Conferir o workspace do Render** (seção 1, "Workspace do Render"): nenhum serviço com os nomes `agenda-cloud-piloto-*`.
5. **Criar o Blueprint e inserir os segredos:**
   1. No painel do Render: **New → Blueprint**. Conecte este repositório e escolha a branch `integration/nestjs-typeorm-frontend`. Dê ao Blueprint um nome próprio do Agenda Cloud (por exemplo, `agenda-cloud-piloto`).
   2. Na revisão, confirme que aparecem **só** `agenda-cloud-piloto-api` e `agenda-cloud-piloto-web`, os dois como web service **Free** em **Virginia**.
   3. O Render pede os quatro valores `sync: false`. Cole cada um direto do gerenciador de senhas:
      - `DATABASE_URL` (api): a URL **pooled** do piloto, terminando em `?sslmode=verify-full`;
      - `DIRECT_URL` (api): a URL **direta** do piloto, terminando em `?sslmode=verify-full`;
      - `FRONTEND_URL` (api): `https://agenda-cloud-piloto-web.onrender.com`;
      - `API_PROXY_TARGET` (web): `https://agenda-cloud-piloto-api.onrender.com`.

      Os dois endereços são os esperados. Sem barra no fim.
   4. `API_PROXY_SECRET` não é pedido: o Render gera na api e copia para o web.
   5. Clique em **Deploy Blueprint**. A criação dispara o primeiro deploy dos dois serviços. Depois dela, deploys só acontecem manualmente.
6. **Conferir os endereços:** o endereço público de cada serviço aparece no topo da página dele no painel. Se algum for diferente do esperado (sufixo no nome), corrija `FRONTEND_URL` (api) e `API_PROXY_TARGET` (web) em **Environment**, e faça **Manual Deploy → Deploy latest commit** nos dois: `API_PROXY_TARGET` é conferido também no build do web.
7. **Conferir o commit publicado:** no log de deploy de cada serviço, o commit precisa ser o `<sha>`. Se não for, em cada serviço: **Manual Deploy → Deploy a specific commit → `<sha>`**, primeiro a api, depois o web.
8. **Verificações básicas** (Git Bash, com `WEB=https://<web>.onrender.com` e `API=https://<api>.onrender.com`). A primeira chamada depois de um período parado pode levar perto de um minuto.
   - Saúde:
     - `curl -sS -o /dev/null -w "%{http_code}\n" "$API/"` deve dar `200`;
     - `curl -sS -o /dev/null -w "%{http_code}\n" "$WEB/login"` deve dar `200`;
     - `curl -sS -o /dev/null -w "%{http_code}\n" "$WEB/agenda_api/auth/me"` deve dar `401` (proxy configurado, API alcançada, sem sessão). `500` indica variável do proxy inválida; `502`/`504`, API inalcançável;
     - os dois serviços aparecem como **Live** no painel.
   - Origem nas escritas:
     - `curl -si -X POST "$WEB/agenda_api/auth/logout" -H "Origin: https://exemplo.invalid"` deve responder `403`, sem `Set-Cookie`;
     - sem `-H "Origin: ..."`, também `403`.
   - Login, sessão e logout no navegador:
     1. Use uma conta existente. Desde o PR #65 o cadastro público está fechado: contas novas entram por convite da administração (`/conta/administracao`). Não existe exclusão de conta.
     2. Em DevTools → Network, confirme que as chamadas vão para `$WEB/agenda_api/...` e **nenhuma** para `$API`.
     3. Em DevTools → Application → Cookies, confira em `$WEB` o cookie `session_token` com `HttpOnly`, `Secure`, `SameSite=Lax` e sem `Domain`. Em `$API` não deve haver cookie.
     4. Recarregue `/conta`: a sessão continua.
     5. Crie um serviço em `/conta/servicos` e recarregue: ele continua listado.
     6. Clique em **Sair**: `/conta` volta a pedir login e o cookie some.
     7. Entre de novo pelo `/login` e saia de novo.
9. **Limite por IP no ambiente real** (seção 5). Espere 15 minutos depois do último login do passo 8, para começar com o limite zerado.
   1. Pelo proxy, da mesma máquina, 6 tentativas com cabeçalhos de IP forjados, um valor diferente a cada tentativa:

      ```bash
      for n in 1 2 3 4 5 6; do
        curl -s -o /dev/null -w "tentativa $n: %{http_code}\n" -X POST "$WEB/agenda_api/auth/login" \
          -H "Origin: $WEB" -H "Content-Type: application/json" \
          -H "CF-Connecting-IP: 203.0.113.$n" -H "X-Forwarded-For: 198.51.100.$n" \
          -H "X-Real-IP: 198.51.100.$n" -H "X-Agenda-Client-IP: 192.0.2.$n" \
          -H "X-Agenda-Proxy-Secret: forjado-$n" \
          -d '{"email":"teste-limite@exemplo.invalid","password":"senha-errada-123"}'
      done
      ```

      Esperado: tentativas 1 a 5 com `401` e a 6 com `429`.
      - Seis `401`: algum cabeçalho forjado foi aceito. Pare e trate como incidente (seção 8, "IP do cliente").
      - `429` já na primeira: o limite desta máquina não estava zerado. Espere 15 minutos e repita.
      - Outro código (por exemplo `400` ou `403` com página da Cloudflare): a borda recusou o `CF-Connecting-IP` forjado antes da aplicação, o que também é seguro. Espere 15 minutos e repita sem a linha `-H "CF-Connecting-IP: ..."`, para conferir os outros cabeçalhos.
   2. Logo em seguida, **de outra rede** (por exemplo, o celular fora do Wi-Fi), entre com a conta do passo 8 em `$WEB/login`. O login precisa funcionar. Isso prova que o `CF-Connecting-IP` chega ao web e é repassado: clientes diferentes não dividem o limite. Se der "muitas tentativas" (`429`), o IP não está sendo repassado: veja seção 8, "IP do cliente".
   3. Direto na API, da primeira máquina: espere mais 15 minutos (pelo proxy e direto, a API conta as tentativas no **mesmo** limite, o do IP real da máquina) e rode o mesmo laço trocando a URL por `"$API/auth/login"` e tirando a linha `-H "Origin: $WEB"`. Esperado: tentativas 1 a 5 com `401` e a 6 com `429`. Seis `401` é incidente; os outros casos têm a mesma leitura do item 1.
10. **Abrir o piloto** só com os passos 8 e 9 completos.

### Domínio próprio depois

Sem mudar código: adicione o domínio ao serviço **web** (só a ele; a API continua no endereço gratuito, atrás do proxy), defina `APP_PUBLIC_ORIGIN=https://<dominio>` no web e `FRONTEND_URL=https://<dominio>` na api, e faça um novo deploy dos dois. Mantenha o DNS como **DNS only** (seção 5, "Quando acionar o suporte do Render"). Os cookies emitidos no endereço `onrender.com` não valem no domínio novo: cada usuário entra de novo uma vez. Depois, repita o passo 9 no domínio novo.

## 8. Retorno ao commit anterior

- **Deploy falhou antes de ficar Live:** o Render cancela sozinho quando o build falha ou o health check não passa. O deploy anterior continua no ar e não há nada a fazer além de investigar.
- **Ficou Live com defeito:** em cada serviço afetado, vá em **Deploys**, escolha o último deploy bom e clique em **Rollback**.
  - O rollback reutiliza o artefato daquele deploy, com as variáveis de ambiente e o comando de start da época.
  - Pelo painel, ele também desliga o auto-deploy, que já está desligado aqui.
  - O frontend volta com o `NEXT_PUBLIC_API_URL` embutido naquele build.
- **Primeiro deploy, sem anterior:** suspenda o serviço (**Suspend**) até corrigir.
- **IP do cliente** (falha no passo 9): em **Environment** de cada serviço, troque `CLIENT_IP_SOURCE` para `socket` e salve; faça **Manual Deploy → Deploy latest commit** nos dois. Depois, abra um commit revisado com a mesma troca em `render.yaml`, para a próxima sincronização do Blueprint não desfazer a correção. Com `socket`, ninguém escapa do limite, mas todos os usuários dividem um limite só: o piloto não abre até a causa ser resolvida (seção 5, "Quando acionar o suporte do Render").
- **Banco:** rollback do Render **não** desfaz migration. Para este primeiro deploy, o banco foi inicializado à parte (seção 6) e o código não aplica migration no deploy. Publicações futuras que tragam migration precisam de um roteiro próprio, com backup (branch do Neon) antes de escrever.
- Depois de qualquer rollback, refaça as verificações da seção 7, passos 8 e 9.

## 9. Evidência: o que já foi verificado e o que depende da publicação

### Verificado sem nenhum recurso externo

No repositório (testes unitários, `npm run test` na raiz e em `backend/`):

- `render.yaml` válido contra o JSON Schema oficial de Blueprint do Render (`render.com/schema/render.yaml.json`), conferido na preparação deste lote; a versão anterior, com valores pendentes, era recusada pelo mesmo schema;
- invariantes de `render.yaml` (`render-blueprint.test.ts`): plano `free` e região `virginia` nos dois serviços, nenhum valor pendente, uma instância, auto-deploy desligado, segredos com `sync: false`, segredo do proxy gerado, `CLIENT_IP_SOURCE=cf-connecting-ip` nos dois, nomes próprios e nenhum recurso compartilhado com outro sistema;
- validação de ambiente da API: recusa de URL sem verificação TLS, de `FRONTEND_URL` não-HTTPS em production, de `HOST` que não é IP, de `CLIENT_IP_SOURCE` desconhecido e de `API_PROXY_SECRET` curto, sem ecoar o valor;
- IP do cliente na API (`client-ip.spec.ts`, `client-ip-rate-limit.spec.ts`, `auth.module.spec.ts`): `X-Agenda-Client-IP` só com o segredo certo; segredo errado, repetido ou ausente ignorado; `X-Forwarded-For` nunca lido; rate limit por HTTP real (supertest) com cabeçalhos forjados nos modos possíveis;
- proxy (`src/lib/api/proxy.test.ts`, contra um servidor HTTP real local no papel da API): destino fixo, caminho recodificado e sem `..`, lista fechada de cabeçalhos, `Origin` exigido nas escritas, status e corpo repassados (200, 204, 4xx, 429, 5xx), vários `Set-Cookie` intactos (inclusive o de remoção no logout), `no-store`, nenhuma nova tentativa, `502`/`504` marcados, corpo acima de 1 MiB recusado;
- configuração do proxy (`proxy-config.test.ts`), guarda de build (`api-url.test.ts`) e cliente HTTP (`http-client.test.ts`);
- conferência do banco do piloto: lógica com cliente falso (só leitura, sem vazar URL, host ou Endpoint ID), mais o script compilado recusando destino errado sem abrir conexão.

No CI (`.github/workflows/test-frontend-auth.yml`, PostgreSQL descartável com TLS):

- os fluxos de navegador existentes, com chamada direta à API (modo de desenvolvimento);
- `npm run test:browser:proxy` (`playwright.proxy.config.ts`): frontend compilado com `NEXT_PUBLIC_API_URL=/agenda_api`, uma borda HTTPS local na frente de cada serviço, com certificado autoassinado gerado na hora, os dois serviços com `CLIENT_IP_SOURCE=cf-connecting-ip` e a API em `NODE_ENV=production`. Prova cadastro, login pela tela, restauração de sessão, criação de serviço, erro da API repassado e logout **só pelo proxy** (nenhuma requisição do navegador à porta da API); o cookie `session_token` com `HttpOnly`, `Secure`, `SameSite=Lax`, sem `Domain`, na origem do frontend, e removido no logout; `403` para escrita de outra origem; cabeçalhos de IP forjados (`CF-Connecting-IP`, `X-Forwarded-For`, `X-Real-IP`, `X-Agenda-*`) sem escapar do limite, pelo proxy e direto na API pela borda dela; clientes de endereços diferentes com limites diferentes nos dois caminhos.

### Documentado pelo provedor, ainda não testado aqui

- a borda do Render escreve e sobrescreve `CF-Connecting-IP` em toda requisição a um web service, e acrescenta ao `X-Forwarded-For` (seção 5, fonte e limites).

### Só verificável com o ambiente publicado

- Recebimento real de Web Push com Android e iPhone bloqueados (seção 6, parte E). O CI prova cifra, VAPID, destino, autorização e o fluxo da tela com o `PushManager` simulado — não a exibição num aparelho.

- escuta em `0.0.0.0:$PORT` aceita pelo Render, e health checks verdes;
- certificado público e endereço `*.onrender.com` de cada serviço;
- o proxy alcançando a API pelo endereço público, inclusive saindo da hibernação do plano gratuito dentro de 90 segundos;
- cookie `Secure`/`HttpOnly`/`SameSite=Lax` emitido atrás da borda real, e o ciclo login → sessão → logout (seção 7, passo 8);
- comportamento real de `CF-Connecting-IP` na borda do Render, pelo proxy e direto na API (seção 7, passo 9);
- conexão ao Neon do piloto com `sslmode=verify-full`;
- consumo da franquia gratuita do workspace;
- rollback pelo painel.
