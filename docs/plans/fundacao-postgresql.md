# Fundação PostgreSQL + Prisma (multi-tenant)

## Estado atual

- Next.js 16.3.4 (App Router) + React 19.2.8, projeto 100% client-side.
- Domínio inteiro tipado em `src/lib/types.ts` (415 linhas), em português: `Estabelecimento`,
  `Unidade`, `Profissional`, `Servico`, `Consumidor`, `Agendamento`, `Membership`, `Convite`,
  `RegistroAuditoria`, `UsuarioPlataforma`, `UsuarioEstabelecimento`, etc.
- Persistência hoje é 100% `localStorage`, via `src/lib/repositories/index.ts` (um único
  arquivo com um "repositório" por entidade) sobre o wrapper `src/lib/storage/local-storage.ts`.
  O próprio comentário de topo do arquivo já antecipa esta etapa: *"para trocar por uma API
  real no futuro, basta reescrever este arquivo mantendo as mesmas assinaturas — os
  componentes não mudam."*
- Dados de demonstração gerados em `src/lib/seed-data.ts` (determinísticos, mas recalculados a
  cada carga da página com base na data atual — não persistidos).
- Planos são um registro estático em `src/lib/planos.ts` (`DEFINICOES_PLANO`), não uma tabela.
- Resolução de tenant: página pública resolve por `slug` da URL
  (`estabelecimentoRepository.obterPorSlug`); área autenticada usa `useTenantId()`
  (`src/lib/auth/auth-context.tsx`), que lê o `tenantId` da sessão simulada
  (`sessionStorage`) — nunca da URL. Esse contrato (tenant da sessão, nunca do
  request) é o que a nova camada precisa preservar.
- Nenhuma dependência de banco, ORM, ou variável `DATABASE_URL` existe hoje no projeto.
- Baseline confirmada antes de iniciar: árvore Git limpa, 50 testes passando (`vitest`),
  lint limpo (`eslint`), build limpo com as 20 rotas atuais compilando (Node v24.16.0,
  npm 11.13.0).

## Dependências escolhidas

| Pacote | Versão | Motivo |
| --- | --- | --- |
| `prisma` | `7.10.0` | CLI/dev-dependency. Última tag `prev` do npm — versão estável imediatamente anterior à `8.x`, conforme pedido explicitamente. |
| `@prisma/client` | `7.10.0` | Cliente gerado, mesma major/minor da CLI. |
| `@prisma/adapter-pg` | `7.10.0` | Adapter oficial de driver para Prisma 7 (motor "driver adapters"), usa o driver `pg` diretamente em vez do engine binário Rust para queries. |
| `pg` | `^8.23` | Driver PostgreSQL para Node, consumido pelo adapter. Next.js 16 já trata `pg` e `@prisma/client` como `serverExternalPackages` automaticos (confirmado em `node_modules/next/dist/docs/.../serverExternalPackages.md`), então não é necessário configurar `next.config.ts` manualmente para isso. |
| `@types/pg` | latest compatível | Tipagem do driver (dev). |
| `tsx` | `^4.23` | Executar scripts TypeScript (seed, smoke test) fora do Next. |
| `@next/env` | latest | Carregar `.env*` da mesma forma que o Next carrega, em scripts standalone (`prisma.config.ts`, seed, smoke test) que rodam fora do runtime do Next. |

Compatibilidade verificada: `prisma@7.10.0` e `@prisma/client@7.10.0` exigem
`node ^20.19 || ^22.12 || >=24.0`; o Node instalado é `v24.16.0` — compatível. Node **não**
será atualizado.

Não será usado Prisma 8 nem qualquer "skill" do Prisma.

## Estrutura do schema

Convenção adotada: nomes de **model** e campo no `schema.prisma` em **inglês**
(`Tenant`, `Professional`, `Service`, `Consumer`, `Appointment`, ...), mapeados para
tabelas/colunas `snake_case` via `@@map`/`@map`. Isso é uma ruptura deliberada com o
português usado em `src/lib/types.ts` — decisão registrada aqui, não implícita:

1. A própria instrução desta etapa já nomeia o model global de usuário como **`User`**
   (em inglês), porque esse é o nome que o Better Auth espera ao adotar um adapter Prisma
   no futuro — sinal de que a camada de banco pode divergir do vocabulário da UI.
