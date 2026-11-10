# Estabelecimento de teste e slugs reservados

Este lote resolve as duas pendências que ficaram do lote de SEO
(`docs/plans/seo-indexacao-seguranca.md`): a marca de estabelecimento de teste
e as colisões de slug (achado R6). Ele traz uma migration nova e não mexe na
publicação de comissões preparada em `5d74556`, que continua separada.

Roteiro operacional (publicação, classificação dos testes antigos e
conferência de colisões): `docs/runbooks/publicacao-tenant-teste-slugs.md`.

## Decisões

- **`tenants.is_test boolean NOT NULL DEFAULT false`**, sem enum. O valor
  padrão não identifica nenhum teste antigo. Cada um precisa ser marcado
  pelo portal antes de a proteção valer no piloto.
- **Quem altera:** só uma conta da plataforma com `manageEstablishments`,
  relida dentro da transação, pela rota
  `PUT /platform/establishments/:tenantId/test-flag`. Dono, gerente e equipe
  não chegam a essa rota: ela fica no controlador da plataforma, e sem a
  capacidade a resposta é 403. Nenhuma rota de estabelecimento grava o campo.
- **Auditoria:** a ação `TENANT_TEST_FLAG_CHANGED` (valor novo de
  `audit_action`) guarda `previousData.isTest` e `newData.isTest` na mesma
  transação. Repetir o mesmo valor não grava nada (idempotente pelo estado).
  O pedido leva a versão lida (`expectedUpdatedAt`), como as outras escritas
  do portal.
- **Resposta pública:** `GET /public/:slug` ganha só `indexable: boolean`. O
  campo `is_test` não é exposto.
- **Página pública de teste:** `noindex, nofollow` nos metadados do HTML (sem
  canonical) e no cabeçalho `X-Robots-Tag`, só em `/agendar/<slug>`.
  Agendamento, link e Open Graph continuam funcionando.
- **Uma decisão por requisição** (revisão do PR, 10/11): o `src/proxy.ts` lê
  a API e decide. O cabeçalho sai dessa decisão, e o layout a recebe pelo
  cabeçalho interno `x-agenda-indexacao`. Antes, o layout e o proxy liam a
  API cada um por si e podiam divergir. O proxy apaga esse cabeçalho de toda
  requisição que chega, então o cliente não consegue forjá-lo.
- **API lenta ou fora:** vale a última classificação lida da API para aquele
  slug, guardada na memória do processo do web por até 1 h (no máximo 500
  slugs, só os que a API confirmou). Sem ela, o proxy responde 503 com
  `Retry-After: 30`, `no-store`, recarga automática e link para tentar de
  novo, sem `noindex` e nunca 404. Dúvida nunca vira "indexável", e um
  estabelecimento real nunca ganha `noindex` por falha passageira. A leitura
  nova sempre substitui a lembrada, e um 404 confirmado apaga a lembrança.
  Isso substitui o "limite conhecido" da primeira versão, em que um teste
  saía sem `noindex` quando a API passava de 2,5 s.
- **Sem proxy configurado** (desenvolvimento, suítes em chamada direta): o
  layout decide sozinho, e só uma página lida e não marcada é indexável.
- **API anterior sem `indexable`:** o web trata o campo ausente como
  indexável, que é o comportamento de hoje.
- **Sitemap:** continua só com a página inicial. Nenhuma lista pública de
  estabelecimentos.
- **Slugs reservados:** uma lista central em
  `backend/src/common/reserved-slugs.ts`, com as rotas fixas da raiz do web,
  as entradas antigas que redirecionam (`/plataforma`, `/administracao`) e os
  seis slugs da semente da demonstração. Pastas dinâmicas (`[slug]`) e grupos
  (`(area)`) não entram. Um teste do web compara a lista com as pastas de
  `src/app` e com a semente.
- **Slug gerado e slug escolhido são casos diferentes** (revisão do PR,
  10/11). No fluxo real (`InvitesService.createEstablishment`, cadastro pelo
  portal), o slug não é digitado: ele vem do nome do negócio (`slugify`).
  Para esse caso gerado, um reservado conta como ocupado em `resolveSlug`, e
  o gerador escolhe o próximo candidato livre e não reservado ("Portal" vira
  `portal-2`). Ninguém pediu `portal`, então nada é substituído em silêncio.
  A UNIQUE `uq_tenants_slug` e a nova tentativa em caso de corrida
  continuam iguais, e o db-e2e prova cadastros simultâneos com o mesmo nome
  reservado.
