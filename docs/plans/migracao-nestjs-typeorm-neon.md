# Migração para NestJS + TypeORM + Neon

Status: plano aprovado para execução faseada. Nenhum lote abaixo foi implementado ainda.
Este documento é o carimbo de saída da auditoria feita em `refactor/nestjs-typeorm`
(commit `6fc2fbd`, "chore: checkpoint before NestJS TypeORM migration").

## Decisão de arquitetura (dada, não revisitada aqui)

- Frontend e páginas públicas: Next.js atual, preservado no lugar.
- Backend/API: NestJS, em `backend/` (novo diretório na raiz do repo).
- Banco: PostgreSQL, hospedado no Neon (grátis, região São Paulo, para começar).
- ORM: TypeORM. Migrations: arquivos TypeScript do TypeORM (nunca `synchronize: true`).
- Prisma só é removido depois de paridade comprovada entre as duas camadas.
- UI continua 100% sobre `localStorage` nesta fase — nenhuma tela é reconectada.

## 1. Inventário do estado atual

Levantado lendo os arquivos reais (não os relatórios anteriores) em 2026-09-01.

### 1.1 Projeto

- `package.json`: `agenda-barber@0.1.0`, Next.js 16.3.4 + React 19.2.8, Vitest 4.1.11,
  Prisma 7.10.0 + `@prisma/adapter-pg` 7.10.0 + `pg` 8.23.0. Scripts: `dev`, `build`,
  `start`, `lint`, `test`, `test:db`. Sem `workspaces`.
- `tsconfig.json`: alias único `@/*` → `./src/*`. Nenhum path aponta para fora de `src/`,
  então criar `backend/` como diretório-irmão não colide com nada.
- `next.config.ts`: config vazia (`/* config options here */`), sem `serverExternalPackages`
  manual (Next 16 já trata `pg`/`@prisma/client` automaticamente).
- Git: branch `main` + remoto `origin` (`github.com/Welington753/Agenda-Cloud`). Nenhuma
  outra branch local existia antes deste plano.
- `.gitignore`: ignora `.env*` exceto `.env.example` — confirmado que `.env` nunca foi
  rastreado (`git ls-files` não o encontra) e está coberto pela regra `.env*` (`git
  check-ignore -v` confirma). `src/generated/` (client Prisma gerado, ~2,2 MB / 33
  arquivos) **não** está no `.gitignore` hoje e acabou de ser commitado no checkpoint —
  ver risco R7 abaixo.

### 1.2 Estrutura de `src/`

- `src/app/` — ~20 rotas do App Router (público `[slug]`, `login`, `403`, `master/*`,
  `painel/*`, `profissional/agenda`).
- `src/components/` — UI, modais, layout, e componentes de guarda de acesso
  (`require-role.tsx`, `require-permission.tsx`, `require-platform-permission.tsx`).
- `src/lib/`:
  - `types.ts` — domínio inteiro em português (`Estabelecimento`, `Unidade`,
    `Profissional`, `Servico`, `Consumidor`, `Agendamento`, `Membership`, `Convite`,
    `RegistroAuditoria`, `UsuarioPlataforma`, `UsuarioEstabelecimento`, etc.).
  - `repositories/index.ts` (414 linhas) — um objeto "repositório" por entidade sobre
    `storage/local-storage.ts`; cada função é síncrona, lê/escreve a coleção inteira via
    `readCollection`/`writeCollection`. Comentário no topo já antecipa a troca por API
    real "mantendo as mesmas assinaturas".
  - `availability/engine.ts` (140 linhas) — motor de disponibilidade **puro** (sem
    storage/React): `calcularHorariosDisponiveis`, `encontrarProfissionalDisponivel`,
    `horarioAindaDisponivel`, `intervalosSeSobrepoem`. Trata como "ocupando agenda" os
    status `pendente | confirmado | em_atendimento | concluido` (cancelado/no-show
    liberam) — mesma regra que a `EXCLUDE` constraint do Postgres já aplica.
  - `access/access-control.ts` (220 linhas) — `calcularAcessoEfetivo` (portal do
    estabelecimento) e `podeAdministrarPlataforma` (master), funções puras e
    centralizadas. Ordem de verificação: status do tenant → status do usuário → negação
    individual → feature no plano → feature desativada pelo master → permissão efetiva
    do papel. `identificarProprietarioPrincipal` deriva o MASTER_OWNER mais antigo (nunca
    removível) sem campo próprio.
  - `permissions.ts` — só rotas iniciais por papel, não é motor de permissão.
  - `tenant/tenant-context.tsx` — `tenantId` **sempre** da sessão simulada
    (`useTenantId`), nunca de URL/form; concentra `podeAcessar()` num único ponto.
  - `auth/auth-context.tsx` — sessão simulada em `sessionStorage`, sem senha/token real.
  - `planos.ts` — 3 planos (essencial/equipe/pro) e 13 features com rótulos, hoje
    hardcoded (`DEFINICOES_PLANO`), migrado para `Plan`/`Feature`/`PlanFeature` no schema
    Prisma e no seed.
  - `seed-data.ts` (1116 linhas) — gerador de dados de demonstração em memória, fonte
    original que `prisma/seed.ts` replica de forma determinística.
  - `db/prisma.ts` — singleton `PrismaClient` (`@prisma/adapter-pg`), cacheado em
    `globalThis`. **Nenhuma tela consome isto ainda.**
- Testes unitários existentes (50 testes, 6 arquivos): `access-control.test.ts`,
  `engine.test.ts`, `format.test.ts`, `tenant-isolation.test.ts`,
  `tenant-lifecycle.test.ts`, `terminologia.test.ts`. Todos sem rede/banco.

### 1.3 Camada Prisma (fundação anterior, `docs/plans/fundacao-postgresql.md`)

- `prisma/schema.prisma` — 703 linhas, 16 enums, 25 models mapeados para 25 tabelas
  (`@@map` em `snake_case`) + `_prisma_migrations` = 26 tabelas no banco.
