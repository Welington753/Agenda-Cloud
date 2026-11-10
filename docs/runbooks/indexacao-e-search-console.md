# Indexação, Search Console e conferência pós-publicação

Este roteiro diz o que o código já faz pela indexação e pela segurança das
respostas, o que depende de conta, domínio ou DNS, e como conferir tudo no
ambiente publicado. Nada aqui foi executado no piloto, e a indexação não
foi verificada.

## 1. O que o código faz

| Item | Onde | Comportamento |
|---|---|---|
| Origem dos endereços absolutos | `src/lib/site/origem-do-site.ts` | `APP_PUBLIC_ORIGIN` ou `RENDER_EXTERNAL_URL`, só HTTPS exata. Nunca vem de `Host` ou `X-Forwarded-*`. Sem origem válida, o site não publica canonical, sitemap nem imagem de compartilhamento. |
| Pré-visualização de PR | idem e `src/lib/site/cabecalhos.ts` | Com `IS_PULL_REQUEST=true` no build (Render): `X-Robots-Tag: noindex, nofollow` em TODA resposta, `noindex` nos metadados, sitemap vazio e nenhum endereço da prévia (`RENDER_EXTERNAL_URL`) em canonical, Open Graph ou JSON-LD. O robots.txt da prévia não bloqueia nada, de propósito (seção 5). Hoje o `render.yaml` não liga prévias. |
| `sitemap.xml` | `src/app/sitemap.ts`, regra em `src/lib/site/indexacao.ts` | Só a página inicial, sem data de alteração. As páginas `/agendar/<slug>` não entram (ver seção 4). |
| `robots.txt` | `src/app/robots.ts` | Libera tudo, menos `/agenda_api/`, e aponta o sitemap. As áreas privadas não são bloqueadas aqui de propósito: um endereço bloqueado não tem o `noindex` lido. |
| `noindex` | `ROTAS_SEM_INDEXACAO` em `src/lib/site/cabecalhos.ts` | `X-Robots-Tag: noindex, nofollow` em `/conta`, `/portal`, `/login`, `/cadastro`, `/convite`, `/redefinir-senha`, `/403`, `/agenda_api` e nas telas da demonstração. A proteção de verdade continua sendo a sessão exigida pela API. |
| Página do estabelecimento | `src/app/agendar/[slug]/layout.tsx` | Lê `/public/<slug>` no servidor (prazo de 2,5 s, sem cache entre requisições). Encontrada: título, descrição, canonical e JSON-LD do estabelecimento. A API respondeu 404 (página inexistente, desligada ou estabelecimento inativo): status 404. API hibernada ou lenta: metadados genéricos, sem canonical, e status 200; a tela segue como antes. |
| Endereço curto `/<slug>` | `src/app/[slug]/page.tsx`, regra em `src/lib/agendamento-publico/endereco-curto.ts` | Decidido no servidor, com a mesma leitura. Encontrado: `308` para `/agendar/<slug da API>`. A API respondeu 404: status 404. API lenta ou fora: `307` (temporário) para `/agendar/<slug>`. Slug da semente da demonstração: a demonstração, com `noindex`. Todas essas respostas levam `Cache-Control: private, no-cache, no-store`. |
| 404 | `src/app/not-found.tsx` e `src/app/[slug]/not-found.tsx` | Status 404 de verdade, com título próprio e `noindex` no HTML. Limitação do Next.js 16: quando o 404 vem de `notFound()` numa rota dinâmica (estabelecimento inexistente), o corpo da página é desenhado pelo JavaScript; sem JavaScript ficam o status, o título e o `noindex`. Um endereço que não casa com rota nenhuma tem o corpo completo no HTML. |
| Search Console | `GOOGLE_SITE_VERIFICATION` (`src/lib/site/metadados-do-site.ts`) | Com a variável no build, sai a meta tag `google-site-verification`. |
| Cabeçalhos de segurança | `src/lib/site/cabecalhos.ts` | CSP sem nonce, `X-Frame-Options: DENY`, nosniff, `Referrer-Policy`, `Permissions-Policy` e `Strict-Transport-Security: max-age=31536000`, sem `includeSubDomains` e sem `preload`. **Limitação:** a CSP permite script inline (`'unsafe-inline'`), então não impede a execução de um script injetado por uma falha de XSS. Ela limita o resto: para onde a página conecta, enquadramento, plugins, `<base>` e formulários. Fechar isso exige nonce em toda página (renderização por requisição), fora deste lote. |

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
curl -sI https://<origem>/<slug-de-um-estabelecimento-real> | grep -iE "^HTTP|^location|^cache-control"
curl -s -o /dev/null -w "%{http_code}\n" https://<origem>/slug-que-nao-existe-123
curl -sI http://<web>.onrender.com/login | grep -iE "^HTTP|^location"
```

Esperado: os cabeçalhos de segurança presentes; o robots.txt com a linha
`Sitemap:` apontando para a própria origem; o sitemap só com a página
inicial; o canonical na própria origem, sem `localhost` e sem parâmetros;
`X-Robots-Tag: noindex, nofollow` no login; `404` nas páginas inexistentes
(com a API acordada; com a API hibernada, a primeira visita pode receber
200 em `/agendar/<slug>` ou 307 no endereço curto); `308` do endereço
curto para `/agendar/<slug>`, com `no-store` no `Cache-Control`; e o HTTP
respondendo com redirecionamento para HTTPS, preservando o caminho.

Depois, abra no celular e no computador: login, área da conta, portal,
agendamento público, ativação de notificações e o aplicativo instalado.
A CSP não pode ter bloqueado nada (console do navegador sem
"Content Security Policy").

## 4. Estabelecimentos no sitemap e na busca

Ficar fora do sitemap não impede a indexação: o buscador acha a página
`/agendar/<slug>` por qualquer link público.

- **Por que fora do sitemap:** não existe lista pública de
  estabelecimentos, e criá-la exporia a carteira de clientes da plataforma.
- **Estabelecimentos reais:** a página continua indexável, com título,
  descrição e canonical próprios. Ela chega à busca pelo link que o próprio
  estabelecimento divulga.
- **Demonstração:** os estabelecimentos da demonstração existem só no
  navegador (`localStorage`). A API não os conhece, então
  `/agendar/<slug-da-demonstração>` responde 404. O endereço curto dos seis
  slugs da semente mostra a demonstração com `noindex`, e as telas internas
  dela têm `X-Robots-Tag: noindex`.
- **Estabelecimentos de teste no banco:** o banco não tem marca de teste
  (nem coluna, nem plano, nem convenção de nome). Um estabelecimento de
  teste com a página pública ligada é indexável como qualquer real, se
  alguém publicar o link dele. Hoje, o jeito de tirá-lo da busca é o dono
  **desligar a página pública**: ela passa a responder 404. **Decisão
  pendente:** se a plataforma quiser outra regra (uma marca de teste
  definida pela administração, ou uma opção do dono para não aparecer em
  buscadores), é preciso definir quem marca e criar o campo. Nada foi
  classificado nem bloqueado por suposição.
- **Colisões do endereço curto (R6, parcial):** um estabelecimento real com
  slug igual a uma rota da raiz (`login`, `conta`...) ou a um slug da
  semente da demonstração não é alcançado por `/<slug>`, só por
  `/agendar/<slug>`, o link que a tela copia. A correção pede uma lista de
  slugs reservados no backend, num lote próprio.

## 5. Bloqueio de rastreamento não é `noindex`

- `Disallow` no robots.txt só pede que o buscador não **baixe** o endereço.
  Ele ainda pode indexar o endereço (sem conteúdo) se achar um link para
  ele, e nunca lê o `noindex` de uma página que não baixou.
- `noindex` (meta tag ou `X-Robots-Tag`) tira da busca, mas só funciona se
  o buscador puder baixar a página.
- Por isso as áreas privadas e a pré-visualização ficam rastreáveis e levam
  `noindex`. O robots.txt não protege nada: o que protege as áreas privadas
  é a sessão exigida pela API.
- Para tirar da busca um endereço já indexado, use o `noindex` e a
  ferramenta de remoção do Search Console. Não bloqueie o endereço no
  robots.txt antes de o buscador ler o `noindex`.
