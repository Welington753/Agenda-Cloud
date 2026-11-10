# Runbook: estabelecimento de teste e slugs reservados no piloto

Este roteiro publica o lote `docs/plans/estabelecimento-teste-e-slugs-reservados.md`:
a migration 17 (`TenantTestFlag1793664000000`), a API e o web. Depois da
publicação, ele também cobre a classificação dos testes antigos e a conferência
de colisões de slug.

**Este documento nunca contém credencial, URL de banco, Endpoint ID ou
endereço real.** Quem opera digita as variáveis no próprio terminal, como nos
outros roteiros (`publicacao-piloto-render.md`, seção 6.B, passos 1 e 2).

## 0. Antes de começar: ordem em relação às comissões

- A publicação de comissões em massa (`5d74556`, roteiro
  `publicacao-comissoes-em-massa-piloto.md`) é **separada** e vem **antes**.
  Ela não tem migration e roda no estado 16.
- O kit da migration 16 (`aplicar-regra-geral-comissoes-piloto.mjs`) e a fase
  `conferir` dele só servem no commit deles. Num build com a migration 17, eles
  recusam de propósito, com `ERR_MIGRATIONS_COMPILADAS_INESPERADAS`. Rode esse
  kit numa worktree no commit do roteiro dele, nunca no head deste lote.
- Este lote parte do piloto com **exatamente as 16 migrations** e a API e o web
  já publicados no commit das comissões, ou no anterior (`8e8577d`). As duas
  versões aceitam o schema 17 (tabela de compatibilidade abaixo).

## 1. Compatibilidade

"Funciona" na tabela quer dizer que as páginas abrem e o agendamento segue.
**Não** quer dizer que a proteção contra indexação está ativa: ela só vale na
última linha, e só depois da classificação da seção 4.

| Banco | API | Web | Páginas | Proteção contra indexação |
|---|---|---|---|---|
| 16 | anterior | anterior | funcionam (estado atual) | não existe |
| 17 | anterior | anterior | funcionam. A API anterior não lê `is_test`, e o `INSERT` de um cadastro novo recebe o padrão `false` | não existe |
| 16 | **nova** | qualquer | **quebram**: a entidade `Tenant` da API nova lê `is_test`, e toda leitura de estabelecimento falha. Por isso a migration vem antes | — |
| 17 | nova | anterior | funcionam. O web anterior ignora `indexable` e a marca no portal | **inativa**: nenhum `noindex`, nem para quem já estiver marcado |
| 17 | anterior | nova | funcionam. Sem `indexable` na resposta, o web classifica toda página como indexável (é o comportamento anterior), e o portal esconde o controle da marca | **inativa**: nenhuma página é reconhecida como teste |
| 17 | nova | nova | funcionam | **ativa só para os marcados**. Com o padrão `false`, nenhum teste antigo está marcado até a seção 4 |

O web novo também muda o que acontece com a API lenta ou fora do ar
(seção 3.1): a página pública responde 503 temporário em vez de abrir.

**Ordem obrigatória:** backup, conferência antes, migration, conferência
depois, API, web, os dois no mesmo SHA. O deploy é manual no Render, com
Auto-Deploy desligado.

**Retorno:** o web e a API voltam ao commit anterior sem mexer no banco. A
coluna com padrão `false` não atrapalha a versão anterior. O `down` da
migration recusa enquanto algum estabelecimento estiver marcado como teste, e o
valor `TENANT_TEST_FLAG_CHANGED` de `audit_action` fica no banco (o PostgreSQL
não remove valor de enum).

## 2. Migration 17

Use uma cópia limpa do commit alvo, com as variáveis do piloto
(`PILOT_DIRECT_URL`, `PILOT_ENDPOINT_ID`, `PRODUCTION_ENDPOINT_ID`) e
`npm ci` em `backend/`.