- `prisma/migrations/20260901155542_init/migration.sql` — migration única aplicada,
  gerada via `migrate diff --from-empty` e editada à mão para acrescentar duas peças sem
  DSL no Prisma 7: `CHECK ("endAt" > "startAt")` e `EXCLUDE USING gist` anti-sobreposição.
- `prisma/seed.ts` (1537 linhas) — idempotente (upsert por chave natural), transacional
  por tenant, ancorado em `REFERENCE_DATE` fixa (não `new Date()`), conecta via
  `@prisma/adapter-pg` + `DIRECT_URL`. Desvios documentados no próprio cabeçalho: (a)
  `Barbeiro Bastião.maxProfissionais: 1` não tem tabela correspondente no schema (só
  `TenantFeatureOverride`, para features, não limites numéricos) — omitido; (b)
  `Invite.createdByUserId` é FK obrigatória sem equivalente no tipo de domínio `Convite`
  — seed atribui um ator plausível; (c) `PublicSettings.isPublished` é campo novo, sem
  equivalente na UI atual.
- `prisma/db-*.db.test.ts` (6 arquivos) + `db-test-helpers.ts` + `db-test-setup.ts` — 24
  testes de banco, execução serial (`vitest.db.config.ts`, `fileParallelism: false`),
  cada um cria/limpa só os próprios registros (nunca `deleteMany` global).
- **Divergência conhecida e não resolvida**: o checksum gravado em `_prisma_migrations`
  para `20260901155542_init` não bate com o arquivo `migration.sql` atual, porque o
  predicado da `EXCLUDE` foi corrigido *depois* do `migrate deploy` (edição manual do
  arquivo + `ALTER TABLE` direto no banco, sem nova migration). Arquivo e banco estão
  consistentes **entre si**; só o ledger de integridade do Prisma ficou desatualizado.
  Isso não afeta o Neon (banco novo, sem esse histórico), mas é a razão pela qual
  qualquer continuação da suíte Prisma antiga precisa reconciliar isso antes — não é
  assunto deste plano, só registrado para não se perder.
- **Credencial potencialmente exposta**: ao investigar por que `@prisma/adapter-pg` não
  conseguia falar com a `DATABASE_URL` (um endpoint Prisma Accelerate,
  `prisma+postgres://.../accelerate.prisma-data.net`, protocolo HTTP próprio que o driver
  `pg` não fala), um diagnóstico anterior imprimiu a URL completa — API key incluída — no
  transcript de uma ferramenta. Recomendação permanente, independente deste plano: girar
  essa API key no Prisma Console. **O Prisma Postgres antigo não será migrado nem
  reutilizado** (só tem dado demonstrativo), então essa exposição não compromete o Neon.
- O banco Prisma Postgres de demonstração continua fora do escopo: nenhum comando deste
  plano ou de sua execução toca nele.

### 1.4 Inventário de tabelas, enums, relacionamentos e constraints a transportar

**Enums (16)** — todos armazenados como tipos nativos Postgres (`CREATE TYPE ... AS
ENUM`) pelo Prisma; TypeORM deve recriá-los idênticos (mesmo nome, mesmos valores) no
Neon:

`PlatformRole`, `PlatformPermission`, `UserStatus`, `TenantStatus`, `BusinessCategory`,
`PageTemplate`, `FeatureKey`, `EstablishmentRole`, `Permission`, `PermissionMode`,
`InviteType`, `InviteStatus`, `AuditAction`, `ResourceType`, `ServiceModality`,
`AppointmentStatus`.

**Tabelas (25 models de domínio, ver seção 3 para detalhe campo a campo):**

| Grupo | Tabelas |
| --- | --- |
| Globais (sem `tenantId`) | `users`, `plans`, `features`, `plan_features` |
| Tenant e configuração | `tenants`, `tenant_feature_overrides`, `brand_identities`, `booking_policies`, `public_settings` |
| Operação | `units`, `memberships`, `membership_permission_overrides`, `invites`, `audit_logs`, `professionals`, `professional_schedules`, `services`, `professional_services`, `consumers`, `time_blocks`, `resources`, `appointments`, `appointment_items`, `appointment_resources`, `appointment_status_changes` |

**Extensões Postgres:** `citext` (colunas case-insensitive: `users.email`,
`tenants.slug`, `invites.targetEmail`) e `btree_gist` (pré-requisito da `EXCLUDE
USING gist`). `prisma_postgres` (extensão própria da infraestrutura Prisma Postgres
antiga) **não** deve ser recriada no Neon — é específica daquele provedor gerenciado.

**Constraints manuais (sem DSL, hoje em SQL bruto na migration Prisma):**

1. `CHECK ("endAt" > "startAt")` em `appointments`.
2. `EXCLUDE USING gist ("professionalId" WITH =, tstzrange("startAt","endAt") WITH &&)
   WHERE (status <> 'CANCELED')` em `appointments` — só `CANCELED` libera a agenda
   (confirmado como regra de negócio única; `NO_SHOW`, `COMPLETED` etc. continuam
   bloqueando sobreposição).

**Unicidades e índices notáveis** (lista completa por tabela na seção 3): `users.email`
único (citext); `tenants.slug` único (citext); `plans.code`, `features.key`,
`invites.tokenHash` únicos; `memberships.(userId, tenantId)` único +
`memberships.professionalId` único; `consumers.(tenantId, whatsappNormalized)` único;
`professional_schedules.(professionalId, weekday)` único; `professional_services.
(professionalId, serviceId)` único; `appointment_resources.(appointmentId, resourceId)`
único; `plan_features.(planId, featureId)` e `tenant_feature_overrides.(tenantId,
featureId)` únicos. Índices simples em toda FK `tenantId` de tabela operacional, mais
`appointments.(professionalId, startAt, endAt)`, `appointments.status`,
`appointments.startAt`, `time_blocks.(professionalId, startAt, endAt)`,
`invites.(tenantId, status)`, `invites.targetEmail`, `audit_logs.(tenantId,
occurredAt)`, `audit_logs.actorUserId`, `tenants.status`.

