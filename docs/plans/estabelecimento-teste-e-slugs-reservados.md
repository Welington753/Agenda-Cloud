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
  canonical) e no cabeçalho `X-Robots-Tag`, posto pelo `src/proxy.ts` só em
  `/agendar/<slug>`. Agendamento, link e Open Graph continuam funcionando.
  Quando a leitura falha ou o prazo de 2,5 s acaba, nada muda (vale a mesma
  regra do lote de SEO): um estabelecimento real nunca sai da busca porque a
  API estava acordando. Um teste pode ficar sem `noindex` numa resposta
  dessas, e o runbook registra esse limite.
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
- **Cadastro:** o slug não é digitado. Ele vem do nome do negócio
  (`slugify`), no aceite do convite. Um slug reservado é tratado como
  ocupado em `resolveSlug`: "Portal" vira `portal-2`, e o cadastro nunca é
  recusado por causa do nome (decisão do responsável, 10/11). A UNIQUE
  `uq_tenants_slug` e a nova tentativa em caso de corrida continuam iguais.
- **Troca de slug:** não existe rota para isso. O contrato fica pronto em
  `assertSlugChangeAllowed`: 409 com `code: SLUG_RESERVADO` para mudar para
  um slug reservado, e o mesmo slug reenviado sem mudança passa, mesmo que
  seja reservado. A edição de dados do portal não aceita slug.
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

**Não feito, de propósito:** merge do PR do lote, migration no piloto,
deploy, backup, DNS, classificação dos testes antigos e a publicação de
comissões (`5d74556`), que continua separada e vem antes (runbook, seção 0).

**Próximo passo concreto:** acompanhar o CI do PR no head final. Depois do
merge, quando houver pedido explícito: publicar comissões pelo roteiro
delas e, em seguida, este lote pelo `publicacao-tenant-teste-slugs.md`
(migration, API, web, classificação dos testes, conferência de colisões).

**Só neste computador:** o cluster PostgreSQL descartável no scratchpad da
sessão, que é apagado com ela. Nada de que o próximo passo dependa.
