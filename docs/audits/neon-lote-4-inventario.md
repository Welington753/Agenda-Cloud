# Lote 4 — Auditoria read-only do Neon existente

**Data:** 2026-09-03
**Commit auditado:** `c49ca75` (branch `integration/nestjs-typeorm-frontend`, trabalho feito em `feat/nestjs-typeorm-lote-4`)
**Issue:** [#1 — Lote 4] Auditar o Neon existente em modo read-only

## 1. Escopo e garantias read-only

- Toda consulta ao banco rodou dentro de `BEGIN TRANSACTION READ ONLY` com `statement_timeout = '10s'` e `lock_timeout = '2s'`, confirmando `SHOW transaction_read_only = on` antes de qualquer leitura de catálogo.
- A transação terminou com `ROLLBACK` (mesmo sendo só leitura), executado num bloco `finally` que roda independentemente de sucesso ou erro.
- Nenhum `CREATE`/`ALTER`/`DROP`/`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/`GRANT` foi emitido. Nenhuma migration, seed, `db push` ou `schema sync` foi executado.
- Conexão feita só com `DIRECT_URL`, lida internamente de `backend/.env` por um script Node temporário (`backend/tmp-lote4-audit.mjs`) que nunca imprimiu a URL, host, usuário ou senha — só o resultado das queries de catálogo. O script foi apagado ao final desta auditoria (confirmado via `git status`, nunca ficou tracked nem untracked no repositório).
- Nenhuma linha de tabela de negócio foi lida — só `information_schema`, `pg_catalog`, `pg_stat_user_tables` (estimativas agregadas) e a tabela de controle `_prisma_migrations` (metadata de migration, não dado de negócio). Nenhum dado pessoal (nome, telefone, e-mail, documento) foi consultado.

### Divergência registrada (Issue #1 × instruções desta execução)

A Issue #1 pede "criar branch/checkpoint no Neon (ou `pg_dump --schema-only` local) como ponto de rollback". As instruções desta execução proíbem explicitamente criar branch/checkpoint no painel da Neon. Segui a opção mais conservadora: **nenhum checkpoint foi criado**, nem no Neon nem via `pg_dump` local. Isso não é uma lacuna prática neste caso — o banco está vazio (seção 4), então não há dado para proteger com um checkpoint. Fica registrado para quem revisar: se o Lote 5 encontrar o banco em outro estado (após decisão humana sobre este relatório), a criação do checkpoint antes de qualquer DDL volta a ser obrigatória conforme a Issue #1 e a seção 8.2 do plano.

## 2. Baseline (sem tocar o banco)

| Verificação | Resultado |
| --- | --- |
| `npm run lint` (frontend) | limpo, exit 0 |
| `npm run lint:types` (frontend) | limpo, exit 0 |
| `npx tsc --noEmit` (frontend) | limpo, exit 0 |
| `npm test` (frontend) | 13 arquivos, **187 testes**, todos passando |
| `npm run build` (frontend) | sucesso, **21 rotas** |
| `npx prisma validate` | schema válido |
| `npm run lint` (backend) | limpo (oxlint), exit 0 |
| `npm test` (backend) | 7 arquivos, **157 testes**, todos passando |
| `npm run test:e2e` (backend) | 1 arquivo, **1 teste**, passando |
| `npm run build` (backend) | sucesso (`nest build`) |

Baseline bate exatamente com o esperado. Prosseguiu para a conexão.

## 3. Fontes locais lidas

`docs/plans/migracao-nestjs-typeorm-neon.md` (já lido integralmente em sessão anterior desta mesma conversa — conteúdo revalidado contra o código atual nesta auditoria), `prisma/schema.prisma`, `prisma/migrations/20260901155542_init/migration.sql`, `prisma.config.ts`, todos os 30 `backend/src/entities/*.entity.ts`, os 18 `backend/src/entities/enums/*.enum.ts`, `backend/src/database/{runtime,migrations}-data-source.ts`, `backend/src/database/snake-naming-strategy.ts`, `backend/src/config/env.validation.ts`, `backend/package.json`, `backend/.env.example`.

**Divergência de caminho:** a Issue #1/prompt cita `backend/src/enums/`; o diretório real é `backend/src/entities/enums/`. Lido o diretório real (opção conservadora — não assumir ausência sem checar o caminho certo).

## 4. Inventário sanitizado do Neon

**O banco Neon apontado por `DIRECT_URL` está completamente vazio.**

| Item | Resultado |
| --- | --- |
| Versão do PostgreSQL | 18.6 |
| Schemas não-sistêmicos | só `public` (nenhum schema de aplicação) |
| Extensões instaladas | só `plpgsql` (padrão do Postgres) — **`citext` e `btree_gist` não estão instaladas** |
| Tabelas | 0 |
| Views | 0 |
| Sequences | 0 |
| Enums (tipos) | 0 |
| Colunas | 0 (nenhuma tabela) |
| PK/FK/UNIQUE/CHECK/EXCLUDE | 0 constraints |
| Índices | 0 |
| Triggers | 0 |
| RLS habilitado / policies | nenhuma tabela para ter RLS; 0 policies |
| `_prisma_migrations` | **não existe** |
| Tabela de migrations do TypeORM (`migrations`) | **não existe** |

Nenhuma dessas conclusões foi tirada só pela ausência de uma tabela isolada — o inventário completo de catálogo (`information_schema.tables`, `pg_extension`, `pg_type`/`pg_enum`, `pg_constraint`, `pg_indexes`, `information_schema.triggers`, `pg_class`/`pg_policies`) retornou vazio de ponta a ponta, e `pg_stat_user_tables` (estimativas agregadas) também não lista nenhuma tabela — consistente com "banco nunca recebeu nenhum DDL", não com uma falha de query isolada.

## 5. Matriz Neon × Prisma × TypeORM

Como o Neon está vazio, a coluna "Neon" é "ausente" para tudo — a matriz existe para registrar o que Prisma e TypeORM *pretendem* criar, e onde os dois já divergem entre si (relevante para o Lote 5 decidir o que a migration TypeORM deve gerar).

| Área | Situação no Neon | Prisma (schema + migration local) | TypeORM (entidades atuais) | Diferença | Risco | Ação sugerida (Lote 5) |
| --- | --- | --- | --- | --- | --- | --- |
| Tabelas (25 originais) | Ausentes | 25 tabelas, `snake_case` via `@@map` | Mesmas 25 tabelas, `snake_case` via `@Entity('...')` | Nomes de tabela **idênticos** entre Prisma e TypeORM | Nenhum (banco vazio) | Migration TypeORM cria as 25 do zero, sem reconciliar nome de tabela |
| Tabelas novas (5) | Ausentes | Não existem no schema Prisma | `credentials`, `sessions`, `support_sessions`, `commission_rules`, `commission_entries` | TypeORM tem 5 tabelas que o Prisma nunca teve | Nenhum (banco vazio) | Migration TypeORM cria as 30 completas (seção 8.4 do plano, caminho "banco vazio") |
| **Colunas — nomenclatura** | N/A | Migration gera colunas em **camelCase** (`"tenantId"`, `"createdAt"` etc. — confirmado lendo `migration.sql`, nenhum `@map` de coluna individual no schema) | `SnakeNamingStrategy` própria gera colunas em **snake_case** (`tenant_id`, `created_at`) | **Divergência real de convenção física entre as duas ferramentas** — se a migration Prisma tivesse sido aplicada neste Neon, o TypeORM não acharia as colunas que espera | Seria **alto** se o banco não estivesse vazio; **nulo agora** | Como o banco está vazio, o Lote 5 não herda esse problema — a migration TypeORM parte do zero em snake_case. Registrar como risco só se algum dia uma migration Prisma for aplicada neste mesmo Neon antes do TypeORM |
| Colunas — tipos | N/A | IDs como `TEXT` (sem tamanho) | IDs como `varchar(30)` via `@PrimaryColumn` | Tipo de coluna incompatível (`TEXT` vs `VARCHAR(30)`) caso o schema Prisma fosse aplicado literalmente | Nulo agora (banco vazio); seria baixo-médio mesmo se existisse (cuid tem ~25 chars, cabe em 30) | Nenhuma ação — TypeORM define seu próprio tipo na migration que vai gerar |
| Enums | Ausentes | 16 enums | 18 enums (16 + `CommissionType` + `CommissionEntryStatus`) | TypeORM tem 2 enums a mais, valores dos 16 compartilhados conferem (`AppointmentStatus` comparado literalmente: `PENDING/CONFIRMED/IN_PROGRESS/COMPLETED/CANCELED/NO_SHOW` idêntico nos dois) | Nenhum | Migration TypeORM cria os 18 |
| `tenant_id` / isolamento multi-tenant | N/A | Presente em todas as tabelas operacionais (`Tenant` nunca tem `tenantId` nela mesma) | Mesmo desenho — `tenant_id` presente nas mesmas tabelas, `Tenant` sem `tenant_id` | Nenhuma | Nenhum | Confirmar nos testes de integração do Lote 12 |
| Entidades administrativas (User/Membership/Invite/AuditLog) | Ausentes | Presentes, sem `Credential`/`Session` | Presentes + `Credential`/`Session` novos | TypeORM cobre autenticação real (Lote 6), Prisma nunca cobriu | Nenhum (banco vazio) | Seguir seção 4 do plano no Lote 6 |
| Sessões e credenciais | Ausentes | Não existem no Prisma | `credentials`/`sessions` prontas (campos: hash de senha, token hash, `revokedAt`) | Só existem no TypeORM | Nenhum | Lote 6 |
| Comissões | Ausentes | Não existem no Prisma | `commission_rules`/`commission_entries` prontas (`@unique(appointmentId)` em `commission_entries`, snapshot imutável) | Só existem no TypeORM | Nenhum | Lote 9 |
| Personalização | Ausentes | `BrandIdentity` sem `logoUrl`, `BookingPolicy` sem `visitGuidance` | `BrandIdentity`/`BookingPolicy` já com os campos novos (confirmado lendo os `.entity.ts` — `bannerUrl`, `sectionOrder`, `customFooter`, `hidePlatformBranding` presentes; colunas de logo/orientação a confirmar linha a linha no Lote 10) | TypeORM mais completo que o schema Prisma nesses dois campos | Nenhum | Lote 10 |
| Agenda e disponibilidade (`Appointment`) | Ausente | `CHECK ("endAt" > "startAt")` e `EXCLUDE USING gist (professionalId WITH =, tstzrange(startAt,endAt) WITH &&) WHERE (status <> 'CANCELED')` — só existem no arquivo `migration.sql` (SQL bruto), nunca aplicados neste Neon | Nenhum decorator equivalente nas entidades (documentado no comentário do arquivo: "SQL bruto de migration, Lote 5") — colunas e índices (`tenantId+professionalId+startAt+endAt`, `tenantId+status+startAt`) já prontos | TypeORM ainda não tem o `CHECK`/`EXCLUDE` — precisam ser adicionados via `queryRunner.query(...)` na migration do Lote 5, replicando o texto já validado no arquivo Prisma | Alto se esquecido — é a proteção central contra dupla-reserva | **Lote 5 deve copiar literalmente o `CHECK`/`EXCLUDE` do `migration.sql` Prisma pra dentro da migration TypeORM, incluindo `CREATE EXTENSION IF NOT EXISTS btree_gist/citext`** |
| `_prisma_migrations` | Não existe | Uma migration local (`20260901155542_init`) nunca aplicada aqui | N/A | A migration Prisma nunca rodou contra este Neon | Nenhum | Nenhuma ação de reconciliação necessária — ver seção 8 |
| Tabela de migrations do TypeORM | Não existe | N/A | Ainda não gerada (nenhum arquivo em `backend/src/migrations/`, diretório nem existe) | Esperado neste estágio | Nenhum | Lote 5 cria a primeira migration e, com ela, a tabela de controle |

## 6. Constraints e índices

Não há nada a inventariar no banco (zero constraints, zero índices). O que existe é só a **intenção documentada nos dois lados**:

- Prisma (`migration.sql`, nunca aplicado aqui): `CHECK` de duração positiva + `EXCLUDE USING gist` contra sobreposição, `WHERE status <> 'CANCELED'` (NO_SHOW não libera a exclusão — mesma decisão já registrada no plano como "pergunta em aberto para o dono do produto", não resolvida aqui).
- TypeORM (entidades atuais): índices compostos liderando com `tenant_id` em `appointments` (`[tenantId, professionalId, startAt, endAt]` e `[tenantId, status, startAt]`) e em outras tabelas operacionais — já implementados como `@Index` nas entidades, prontos para a migration gerar. `CHECK`/`EXCLUDE` ainda pendentes de SQL bruto (ver matriz acima).

## 7. Isolamento multi-tenant

Não há dado no banco para testar isolamento na prática. Na **definição**, o desenho é consistente entre as duas camadas: `Tenant` nunca carrega `tenantId` nela mesma; toda tabela operacional (`Professional`, `Service`, `Consumer`, `Appointment`, `Invite`, `AuditLog`, `Unit`, `Membership`, etc.) tem `tenant_id` obrigatório (exceto `Invite`/`AuditLog`, que permitem `tenantId` nulo de propósito para cobrir convite/ação de escopo de plataforma — confirmado no `schema.prisma`, `tenantId String?` nesses dois models). Confirmação real de isolamento (zero `tenant_id` nulo onde deveria ser obrigatório, zero referência cruzada entre tenants) só é possível depois que o Lote 5 popular o banco — fica registrada como verificação obrigatória do Lote 12 (testes de integração).

## 8. Migrations e checksum

- `_prisma_migrations`: **tabela não existe neste Neon** — logo não há nenhuma linha de migration Prisma para comparar checksum.
- **Checksum: não aplicável.** Não existe migration aplicada neste banco para divergir de nada. A divergência de checksum mencionada em versões anteriores do plano (seção 8.10, "checksum divergente... porque a `EXCLUDE` foi corrigida depois do `deploy` original") **não se confirma neste Neon** — ou porque se referia a um banco diferente (o plano já registra separadamente um "banco Prisma Postgres de demonstração antigo", fora do escopo desta migração), ou porque esse Neon específico nunca chegou a receber o `migrate deploy` que geraria essa divergência.
- Nenhum arquivo nem tabela foi modificado para investigar isso. Nenhum `prisma migrate resolve` foi executado.
- Tabela de migrations do TypeORM: também não existe (esperado — nenhuma migration TypeORM foi gerada ainda, `backend/src/migrations/` nem existe como diretório).

## 9. Diferenças de nomenclatura

- **Tabelas:** convenção idêntica dos dois lados — `snake_case`, mesmos 25 nomes onde ambos definem a tabela.
- **Colunas:** convenção **diferente** — a migration Prisma gera colunas `camelCase` (sem `@map` por campo no schema atual); as entidades TypeORM usam `SnakeNamingStrategy` (colunas `snake_case`). Isso nunca chegou a colidir porque a migration Prisma nunca foi aplicada neste Neon — mas é um ponto de atenção arquitetural: se algum dia uma ferramenta rodar `prisma migrate deploy` contra este mesmo banco antes do Lote 5, os nomes de coluna ficariam incompatíveis com o que o TypeORM espera.
- **Enums:** valores em `SCREAMING_SNAKE_CASE` nos dois lados, idênticos onde compartilhados (conferido literalmente em `AppointmentStatus`, `TenantStatus`, `UserStatus`, `BusinessCategory` etc. via leitura direta dos dois arquivos-fonte).

## 10. Anomalias agregadas

Nenhuma — não há linhas para ter anomalia. Todas as verificações da seção 7 do prompt (contagem de `tenant_id` nulo, referências órfãs, duplicatas, agendamentos com término ≤ início, sobreposições) foram **puladas por não haver tabela nenhuma para consultar**, não por decisão de pular uma carga alta. Nenhuma ficou pendente por risco de carga — o motivo de não rodar é a ausência total de tabela, confirmada pelo inventário da seção 4.

## 11. Riscos para preservação dos dados

**Nenhum.** Não existe dado no banco. Qualquer DDL futuro do Lote 5 não corre risco de apagar ou corromper informação real, porque não há informação real neste Neon.

## 12. Estratégia recomendada para o Lote 5

O banco segue o caminho **"baseline vazio"** (seção 8.4 do plano, primeira opção): a migration TypeORM inicial deve cobrir as **30 tabelas completas desde o começo** — não há necessidade do caminho alternativo "baseline sem reaplicar tabela existente" (seção 8.7), porque não existe tabela existente para preservar.

Pontos que o Lote 5 precisa tratar explicitamente, coletados nesta auditoria:

1. `CREATE EXTENSION IF NOT EXISTS citext` e `CREATE EXTENSION IF NOT EXISTS btree_gist` — nenhuma das duas está instalada neste Neon; a migration TypeORM precisa criá-las (o `CREATE EXTENSION IF NOT EXISTS prisma_postgres` do lado Prisma é específico da infraestrutura gerenciada do Prisma e não se aplica ao TypeORM).
2. `CHECK ("end_at" > "start_at")` e `EXCLUDE USING gist (...) WHERE (status <> 'CANCELED')` em `appointments` — copiar o texto já validado em `prisma/migrations/20260901155542_init/migration.sql` (linhas 641 e 650–651), adaptando nomes de coluna para `snake_case` (`end_at`, `start_at`, `professional_id`) já que a migration TypeORM vai gerar colunas nesse formato.
3. Nenhuma reconciliação de checksum Prisma é necessária — não há linha em `_prisma_migrations` para reconciliar.
4. Nenhum dado a migrar ou preservar — a migration pode ser gerada e aplicada diretamente, sem etapa de comparação linha-a-linha contra dado real.

## 13. Pontos que exigem aprovação humana

- Confirmar que o caminho "baseline vazio" está correto antes de o Lote 5 gerar a migration — este relatório é a evidência, mas a Issue #1 exige revisão humana antes de prosseguir.
- Decidir se `NO_SHOW` deve ou não liberar a `EXCLUDE` (pergunta em aberto já registrada no plano, seção 13, item 1 — não decidida nesta auditoria).
- Confirmar se o checkpoint/branch do Neon (pedido pela Issue #1, pulado nesta execução por instrução explícita mais conservadora) deve ser criado manualmente antes do Lote 5, mesmo o banco estando vazio hoje — decisão de quem revisar este relatório.

## 14. Comandos proibidos que não foram executados

Nenhum destes comandos foi executado, em nenhum momento desta auditoria: `CREATE`, `ALTER`, `DROP`, `GRANT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `prisma migrate deploy/dev/reset`, `prisma migrate resolve`, `prisma db push`, `prisma db seed`, `typeorm migration:generate/run/revert`, `EXPLAIN ANALYZE`, criação de branch/checkpoint no painel da Neon.
