# Indexação, Search Console e conferência pós-publicação

Este roteiro diz o que o código já faz pela indexação e pela segurança das
respostas, o que depende de conta, domínio ou DNS, e como conferir tudo no
ambiente publicado. Nada aqui foi executado no piloto. A existência deste
roteiro não significa que o site esteja indexado.

## 1. O que o código faz

| Item | Onde | Comportamento |
|---|---|---|
| Origem dos endereços absolutos | `src/lib/site/origem-do-site.ts` | `APP_PUBLIC_ORIGIN` ou `RENDER_EXTERNAL_URL`, só HTTPS exata. Nunca vem de `Host` ou `X-Forwarded-*`. Sem origem válida, o site não publica canonical, sitemap nem imagem de compartilhamento. |
| Pré-visualização de PR | idem | Com `IS_PULL_REQUEST=true` (Render), o robots.txt bloqueia tudo e as páginas levam `noindex`. |
| `sitemap.xml` | `src/app/sitemap.ts`, regra em `src/lib/site/indexacao.ts` | Só a página inicial, sem data de alteração. As páginas `/agendar/<slug>` não entram (ver seção 4). |
| `robots.txt` | `src/app/robots.ts` | Libera tudo, menos `/agenda_api/`, e aponta o sitemap. As áreas privadas não são bloqueadas aqui de propósito: um endereço bloqueado não tem o `noindex` lido. |
| `noindex` | `ROTAS_SEM_INDEXACAO` em `src/lib/site/cabecalhos.ts` | `X-Robots-Tag: noindex, nofollow` em `/conta`, `/portal`, `/login`, `/cadastro`, `/convite`, `/redefinir-senha`, `/403`, `/agenda_api` e nas telas da demonstração. A proteção de verdade continua sendo a sessão exigida pela API. |
| Página do estabelecimento | `src/app/agendar/[slug]/layout.tsx` | Lê `/public/<slug>` no servidor (prazo de 2,5 s). Encontrada: título, descrição, canonical e JSON-LD do estabelecimento. A API respondeu 404 (página inexistente, desligada ou estabelecimento inativo): status 404. API hibernada ou lenta: metadados genéricos e status 200, e a tela segue como antes. |
| 404 | `src/app/not-found.tsx` | Status 404 de verdade, com `noindex` automático do Next.js. |
| Search Console | `GOOGLE_SITE_VERIFICATION` (`src/lib/site/metadados-do-site.ts`) | Com a variável no build, sai a meta tag `google-site-verification`. |
| Cabeçalhos de segurança | `src/lib/site/cabecalhos.ts` | CSP sem nonce, `X-Frame-Options: DENY`, nosniff, `Referrer-Policy`, `Permissions-Policy` e `Strict-Transport-Security: max-age=31536000`, sem `includeSubDomains` e sem `preload`. |

## 2. O que depende de ação externa

### Google Search Console (precisa da conta Google de quem administra o site)

No endereço gratuito `*.onrender.com` não há acesso ao DNS. Use uma
propriedade do tipo **prefixo de URL**:

1. No Search Console, adicione a propriedade `https://<web>.onrender.com/`
   (ou `https://<dominio>/`, se o domínio próprio já existir).
2. Escolha o método **Tag HTML** e copie só o valor do atributo `content`.
   Não cole o valor no chat nem no repositório.
3. No painel do Render, serviço web, **Environment**: crie
   `GOOGLE_SITE_VERIFICATION` com esse valor.
4. Faça um deploy do web com build (a meta tag é gerada no build). Siga a
   ordem do runbook de publicação.
5. Confira a meta tag (seção 3) e clique em **Verificar** no Search Console.
6. Em **Sitemaps**, envie `https://<origem>/sitemap.xml`.
7. Use **Inspeção de URL** na página inicial e, se quiser, na página de um
   estabelecimento real, para pedir a indexação.

Com domínio próprio, a alternativa é uma propriedade de **domínio**,
verificada por registro TXT no DNS. Ela não depende da variável acima.

### Domínio próprio, domínio preferido e HSTS