1. **Backup antes de escrever**: um branch do Neon a partir do piloto, ou
   `pg_dump -Fc` restaurado num PostgreSQL descartável com a mesma contagem de
   linhas por tabela (`publicacao-piloto-render.md`, seção 6.C, passo 1).
   Anote o horário. Restaure só em banco descartável, nunca sobre o piloto.
2. **Conferência antes**, só leitura:
   ```bash
   PILOT_EXPECT=before-tenant-test-flag npm run pilot:check-database
   ```
   O resultado precisa ser `RESULT: SUCCESS`, com `MIGRATIONS_APPLIED: 16`,
   `SCHEMA_OBJECTS_OK: 0/2`, `MARCADOS_COMO_TESTE: coluna ainda não existe` e
   `BASELINE_FAILURES: none`. Essa conferência reaproveita a
   `after-commission-settings` inteira.
3. **Aplicar**:
   ```bash
   npm run build:migrations-runtime
   DIRECT_URL="$PILOT_DIRECT_URL" npm run migration:run:compiled
   ```
   O TypeORM aplica a 17 numa transação: o valor novo de `audit_action` e a
   coluna `tenants.is_test boolean NOT NULL DEFAULT false`. Nenhuma linha é
   reescrita.
4. **Conferência depois**, só leitura:
   ```bash
   PILOT_EXPECT=after-tenant-test-flag npm run pilot:check-database
   ```
   O resultado precisa ser `RESULT: SUCCESS`, com `MIGRATIONS_APPLIED: 17`,
   `SCHEMA_OBJECTS_OK: 2/2`, `MARCADOS_COMO_TESTE: 0` e
   `BASELINE_FAILURES: none`.

Se o passo 3 falhar ou a conexão cair, **não** repita, não rode
`migration:revert` e não restaure o backup sem decidir antes. Rode o passo 4
(ou o 2) para ver o estado real.

## 3. API e web

1. Publique a **API** no SHA alvo e confira `GET /public/<slug-real>`: a
   resposta traz `"indexable": true`.
2. Publique o **web** no mesmo SHA.
3. Confira por `curl -sI https://<web>/agendar/<slug-real>`: a resposta não
   pode trazer `x-robots-tag`, e o HTML traz o `canonical`.

O web precisa do proxy da API configurado (`API_PROXY_TARGET`, como no
modo mesma origem do piloto). Sem ele nenhuma página pública é lida no
servidor, e todas saem com `noindex` (dúvida nunca vira indexável). O site
inteiro já depende dessa variável no piloto; ela só não pode faltar.

### 3.1 Com a API lenta ou fora

O servidor do web decide a indexação **uma vez por requisição**
(`src/proxy.ts`). O cabeçalho `X-Robots-Tag` e o meta robots do HTML usam a
mesma decisão, então nunca divergem, mesmo que a leitura do layout dê outro
resultado.

| Situação na requisição | Resposta |
|---|---|
| API respondeu: teste | 200, `noindex, nofollow` no cabeçalho e no HTML |
| API respondeu: real | 200 normal, com canonical |
| API sem resposta em 2,5 s, erro ou resposta ilegível | **503**, `Retry-After: 30`, `Cache-Control: no-store`, sem `noindex`. A página tenta de novo sozinha a cada 10 s e tem um link "Tentar de novo agora". Nunca 404 |

Nenhuma classificação antiga é reaproveitada, nem para um estabelecimento
aberto há pouco. Uma lembrada poderia estar desatualizada (a marca trocada
no portal logo antes de a API falhar) e seria diferente em cada processo do
web. Só vale o que a API confirmou na própria requisição.