2. "Estabelecimento **ou tenant**" já é oferecido como sinônimo aceito nas instruções.
3. Os repositórios `src/server/repositories/*` são exatamente a camada de tradução
   entre o Prisma (inglês) e os tipos de domínio da UI (português, `src/lib/types.ts`) —
   é uma fronteira de tradução esperada, não acidental.

### Tabela de mapeamento (domínio português → model Prisma)

| `src/lib/types.ts` | Model Prisma | Observação |
| --- | --- | --- |
| `UsuarioPlataforma` + `UsuarioEstabelecimento` | `User` | Unificados em um único model global (preparado para Better Auth). Papel de plataforma vira `User.platformRole` (enum opcional) + `User.platformPermissions` (array de enum), em vez de tabela própria — conjunto fechado e pequeno. |
| `Estabelecimento` | `Tenant` | `Estabelecimento.id` e `.tenantId` hoje são dois campos distintos; no Prisma, `Tenant.id` **é** o identificador do tenant (um único campo), simplificando o conceito. |
| `Unidade` | `Unit` | Ganha `timezone` (IANA) obrigatório — hoje o fuso mora só no estabelecimento; regra 7 exige fuso por unidade. |
| `Membership` | `Membership` | Mantido. `permissoesLiberadas`/`permissoesNegadas` viram `MembershipPermissionOverride` (tabela própria: `permission` + `mode: GRANTED\|DENIED`) em vez de dois arrays — fica auditável e indexável linha a linha, como a lista de entidades globais pede ("Exceção individual de permissão"). |
| `Convite` | `Invite` | `token` em texto puro **não é persistido** — vira `tokenHash`. |
| `RegistroAuditoria` | `AuditLog` | Mantido 1:1. |
| `IdentidadeVisual` | `BrandIdentity` | 1:1 com `Tenant`. Inclui `template` (= `ModeloPaginaPublica` / "modelo de página" da lista de requisitos — decisão: campo estruturado dentro de `BrandIdentity`, não tabela própria, pois é um enum de 2 valores sem dado próprio). |
| `RegrasAgendamento` | `BookingPolicy` | 1:1 com `Tenant`. |
| (`horarioGeral` + nenhum flag hoje) | `PublicSettings` | 1:1 com `Tenant`. Cobre "Configurações públicas" e "Status de publicação" (`isPublished`) — não existe hoje na UI, campo novo preparado para a publicação da página pública. |
| `Profissional` | `Professional` | `horarios: HorarioDia[]` (array embutido) vira tabela filha `ProfessionalSchedule` (uma linha por dia da semana). |
| `Servico` | `Service` | Mantido. |
| (`servicosIds`/`profissionaisIds` paralelos) | `ProfessionalService` | Tabela de junção explícita M:N. |
| `Consumidor` | `Consumer` | Ganha `whatsappNormalized` (dígitos, indexado) ao lado do `whatsapp` original. |
| `Bloqueio` | `TimeBlock` | Mantido. |
| `Recurso` | `Resource` | Mantido. |
| `Agendamento` | `Appointment` | Campos de snapshot (`consumidorNome`, `consumidorWhatsapp`, `precoCentavos`) preservados propositalmente — são histórico imutável, não denormalização acidental. |
| (`servicoId` + `precoCentavos` dentro de `Agendamento`) | `AppointmentItem` | Extraído para tabela filha (1 linha hoje por agendamento) — corresponde a "Itens do agendamento" da lista de requisitos e prepara terreno para múltiplos serviços por agendamento no futuro, sem exigir migração de novo. |
| (nada hoje — recurso não é reservado) | `AppointmentResource` | Corresponde a "Recursos utilizados pelo agendamento" da lista de requisitos. Tabela vazia por enquanto (recurso ainda não entra no motor de disponibilidade, como já documentado em `seed-data.ts`). |
| `Agendamento.historico: HistoricoAlteracao[]` | `AppointmentStatusChange` | Tabela filha, uma linha por transição de status — preserva o histórico hoje embutido como array. |
| `DefinicaoPlano` (`src/lib/planos.ts`, estático) | `Plan` + `Feature` + `PlanFeature` | Vira dado real no banco (populado pelo seed), deixando de ser config hardcoded. |
| (`featuresDesativadas: Feature[]` em `Estabelecimento`) | `TenantFeatureOverride` | Tabela `tenant_id + feature_id + enabled`, preservando a semântica atual (exceção do master vence o plano). |

