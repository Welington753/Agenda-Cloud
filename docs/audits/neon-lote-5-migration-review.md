# Lote 5A — Migration inicial TypeORM (criação e revisão local)

**Data:** 2026-09-07
**Branch:** `feat/nestjs-typeorm-lote-5` (criada a partir de `integration/nestjs-typeorm-frontend`, HEAD `958a3ce`)
**Issue:** [#2 — Lote 5] Criar baseline e migration TypeORM compatível

Escopo desta fase (Lote 5A, conforme instrução da execução): gerar, revisar,
testar e commitar a migration TypeORM inicial **localmente**. Nenhuma
migration foi aplicada em nenhum banco. Nenhuma conexão com o Neon foi aberta
nesta fase.

**Lote 5A.1 (correção pré-Neon, mesma data):** três bloqueios encontrados
nesta revisão antes de qualquer conexão com o Neon, todos corrigidos e
cobertos por teste — ver seções 3, 5 e 6 abaixo para o detalhe de cada um:
`enumName` explícito adicionado às ~23 colunas enum das entidades; FK composta
`memberships` × `professionals` trocada de `RESTRICT` para
`SET NULL (professional_id)`; expressão da exclusion constraint tornada
explícita com bounds `'[)'`.

## 1. Por que a migration foi escrita manualmente, sem `migration:generate`

A instrução desta execução permite usar `typeorm migration:generate` só se a
introspecção puder ser garantida como read-only (via `PGOPTIONS
default_transaction_read_only=on`, comparação de catálogo antes/depois, etc.).
Isso exigiria abrir `backend/.env` para ler `DIRECT_URL` — proibido
explicitamente nesta fase ("Não abra nem imprima `backend/.env`"). Como as 30
entidades e os 18 enums já estavam completamente lidos e documentados (Lote 3,
confirmado de novo nesta execução lendo cada `*.entity.ts`/`*.enum.ts`), a
migration foi escrita inteiramente à mão a partir do código-fonte das
entidades — caminho explicitamente autorizado pela instrução ("se não for
possível garantir geração read-only, não conecte: crie a migration
manualmente a partir das entidades"). Nenhuma conexão com o Neon foi aberta em
nenhum momento desta fase.

## 2. Migration criada

Arquivo: `backend/src/migrations/1788782400000-InitialSchema.ts`
Classe: `InitialSchema1788782400000`

Estrutura: cada seção da issue (extensões, enums, tabelas, uniques, FKs,
checks, exclusion, índices) é um array de strings SQL exportado
separadamente, concatenado em `UP_STATEMENTS`/`DOWN_STATEMENTS`. `up()`/
`down()` só iteram sobre esses arrays chamando `queryRunner.query(...)` —
nenhuma lógica condicional, nenhum SQL construído dinamicamente. Essa forma
foi escolhida para que os testes de contrato (seção 6 abaixo) inspecionem o
SQL como string, sem precisar de banco nem de mock de `QueryRunner`.

Contagem de comandos SQL (`UP_STATEMENTS.length`, verificada
programaticamente e conferida pelo teste `up() — soma exata das seções` em
`initial-schema-lifecycle.spec.ts`): **161**, distribuídos assim:

| Seção | Qtde |
| --- | --- |
| Extensões | 2 |
| Enums (`CREATE TYPE`) | 18 |
| Tabelas (`CREATE TABLE`) | 30 |
| Uniques auxiliares de tenant (`UNIQUE(tenant_id, id)`) | 5 |
| Uniques de negócio (`@Unique` de classe) | 9 |
| Índices únicos (`@Index({unique:true})`) | 12 |
| FKs simples | 33 |
| FKs compostas de tenant | 15 |
| Checks | 9 |
| Exclusion constraint | 1 |
| Índices não-únicos | 27 |
| **Total** | **161** |

`down()` (`DOWN_STATEMENTS`, 48 comandos): 30 `DROP TABLE` na ordem
exatamente inversa da criação + 18 `DROP TYPE`, também verificado pelo teste
de simetria. Nenhum `DROP TABLE` usa `CASCADE` — cada tabela filha já foi
removida antes da sua tabela-pai, então não há mais nada dependente para
forçar. Extensões `citext`/`btree_gist` **nunca** são removidas em `down()`
(ver seção 5).

## 3. Tabelas e enums representados

30 tabelas e 18 enums — mesma contagem confirmada no Lote 3 e no Lote 4
(`docs/audits/neon-lote-4-inventario.md`, seção "Fontes locais lidas": "30
`backend/src/entities/*.entity.ts`... 18
`backend/src/entities/enums/*.enum.ts`"). A Issue #2 e o plano citam "21
enums" em alguns pontos (16 herdados + 5 "novos", contando os 2 valores novos
em enums existentes como se fossem enums separados) — a contagem correta e
verificada linha a linha nos arquivos-fonte é **18 tipos enum distintos**
(16 originais + `CommissionType` + `CommissionEntryStatus`; os outros "3
novos" citados no plano são só valores adicionados a enums já existentes:
`Permission` ganhou 2 valores, `AuditAction` ganhou 2 valores — não geram tipo
Postgres novo). Esta migration segue a contagem verificada no código-fonte
(18), não o número da Issue.

**Mapeamento enum TypeScript → entidades/colunas → tipo Postgres (contagem por
declaração de coluna, não por arquivo):** 23 colunas `type: 'enum'` nas
entidades, reaproveitando os 18 tipos lógicos entre tabelas — `EstablishmentRole`
(`membership.role`, `invite.establishmentRole`), `PlatformRole`
(`user.platformRole`, `invite.platformRole`) e `AppointmentStatus`
(`appointment.status`, `appointmentStatusChange.fromStatus`/`.toStatus`, 3
colunas) são os únicos tipos usados em mais de uma coluna; os outros 15
aparecem uma única vez. Todas as 23 colunas agora declaram `enumName:
'<nome_snake_case>'` explícito e idêntico ao `CREATE TYPE` correspondente desta
migration (`user_status`, `platform_role`, `platform_permission`,
`appointment_status`, `commission_type`, `feature_key`, `page_template`,
`audit_action`, `commission_entry_status`, `permission`, `permission_mode`,
`service_modality`, `invite_type`, `establishment_role`, `invite_status`,
`resource_type`, `business_category`, `tenant_status`) — sem isso, o TypeORM
derivaria um tipo Postgres por *coluna* (`<tabela>_<coluna>_enum`) em vez de
reaproveitar o tipo entre tabelas, e um `migration:generate` futuro relataria
"tipo renomeado" para cada uma das 23 colunas. Coberto por
`initial-schema-structure.spec.ts` (`enumName das entidades — idêntico ao
CREATE TYPE da migration`): confirma presença de `enumName` em toda declaração
`enum:`, que cada tipo TS mapeia sempre para o mesmo `enumName`, e que o
conjunto de `enumName` das entidades é exatamente igual ao conjunto de
`CREATE TYPE` desta migration.

## 4. Extensões

```sql
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

Nenhuma outra extensão é criada (`prisma_postgres`, presente na migration
Prisma, é específica da infraestrutura gerenciada do Prisma — não se aplica
aqui, confirmado no Lote 4).

**Decisão de `down()`:** as duas extensões **nunca** são removidas no
rollback. São recursos compartilhados do schema `public` — derrubá-las
poderia afetar outro objeto não criado por esta migration (instrução
explícita da issue: "não remova extensões compartilhadas automaticamente se
isso puder afetar outros objetos; priorize rollback sem dano colateral").
Reverter esta migration deixa `citext`/`btree_gist` instaladas mas sem
nenhuma coluna/constraint que as use — estado seguro e sem efeito colateral
observável.

## 5. FKs compostas multi-tenant (seção 7 da issue)

5 tabelas-pai ganham `UNIQUE(tenant_id, id)`: `professionals`, `services`,
`consumers`, `memberships`, `appointments`. 15 FKs compostas
`(tenant_id, x) REFERENCES parent (tenant_id, id)` implementam as 8 relações
exigidas:

| Relação exigida | FK(s) composta(s) | `ON DELETE` |
| --- | --- | --- |
| agendamento × profissional | `appointments(tenant_id, professional_id)` → `professionals` | RESTRICT |
| agendamento × consumidor | `appointments(tenant_id, consumer_id)` → `consumers` | RESTRICT |
| itens/recursos/status × agendamento | `appointment_items`/`appointment_resources`/`appointment_status_changes(tenant_id, appointment_id)` → `appointments` | CASCADE |
| profissional-serviço × profissional/serviço | `professional_services(tenant_id, professional_id)` → `professionals`; `professional_services(tenant_id, service_id)` → `services` | CASCADE |
| agenda profissional × profissional | `professional_schedules(tenant_id, professional_id)` → `professionals` | CASCADE |
| membership × profissional | `memberships(tenant_id, professional_id)` → `professionals` | **SET NULL (professional_id)** (ver abaixo) |
| permissões extras × membership | `membership_permission_overrides(tenant_id, membership_id)` → `memberships` | CASCADE |
| comissão × agendamento/profissional/serviço | `commission_rules(tenant_id, professional_id/service_id)` → `professionals`/`services` (CASCADE); `commission_entries(tenant_id, appointment_id/professional_id/service_id)` → `appointments`/`professionals`/`services` (RESTRICT) | ver células |

**`memberships` × `professionals` — `ON DELETE SET NULL (professional_id)`:**
a relação simples declarada em `membership.entity.ts` usa
`onDelete: 'SET NULL'`, e o Prisma original (`memberships_professionalId_fkey`,
`prisma/migrations/20260901155542_init/migration.sql:563`) também usa
`SET NULL` — a intenção sempre foi desvincular o membership, nunca bloquear a
exclusão do profissional. Uma FK **composta** com `SET NULL` "comum" (sem
lista de colunas) zeraria **todas** as colunas da FK no registro filho ao
apagar o profissional referenciado — incluindo `tenant_id`, que é `NOT NULL`
em `memberships` — e faria o `DELETE` falhar em runtime. A revisão anterior
deste lote contornou isso usando `RESTRICT`, mudando o comportamento (bloquear
em vez de desvincular) por engano. Correção desta revisão: Postgres 15+
(Neon roda 18.6) suporta `ON DELETE SET NULL (professional_id)` — a sintaxe de
coluna-alvo restringe o `SET NULL` só à coluna listada, preservando
`tenant_id`. `ALTER TABLE memberships ADD CONSTRAINT
fk_memberships_tenant_professional FOREIGN KEY (tenant_id, professional_id)
REFERENCES professionals (tenant_id, id) ON DELETE SET NULL (professional_id)`
agora bate com a relação simples da entidade e com o Prisma original. Coberto
por `initial-schema-tenant-integrity.spec.ts`.

**Fora do escopo da FK composta, documentado (seção 7: "documente qualquer
relação que não possa receber FK composta e o motivo técnico concreto"):**

- `time_blocks` × `professionals` — a issue não lista "bloqueio ×
  profissional" entre as 8 relações exigidas (só "agenda profissional ×
  profissional", que é `professional_schedules`). Mantido como FK simples
  (`professional_id → professionals(id)`, `CASCADE`). Isolamento de tenant
  para bloqueios fica com o serviço (toda query de bloqueio já filtra por
  `tenant_id` explícito, mesma disciplina do resto do plano).
- `appointment_items` × `services` e `appointment_resources` × `resources` —
  a issue exige composta só entre a tabela filha e `appointments`, não entre
  a tabela filha e o serviço/recurso referenciado. Mantidos como FK simples
  (`RESTRICT`).

Nenhuma relação teve que ficar **sem** proteção nenhuma — onde a FK composta
não se aplicava, a FK simples (que garante que o `id` referenciado existe)
continua presente; só a checagem cruzada de tenant fica com o serviço nesses
casos residuais.

## 6. `CHECK`s e exclusion constraint

```sql
ALTER TABLE appointments ADD CONSTRAINT ck_appointments_end_after_start CHECK (end_at > start_at);

ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap_excl
  EXCLUDE USING gist (
    tenant_id WITH =,
    professional_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  )
  WHERE (status <> 'CANCELED');
```

Texto adaptado literalmente de
`prisma/migrations/20260901155542_init/migration.sql:641,650-656` para
`snake_case`, com duas diferenças deliberadas: `tenant_id` foi acrescentado à
chave de exclusão (o Prisma original só tinha `professionalId`) — tecnicamente
redundante, já que um `professional_id` só existe em um tenant, mas a issue
pede "escopo correto por tenant" explicitamente na exclusion constraint (seção
8), e a coluna extra ajuda o planner a usar o índice GiST de forma mais
seletiva em consultas já filtradas por tenant; e o terceiro argumento `'[)'`
de `tstzrange` (início inclusive, fim exclusivo) agora é explícito em vez de
depender do default do construtor — mesmo valor que o Postgres já assumiria
sem o argumento, mas escrito por extenso para casar literalmente com a
semântica pretendida (`end_at` é o instante em que o próximo agendamento já
pode começar) e evitar qualquer ambiguidade numa leitura futura do SQL.
`WHERE (status <> 'CANCELED')`
preservado tal como no Prisma: `NO_SHOW` continua ocupando a exclusão — a
mesma divergência pré-existente entre banco e motor de disponibilidade da
aplicação já registrada no plano (seção 7.1) e no Lote 4 (matriz da seção 5,
linha "Agenda e disponibilidade"). **Não foi "corrigida" nesta migration** —
é decisão de negócio em aberto, não um bug óbvio.

Demais `CHECK`s: faixa de valor de comissão (`commission_rules.value`,
`commission_entries.applied_value`, ambos `PERCENTAGE` entre 0-10000
pontos-base ou `FIXED >= 0`), `professional_cents`/`establishment_cents`/
`price_cents_snapshot` não-negativos em `commission_entries`,
`price_cents_snapshot` não-negativo (quando presente) em `appointment_items`,
e `expires_at > created_at` em `sessions`/`invites` (seção 10 da issue,
"constraints que impeçam estados estruturalmente inválidos" — não declarado
nas entidades atuais, acrescentado por exigência explícita da tarefa).

## 7. Responsabilidades SQL × TypeORM × domínio

| Garantia | Camada | Onde |
| --- | --- | --- |
| Tipos de coluna, FKs simples, uniques de coluna única | Decorators TypeORM (fonte da verdade) | `*.entity.ts` |
| `UNIQUE(tenant_id, id)`, FK composta de tenant, `CHECK`, `EXCLUDE`, `CREATE EXTENSION` | SQL manual desta migration | `1788782400000-InitialSchema.ts` |
| Slugs reservados (`SLUGS_RESERVADOS`) | Serviço de domínio (nunca `CHECK`) | Lote 13 (adaptação de frontend)/serviço de tenants |
| "Nunca zero `MASTER_OWNER` ativo" | Serviço de domínio, transação com `SELECT ... FOR UPDATE` (nunca `CHECK`) | Lote 7 |
| Bloqueio de remarcação de atendimento concluído | Serviço de domínio (depende de transição de estado, não de valor de coluna) | Lote 8 |
| Reconfirmação de disponibilidade antes de gravar | Serviço de domínio, dentro da transação | Lote 8 |
| Criação/estorno/reativação idempotente de `CommissionEntry` | Serviço de domínio, mesma transação do `Appointment` | Lote 8/9 |
| "Serviço vinculado ao profissional" (valida `CommissionRule`) | Serviço de domínio (depende de outra tabela) | Lote 9 |

## 7.1 Revisão estática — conferência das 30 entidades contra a migration

Tabela de conferência (seção 14 da issue): as 30 entidades comparadas
linha a linha contra `TABLE_STATEMENTS`/`UNIQUE_STATEMENTS`/
`FOREIGN_KEY_STATEMENTS`/`CHECK_STATEMENTS`/`INDEX_STATEMENTS`. "tenant_id"
marca se a tabela tem a coluna (`sim`), se é a própria raiz multi-tenant
(`raiz`), se é global/sem tenant (`—`) ou se é nullable por desenho
(`nullable`). FKs compostas aparecem como "composta →tabela". Nenhuma
entidade ficou sem tabela; nenhuma tabela foi inventada sem requisito — as 30
linhas abaixo batem exatamente com as 30 de `TABLE_STATEMENTS`.

| Entidade | Tabela | PK | tenant_id | Uniques | FKs | Checks | Índices |
| --- | --- | --- | --- | --- | --- | --- | --- |
| User | users | id | — | email | — | — | — |
| Credential | credentials | id | — | user_id | user_id→users CASCADE | — | — |
| Session | sessions | id | — | token_hash | user_id→users CASCADE | expires_at>created_at | user_id; expires_at |
| Plan | plans | id | — | code | — | — | — |
| Feature | features | id | — | key | — | — | — |
| PlanFeature | plan_features | id | — | (plan_id,feature_id) | plan_id→plans CASCADE; feature_id→features CASCADE | — | — |
| Tenant | tenants | id | raiz | slug | plan_id→plans RESTRICT | — | status |
| TenantFeatureOverride | tenant_feature_overrides | id | sim | (tenant_id,feature_id) | tenant_id→tenants CASCADE; feature_id→features CASCADE | — | — |
| BrandIdentity | brand_identities | id | sim | tenant_id | tenant_id→tenants CASCADE | — | — |
| BookingPolicy | booking_policies | id | sim | tenant_id | tenant_id→tenants CASCADE | — | — |
| PublicSettings | public_settings | id | sim | tenant_id | tenant_id→tenants CASCADE | — | — |
| Unit | units | id | sim | — | tenant_id→tenants RESTRICT | — | tenant_id |
| Membership | memberships | id | sim | (user_id,tenant_id); (tenant_id,id) aux; professional_id parcial | user_id→users RESTRICT; tenant_id→tenants RESTRICT; composta →professionals SET NULL (professional_id) | — | tenant_id |
| MembershipPermissionOverride | membership_permission_overrides | id | sim | (tenant_id,membership_id,permission) | composta →memberships CASCADE | — | tenant_id |
| Invite | invites | id | nullable | token_hash | tenant_id→tenants RESTRICT (nullable); created_by_user_id→users RESTRICT | expires_at>created_at | target_email; (tenant_id,status) |
| AuditLog | audit_logs | id | nullable | — | actor_user_id→users RESTRICT; tenant_id→tenants RESTRICT (nullable); support_session_id→support_sessions RESTRICT (nullable) | — | actor_user_id; (tenant_id,occurred_at) |
| SupportSession | support_sessions | id | sim | — | master_user_id→users RESTRICT; tenant_id→tenants RESTRICT | — | master_user_id; (tenant_id,started_at) |
| Professional | professionals | id | sim | (tenant_id,id) aux | tenant_id→tenants RESTRICT; unit_id→units SET NULL | — | tenant_id |
| ProfessionalSchedule | professional_schedules | id | sim | (tenant_id,professional_id,weekday) | composta →professionals CASCADE | — | tenant_id |
| Service | services | id | sim | (tenant_id,id) aux | tenant_id→tenants RESTRICT | — | tenant_id |
| ProfessionalService | professional_services | id | sim | (tenant_id,professional_id,service_id) | composta →professionals CASCADE; composta →services CASCADE | — | (coberto pelo unique) |
| Consumer | consumers | id | sim | (tenant_id,whatsapp_normalized); (tenant_id,id) aux | tenant_id→tenants RESTRICT | — | whatsapp_normalized (cross-tenant, deliberado) |
| TimeBlock | time_blocks | id | sim | — | tenant_id→tenants RESTRICT; professional_id→professionals CASCADE (simples, ver seção 5) | — | tenant_id; (professional_id,start_at,end_at) |
| Resource | resources | id | sim | — | tenant_id→tenants RESTRICT | — | tenant_id |
| Appointment | appointments | id | sim | (tenant_id,id) aux | tenant_id→tenants RESTRICT; unit_id→units RESTRICT; composta →professionals RESTRICT; composta →consumers RESTRICT | end_at>start_at; EXCLUDE gist | (tenant_id,professional_id,start_at,end_at); (tenant_id,status,start_at) |
| AppointmentItem | appointment_items | id | sim | — | composta →appointments CASCADE; service_id→services RESTRICT | price_cents_snapshot≥0 (se presente) | tenant_id; appointment_id |
| AppointmentResource | appointment_resources | id | sim | (tenant_id,appointment_id,resource_id) | composta →appointments CASCADE; resource_id→resources RESTRICT | — | tenant_id |
| AppointmentStatusChange | appointment_status_changes | id | sim | — | composta →appointments CASCADE | — | tenant_id; appointment_id |
| CommissionRule | commission_rules | id | sim | (tenant_id,professional_id,service_id) | tenant_id→tenants RESTRICT; composta →professionals CASCADE; composta →services CASCADE | valor em faixa (pontos-base/fixo) | (coberto pelo unique) |
| CommissionEntry | commission_entries | id | sim | appointment_id | tenant_id→tenants RESTRICT; composta →appointments RESTRICT; composta →professionals RESTRICT; composta →services RESTRICT | applied_value em faixa; professional_cents≥0; establishment_cents≥0; price_cents_snapshot≥0 | (tenant_id,professional_id,service_date) |

## 8. Divergências intencionais em relação a um `migration:generate` real

Documentadas para quem revisar ou rodar `migration:generate` de verdade numa
branch Neon descartável (Lote 5B):

1. **Nomes de tipo enum compartilhados** (`platform_role`, `tenant_status`,
   etc. — um tipo por enum lógico) em vez do default do TypeORM (um tipo
   Postgres por *coluna*, `<tabela>_<coluna>_enum`). **Decidido nesta revisão
   (Lote 5A.1):** as 23 colunas enum das entidades agora declaram `enumName`
   explícito, idêntico aos 18 `CREATE TYPE` desta migration (ver seção 3) — um
   `migration:generate` real no Lote 5B não deve mais relatar "renomear tipo"
   para nenhuma coluna enum.
2. **Nomes de constraint/índice legíveis** (`uq_...`, `fk_...`, `ck_...`,
   `idx_...`) em vez dos hashes que `migration:generate` teria produzido.
   Decisão deliberada de revisabilidade — um `generate` real mostraria
   "renomear constraint" para cada uma, sem nenhuma mudança estrutural.
3. **Índice `idx_sessions_expires_at`** e o `CHECK`
   `expires_at > created_at` em `sessions`/`invites` não estão declarados nas
   entidades atuais — acrescentados por exigência explícita da seção 10 da
   issue ("índices de sessão e expiração", "constraints que impeçam estados
   estruturalmente inválidos"). Recomendação: replicar como `@Index()`
   explícito em `session.entity.ts` no Lote 6, para não divergir de um
   `generate` futuro.

## 9. Comandos previstos para validação em branch Neon descartável (Lote 5B)

Nenhum destes foi executado nesta fase — só documentados como plano do
próximo lote:

1. Criar branch Neon descartável (nunca o banco principal).
2. `DIRECT_URL` apontando para essa branch, lida de `backend/.env` (nunca
   commitada).
3. `npx typeorm migration:run -d backend/src/database/migrations-data-source.ts`.
4. Query de verificação: 30 tabelas, 18 enums, 2 extensões, as duas
   constraints de `appointments` batendo com a seção 6 acima
   (`pg_get_constraintdef`).
5. Teste de aceitação da Issue: inserir dois agendamentos sobrepostos falha
   com `23P01`; `end_at <= start_at` falha por `CHECK`.
6. `npx typeorm migration:revert` seguido de `migration:run` de novo, sem
   erro (prova de `up`/`down` simétricos contra banco real).
7. Apagar a branch Neon descartável ao final — nunca aplicar contra o Neon
   principal antes desta validação passar.

## 10. Riscos e rollback do futuro Lote 5B

- **Maior risco:** primeiro DDL de fato contra um Neon (mesmo descartável) —
  qualquer erro de sintaxe só aparece ao rodar de verdade. Mitigação: os 5
  arquivos de teste de contrato (seção 11) já verificam sintaticamente cada
  cláusula crítica antes de qualquer tentativa de `migration:run`.
- **FK composta com `MATCH SIMPLE`:** comportamento padrão do Postgres
  (constraint só é checada quando nenhuma coluna da FK é nula) precisa ser
  confirmado na prática para `memberships.professional_id` (nullable) — teste
  de integração recomendado no Lote 5B: inserir membership sem
  `professional_id`, depois com um `professional_id` de tenant errado
  (deve falhar), depois com o tenant certo (deve passar).
- **Enum type naming** (seção 8, item 1) — já decidido e corrigido nesta
  revisão (`enumName` explícito nas 23 colunas); nenhuma ação pendente para o
  Lote 5B nesse ponto.
- **Rollback:** `migration:revert` é o mecanismo primário, já coberto pelos
  testes de simetria `up`/`down`. Não há checkpoint/branch Neon desta fase
  (nenhuma conexão foi aberta) — o Lote 5B deve criar seu próprio checkpoint
  antes de aplicar, conforme a Issue #1 e a seção 8.2 do plano.

## 11. Testes locais adicionados

5 arquivos, todos em `backend/src/migrations/`, nenhum acima de 350 linhas,
nenhum conecta a banco (confirmado pelo próprio
`initial-schema-lifecycle.spec.ts`):

| Arquivo | Cobre |
| --- | --- |
| `initial-schema-structure.spec.ts` | 30 tabelas, 18 enums, extensões, `snake_case` de tabela/coluna/enum, contagem exata contra a lista da issue, `enumName` das entidades idêntico ao `CREATE TYPE` desta migration |
| `initial-schema-appointments.spec.ts` | `CHECK end_at > start_at`, `EXCLUDE USING gist` com bounds `'[)'` explícitos, statuses corretos na exclusão, índices de disponibilidade, ausência de `CONCURRENTLY` |
| `initial-schema-commissions.spec.ts` | Uniques de comissão, `CHECK`s de faixa de valor (pontos-base 0-10000 / fixo ≥0), `RESTRICT` em `commission_entries`, `CASCADE` em `commission_rules` |
| `initial-schema-tenant-integrity.spec.ts` | As 5 `UNIQUE(tenant_id, id)` e as 15 FKs compostas das 8 relações da seção 7, incluindo `SET NULL (professional_id)` em `memberships`×`professionals` |
| `initial-schema-lifecycle.spec.ts` | `up`/`down` completos e simétricos, ausência de `DROP SCHEMA`/`DROP DATABASE`/`CASCADE` em `down()`, `synchronize`/`migrationsRun` sempre `false`, migration registrada pelo `MigrationsDataSource` (glob exclui `.spec.ts`), importar o módulo nunca inicializa nenhum `DataSource` |

Mais 1 assertion nova em `backend/src/database/migrations-data-source.spec.ts`
(`migrationsTableName` explícito).

## 12. Correção acompanhante em `migrations-data-source.ts`

O glob `migrations: [...]` usava `**/*.{ts,js}` sem filtro — com os testes de
contrato vivendo ao lado da migration (mesma pasta), o TypeORM real tentaria
carregar os `*.spec.ts` como migration. Corrigido para
`**/!(*.spec).{ts,js}` (extglob, suportado pelo `tinyglobby` que o TypeORM usa
internamente — verificado localmente sem conectar a banco nenhum, só
resolvendo o glob em arquivo). Também adicionado `migrationsTableName:
'typeorm_migrations'` (nome explícito e estável, exigido pela seção 4 da
issue e pelo plano, seção 8.6 — nunca colide com `_prisma_migrations`).

## 13. Confirmação de que nada foi aplicado no Neon

Nenhum comando `migration:run`, `migration:revert`, `schema:sync`,
`schema:drop`, `prisma migrate`, `seed`, `reset`, `deploy` ou SQL manual foi
executado contra o Neon nesta fase. Nenhuma conexão de rede com o banco foi
aberta — `backend/.env` nunca foi lido nem impresso. O estado do Neon
permanece exatamente o confirmado no Lote 4
(`docs/audits/neon-lote-4-inventario.md`, seção 4): 0 tabelas, 0 enums, 0
extensões de aplicação, `_prisma_migrations` inexistente. Nenhuma verificação
read-only nova foi feita contra o banco real nesta fase — o estado vazio é
herdado sem alteração do relatório do Lote 4, e confirmar isso de novo contra
o Neon exigiria abrir `backend/.env`, o que esta fase proíbe explicitamente.