**Regras de negócio a preservar (não são só schema):**

- Isolamento por tenant: toda tabela operacional tem `tenantId` obrigatório + índice;
  global (`User`, `Plan`, `Feature`) não recebe `tenantId` artificial. Toda query deve
  combinar `id + tenantId`, nunca `id` sozinho.
- Dinheiro sempre `Int` (centavos). Datas de agendamento sempre `timestamptz` UTC.
  Telefone: campo original + `whatsappNormalized` (dígitos) indexado.
- `Invite` nunca guarda token em texto puro, só `tokenHash`.
- Cancelamento (`status = CANCELED`) libera a agenda tanto na `EXCLUDE` constraint do
  banco quanto — como segunda camada, independente do banco — na checagem transacional
  que a futura camada de repositório do NestJS precisará implementar (ver Lote 8).
- `TenantFeatureOverride` nunca apaga dado, só marca `enabled: false`.

## 2. Arquitetura-alvo

```text
Agenda-Cloud/
├── src/                 # Next.js atual — preservado, NÃO movido
├── backend/             # nova aplicação NestJS
│   ├── src/
│   │   ├── config/          # @nestjs/config + validação de env (Joi/Zod)
│   │   ├── database/        # DataSource de runtime + DataSource de migrations
│   │   ├── migrations/       # arquivos TypeScript do TypeORM
│   │   ├── entities/         # entidades TypeORM (uma por tabela)
│   │   ├── modules/          # um módulo Nest por domínio (tenants, users, ...)
│   │   ├── common/           # filtros de erro, interceptors, decorators de tenant
│   │   ├── health/           # health check
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── test/                 # testes de integração (contra Neon)
│   ├── package.json          # projeto npm independente (não workspace por ora — ver nota)
│   └── tsconfig.json
├── docs/
│   └── plans/
│       ├── fundacao-postgresql.md            # etapa Prisma (histórico)
│       └── migracao-nestjs-typeorm-neon.md   # este documento
└── package.json          # inalterado no que toca ao Next.js
```

Verificado antes de fechar esta estrutura: `tsconfig.json` da raiz só mapeia `@/*` →
`./src/*` (nada aponta pra fora), `next.config.ts` não referencia diretório algum fora de
`src/`, e não existe hoje `src/server/` nem `backend/` — criar `backend/` como
diretório-irmão não colide com nenhuma configuração existente. **Next.js não é movido.**

**Nota sobre monorepo:** `backend/` terá `package.json`/`node_modules`/scripts própprios,
tratado como projeto npm independente dentro do mesmo repositório Git — não workspace npm
por padrão (menos superfície nesta fase). O `package.json` da raiz ganha só scripts de
passagem opcionais (`"backend:build": "npm --prefix backend run build"`, etc.), sem
alterar `dependencies`/`devDependencies` do Next.js. Se o time preferir workspaces depois,
é uma migração de tooling isolada, não deste plano.

### 2.1 O que o backend NestJS deve prever desde o Lote 1–2

- `@nestjs/config` com **validação obrigatória** das variáveis de ambiente na
  inicialização (schema Joi ou Zod: falha rápido e claro se faltar `DATABASE_URL`,
  `DIRECT_URL`, porta, etc. — nunca sobe com env incompleta).
- TypeORM + driver `pg` (mesmo driver já usado no lado Prisma do projeto, comportamento
  de rede já validado).
- `synchronize: false` em **todos** os ambientes, sem exceção — schema só muda via
  migration versionada.
- **Dois `DataSource` distintos**, espelhando a separação que já existe do lado Prisma
  (`prisma.config.ts` usa `DIRECT_URL`, runtime usa `DATABASE_URL`):
  - `runtime DataSource` — usado pela aplicação (NestJS `TypeOrmModule.forRootAsync`),
    consome `DATABASE_URL` (a URL pooled do Neon).
  - `migrations DataSource` — usado só pelo TypeORM CLI (`typeorm migration:generate`,
    `migration:run`, `migration:revert`), consome `DIRECT_URL` (a URL direta do Neon,
    sessão longa, sem pooler — necessária para `CREATE EXTENSION`, locks de DDL, etc.,
    mesmo motivo documentado em `prisma.config.ts` hoje).
- Health check (`@nestjs/terminus` ou handler manual) cobrindo ao menos "app viva" e
  "consegue falar com o Postgres" (`SELECT 1` via runtime DataSource).
- CORS configurável por env (origem do Next.js em dev vs. produção).
- Tratamento padronizado de erros: um `ExceptionFilter` global traduzindo erros de
  domínio (não encontrado, conflito de unicidade, violação de constraint) para respostas
  HTTP consistentes — sem vazar detalhes internos do Postgres pro cliente.
  - **Nota de robustez:** o `ExceptionFilter` também precisa reconhecer o erro de
    violação da `EXCLUDE` constraint anti-sobreposição (código Postgres `23P01`,
    "exclusion_violation") e traduzi-lo para uma resposta 409/conflito clara — é a
    própria proteção de concorrência do banco, não um erro genérico de servidor.
- Transações (via `DataSource.transaction()` ou `QueryRunner` manual) em toda operação
  que grava mais de uma tabela (ex.: criar tenant = `Tenant` + `BrandIdentity` +
  `BookingPolicy` + `PublicSettings` + `Unit` principal + `Membership` do dono).
- Isolamento por tenant reforçado na camada de serviço: todo método de
  repositório/serviço que toca dado operacional recebe um contexto de tenant explícito
  (equivalente ao `TenantContext`/`ActorContext` já desenhado no plano Prisma anterior) e
  toda query combina `id + tenantId`.