### Enums Prisma

`PlatformRole`, `PlatformPermission`, `TenantStatus`, `BusinessCategory`,
`PageTemplate`, `Feature` (chave, não tabela de catálogo pura — ver nota abaixo),
`WeekDay` (0–6, `Int` puro, não enum), `ResourceType`, `ServiceModality`,
`AppointmentStatus`, `PermissionMode` (`GRANTED`/`DENIED`), `Permission`,
`EstablishmentRole`, `InviteType`, `InviteStatus`, `AuditAction`.

Nota sobre `Feature`: existe **como tabela** (`Feature { id, key, label }`) porque plano e
tenant precisam referenciá-la por FK em `PlanFeature`/`TenantFeatureOverride` — a "chave"
lógica (`agenda`, `agendamentoPublico`, ...) vira uma coluna `key` única do tipo enum
`FeatureKey`, e a tabela guarda o catálogo + rótulo amigável (hoje em `ROTULO_FEATURE`).

### Regras de dinheiro, data/hora e telefone

- Dinheiro: sempre `Int` (centavos), nunca `Float`/`Decimal` monetário sem necessidade —
  já é assim em `precoCentavos` hoje, preservado.
- Datas/horas de agendamento: `DateTime` (`timestamptz` no Postgres) sempre em UTC. A
  conversão para o horário local de exibição usa `Unit.timezone` (IANA) na camada de
  serviço/UI, nunca é guardada em campo `Date`/hora-local no banco.
- Telefone: campo original (`whatsapp`, como digitado) + `whatsappNormalized` (apenas
  dígitos) indexado, calculado na camada de repositório no momento da escrita.

## Estratégia de isolamento por tenant

- Toda tabela operacional carrega `tenantId` (FK obrigatória, nunca opcional) e um índice
  em `tenantId`.
- Tabelas globais (`User`, `Plan`, `Feature`) **não** recebem `tenantId` artificial.
- Repositórios server-only definidos em `src/server/repositories/*` **exigem** um
  parâmetro de contexto (`TenantContext { tenantId: string }` ou `ActorContext`) em toda
  função que toque dado operacional — o `tenantId` nunca é opcional nessa assinatura, e
  toda query Prisma correspondente combina `AND { id, tenantId }` (nunca `id` sozinho).
- Tipos de contexto (`src/server/context/`):
  - `TenantContext` — `{ tenantId: string }`, resolvido no servidor (sessão ou, na área
    pública, `slug` → `Tenant.id` via uma única consulta inicial).
  - `ActorContext extends TenantContext` — adiciona `{ userId: string; membershipId: string }`
    para operações que precisam registrar autoria (auditoria, criação de agendamento).
  - `PublicContext` — `{ tenantId: string }` também, mas resolvido **apenas** a partir do
    `slug` da URL, e usado só pelos repositórios/serviços que devolvem dado público (nunca
    o mesmo objeto que serve o painel autenticado).
  - Nenhum "tenant atual" global mutável é criado — o contexto é sempre passado
    explicitamente como argumento, nunca lido de uma variável de módulo compartilhada.
- Depois de resolver `Tenant.id` (por sessão ou por slug), toda consulta subsequente na
  mesma requisição usa esse ID interno — nunca um `tenantId` vindo de `FormData`, JSON do
  corpo da requisição, ou query string.

## Estratégia de concorrência de agendamentos

- `Appointment` guarda `startAt`, `endAt` (`timestamptz`), `professionalId`, `tenantId`,
  `unitId`, `status`.
- Índice `@@index([professionalId, startAt, endAt])` para consulta de disponibilidade.
- Regra "fim depois do início": não expressável no DSL do `schema.prisma` (Prisma 7 ainda
  não tem `CHECK` constraint nativo estável) → aplicada via SQL bruto na mesma migration
  manual descrita abaixo.
- Constraint de exclusão contra sobreposição: também SQL específico do Postgres
  (`EXCLUDE USING gist`, extensão `btree_gist`), não representável no `schema.prisma`.
