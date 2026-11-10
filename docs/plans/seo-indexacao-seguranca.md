# SEO, indexação e cabeçalhos de segurança

Este lote revisou e completou 12 itens: sitemap, robots, títulos e
descrições, canonical, Open Graph, imagens, JSON-LD, Search Console, Google
Analytics, página 404, HTTPS e cabeçalhos de segurança. Não altera a API,
o banco, as migrations nem a publicação de comissões preparada em `5d74556`.

O roteiro operacional (o que o código faz, passos externos e conferência
no ambiente publicado) está em `docs/runbooks/indexacao-e-search-console.md`.

## Decisões

- A origem pública vem só do ambiente (`APP_PUBLIC_ORIGIN` ou
  `RENDER_EXTERNAL_URL`, só HTTPS), com a mesma fonte do proxy. Sem origem
  válida, nenhum endereço absoluto é publicado. Na pré-visualização, só
  `APP_PUBLIC_ORIGIN` vale: o endereço da prévia nunca vai para o HTML.
- O sitemap tem só a página inicial. As páginas `/agendar/<slug>` são
  indexáveis, mas não entram no sitemap (runbook, seção 4).
- As áreas privadas recebem `X-Robots-Tag: noindex` e não são bloqueadas
  no robots.txt. A pré-visualização segue a mesma lógica: `noindex` em toda
  resposta e robots.txt sem `Disallow`, porque um endereço bloqueado não
  tem o `noindex` lido (runbook, seção 5).
- A página do estabelecimento é lida no servidor com prazo de 2,5 s, pelo
  mesmo destino e segredo do proxy, sem cache. Só uma resposta 404 em JSON
  da API vira página 404. Qualquer dúvida mantém o comportamento anterior.
- O endereço curto `/<slug>` é decidido no servidor com a mesma leitura:
  `308` para `/agendar/<slug>` quando a API confirma o estabelecimento
  (destino que só depende do slug), 404 quando a API responde 404, `307`
  quando há dúvida. Os seis slugs da semente da demonstração continuam na
  demonstração, com `noindex`. Um estabelecimento criado na demonstração do
  navegador ainda aparece dentro da página 404 desse navegador.
- JSON-LD: `Organization` na página inicial e na página do
  estabelecimento, com os serviços e o preço só quando a tela o mostra.
  `LocalBusiness` foi descartado porque a página não mostra endereço. As
  propriedades e os tipos são conferidos contra o vocabulário schema.org em
  `src/lib/site/json-ld-vocabulario.test.ts`.
- A CSP é aplicada sem nonce, porque nonce obrigaria renderizar toda página
  por requisição. Scripts e estilos inline continuam liberados, e por isso
  a CSP não barra um script injetado por XSS.
- O HSTS vai sem `includeSubDomains` e sem `preload`.
- O Google Analytics não foi implementado: não há consentimento nem
  política de privacidade (runbook, seção 2).

## Estado e retomada

**Feito** (branch `feat/seo-indexacao-seguranca`, a partir de
`4d38f97`, PR #104):

- `sitemap.ts`, `robots.ts`, `not-found.tsx` e a rota
  `imagem-de-compartilhamento.png`;
- metadados da raiz, da página inicial, do login, do convite, da
  redefinição de senha e da página do estabelecimento;
- JSON-LD serializado com escape e conferido contra o vocabulário;
- cabeçalhos de segurança e `noindex` pelo `next.config.ts`, incluindo
  `noindex` em toda resposta da pré-visualização;
- endereço curto `/<slug>` decidido no servidor (`src/app/[slug]/page.tsx`
  e `src/lib/agendamento-publico/endereco-curto.ts`), com 404 próprio;
- testes unitários em `src/lib/site/*.test.ts` e
  `src/lib/agendamento-publico/{pagina-no-servidor,metadados-publicos,endereco-curto}.test.ts`.

**Verificado localmente:** builds de produção em modo mesma origem com uma
API fictícia e dados inventados, por curl e no Chromium:

- `/agendar/<slug>` e `/<slug>` para estabelecimento válido, inexistente,
  página desligada, API respondendo 502 e API lenta (5 s, cortada em 2,5 s);
- canonical, título, Open Graph e JSON-LD de dois estabelecimentos pedidos
  em paralelo, sem mistura;
- `Cache-Control: private, no-cache, no-store` nos redirecionamentos, nos
  404 e nas respostas da dúvida;
- demonstração da semente, demonstração criada no navegador e o mesmo
  endereço em outro navegador (404);
- login, cadastro, portal, conta, convite, redefinição de senha, manifesto
  e service worker sem violação de CSP;
- build de pré-visualização (`IS_PULL_REQUEST=true`): `X-Robots-Tag` em
  toda resposta, robots.txt sem bloqueio, sitemap vazio e nenhum endereço da
  prévia no HTML.

**Não feito:**

- Search Console, Analytics, domínio e DNS, que dependem do responsável;
- conferência no ambiente publicado (runbook, seção 3);
- marca de estabelecimento de teste no banco (decisão pendente, runbook,
  seção 4);
- R6, parte das colisões: slug real igual a uma rota da raiz ou a um slug
  da semente da demonstração continua alcançável só por `/agendar/<slug>`.
  Pede lista de slugs reservados no backend, num lote próprio;
- corpo do 404 sem JavaScript nas rotas dinâmicas: limitação do Next.js 16
  (status, título e `noindex` já vêm no HTML).

**Próximo passo:** com o CI verde e o PR aprovado, publique pelo runbook
de publicação, que depende de pedido explícito. Depois, faça a conferência
da seção 3 do roteiro de indexação.

**Só neste computador:** nada. A API fictícia usada na conferência ficou
no diretório temporário da sessão.