- Auditoria: serviço central de escrita em `AuditLog`, chamado pelos serviços de domínio
  (não espalhado).
- Testes unitários (serviços/regras puras, sem banco) e testes de integração (contra o
  Neon real, seguindo o mesmo padrão serial/limpeza-cirúrgica já validado em
  `prisma/db-*.db.test.ts`).
- Scripts claros em `backend/package.json`: `migration:generate`, `migration:run`,
  `migration:revert`, `seed`, `test`, `test:integration`, `lint`, `build`, `start:dev`.

## 3. Mapeamento Prisma → TypeORM

Convenção preservada: nome de entidade em inglês (igual ao model Prisma), mapeada para
tabela/coluna `snake_case` via decorators (`@Entity({ name: "..." })`,
`@Column({ name: "..." })`) — mesma ruptura deliberada com o português de
`src/lib/types.ts` já registrada em `docs/plans/fundacao-postgresql.md`, preservada aqui
por continuidade, não redecidida.

| # | Model Prisma → Entidade TypeORM | Tabela | Observação de transporte |
| --- | --- | --- | --- |
| 1 | `User` | `users` | `email` vira `@Column({ type: "citext", unique: true })`. `platformPermissions` é array de enum (`PlatformPermission[]`) — TypeORM: `@Column({ type: "enum", enum: PlatformPermission, array: true, nullable: true })`. |
| 2 | `Plan` | `plans` | `code` único. `priceCents` sempre `int`. |
| 3 | `Feature` | `features` | `key` único (`FeatureKey`). |
| 4 | `PlanFeature` | `plan_features` | Junção M:N explícita. Único `(planId, featureId)`. FK cascade nos dois lados. |
| 5 | `Tenant` | `tenants` | `slug` citext único. FK `planId` → `plans` (`onDelete: RESTRICT`). Índice em `status`. |
| 6 | `TenantFeatureOverride` | `tenant_feature_overrides` | Único `(tenantId, featureId)`. Índice em `tenantId`. Cascade em ambas FKs. |
| 7 | `BrandIdentity` | `brand_identities` | 1:1 com `Tenant` (`tenantId` único). Cascade. Arrays de string nativos (`photos`, `sectionOrder`). |
| 8 | `BookingPolicy` | `booking_policies` | 1:1 com `Tenant`. Cascade. |
| 9 | `PublicSettings` | `public_settings` | 1:1 com `Tenant`. Cascade. `operatingDays` é `int[]`. |
| 10 | `Unit` | `units` | FK `tenantId` → `Tenant` (`RESTRICT`). Índice em `tenantId`. |
| 11 | `Membership` | `memberships` | Único `(userId, tenantId)` e `professionalId` único (nullable). FK `userId`/`tenantId` `RESTRICT`, `professionalId` `SET NULL`. |
| 12 | `MembershipPermissionOverride` | `membership_permission_overrides` | Único `(membershipId, permission)`. Cascade. |
| 13 | `Invite` | `invites` | `targetEmail` citext. `tokenHash` único — **nunca** persistir o token puro. Índices `(tenantId, status)` e `targetEmail`. FK `tenantId` `RESTRICT` (nullable), `createdByUserId` `RESTRICT`. |
| 14 | `AuditLog` | `audit_logs` | `previousData`/`newData` como `jsonb`. Índices `(tenantId, occurredAt)` e `actorUserId`. FK `RESTRICT` nos dois lados. |
| 15 | `Professional` | `professionals` | FK `tenantId` `RESTRICT`, `unitId` `SET NULL` (nullable). Índice em `tenantId`. |
| 16 | `ProfessionalSchedule` | `professional_schedules` | Único `(professionalId, weekday)`. Cascade. `weekday` é `int` puro (não enum). |
| 17 | `Service` | `services` | FK `tenantId` `RESTRICT`. Índice em `tenantId`. `priceCents` nullable (serviço sem preço público). |
| 18 | `ProfessionalService` | `professional_services` | Junção M:N. Único `(professionalId, serviceId)`. Cascade nos dois lados. |
| 19 | `Consumer` | `consumers` | Único `(tenantId, whatsappNormalized)` — isolamento por tenant é **por par**, nunca telefone sozinho. Índices em `tenantId` e `whatsappNormalized`. FK `RESTRICT`. |
| 20 | `TimeBlock` | `time_blocks` | FK `tenantId` `RESTRICT`, `professionalId` `CASCADE`. Índices `tenantId` e `(professionalId, startAt, endAt)`. |
| 21 | `Resource` | `resources` | FK `tenantId` `RESTRICT`. Índice `tenantId`. |
| 22 | `Appointment` | `appointments` | Ver seção 3.1 — carrega os dois constraints manuais. FKs `tenantId`/`unitId`/`consumerId`/`professionalId` todas `RESTRICT` (nunca apagar dado operacional referenciado). Campos de snapshot (`consumerNameSnapshot`, `consumerWhatsappSnapshot`) são histórico imutável proposital, não denormalização acidental — preservar tal como está. |
| 23 | `AppointmentItem` | `appointment_items` | FK `appointmentId` `CASCADE`, `serviceId` `RESTRICT`. Índice `appointmentId`. |
| 24 | `AppointmentResource` | `appointment_resources` | Único `(appointmentId, resourceId)`. FK `appointmentId` `CASCADE`, `resourceId` `RESTRICT`. |
| 25 | `AppointmentStatusChange` | `appointment_status_changes` | FK `appointmentId` `CASCADE`. Índice `appointmentId`. `fromStatus` nullable (primeira transição). |

### 3.1 `Appointment` — as duas peças sem decorator

TypeORM não representa `CHECK` arbitrário nem `EXCLUDE USING gist` via decorator de
entidade. Assim como no Prisma, isso vai em SQL bruto dentro da migration TypeScript
(`queryRunner.query(...)`), documentado no cabeçalho do arquivo de migration:

