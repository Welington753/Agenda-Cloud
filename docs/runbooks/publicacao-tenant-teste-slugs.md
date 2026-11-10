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

| Banco | API | Web | Resultado |
|---|---|---|---|
| 16 | anterior | anterior | estado atual |
| 17 | anterior | anterior | funciona. A API anterior não lê `is_test`, e o `INSERT` de um cadastro novo recebe o padrão `false`. Nenhuma página sai da busca |
| 16 | **nova** | qualquer | **quebra**: a entidade `Tenant` da API nova lê `is_test`, e toda leitura de estabelecimento falha. Por isso a migration vem antes |
| 17 | nova | anterior | funciona. O web anterior ignora `indexable` e a marca no portal. Ainda não há `noindex` |
| 17 | anterior | nova | funciona. Sem `indexable` na resposta, o web trata a página como indexável, e o portal esconde o controle da marca |
| 17 | nova | nova | lote completo |

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

**Limite conhecido:** se a API demorar mais de 2,5 s na leitura do servidor
(plano gratuito acordando), aquela resposta sai sem o `noindex`. Esse é o
preço da regra que impede um estabelecimento real de sumir da busca nesse
mesmo caso. O buscador costuma voltar e ler a página de novo.

## 5. Colisões de slug

A partir deste lote, um cadastro novo nunca recebe um slug reservado: rota
fixa da raiz (`login`, `conta`, `portal`...), entrada antiga (`plataforma`,
`administracao`) ou slug da semente da demonstração. "Portal" vira
`portal-2`. A lista fica em `backend/src/common/reserved-slugs.ts`.

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