- Fluxo obrigatório para essa parte (regra do enunciado — gerar `--create-only`, inspecionar,
  editar manualmente):
  1. `npx prisma migrate dev --name init --create-only` gera o SQL a partir do schema puro.
  2. Edito o arquivo `.sql` gerado à mão, acrescentando, dentro da mesma migration:
     - `CREATE EXTENSION IF NOT EXISTS citext;` — para `User.email` e `Tenant.slug` serem
       case-insensitive **no banco**, não só por convenção da aplicação.
     - `CREATE EXTENSION IF NOT EXISTS btree_gist;` — pré-requisito da exclusion constraint.
     - `ALTER TABLE "User" ALTER COLUMN "email" TYPE citext;`
     - `ALTER TABLE "Tenant" ALTER COLUMN "slug" TYPE citext;`
     - `ALTER TABLE "Appointment" ADD CONSTRAINT appointment_end_after_start CHECK ("end_at" > "start_at");`
     - `ALTER TABLE "Appointment" ADD CONSTRAINT appointment_no_overlap EXCLUDE USING gist (professional_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE (status <> 'CANCELADO');`
  3. Reviso o SQL completo (destrutivo ou não) antes de aplicar.
  4. Aplico com `prisma migrate deploy` (nunca `db push`, nunca reset automático).
- Por que essa parte não aparece no `schema.prisma`: o Prisma 7 (estável) não tem DSL para
  `CHECK` nem para `EXCLUDE USING gist` — ambos exigem SQL nativo do Postgres, documentado
  aqui e no cabeçalho do arquivo de migration correspondente.
- Se, na prática, a aplicação da exclusion constraint falhar ou o ambiente não suportar a
  extensão `btree_gist`, a trava não será improvisada: o repositório de agendamento mantém
  a verificação transacional (checar sobreposição dentro da mesma transação de criação,
  com nível de isolamento serializável ou `SELECT ... FOR UPDATE` nas linhas do
  profissional/período) como camada de segurança independente do banco, e a limitação fica
  registrada no relatório final.
- Agendamento cancelado não conta para a constraint (`WHERE status <> 'CANCELADO'`) nem
  para a verificação transacional do repositório.

## Estratégia de migrations

Fluxo obrigatório, sempre nesta ordem: `prisma format` → `prisma validate` →
`prisma generate` → `prisma migrate dev --create-only` → inspeção manual do SQL → aplicar
→ `prisma migrate status`. Nunca `db push`. Nunca aceitar reset automático — se o Prisma
pedir reset (schema drift, histórico divergente), a execução para e o motivo é reportado
sem confirmar.

## Estratégia de seed

- `prisma/seed.ts`, executado via `tsx`.
- Idempotente por construção: toda escrita usa `upsert` com chave natural estável
  (`slug` para `Tenant`, `email` para `User`, `code` para `Plan`, `key` para `Feature`,
  IDs de negócio determinísticos tipo `dom-navalha-corte-tradicional` para `Service`, etc.)
  — nunca `create` cego.
- Envolvido em uma única transação Prisma (`prisma.$transaction`) por tenant, para que uma
  falha no meio da carga de um tenant não deixe metade dos dados daquele tenant no banco.
- Réplica fiel dos dados hoje gerados em `src/lib/seed-data.ts`: os 3 planos
  (essencial/equipe/pro), o catálogo de features, os usuários master
  (Ana Beatriz, Rodrigo Salles, Camila Duarte), e os 6 estabelecimentos de demonstração —
  com atenção especial aos 4 que têm dados operacionais completos (Dom Navalha, Clínica
  Sorriso Leve, Barbearia JR, Barbeiro Bastião) e aos 2 que só existem para popular a
  listagem do master (Corte Certo — em teste; Barbearia Vintage — suspenso).
- Sem senhas, sem tokens de convite reutilizáveis (o `Invite` de exemplo grava só um hash
  determinístico fictício), sem dado pessoal real — todos os nomes/e-mails/telefones já são
  fictícios no código-fonte atual e serão preservados como estão.
- Datas relativas (`addDays(new Date(), -220)` etc.) do gerador atual são preservadas
  conceitualmente, mas fixadas em valores absolutos determinísticos no seed (para que rodar
  o seed duas vezes em dias diferentes não produza diffs de auditoria/agendamento
  divergentes) — decisão documentada no topo de `prisma/seed.ts`.