```sql
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_end_after_start_check"
  CHECK ("endAt" > "startAt");

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_overlap_excl"
  EXCLUDE USING gist (
    "professionalId" WITH =,
    tstzrange("startAt", "endAt") WITH &&
  )
  WHERE ("status" <> 'CANCELED');
```

E no `down()` da mesma migration, os `DROP CONSTRAINT` correspondentes — testados antes
de considerar o lote pronto (ver Lote 5).

### 3.2 Extensões

Na primeira migration TypeORM (`down()` também reverte, se a extensão não for usada por
mais nada):

```sql
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

`prisma_postgres` **não** entra — é específica do provedor Prisma Postgres antigo, o Neon
não a tem e não precisa dela.

## 4. Estratégia de migrations (TypeORM)

Fluxo obrigatório, nesta ordem, espelhando o rigor que já foi seguido do lado Prisma:

1. Entidades TypeORM escritas primeiro (Lote 3), **sem** tocar no banco ainda.
2. `typeorm migration:generate` contra o Neon **vazio** (requer `DIRECT_URL` real — ver
   checkpoint da Etapa 7) para produzir o SQL inicial a partir das entidades.
3. Inspeção manual do SQL gerado (mesmo hábito do Prisma: nunca aplicar sem ler).
4. Edição manual para acrescentar as duas constraints da seção 3.1 e os `CREATE
   EXTENSION` da seção 3.2 — o gerador de diff do TypeORM não os produz sozinho, do mesmo
   jeito que o `migrate diff` do Prisma não produzia.
5. Aplicar com `typeorm migration:run` usando o `migrations DataSource` (`DIRECT_URL`).
   **Nunca** `synchronize: true`, nunca um equivalente a `db push`.
6. Verificar com uma query de estado (tabelas, extensões, definição das constraints) —
   mesmo tipo de auditoria somente-leitura já praticada na fundação Prisma.

Cada lote de entidade nova (se o trabalho for fatiado além do Lote 4) segue o mesmo
ciclo: gerar → inspecionar → editar se precisar de SQL manual → aplicar → verificar.

## 5. Estratégia de seed

- `backend/src/database/seed.ts` (ou equivalente), script standalone rodado via
  `ts-node`/`tsx` fora do NestJS runtime — mesmo padrão do `prisma/seed.ts` atual.
- **Idempotente por construção**: `INSERT ... ON CONFLICT (...) DO UPDATE` (upsert nativo
  do Postgres, via `QueryBuilder().insert().orUpdate()` do TypeORM) usando as mesmas
  chaves naturais já validadas no seed Prisma (`slug` em Tenant, `email` em User, `code`
  em Plan, `key` em Feature, `tokenHash` em Invite, IDs determinísticos nas tabelas
  operacionais).
- Mesma âncora de data fixa (`REFERENCE_DATE`) em vez de `new Date()` — reaproveitando a
  decisão e os valores já usados em `prisma/seed.ts`, para que os dois seeds (Prisma
  antigo e TypeORM novo) sejam comparáveis registro a registro durante a fase de
  paridade.
- Mesmos três desvios documentados do seed Prisma (Barbeiro Bastião sem tabela de limite
  numérico, `Invite.createdByUserId` com ator plausível, `PublicSettings.isPublished`
  como decisão de seed) — reafirmados aqui, não redecididos.
- Envolvido em transação por tenant, mesma razão: falha no meio de um tenant não deixa
  dado parcial.
- Roda contra o Neon usando `DIRECT_URL` (script CLI de sessão longa, mesmo raciocínio já
  aplicado em `prisma.config.ts`/`prisma/seed.ts`).

## 6. Estratégia de testes

- **Unitários** (`backend/test` ou `backend/src/**/*.spec.ts`): regras puras de domínio
  (validação, cálculo de acesso efetivo replicado/adaptado, motor de disponibilidade se
  for portado) — sem rede, sem banco, rodam sempre, inclusive em CI sem Neon configurado.
- **Integração** (`backend/test/*.integration.spec.ts` ou equivalente): contra o Neon
  real, execução **serial** (mesma razão do `fileParallelism: false` já usado em
  `vitest.db.config.ts` — evitar corrida no mesmo banco compartilhado). Cada teste cria
  registros com ID único (`crypto.randomUUID()` ou prefixo `test-<timestamp>-`) e limpa
  só o que criou — nunca `TRUNCATE`/delete global.
- Cobertura mínima (replicando e estendendo a já validada em `prisma/db-*.db.test.ts`):
  conexão, seed idempotente (rodar 2x, contagens idênticas), slug duplicado rejeitado,
  criação transacional de tenant, rollback em falha no meio da transação, isolamento
  entre dois tenants (consumidor/profissional/serviço/agendamento), cancelamento
  liberando o horário, sobreposição bloqueada pela `EXCLUDE` (e mapeada para 409 pelo
  `ExceptionFilter`), feature desativada preservando dado, convite só com hash, auditoria
  vinculada a ator e tenant corretos.
- Os 50 testes unitários do Next.js (`npm run test` na raiz) e os 24 testes de banco
  Prisma (`npm run test:db`) continuam existindo e passando durante toda a migração —
  são a rede de segurança de paridade até o Lote 10 (remoção do Prisma).

## 7. Plano por lotes

Cada lote é um passo committável isoladamente, na branch `refactor/nestjs-typeorm`.
Nenhum lote além do checkpoint atual foi executado.

### Lote 1 — Estrutura NestJS

- **Arquivos:** `backend/package.json`, `backend/tsconfig.json`, `backend/nest-cli.json`,
  `backend/src/main.ts`, `backend/src/app.module.ts`, `.gitignore` (adicionar
  `backend/node_modules`, `backend/dist`).
- **Comandos:** `npx @nestjs/cli new backend --package-manager npm --skip-git` (ou
  scaffold manual equivalente) a partir da raiz do repo.
- **Testes:** `backend/test/app.e2e-spec.ts` gerado pelo Nest (smoke test HTTP, sem
  banco).
- **Critério de aceitação:** `npm --prefix backend run build` e `npm --prefix backend run
  start:dev` sobem sem erro; endpoint raiz responde. `npm run test`/`lint`/`build` na
  raiz continuam intactos (backend não interfere no Next.js).
- **Rollback:** apagar `backend/` inteiro; nada fora dele foi tocado.
- **Não remover:** nada ainda existe para remover neste lote.

### Lote 2 — Configuração e DataSource

- **Arquivos:** `backend/src/config/env.validation.ts` (schema Joi/Zod), `backend/src/
  config/config.module.ts`, `backend/src/database/runtime-data-source.ts`, `backend/src/
  database/migrations-data-source.ts`, `backend/.env.example` (placeholders, nunca valor
  real).
- **Comandos:** nenhum contra banco. Só `npm --prefix backend run build`.
- **Testes:** unitário do schema de validação (env incompleta → falha explícita).
- **Critério de aceitação:** app recusa subir com env inválida/incompleta; com
  `DATABASE_URL`/`DIRECT_URL` ausentes (ainda sem Neon, ver Etapa 7), o teste unitário de
  validação passa sem precisar de banco real.
- **Rollback:** reverter o commit do lote.
- **Não remover:** nada do Lote 1.

### Lote 3 — Enums e entidades

- **Arquivos:** `backend/src/entities/*.entity.ts` (25 arquivos, um por tabela da seção
  3), `backend/src/entities/enums/*.ts` (16 enums da seção 1.4).
- **Comandos:** nenhum contra banco (entidades são só metadata TypeScript).
- **Testes:** compilação (`tsc --noEmit`) + teste unitário garantindo que toda entidade
  tem `@Entity({ name })` batendo com a tabela `snake_case` esperada.
- **Critério de aceitação:** build limpo; contagem de entidades = 25; contagem de enums =
  16 (conferir contra a lista da seção 1.4, não de memória).
- **Rollback:** reverter o commit; nenhum banco foi tocado.
- **Não remover:** `prisma/schema.prisma` continua sendo a fonte de verdade até o Lote 9.

### Lote 4 — Migration inicial TypeORM ⚠️ primeiro ponto que exige Neon real

- **Pré-requisito:** checkpoint da Etapa 7 cumprido (projeto Neon criado, região São
  Paulo, `DATABASE_URL`/`DIRECT_URL` configuradas localmente em `backend/.env`, nunca
  commitadas).
- **Arquivos:** `backend/src/migrations/<timestamp>-Init.ts`.
- **Comandos:** `typeorm migration:generate` contra o Neon vazio, usando o `migrations
  DataSource` (`DIRECT_URL`).
- **Testes:** nenhum ainda — só inspeção manual do SQL gerado.
- **Critério de aceitação:** SQL gerado cobre as 25 tabelas + 16 enums, sem `synchronize`
  envolvido, revisado linha a linha antes de seguir para o Lote 5.
- **Rollback:** apagar o arquivo de migration; banco Neon continua vazio (nada foi
  aplicado ainda neste lote).
- **Não remover:** nada.

### Lote 5 — Constraints PostgreSQL manuais

- **Arquivos:** edição do mesmo arquivo de migration do Lote 4 (acrescentar `CREATE
  EXTENSION`, `CHECK`, `EXCLUDE USING gist` da seção 3.1/3.2, com `down()` simétrico).
- **Comandos:** `typeorm migration:run` (aplica pela primeira vez, `DIRECT_URL`).
- **Testes:** query somente-leitura confirmando: 25 tabelas + enums criados, extensões
  `citext`/`btree_gist` presentes, definição exata das duas constraints em `appointments`
  batendo com a seção 3.1 (mesma auditoria já praticada no lado Prisma).
- **Critério de aceitação:** `typeorm migration:show` reporta a migration aplicada;
  inserir dois agendamentos sobrepostos do mesmo profissional falha com `23P01`; inserir
  `endAt <= startAt` falha com violação de `CHECK`.
- **Rollback:** `typeorm migration:revert` (testado explicitamente antes de considerar o
  lote pronto — down() simétrico é parte do critério de aceitação, não opcional).
- **Não remover:** nada.

### Lote 6 — Seed idempotente

- **Arquivos:** `backend/src/database/seed.ts` + dados replicados de
  `src/lib/seed-data.ts`/`src/lib/planos.ts` (mesma fonte, seção 5).
- **Comandos:** script de seed via `ts-node`/`tsx`, `DIRECT_URL`.
- **Testes:** rodar 2x seguidas, comparar contagens (devem ser idênticas) — mesmo teste
  que já validou o seed Prisma.
- **Critério de aceitação:** contagens finais por tabela iguais às já obtidas no seed
  Prisma (mesma fonte de dados, mesma âncora de data) — primeira evidência concreta de
  paridade.
- **Rollback:** `deleteMany`/`DELETE` filtrado pelas chaves determinísticas do seed (nunca
  `TRUNCATE`), ou simplesmente `migration:revert` + `migration:run` de novo num Neon de
  teste.
- **Não remover:** `prisma/seed.ts` continua rodando contra o Prisma Postgres antigo
  (ambientes independentes).

### Lote 7 — Testes de banco (integração)

- **Arquivos:** `backend/test/*.integration.spec.ts`, réplica adaptada dos 6 arquivos
  `prisma/db-*.db.test.ts` (cobertura da seção 6).
- **Comandos:** script `test:integration` novo em `backend/package.json`.
- **Testes:** os próprios testes de integração — 24+ casos espelhando os já existentes.
- **Critério de aceitação:** 100% dos testes de integração passando contra o Neon;
  nenhuma linha `test-*` órfã sobrevive à suíte (mesma checagem já feita do lado Prisma).
- **Rollback:** reverter o commit do lote; nenhuma alteração de schema/dado permanente.
- **Não remover:** suíte Prisma (`npm run test:db`) continua rodando em paralelo até o
  Lote 9.

### Lote 8 — Serviços e repositórios server-side

- **Arquivos:** `backend/src/modules/*/` (um módulo Nest por domínio: tenants, users,
  professionals, services, consumers, appointments, invites, audit, plans/features),
  cada um com `*.service.ts` (regra de negócio + transação + isolamento por tenant) e
  `*.repository.ts` ou `Repository<Entity>` injetado.
- **Comandos:** nenhum novo contra banco além dos já rodados.
- **Testes:** unitários por serviço (regra pura, banco mockado) + integração cobrindo os
  fluxos completos (criar tenant transacional, criar agendamento com checagem de
  sobreposição em duas camadas — `EXCLUDE` do banco **e** checagem transacional no
  serviço, mesma dupla proteção já decidida no plano Prisma anterior).
- **Critério de aceitação:** paridade funcional com as regras de `src/lib/access/
  access-control.ts` e `src/lib/availability/engine.ts` (mesmos resultados para os mesmos
  casos de teste, adaptados para rodar contra o serviço Nest em vez da função pura
  client-side).
- **Rollback:** reverter o commit do lote; camada é nova, não substitui nada em uso.
- **Não remover:** `src/lib/repositories/*` (localStorage) continua sendo o que a UI usa
  — nenhuma tela muda neste lote.

### Lote 9 — Verificação de paridade

- **Arquivos:** nenhum novo — só relatório de comparação (pode viver neste próprio
  documento, seção a acrescentar, ou um novo `docs/plans/paridade-nestjs-typeorm.md`).
- **Comandos:** rodar seed Prisma e seed TypeORM lado a lado (bancos diferentes: Prisma
  Postgres antigo vs. Neon), comparar contagens por tabela e uma amostra de registros
  campo a campo.
- **Testes:** os 24 testes de integração TypeORM cobrindo os mesmos cenários que os 24
  testes `*.db.test.ts` do Prisma, com resultado equivalente.
- **Critério de aceitação:** paridade de schema (mesmas 25 tabelas, 16 enums, mesmas
  constraints/índices/unicidades), paridade de dado (mesmas contagens do seed) e
  paridade de comportamento (mesmos testes passando nos dois lados). Só depois disso o
  Lote 10 pode começar.
- **Rollback:** não aplicável (lote só de verificação, sem mudança de estado).
- **Não remover:** nada — este é o portão antes de remover qualquer coisa do Prisma.

### Lote 10 — Remoção segura do Prisma

- **Só inicia depois do Lote 9 aprovado explicitamente.**
- **Arquivos removidos:** `prisma/` inteiro (schema, migration, seed, testes de banco),
  `prisma.config.ts`, `src/generated/prisma/`, `src/lib/db/prisma.ts`,
  `vitest.db.config.ts`, dependências `prisma`/`@prisma/client`/`@prisma/adapter-pg`/`pg`
  do `package.json` da raiz (o `pg` do backend é uma dependência separada, em
  `backend/package.json`, e fica).
- **Critério de aceitação:** `npm run test`/`lint`/`build` na raiz continuam limpos sem
  nenhum arquivo Prisma; nenhuma referência a `@prisma/*` sobra em `src/` fora do que já
  foi removido.
- **Rollback:** `git revert` do commit de remoção (tudo em Git, nada destrutivo fora do
  controle de versão) — o Prisma Postgres antigo (banco em si) nunca precisa ser
  restaurado porque só tinha dado demonstrativo.
- **O que não pode ser removido:** `docs/plans/fundacao-postgresql.md` fica como registro
  histórico da etapa anterior, mesmo depois do código Prisma sair.

### Lote 11 — Documentação

- **Arquivos:** atualizar este documento com o resultado real de cada lote (não deixar o
  plano como única fonte — registrar o que de fato aconteceu, divergências incluídas,
  mesmo padrão de honestidade já praticado em `docs/plans/fundacao-postgresql.md`), mais
  um `backend/README.md` com como rodar/testar/migrar localmente.
- **Critério de aceitação:** qualquer pessoa nova consegue clonar, configurar `.env`,
  rodar migrations e seed, e subir o backend só lendo a documentação.

### Lote 12 — Integração futura das telas via API (fora desta execução)

- Registrado aqui só como próximo passo, **não implementado nesta migração**: trocar,
  tela por tela, os repositórios `src/lib/repositories/*` (localStorage) pelos
  equivalentes HTTP contra o backend NestJS. Começar pela área `master` (menor
  superfície) antes do `painel` do tenant — mesma ordem já sugerida no plano Prisma
  anterior. Autenticação real (ex.: sessão via cookie assinado pelo NestJS) é
  pré-requisito antes deste lote, e também fora do escopo agora.

## 8. Riscos

- **R1 — Neon free tier e cold start/hibernação.** O plano gratuito do Neon hiberna
  compute ocioso; a primeira query depois de um período parado pode ter latência bem
  maior. Mitigação: nada a fazer nos Lotes 1–9 (afeta produção, não desenvolvimento);
  documentar no Lote 11 como algo a revisar antes de "produção futura" (fora deste
  plano).
- **R2 — `EXCLUDE USING gist` fora do padrão comum do TypeORM.** O TypeORM não tem
  suporte de primeira classe a exclusion constraints; depende inteiramente de SQL bruto
  na migration (seção 3.1). Mitigação: mesma rede de segurança já decidida no plano
  Prisma anterior — se a constraint falhar ao aplicar no Neon, a checagem transacional no
  serviço (Lote 8) segura a regra independente do banco, e a limitação é reportada
  explicitamente, nunca escondida.
- **R3 — Divergência de paridade não detectada.** Migrar 25 tabelas/16 enums à mão cria
  risco de um campo, índice ou `onDelete` divergir silenciosamente do Prisma. Mitigação:
  Lote 9 existe exatamente para isso — é um portão, não um formalismo.
- **R4 — Dois bancos, duas fontes de seed, dado divergente com o tempo.** Enquanto Prisma
  e TypeORM coexistem (Lotes 1–9), há dois seeds gerando dado "equivalente" em bancos
  diferentes. Mitigação: mesma `REFERENCE_DATE` e mesmas chaves determinísticas nos dois
  lados (seção 5), para que a comparação do Lote 9 seja direta.
- **R5 — Credenciais Neon em `backend/.env` sem proteção adicional.** Mesmo risco que já
  existe com o `.env` da raiz (Prisma Postgres). Mitigação: mesma regra do `.gitignore`
  (`.env*` exceto `.env.example`) deve valer também dentro de `backend/` — verificar
  isso explicitamente no Lote 1, não assumir que o `.gitignore` da raiz cobre um
  `package.json` novo em subdiretório (ele cobre, por ser um único `.gitignore` na raiz
  do repo Git, mas vale conferir no lote em vez de supor).
- **R6 — API key do Prisma Accelerate possivelmente exposta** (seção 1.3). Ação
  recomendada fora deste plano: girar a key no Prisma Console. Não bloqueia nada aqui
  porque o banco antigo não é reaproveitado.
- **R7 — `src/generated/prisma/` (client gerado, 2,2 MB) foi commitado no checkpoint
  deste plano.** Não é prática comum versionar código gerado; normalmente entra no
  `.gitignore` e é regenerado via `prisma generate` em cada `install`/build. Não é
  destrutivo (só custa espaço no histórico Git) e será removido de qualquer forma no
  Lote 10 — mas vale decidir conscientemente, não por omissão, se antes disso vale a pena
  já adicionar `src/generated/` ao `.gitignore` num commit separado.
- **R8 — Checksum divergente da migration Prisma antiga (seção 1.3).** Não afeta o Neon,
  mas se alguém tentar rodar `prisma migrate` de novo contra o Prisma Postgres antigo sem
  saber disso, vai travar pedindo reset. Documentado aqui para não se perder entre
  projetos.

## 9. Rollback

- Cada lote é um commit isolado em `refactor/nestjs-typeorm` — reverter é `git revert`
  ou simplesmente não mergear a branch.
- Nenhum lote antes do 4 toca em qualquer banco.
- A partir do Lote 4, todo `up()` de migration TypeORM tem `down()` simétrico testado
  como parte do critério de aceitação (Lote 5) — reverter o schema do Neon é sempre
  `typeorm migration:revert`, nunca `DROP DATABASE`/reset.
- O seed (Lote 6) só usa upsert; "desfazer" é deletar pelas chaves determinísticas
  conhecidas, nunca `TRUNCATE`.
- O Prisma (schema, migration, seed, testes) só é removido no Lote 10, e só depois do
  portão de paridade do Lote 9 — até lá, a suíte Prisma inteira continua sendo a rede de
  segurança e pode ser usada para comparar/restaurar entendimento a qualquer momento.
- Em nenhum momento este plano usa `prisma migrate reset`, `prisma db push`, `TRUNCATE`,
  ou exclusão global de dado — nem do lado Prisma nem do lado TypeORM.

## 10. Critérios de remoção do Prisma

Todos precisam ser verdadeiros antes do Lote 10 começar:

1. Lote 9 (verificação de paridade) formalmente aprovado — schema, dado e comportamento
   equivalentes, com evidência registrada (não "parece igual").
2. Os 24 testes de integração TypeORM (Lote 7) passam de forma estável (não passam "às
   vezes").
3. Seed TypeORM idempotente confirmado (2 execuções, contagens idênticas) — mesmo padrão
   já exigido do seed Prisma.
4. Nenhum código em `src/` (Next.js) ou em qualquer script depende mais de
   `@prisma/client`, `@prisma/adapter-pg` ou `prisma/`.
5. Decisão humana explícita de seguir — este lote apaga arquivos versionados; mesmo
   sendo reversível via Git, não deve ser automático ao bater os critérios 1–4.

## 11. Ponto exato em que as credenciais Neon serão necessárias

**Início do Lote 4** ("Migration inicial TypeORM"), não antes. Os Lotes 1–3 (estrutura
NestJS, configuração/validação de env, enums e entidades) são inteiramente offline — Nest
sobe, valida env e compila entidades sem uma conexão real ao Postgres. O primeiro comando
que precisa de um Neon vivo é `typeorm migration:generate`, porque ele compara o schema
atual do banco (vazio) contra as entidades para produzir o diff SQL.

**Checkpoint obrigatório antes do Lote 4:**

1. Você cria o projeto no Neon, escolhe a região São Paulo.
2. Você configura localmente, em `backend/.env` (nunca commitado — mesma regra do
   `.gitignore` já em vigor):
   ```text
   DATABASE_URL=URL_POOLED_DO_NEON
   DIRECT_URL=URL_DIRECT_DO_NEON
   ```
3. Só depois disso o Lote 4 começa. Nenhuma migration é gerada ou aplicada antes deste
   checkpoint — este plano não presume nem inventa valores de conexão.

## Verificação desta etapa (sem banco)

- `npm run test` (raiz): **50/50 passando.**
- `npm run lint` (raiz): **0 erros**, 1 aviso pré-existente e não bloqueante
  (`src/lib/db/prisma.ts:27`, diretiva `eslint-disable` não usada — cosméstico, não
  tratado aqui por estar fora do escopo desta etapa).
- `npm run build` (raiz): **sucesso**, 20 rotas geradas (`○` estático / `ƒ` dinâmico),
  igual à baseline registrada em `docs/plans/fundacao-postgresql.md`.
- Nenhum teste de banco (`test:db`) foi rodado nesta etapa, por instrução explícita.
- Nenhum comando contra o Prisma Postgres antigo foi executado nesta etapa.