**Impacto na disponibilidade:** a página pública passa a depender da API em
toda abertura. Qualquer consulta que falhe ou passe de 2,5 s interrompe a
abertura daquela vez, mesmo para um estabelecimento que abriu um minuto
antes: o visitante vê "Estamos abrindo esta agenda" em vez da página. Ela
recarrega sozinha a cada 10 s, e o tempo até voltar depende só de quando a
API voltar a responder. No plano gratuito, a API hiberna depois de 15
minutos sem uso, e a primeira visita depois disso pode cair nessa página
enquanto ela acorda. O agendamento em si não fica pior: sem a API ele já não
funcionava. Um buscador que recebe 503 volta depois e não indexa nada
daquela resposta.

**Troca da marca:** como nada é lembrado, marcar ou desmarcar no portal vale
na primeira consulta bem-sucedida depois da troca, em qualquer processo do
web. Enquanto a API falhar, a resposta é 503, nunca a classificação de antes
da troca.

## 4. Classificar os testes antigos (obrigatório)

> **O padrão `false` não identifica nenhum teste antigo.** Até cada um ser
> marcado, todos os estabelecimentos continuam indexáveis como antes. Só
> considere a proteção efetiva no piloto depois deste passo.

1. Faça a lista dos estabelecimentos de teste a partir do que você sabe da
   operação. O sistema não adivinha nada por nome ou plano.
2. No portal, abra a ficha de cada um e use **Busca na internet → Marcar como
   teste**. Essa ação não pede senha e grava `TENANT_TEST_FLAG_CHANGED` no
   histórico administrativo, com o valor anterior e o novo.
3. Confira: `PILOT_EXPECT=after-tenant-test-flag npm run pilot:check-database`
   mostra `MARCADOS_COMO_TESTE` igual ao tamanho da sua lista.
4. Para cada marcado, `curl -sI https://<web>/agendar/<slug>` traz
   `x-robots-tag: noindex, nofollow`, e a página abre normalmente no
   navegador.
5. Uma página que já está no Google sai depois que o buscador a visita de
   novo. Para acelerar, use a remoção temporária do Search Console
   (`indexacao-e-search-console.md`, seção 2).

Com a API lenta ou fora, a resposta é 503, nunca a página indexável
(seção 3.1).

## 5. Colisões de slug

A partir deste lote, um cadastro novo nunca recebe um slug reservado: rota
fixa da raiz (`login`, `conta`, `portal`...), entrada antiga (`plataforma`,
`administracao`) ou slug da semente da demonstração. A lista fica em
`backend/src/common/reserved-slugs.ts`.

- **Slug gerado:** hoje o único jeito de nascer um slug é o cadastro pelo
  portal, que gera o slug do nome do negócio. O gerador trata o reservado
  como ocupado e escolhe o próximo livre: "Portal" vira `portal-2` (ou
  `portal-3`, se `portal-2` já existir). A UNIQUE do banco continua sendo a
  garantia final. Em cadastros simultâneos com o mesmo nome, quem perde a
  corrida tenta de novo com outro candidato.
- **Slug escolhido:** nenhuma rota aceita. Um `slug` no corpo do cadastro é
  recusado com 400 e nada é gravado, então um slug pedido nunca é trocado
  em silêncio. Se um dia existir uma rota que receba slug escolhido, ela
  responde 409 com `code: SLUG_RESERVADO` para um reservado
  (`assertSlugChangeAllowed`, já testado), e o mesmo slug reenviado sem
  mudança continua aceito.

Cadastros antigos **não** são renomeados. Para listá-los, só leitura:

```bash
npm run pilot:check-reserved-slugs
```

A saída tem `COLISOES: <n>` e uma linha `COLISAO: <slug> (situacao=...)` por
caso, sem nome, e-mail ou id. Um estabelecimento listado continua abrindo em
`/agendar/<slug>`, o link que a tela copia. Só o endereço curto `/<slug>` cai
na rota fixa ou na demonstração. Renomear um caso depende da sua decisão, um
de cada vez: não existe rota para trocar slug, e links já divulgados
quebrariam.

A conferência usa o mesmo guarda do `pilot:check-database`: URL direta do
piloto, Endpoint ID diferente do de production e TLS com verificação.
