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
  válida, nenhum endereço absoluto é publicado.
- O sitemap tem só a página inicial. As páginas `/agendar/<slug>` são
  indexáveis, mas não entram no sitemap (runbook, seção 4).
- As áreas privadas recebem `X-Robots-Tag: noindex` e não são bloqueadas
  no robots.txt.
- A página do estabelecimento é lida no servidor com prazo de 2,5 s, pelo
  mesmo destino e segredo do proxy. Só uma resposta 404 em JSON da API
  vira página 404. Qualquer dúvida mantém o comportamento anterior.
- JSON-LD: `Organization` na página inicial e na página do
  estabelecimento, com os serviços e o preço só quando a tela o mostra.
  `LocalBusiness` foi descartado porque a página não mostra endereço.
- A CSP é aplicada sem nonce, porque nonce obrigaria renderizar toda página
  por requisição. Scripts e estilos inline continuam liberados.
- O HSTS vai sem `includeSubDomains` e sem `preload`.
- O Google Analytics não foi implementado: não há consentimento nem
  política de privacidade (runbook, seção 2).

## Estado e retomada

**Feito** (branch `feat/seo-indexacao-seguranca`, a partir de
`4d38f97`):

- `sitemap.ts`, `robots.ts`, `not-found.tsx` e a rota
  `imagem-de-compartilhamento.png`;
- metadados da raiz, da página inicial, do login, do convite, da
  redefinição de senha e da página do estabelecimento;
- JSON-LD serializado com escape;
- cabeçalhos de segurança e `noindex` pelo `next.config.ts`;
- testes unitários em `src/lib/site/*.test.ts` e
  `src/lib/agendamento-publico/{pagina-no-servidor,metadados-publicos}.test.ts`.

**Verificado localmente:** build de produção em modo mesma origem com uma
API fictícia e dados inventados. Foram conferidos os metadados, o
canonical, o JSON-LD (incluindo um nome com `</script>`), o 404 de
estabelecimento e de rota, os cabeçalhos, o sitemap e o robots. No
Chromium, a CSP não bloqueou nada na página inicial, no login, no portal,
no agendamento ou no service worker. Também foi feito um build sem origem
(como no CI), que não gerou nenhum endereço `localhost`.

**Não feito:**

- Search Console, Analytics, domínio e DNS, que dependem do responsável;
- conferência no ambiente publicado (runbook, seção 3);
- a colisão do endereço curto `/<slug>` (achado R6): `/qualquer-coisa`
  ainda responde 200 pela demonstração e encaminha no navegador para
  `/agendar/qualquer-coisa`, que responde 404.

**Próximo passo:** com o CI verde e o PR aprovado, publique pelo runbook
de publicação, que depende de pedido explícito. Depois, faça a conferência
da seção 3 do roteiro de indexação.

**Só neste computador:** nada. A API fictícia usada na conferência ficou
no diretório temporário da sessão.