## Repositórios que serão criados

Nova camada, **paralela** à existente, sem tocar em `src/lib/repositories` (que continua
alimentando toda a UI atual):

- `src/lib/db/prisma.ts` — instância singleton do `PrismaClient` (server-only, cacheada em
  `globalThis` durante hot reload em dev).
- `src/server/context/` — `TenantContext`, `ActorContext`, `PublicContext`.
- `src/server/repositories/`:
  - `tenant-repository.ts` — resolver por slug (público), buscar por ID+contexto (privado),
    criar tenant transacionalmente (Tenant + BrandIdentity + BookingPolicy + PublicSettings
    + Unit principal + Membership do dono em uma única transação).
  - `user-repository.ts` + membership — buscar/():: criar usuário, consultar membership e
    permissões efetivas persistidas.
  - `consumer-repository.ts` — criar/listar consumidor isolado por tenant.
  - `professional-repository.ts` — listar/criar profissional isolado por tenant.
  - `service-repository.ts` — listar/criar serviço isolado por tenant.
  - `appointment-repository.ts` — criar (transacional, com checagem de sobreposição),
    cancelar (libera o horário), listar por tenant/profissional.
  - `audit-repository.ts` — registrar e listar auditoria por tenant.
- `src/server/services/` (se necessário) — regras que cruzam mais de um repositório (ex.:
  criação de tenant cruzando Plan + Feature).

Nenhuma tela é reconectada nesta etapa — os componentes React continuam 100% sobre
`src/lib/repositories` (localStorage). Isso será migração de fase futura.

## Estratégia de testes

- Os 50 testes atuais (`vitest run`, sem tocar rede/banco) continuam intactos e são a
  suíte padrão de `npm run test` — não passam a depender de internet nem de Postgres.
- Nova suíte separada, `test:db` → `vitest run --config vitest.db.config.ts` (ou
  equivalente), cobrindo só arquivos `*.db.test.ts`, execução **serial**
  (`poolOptions.threads.singleThread` / `fileParallelism: false`) para evitar corrida entre
  testes que compartilham o mesmo banco.
- Cada teste de banco cria seus próprios registros com identificadores únicos
  (`crypto.randomUUID()` ou prefixo `test-<timestamp>-`) e limpa só o que criou
  (`afterEach`/`afterAll` com `deleteMany` filtrado pelos próprios IDs) — nunca
  `TRUNCATE`/`deleteMany` global.
- Cobertura mínima: conexão, seed idempotente (rodar 2x, comparar contagens), slug
  duplicado (deve rejeitar), criação transacional de tenant, rollback em falha de criação
  (força uma etapa a falhar e confirma que nada do tenant ficou gravado), isolamento de
  consumidor/profissional/serviço/agendamento entre dois tenants, cancelamento liberando o
  horário, sobreposição bloqueada (mesmo profissional, período conflitante), feature
  desativada preservando os dados (não apaga nada, só marca), convite armazenando apenas o
  hash (nunca o token puro), auditoria vinculada ao ator e tenant corretos.

## Limites desta etapa

- Sem autenticação real, sem Better Auth, sem senha, sem sessão real — `User` só recebe o
  formato de campos compatível com o que Better Auth vai exigir depois.
- Sem envio de e-mail, sem recuperação de senha.
- Sem migração das telas para o banco — UI continua 100% sobre localStorage.
- Sem pagamentos, sem WhatsApp, sem deploy.
- Constraint de exclusão de sobreposição depende de `btree_gist`; se o ambiente do banco
  temporário não suportar a extensão, a proteção cai para a checagem transacional no
  repositório (documentado acima), e isso será reportado explicitamente no relatório final,
  não escondido.

## Próxima etapa sugerida (autenticação)

Better Auth sobre o `User` já modelado aqui: adicionar `Account`/`Session`/`Verification`
(schema padrão do Better Auth), ligar `Membership`/`platformRole` à sessão real, e só então
começar a trocar, tela por tela, os repositórios de `src/lib/repositories` pelos
equivalentes de `src/server/repositories` — começando pela área `master` (menor superfície)
antes do `painel` do tenant.