- **Slug escolhido:** nenhuma rota aceita. O corpo do cadastro é estrito, e
  `slug` nele dá 400 sem gravar nada (testado). A ficha do portal também
  recusa `slug`. Por isso o 409 `SLUG_RESERVADO` não está ligado a nenhuma
  rota: não existe onde ligá-lo, e criar uma rota de troca só para usá-lo
  ficou fora do escopo. O contrato fica pronto em `assertSlugChangeAllowed`
  (409 para um reservado, e o mesmo slug reenviado sem mudança passa).
- **Cadastros antigos:** nada é renomeado. Um slug reservado já gravado
  continua abrindo `/agendar/<slug>`. A conferência só de leitura
  `npm run pilot:check-reserved-slugs` lista as colisões, sem nomes de
  pessoas.

## Estado e retomada

**Checkpoint de 10/11/2026, branch `feat/tenant-teste-slugs-reservados`.**

**Feito:**

- PR #104 (SEO) mesclado em `ea5596c` antes de começar.
- Migration 17, marca no portal (rota, auditoria, controle na ficha),
  `indexable` na resposta pública, `noindex` no HTML e no
  `X-Robots-Tag` (`src/proxy.ts`), lista de slugs reservados aplicada no
  cadastro, conferências do piloto (`before/after-tenant-test-flag` e
  `pilot:check-reserved-slugs`) e runbook.
- Kits antigos (`ProfessionalCommissions`, `ProfessionalCommissionSettings`,
  6B.2, `aplicar-somente-a-pendente`) passaram a tratar a 17 como migration
  posterior: comparam só o prefixo deles e continuam recusando um runtime com
  a 17, de propósito.
- Verificado localmente, em PostgreSQL 18 descartável com TLS e dados
  fictícios: `migration:run:compiled` com as 17 migrations; revert para 16,
  "antes" aceito; nova aplicação da 17, "depois" aceito; unitários do backend
  e do web; HTTP do backend; db-e2e completo em banco novo (31 arquivos, 300
  testes); navegador `proxy` (cabeçalho e HTML reais de indexação),
  `administracao`, `agendamento-publico` e `portal-recusas`.

- Revisão do PR (10/11): decisão única de indexação no proxy (memória de
  1 h, 503 sem classificação), relé `api-controlavel.mjs` na suíte `proxy`
  para provar API lenta e fora com o Next.js e a API reais, distinção entre
  slug gerado e escolhido (400 para `slug` no cadastro, corrida com nome
  reservado) e tabela de compatibilidade refeita (página funcionando não
  quer dizer proteção ativa).

**Falha recorrente conhecida, fora deste lote:** `portal-instalavel`
("Portal AC sem sessão: manifesto próprio, sem service worker e navegação
entre as áreas") falha às vezes com dois `<link rel="manifest">` na página.
No CI do head `46f1b29`, ele falhou no job `test-frontend-auth` e passou na
reexecução. Localmente, com `--repeat-each 8`, falhou 4 de 8 com o lote e
2 de 8 num build sem `src/proxy.ts`. Não há relação comprovada com este
lote, então ele não foi corrigido nem afrouxado aqui. Fica para um lote
próprio.

**Não feito, de propósito:** merge do PR do lote, migration no piloto,
deploy, backup, DNS, classificação dos testes antigos e a publicação de
comissões (`5d74556`), que continua separada e vem antes (runbook, seção 0).

**Próximo passo concreto:** acompanhar o CI do PR no head final. Depois do
merge, quando houver pedido explícito: publicar comissões pelo roteiro
delas e, em seguida, este lote pelo `publicacao-tenant-teste-slugs.md`
(migration, API, web, classificação dos testes, conferência de colisões).

**Só neste computador:** o cluster PostgreSQL descartável no scratchpad da
sessão, que é apagado com ela. Nada de que o próximo passo dependa.