- O Render redireciona HTTP para HTTPS sozinho, no `onrender.com` e nos
  domínios próprios (documentação do Render, páginas "TLS" e "Custom
  Domains").
- Ao adicionar `exemplo.com.br`, o Render cria `www.exemplo.com.br` e o
  redireciona para o domínio sem `www`. Ao adicionar o `www`, faz o
  contrário. Decida qual é o preferido antes de cadastrar.
- Depois do domínio: defina `APP_PUBLIC_ORIGIN=https://<dominio-preferido>`
  no web (vale para o build, ou seja, só a partir do próximo deploy) e siga
  a seção 7 do runbook de publicação.
- Com o domínio funcionando, o Render permite desativar o `onrender.com`
  (requisições a ele passam a receber 404). Enquanto ele existir, as
  páginas dele apontam o canonical para o domínio próprio.
- `includeSubDomains` e `preload` no HSTS só depois de confirmar que todo
  subdomínio do domínio próprio serve HTTPS. O `preload` é difícil de
  desfazer.

### Google Analytics: decisão pendente

Não há Google Analytics no código, e o site não tem mecanismo de
consentimento nem política de privacidade. Antes de qualquer implementação,
falta decidir:

- se haverá medição e em quais páginas (sugestão: só a página inicial e a
  página pública de agendamento, nunca a área logada);
- a base legal (LGPD) e o banner de consentimento, já que o GA grava
  cookies e envia dados ao Google;
- a propriedade GA4 (o ID de medição `G-...` vem da conta de quem
  administra);
- quais eventos medir. Nenhum evento pode levar nome, e-mail, telefone,
  token ou dados do agendamento.

Quando houver decisão, a CSP precisa incluir os domínios do Google em
`script-src`, `connect-src` e `img-src` (`src/lib/site/cabecalhos.ts`).

## 3. Conferência no ambiente publicado

Troque `<origem>` pela origem pública. Todos os comandos só leem.

```bash
curl -sI https://<origem>/ | grep -iE "content-security|x-frame|x-content|referrer|permissions|strict-transport"
curl -s https://<origem>/robots.txt
curl -s https://<origem>/sitemap.xml
curl -s https://<origem>/ | grep -oE '<link rel="canonical"[^>]*>|google-site-verification[^>]*>|og:image"[^>]*>'
curl -sI https://<origem>/login | grep -i x-robots-tag
curl -s -o /dev/null -w "%{http_code}\n" https://<origem>/agendar/slug-que-nao-existe-123
curl -s -o /dev/null -w "%{http_code}\n" https://<origem>/rota/que/nao/existe
curl -sI http://<web>.onrender.com/login | grep -iE "^HTTP|^location"
```

Esperado: os cabeçalhos de segurança presentes; o robots.txt com a linha
`Sitemap:` apontando para a própria origem; o sitemap só com a página
inicial; o canonical na própria origem, sem `localhost` e sem parâmetros;
`X-Robots-Tag: noindex, nofollow` no login; `404` nas duas últimas páginas
(com a API acordada; com a API hibernada, a página de estabelecimento
inexistente pode responder 200 na primeira visita); e o HTTP respondendo
com redirecionamento para HTTPS, preservando o caminho.

Depois, abra no celular e no computador: login, área da conta, portal,
agendamento público, ativação de notificações e o aplicativo instalado.
A CSP não pode ter bloqueado nada (console do navegador sem
"Content Security Policy").

## 4. Por que as páginas dos estabelecimentos não estão no sitemap

- Não existe lista pública de estabelecimentos, e criá-la exporia a
  carteira de clientes da plataforma.
- O banco não separa estabelecimentos de teste dos reais. Um sitemap
  montado do banco publicaria os de teste.
- A página continua indexável: título, descrição e canonical próprios. Ela
  chega à busca pelo link que o próprio estabelecimento divulga.
- Se a plataforma quiser listar estabelecimentos no sitemap, primeiro é
  preciso decidir quem autoriza (o dono, por uma opção na tela) e marcar os
  estabelecimentos de teste.
