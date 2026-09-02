# Migração para NestJS + TypeORM + Neon

Status: plano aprovado para execução faseada. Nenhum lote abaixo foi implementado ainda.
Este documento é o carimbo de saída da auditoria de 2026-09-02, feita na branch
`integration/nestjs-typeorm-frontend` (HEAD `63ffaac`, "merge: integrate frontend
improvements with database foundation") — commit que integra a branch de fundação
NestJS/TypeORM/Neon (`6fc2fbd`, `4f87871`) com a branch de melhorias de frontend
(`4785eae`..`70eb913`: integridade de agendamento/permissões, divisão de comissões,
administração master, personalização pública). A versão anterior deste documento
(commit `4f87871`) foi escrita ANTES da integração — esta revisão existe para
reconciliar o plano com o que o frontend ganhou depois.

## Decisão de arquitetura (dada, não revisitada aqui)

- Frontend e páginas públicas: Next.js atual, preservado no lugar.
- Backend/API: NestJS, em `backend/` (novo diretório na raiz do repo).
- Banco: PostgreSQL, hospedado no Neon (grátis, região São Paulo, para começar).
- ORM: TypeORM. Migrations: arquivos TypeScript do TypeORM (nunca `synchronize: true`).
- Prisma só é removido depois de paridade comprovada entre as duas camadas.
- UI continua 100% sobre `localStorage` nesta fase — nenhuma tela é reconectada.

## 0. O que mudou desde o plano anterior (resumo executivo)

O plano de `4f87871` foi escrito olhando só para `refactor/nestjs-typeorm` (fundação
Prisma + rascunho NestJS/TypeORM). Desde então, a branch `feat/melhorias-frontend`
adicionou, e o merge `63ffaac` trouxe para esta branch:

1. **Divisão de comissões** (`5caab32`, `04a5c8e`) — motor puro, dois repositórios
   novos (`comissaoRegraRepository`, `lancamentoComissaoRepository`), gatilho de
   consolidação/estorno/**reativação** embutido em `agendamentoRepository`, tela
   `/painel/comissoes`, permissões `comissoes.visualizar`/`comissoes.gerenciar`.
   **Nada disso existe no `schema.prisma`** — zero tabelas, zero enums.
2. **Correção de integridade de agendamento/permissões** (`4785eae`) — duração real
   + intervalo posterior no motor de disponibilidade, reconfirmação de
   disponibilidade centralizada (`horarioAindaDisponivelParaProfissional`),
   bloqueio de agendamento público por status do tenant
   (`podeReceberAgendamentoPublico`), separação visualizar/gerenciar em várias
   telas. **Já coberto pelo plano anterior em espírito** (seção 7), mas a função
   central de reconfirmação e o bloqueio de remarcação de atendimento concluído
   (`agendamentoRepository.remarcar` agora lança erro) precisam entrar
   explicitamente na spec do serviço de domínio.
3. **Administração master parcial** (`348341f`, `07990e8`) — regra "nunca zero
   MASTER_OWNER ativo" generalizada e testada (`podeAlterarStatusAdministrador`,
   `podeAlterarPapelAdministrador`, `podeRemoverAdministrador`,
   `podeCriarAdministrador`), convite de administrador de plataforma
   (`ModalConvitePlataforma`, reaproveitando `Convite`/`conviteRepository`), guarda
   de mutação corrigida em `/master/administradores`. **Só metade do plano
   `admin-master-experiencia-usuarios.md` foi implementada**: o modo de suporte
   (Lote 2), o dashboard novo (Lote 5) e a acessibilidade de componentes (Lote 6)
   continuam só desenhados, não codificados. O seed ainda tem **um único**
   `MASTER_OWNER` (`gerarUsuariosPlataformaSeed`, `src/lib/seed-data.ts:868`) — o
   "segundo sócio" citado no plano de UX nunca foi adicionado ao dado de
   demonstração.
4. **Personalização pública** (`70eb913`) — `IdentidadeVisual.logoUrl` (upload de
   logo, Data URL nesta fase), `personalizacaoAvancada` (ordem de seções, rodapé
   customizado, ocultar marca da plataforma), `RegrasAgendamento.orientacoesAntesVisita`,
   bloco "antes da visita" na página pública (`src/components/publico/secoes.ts`),
   validação de slug com lista de reservados (`src/lib/estabelecimentos/validacao.ts`).
   **`BrandIdentity` no schema não tem coluna para o logo enviado** (só
   `logoInitials`) e **`BookingPolicy` não tem coluna para as orientações antes da
   visita** — os dois são gap direto de schema.

Nenhum destes quatro itens estava representado no `schema.prisma` nem no plano
`4f87871`. As seções 3, 5 e 6 abaixo cobrem o mapeamento completo; a seção 1.5 é o
inventário de lacunas pedido (item 3 da tarefa de auditoria).

## 1. Inventário do estado atual

Levantado lendo os arquivos reais (não os relatórios anteriores) em 2026-09-02,
depois do merge de integração.

### 1.1 Projeto

- `package.json`: `agenda-barber@0.1.0`, Next.js 16.3.4 + React 19.2.8, Vitest 4.1.11,
  Prisma 7.10.0 + `@prisma/adapter-pg` 7.10.0 + `pg` 8.23.0. Scripts: `dev`, `build`,
  `start`, `lint`, `test`, `test:db`. Sem `workspaces`.
- Baseline validada nesta auditoria (sem banco): **187 testes passando** (13
  arquivos), **lint com 0 erros** (1 aviso cosmético pré-existente e não
  bloqueante em `src/lib/db/prisma.ts:27`, diretiva `eslint-disable` não usada),
  **build com sucesso, 21 rotas** (`○` estático / `ƒ` dinâmico), `npx prisma
  validate` confirma schema válido.
- `tsconfig.json`: alias único `@/*` → `./src/*`. Nenhum path aponta para fora de
  `src/`, então criar `backend/` como diretório-irmão não colide com nada.
- Git: branch atual `integration/nestjs-typeorm-frontend`, sincronizada com
  `origin/integration/nestjs-typeorm-frontend`, working tree limpa no início desta
  auditoria.
- `.gitignore`: ignora `.env*` exceto `.env.example`. `src/generated/prisma`
  (client Prisma gerado) continua commitado — mesmo risco R7 já registrado na
  versão anterior deste plano, ainda não resolvido, ainda não bloqueante.

### 1.2 Estrutura de `src/` (atualizada)

- `src/app/` — 21 rotas do App Router (público `[slug]`, `login`, `403`,
  `master/*` com `administradores`/`estabelecimentos`/`estabelecimentos/[id]`/
  `estabelecimentos/novo`, `painel/*` com `agenda`/`comissoes`/`configuracoes`/
  `consumidores`/`equipe`/`equipe/novo`/`personalizacao`/`profissionais`/
  `servicos`, `profissional/agenda`).
- `src/lib/types.ts` — cresceu desde o plano anterior: `TipoComissao`,
  `StatusLancamentoComissao`, `RegraComissao`, `LancamentoComissao` (com
  `reativadoEm?`), `Permission` ganhou `comissoes.visualizar`/`comissoes.gerenciar`,
  `IdentidadeVisual` ganhou `logoUrl?`/`personalizacaoAvancada?`,
  `RegrasAgendamento` ganhou `orientacoesAntesVisita?`. Domínio inteiro continua em
  português (`Estabelecimento`, `Profissional`, `Servico`, `Consumidor`,
  `Agendamento`, `Membership`, `Convite`, `RegistroAuditoria`, `UsuarioPlataforma`,
  `UsuarioEstabelecimento`).
- `src/lib/repositories/index.ts` (618 linhas, era 414) — ganhou
  `comissaoRegraRepository` e `lancamentoComissaoRepository`, e
  `agendamentoRepository.atualizarStatus`/`.remarcar` ganharam gatilho de
  consolidação/estorno/reativação de comissão. `remarcar` agora **lança `Error`**
  se o agendamento já está `concluido` — antes disso era permitido.
  `estabelecimentoRepository.criar`/`.atualizar` agora validam slug (formato +
  reservado + unicidade) e identidade visual (cores hex, URLs de foto/logo,
  feature gate de personalização avançada) via `src/lib/estabelecimentos/validacao.ts`
  — a barreira real fica no repositório, não confia na tela chamadora.
- `src/lib/comissoes/engine.ts` (novo) — motor puro:
  `calcularComissao(precoAgendamentoCentavos, regra)`,
  `validarRegraComissao(entrada)`, `calcularComissaoPreview`,
  `converterValorDigitado`, `calcularTotaisRelatorio(lancamentos)`. Sem
  storage/React, mesmo padrão de `availability/engine.ts`.
- `src/lib/availability/engine.ts` — corrigido: `agendamentosParaOcupados` agora
  usa `dataHoraFim` real do agendamento (não recalcula pela duração cadastrada,
  só cai no fallback se `dataHoraFim` for inválido/ausente) e soma o intervalo
  posterior do serviço. `OpcoesDisponibilidade.intervaloPosteriorMinutos?`
  (padrão 0) passou a ser considerado em `calcularHorariosDisponiveis`.
  `STATUS_OCUPA_AGENDA` inalterado (`pendente | confirmado | em_atendimento |
  concluido`).
- `src/lib/availability/consulta.ts` — ganhou
  `horarioAindaDisponivelParaProfissional(profissional, servico, horario,
  estabelecimento, agendamentoIdExcluir?)`, função central de reconfirmação usada
  por TODO fluxo de criação/remarcação (público, painel, agenda do profissional)
  imediatamente antes de gravar.
- `src/lib/access/access-control.ts` (327 linhas, era 220) — ganhou
  `podeReceberAgendamentoPublico(status)` (bloqueia `suspenso`/`cancelado` para
  NOVOS agendamentos e remarcações públicas, cancelamento continua liberado), e
  todo o bloco de administração master multi-owner:
  `identificarProprietarioPrincipal` (agora só rótulo informativo, não trava
  remoção), `podeGerenciarAdministradores`, `podeCriarAdministrador`,
  `podeAlterarStatusAdministrador`, `podeAlterarPapelAdministrador`,
  `podeRemoverAdministrador` — todas centradas na regra pura
  `ficariaSemOwnerAtivo` (nunca zero `MASTER_OWNER` ativo).
- `src/lib/estabelecimentos/` (novo diretório) — `validacao.ts` (slug, logo,
  cores, URL de foto — `SLUGS_RESERVADOS = ["login","master","painel",
  "profissional","403","api","admin","configuracoes","agendar"]`) e
  `rascunho.ts` (estado de edição de `/painel/personalizacao`, puro,
  reconstruído a partir do estabelecimento salvo).
- `src/components/publico/secoes.ts` (novo) — regras puras de composição da
  página pública: ordem de seções configurável (`obterSecoesVisiveis`, só mostra
  seção com conteúdo real), `exibirMarcaPlataforma`, `obterRodapePersonalizado`,
  `obterAntesDaVisita` (política de cancelamento derivada de
  `prazoCancelamentoHoras` + `orientacoesAntesVisita` livre), `resolverLogo`
  (logo enviado ou iniciais como fallback, nunca os dois).
- `src/components/master/modal-convite-plataforma.tsx` (novo) — convite de
  administrador de plataforma, mesmo padrão de `Convite`/`conviteRepository` já
  usado por `/painel/equipe`.
- Testes: 13 arquivos, 187 testes (era 6 arquivos / 50 testes na versão anterior
  deste plano). Todos sem rede/banco.

### 1.3 Camada Prisma (fundação anterior, inalterada nesta integração)

- `prisma/schema.prisma` — 703 linhas, 16 enums, 25 models mapeados para 25
  tabelas (`@@map` em `snake_case`) + `_prisma_migrations` = 26 tabelas no banco.
  **Nenhuma mudança desde `4f87871`** — não foi atualizado para acompanhar
  comissões/personalização/auth/suporte. É exatamente essa defasagem que esta
  revisão do plano existe para mapear (seções 3, 5, 6).
- `prisma/migrations/20260901155542_init/migration.sql` — migration única
  aplicada, com `CHECK ("endAt" > "startAt")` (linha 641) e `EXCLUDE USING gist`
  (linha 651) confirmados no arquivo. `CREATE EXTENSION` para `btree_gist`,
  `citext` e `prisma_postgres` nas linhas 5–11.
- `prisma/seed.ts` (1537 linhas) — idempotente, transacional por tenant, âncora
  `REFERENCE_DATE` fixa. Não gera dado de comissão nem dos campos novos de
  personalização (schema não os tem ainda).
- `prisma/db-*.db.test.ts` (6 arquivos) + helpers — 24 testes de banco, execução
  serial, nunca `deleteMany` global.
- **Divergência conhecida e não resolvida**: o checksum gravado em
  `_prisma_migrations` para `20260901155542_init` não bate com o arquivo
  `migration.sql` atual, porque o predicado da `EXCLUDE` foi corrigido depois do
  `migrate deploy` (edição manual do arquivo + `ALTER TABLE` direto no banco, sem
  nova migration). Arquivo e banco estão consistentes **entre si**; só o ledger
  de integridade do Prisma ficou desatualizado. Tratamento na seção 8.7.
- **Credencial potencialmente exposta** (Prisma Accelerate, banco de
  demonstração antigo) — mesma recomendação permanente da versão anterior:
  girar a key no Prisma Console, fora do escopo deste plano. O Neon não é afetado.
- O banco Prisma Postgres de demonstração continua fora do escopo: nenhum
  comando desta auditoria ou de sua execução o tocou.

### 1.4 Inventário de tabelas, enums, relacionamentos e constraints a transportar (herdado, revisado)

Igual à versão anterior deste plano — 16 enums, 25 tabelas de domínio, extensões
`citext`/`btree_gist`, `CHECK`/`EXCLUDE` em `appointments` — **mais** o que a
seção 3 acrescenta agora (comissões, sessão/credencial, suporte, colunas novas
de personalização). Não repetido aqui para não duplicar; ver seção 3 para a
tabela de mapeamento completa e atualizada.

### 1.5 Inventário de diferenças — o que o frontend ganhou e o backend/banco ainda não representa

Lista obrigatória (item 3 da tarefa de auditoria), com onde cada item está hoje
e onde é tratado neste plano:

| # | Item | Estado no frontend (localStorage) | Estado no `schema.prisma` | Onde este plano resolve |
| --- | --- | --- | --- | --- |
| 1 | Novas permissões (`comissoes.visualizar`/`.gerenciar`) | `Permission` em `types.ts`, matriz em `access-control.ts` | `Permission` enum não tem `COMISSOES_VISUALIZAR`/`COMISSOES_GERENCIAR` | Seção 3 (enum `Permission`) |
| 2 | Administração com vários `MASTER_OWNER` | Regra pura implementada e testada (`ficariaSemOwnerAtivo`), mas seed ainda tem 1 owner | `PlatformRole.MASTER_OWNER` já suporta N linhas — não é gap de schema, é gap de regra de serviço/transação | Seção 4 |
| 3 | Regra "nunca zero owners ativos" | Implementada em 4 funções puras (`podeAlterarStatusAdministrador` etc.) | Nenhuma constraint de banco cobre isso (não dá para expressar "nunca zero linhas com X" em `CHECK` simples) | Seção 4 (transação de serviço) |
| 4 | Convites administrativos (Master) | `ModalConvitePlataforma` + `Convite`/`conviteRepository`, `InviteType` já distingue estabelecimento/plataforma | `Invite.type = PLATFORM` já existe no schema — **sem gap** | Confirmado na seção 3 |
| 5 | Modo de suporte (futuro) | Só desenhado em `admin-master-experiencia-usuarios.md` §2.2, **não codificado** | Não existe nenhuma tabela | Seção 4.4 (nova entidade `SupportSession`) |
| 6 | Isolamento entre plataforma e tenant | `User.platformRole` nullable, `Membership` separado — já é a base correta | Já modelado assim no schema — **sem gap** | Confirmado na seção 4 |
| 7 | Regras de comissão | `RegraComissao` + `comissaoRegraRepository` (upsert por profissional+serviço) | Não existe | Seção 5.1 (`CommissionRule`) |
| 8 | Lançamentos de comissão | `LancamentoComissao` + `lancamentoComissaoRepository` | Não existe | Seção 5.2 (`CommissionEntry`) |
| 9 | Estorno e reativação | `estornar`/`reativar` no repositório, `reativadoEm` no tipo | Não existe | Seção 5.2 |
| 10 | Snapshot financeiro (preço/regra congelados) | Todos os campos do `LancamentoComissao` são cópia no momento do cálculo | Não existe | Seção 5.2 |
| 11 | Personalização (geral) | `IdentidadeVisual` bem mais rica que `BrandIdentity` | Parcialmente coberto | Seção 6 |
| 12 | Logo (upload) | `IdentidadeVisual.logoUrl` (Data URL na demo) | `BrandIdentity` não tem coluna de logo enviado | Seção 6.1 |
| 13 | Orientações antes da visita | `RegrasAgendamento.orientacoesAntesVisita` | `BookingPolicy` não tem coluna equivalente | Seção 6.2 |
| 14 | Modelos clássico/moderno | `IdentidadeVisual.modelo` | `BrandIdentity.template` (`PageTemplate`) já existe — **sem gap** | Confirmado na seção 6 |
| 15 | Ordem das seções | `personalizacaoAvancada.ordemSecoes` | `BrandIdentity.sectionOrder` (`String[]`) já existe — **sem gap**, mas precisa validação de conteúdo (seção 6.3) | Seção 6.3 |
| 16 | Rodapé personalizado | `personalizacaoAvancada.rodapePersonalizado` | `BrandIdentity.customFooter` já existe — **sem gap** | Confirmado |
| 17 | Ocultar marca | `personalizacaoAvancada.ocultarMarcaPlataforma` | `BrandIdentity.hidePlatformBranding` já existe — **sem gap** | Confirmado |
| 18 | Validação e unicidade de slug | `validarSlugEstabelecimento` (formato + reservado + unicidade) | `Tenant.slug` é `@unique @db.Citext` — unicidade coberta; formato/reservado é regra de aplicação | Seção 6.4 |
| 19 | Slugs reservados | `SLUGS_RESERVADOS` (9 valores) | Não modelável em `CHECK` simples sem lista fixa — decisão: constraint de aplicação, não de banco | Seção 6.4 |
| 20 | Integridade de agendamentos | `CHECK`/`EXCLUDE` já no banco | Já coberto — **sem gap de schema** | Confirmado, seção 7 |
| 21 | Reconfirmação de disponibilidade | `horarioAindaDisponivelParaProfissional`, chamada em todo fluxo de escrita | Não é schema, é regra de serviço | Seção 7.1 |
| 22 | Regras de plano e features | `DEFINICOES_PLANO`/`FEATURES_AINDA_NAO_IMPLEMENTADAS` em `planos.ts` | `Plan`/`Feature`/`PlanFeature`/`TenantFeatureOverride` já existem — **sem gap de schema**, seed precisa refletir os 3 planos atuais (essencial/equipe/pro) e as 13 features (eram 13 no `FeatureKey`, confirmado) | Seção 5 do seed (Lote 11) |
| 23 | Dados públicos do estabelecimento | `/[slug]` já lê identidade+regras+serviços+profissionais | Coberto pelas mesmas tabelas | Seção 9 (endpoint público) |

Confirmação explícita: os itens 4, 6, 14, 16, 17, 20 e 23 **já estavam corretos**
no `schema.prisma` original — não é regressão, é o plano anterior tendo acertado
essas partes antes mesmo do frontend avançar. O trabalho real de schema está nos
itens 1, 5, 7–10, 12, 13.

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
│   ├── package.json          # projeto npm independente (não workspace por ora)
│   └── tsconfig.json
├── docs/
│   └── plans/
│       ├── fundacao-postgresql.md                    # etapa Prisma (histórico)
│       ├── migracao-nestjs-typeorm-neon.md           # este documento
│       ├── admin-master-experiencia-usuarios.md      # UX master/suporte (parcialmente implementado)
│       ├── mvp-divisao-comissoes.md                  # comissões frontend (implementado)
│       └── correcao-integridade-agendamento-permissoes.md  # integridade (implementado)
└── package.json          # inalterado no que toca ao Next.js
```

Sem mudança em relação à versão anterior: `tsconfig.json`/`next.config.ts` não
referenciam nada fora de `src/`, `backend/` continua diretório-irmão seguro,
Next.js não é movido.

### 2.1 O que o backend NestJS deve prever desde o Lote 1–2 (inalterado, reafirmado)

- `@nestjs/config` com validação obrigatória de env (Joi/Zod), falha rápida.
- TypeORM + driver `pg`. `synchronize: false` em todos os ambientes, sem exceção.
- Dois `DataSource`: `runtime` (`DATABASE_URL`, pooled) e `migrations`
  (`DIRECT_URL`, direta), mesma separação já em uso do lado Prisma.
- Health check (`@nestjs/terminus` ou handler manual): app viva + `SELECT 1`.
- CORS configurável por env.
- `ExceptionFilter` global traduzindo erros de domínio para respostas HTTP
  consistentes, **incluindo** o código Postgres `23P01` (violação da `EXCLUDE`)
  → 409, sem vazar detalhe interno.
- Transações em toda operação que grava mais de uma tabela — a lista cresceu
  nesta revisão: criar tenant (`Tenant`+`BrandIdentity`+`BookingPolicy`+
  `PublicSettings`+`Unit`+`Membership` do dono), **concluir agendamento**
  (`Appointment.status`+`AppointmentStatusChange`+`CommissionEntry` — seção 7.3),
  **alterar status/papel de administrador master** (leitura de todos os
  `MASTER_OWNER` ativos + escrita, dentro da mesma transação, para nunca
  observar/permitir um estado intermediário de zero owners — seção 4.3).
- Isolamento por tenant reforçado na camada de serviço (contexto de tenant
  explícito, toda query combina `id + tenantId`).
- Auditoria: serviço central de escrita em `AuditLog`.
- Testes unitários + integração (Neon real, serial, limpeza cirúrgica).
- Scripts: `migration:generate`, `migration:run`, `migration:revert`, `seed`,
  `test`, `test:integration`, `lint`, `build`, `start:dev`.

## 3. Mapeamento Prisma → TypeORM (atualizado)

Convenção preservada: nome de entidade em inglês, tabela/coluna `snake_case`,
mesma ruptura deliberada com o português de `src/lib/types.ts` já registrada em
`docs/plans/fundacao-postgresql.md`.

### 3.1 Enums — 16 existentes + 5 novos

Os 16 já auditados na versão anterior (`PlatformRole`, `PlatformPermission`,
`UserStatus`, `TenantStatus`, `BusinessCategory`, `PageTemplate`, `FeatureKey`,
`EstablishmentRole`, `Permission`, `PermissionMode`, `InviteType`,
`InviteStatus`, `AuditAction`, `ResourceType`, `ServiceModality`,
`AppointmentStatus`) continuam válidos, **com duas alterações de conteúdo** (não
de estrutura):

- `Permission` ganha dois valores: `COMISSOES_VISUALIZAR`, `COMISSOES_GERENCIAR`
  (espelhando `Permission` em `types.ts`).
- `AuditAction` ganha dois valores: `TENANT_SUPPORT_ENTERED`,
  `TENANT_SUPPORT_EXITED` (modo de suporte, seção 4.4). As duas ações genéricas
  já existentes (`SUPPORT_ACCESSED`) continuam para o significado amplo de
  "suporte olhou algo"; as novas são específicas de entrar/sair do contexto de
  um tenant.

Novos enums (5):

| Enum | Valores | Uso |
| --- | --- | --- |
| `CommissionType` | `PERCENTAGE`, `FIXED` | `CommissionRule.type`, `CommissionEntry.appliedType` |
| `CommissionEntryStatus` | `CONFIRMED`, `REVERSED` | `CommissionEntry.status` |

As demais três funcionalidades planejadas (credencial, sessão, suporte) usam
tipos primitivos (string/hash/timestamp) e FKs, não precisam de enum novo.

### 3.2 Tabelas — 25 existentes (mapeamento herdado) + 5 novas

O mapeamento das 25 tabelas já auditadas continua válido tal como descrito na
versão anterior (User, Plan, Feature, PlanFeature, Tenant, TenantFeatureOverride,
BrandIdentity, BookingPolicy, PublicSettings, Unit, Membership,
MembershipPermissionOverride, Invite, AuditLog, Professional,
ProfessionalSchedule, Service, ProfessionalService, Consumer, TimeBlock,
Resource, Appointment, AppointmentItem, AppointmentResource,
AppointmentStatusChange) — **com as seguintes alterações de coluna** (não de
estrutura de relacionamento):

| Tabela | Alteração | Motivo |
| --- | --- | --- |
| `brand_identities` | `+ logoUrl String?` | `IdentidadeVisual.logoUrl` (item 12 da seção 1.5) — nunca Data URL em produção, ver seção 6.1 |
| `booking_policies` | `+ visitGuidance String?` | `RegrasAgendamento.orientacoesAntesVisita` (item 13) |

Cinco tabelas novas (26–30), detalhadas nas seções 4 e 5:

| # | Entidade TypeORM | Tabela | Seção |
| --- | --- | --- | --- |
| 26 | `Credential` | `credentials` | 4.1 |
| 27 | `Session` | `sessions` | 4.2 |
| 28 | `SupportSession` | `support_sessions` | 4.4 |
| 29 | `CommissionRule` | `commission_rules` | 5.1 |
| 30 | `CommissionEntry` | `commission_entries` | 5.2 |

Total transportado: **16 enums (14 inalterados + 2 com valores novos) + 5 enums
novos, 30 tabelas** (25 + 5).

### 3.3 `Appointment` — inalterado

As duas peças sem decorator (`CHECK`/`EXCLUDE`) e as duas extensões
(`citext`/`btree_gist`) continuam exatamente como na versão anterior — SQL
já confirmado linha a linha contra `prisma/migrations/20260901155542_init/
migration.sql:641` (`CHECK`) e `:651` (`EXCLUDE`). Não repetido aqui.

## 4. Modelo administrativo real

Requisito: usuário, credenciais seguras, sessão, papel de plataforma, vínculo
com tenant, papel dentro do tenant, permissões, convite, auditoria — com dois
sócios `MASTER_OWNER`, nenhuma credencial hardcoded, provisionamento inicial
seguro, senha com hash, sessões revogáveis, isolamento estrutural entre conta
de plataforma e conta de tenant, proteção transacional contra zero owners,
proteção contra escalada de privilégio, `Master` sem `tenantId` obrigatório, e
modo de suporte auditável sem personificação silenciosa.

### 4.1 Credencial — `Credential` (nova, MVP)

```text
Credential
  id              String   @id @default(cuid())
  userId          String   @unique
  passwordHash    String
  algorithm       String              // ex.: "argon2id" — nunca hardcode o algoritmo no service, guarda aqui para rotação futura
  updatedAt       DateTime @updatedAt @db.Timestamptz(3)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("credentials")
```

- 1:1 com `User`, separada da tabela `users` — nunca uma coluna de senha direto
  em `User` (reduz superfície de vazamento acidental em queries/logs que
  selecionam `User.*`).
- `passwordHash` gerado com `argon2id` (ou `bcrypt` como alternativa aceitável)
  — decisão de biblioteca fica para o Lote 6 (autenticação), não fixada aqui.
  **Nunca** texto plano, nunca reversível.
- Sem `Credential`, o `User` não consegue autenticar por senha — cobre também o
  caso "convite pendente, conta ainda sem senha definida" (linha simplesmente
  não existe ainda).
- **Fora do MVP** (documentado, não implementado agora): recuperação de senha
  por e-mail, MFA/2FA, histórico de senhas anteriores, política de expiração de
  senha. Ver seção 4.5.

### 4.2 Sessão — `Session` (nova, MVP)

```text
Session
  id            String    @id @default(cuid())
  userId        String
  tokenHash     String    @unique
  createdAt     DateTime  @default(now()) @db.Timestamptz(3)
  expiresAt     DateTime  @db.Timestamptz(3)
  revokedAt     DateTime? @db.Timestamptz(3)
  userAgent     String?
  ipAddress     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("sessions")
```

- Mesmo padrão de `Invite.tokenHash`: **nunca** o token em texto puro, só o
  hash (SHA-256 é suficiente para um token opaco de alta entropia — diferente
  de senha, não precisa de custo computacional no hash).
- Revogável: `revokedAt` preenchido invalida a sessão antes do `expiresAt`
  natural — cobre logout explícito, "sair de todos os dispositivos", e
  revogação administrativa (ex.: suspender um `User`).
- Cookie `httpOnly`/`secure`/`sameSite=lax` (ou `strict`, decisão do Lote 6)
  carrega só o token opaco — nunca um JWT com claims de permissão embutidas
  (permissão é sempre recalculada no servidor a cada request, nunca confiada a
  partir do que está no cookie).
- **Fora do MVP**: refresh token rotativo, device fingerprinting avançado,
  limite de sessões simultâneas por usuário. O bloqueio de força bruta (rate
  limiting no endpoint de login) entra no MVP pela seção 10, não aqui.

### 4.3 Papel de plataforma, vínculo com tenant, papel dentro do tenant, permissões

Sem mudança estrutural em relação ao `schema.prisma` atual — `User.platformRole`
(nullable) e `Membership` (userId+tenantId+role) já separam corretamente os dois
domínios, exatamente como o frontend já pressupõe (`UsuarioPlataforma` vs.
`UsuarioEstabelecimento`+`Membership` em `types.ts`). O que este plano acrescenta
é a **regra de serviço** que o schema sozinho não consegue expressar:

- **Provisionamento dos dois sócios**: nunca migration com e-mail/senha reais.
  Comando NestJS custom (`nest-commander` ou script `ts-node` equivalente),
  executado manualmente uma vez por ambiente, lendo e-mail/senha inicial de
  variável de ambiente **não commitada** (`MASTER_OWNER_1_EMAIL`,
  `MASTER_OWNER_1_PASSWORD`, idem `_2`) ou gerando senha aleatória e imprimindo
  uma única vez no terminal para o operador copiar — nunca persistida em log.
  Cria `User` (`platformRole: MASTER_OWNER`) + `Credential` na mesma transação.
  Repetir o comando para um e-mail já existente é erro explícito, nunca upsert
  silencioso (evita resetar senha por engano).
- **Isolamento estrutural plataforma × tenant**: um `User` com `platformRole`
  preenchido pode adicionalmente ter `Membership`s (arquitetura já permite —
  nada impede uma pessoa de ser ao mesmo tempo Master e dono de um
  estabelecimento próprio), mas a **sessão** carrega um escopo explícito
  (`platform` ou `establishment`, mesmo campo `escopo` que `SessaoUsuario` já
  usa no frontend) decidido no login/troca de contexto — nunca os dois
  simultaneamente. Todo endpoint de `/master/*` exige escopo `platform`; todo
  endpoint de tenant exige escopo `establishment` **e** tenant vindo da sessão,
  nunca do body/query (regra já obrigatória na seção 10).
- **Nunca escalada de privilégio**: replicar como guard de serviço as quatro
  regras já puras e testadas no frontend
  (`src/lib/access/access-control.ts:264-326`):
  `podeCriarAdministrador` (só `MASTER_OWNER` promove a `MASTER_OWNER`),
  `podeAlterarPapelAdministrador`, `podeAlterarStatusAdministrador`,
  `podeRemoverAdministrador`. Usuário de tenant **nunca** alcança
  `usuarioPlataformaRepository`/`UserService.createPlatformUser` — nem por rota
  nem por payload manipulado, porque o guard de escopo da sessão barra antes
  de qualquer lógica de negócio rodar.
- **Nunca zero `MASTER_OWNER` ativos, dentro de transação**: a versão em
  `access-control.ts` (`ficariaSemOwnerAtivo`) já é pura e correta, mas roda
  sobre uma lista carregada antes da checagem — no frontend isso é aceitável
  (mono-usuário, sem concorrência real); no backend, **a leitura de todos os
  `User` com `platformRole = MASTER_OWNER AND status = ACTIVE` e a escrita
  (suspender/rebaixar/remover) precisam estar na mesma transação com
  `SELECT ... FOR UPDATE`** (lock pessimista nas linhas de owner), para que duas
  requisições concorrentes rebaixando os dois únicos owners ao mesmo tempo não
  passem as duas pela checagem antes de qualquer commit. Sem isso, a regra pura
  é correta em teoria e ainda assim burlável por corrida.
- **Permissões dentro do tenant**: `MembershipPermissionOverride` (substituindo
  `permissoesLiberadas`/`permissoesNegadas` paralelos) já é suficiente — `DENIED`
  sempre vence sobre `GRANTED` e sobre o padrão do papel, mesma ordem de
  precedência que `calcularAcessoEfetivo` já implementa no frontend
  (`access-control.ts:141-178`). Replicar essa ordem exata no serviço NestJS,
  não uma reinterpretação.

### 4.4 Modo de suporte — `SupportSession` (nova, planejada para o MVP conforme pedido; **implementação de UI fica fora desta migração**)

O frontend nunca chegou a codificar o modo de suporte (só desenho em
`admin-master-experiencia-usuarios.md` §2.2) — este plano modela a entidade
agora para que o Lote 7 (Master/tenants/memberships) já deixe o campo pronto,
mesmo que a tela de "Entrar em modo de suporte" só seja construída depois.

```text
SupportSession
  id            String    @id @default(cuid())
  masterUserId  String
  tenantId      String
  startedAt     DateTime  @default(now()) @db.Timestamptz(3)
  endedAt       DateTime?
  reason        String?

  masterUser User   @relation(fields: [masterUserId], references: [id], onDelete: Restrict)
  tenant     Tenant @relation(fields: [tenantId], references: [id], onDelete: Restrict)
  auditLogs  AuditLog[]

  @@index([masterUserId])
  @@index([tenantId, startedAt])
  @@map("support_sessions")
```

- `AuditLog` ganha uma FK opcional `supportSessionId` (nullable) — toda ação de
  mutação feita **enquanto** uma `SupportSession` está aberta (`endedAt IS
  NULL`) é gravada com esse vínculo, além do `actorUserId` sempre sendo o
  Master (nunca o dono do tenant) — satisfaz literalmente o requisito "registrar
  Master, tenant, início, término e ações".
- Entrar: cria `SupportSession` (`startedAt = now()`) + `AuditLog`
  (`action: TENANT_SUPPORT_ENTERED`). Sair: preenche `endedAt` + `AuditLog`
  (`action: TENANT_SUPPORT_EXITED`).
- **Nunca personificação silenciosa**: a sessão HTTP do Master continua sendo a
  sessão do Master (mesmo `userId` em `Session`) — o modo de suporte é um
  **contexto adicional** (`supportSessionId` ativo), nunca uma troca de
  identidade. Nenhuma ação em modo de suporte grava `actorUserId` do dono do
  tenant. Isso é a mesma garantia que o desenho de frontend já exigia
  (`admin-master-experiencia-usuarios.md:141`), só que agora expressável como
  invariante de schema (FK sempre para o Master, nunca reatribuível).
- Dentro do MVP: criar/encerrar `SupportSession`, gravar `AuditLog` vinculado.
  **Fora do MVP** (auditoria avançada, não implementar agora): replay de sessão
  de suporte, limite de tempo máximo automático, notificação ao dono do tenant
  de que um Master está em modo de suporte.

### 4.5 MVP vs. MFA/auditoria avançada — linha de corte explícita

| Entra no MVP (Lote 6–7) | Fica para depois (fora desta migração) |
| --- | --- |
| `Credential` com hash de senha | Recuperação de senha por e-mail |
| `Session` revogável por `revokedAt` | Refresh token rotativo, múltiplos dispositivos nomeados |
| Provisionamento dos 2 owners por comando/env protegido | Rotação automática de senha, política de expiração |
| Regra "nunca zero owners" transacional com lock | MFA/2FA (TOTP, WebAuthn) |
| `SupportSession` + `AuditLog.supportSessionId` | Replay de ações de suporte, notificação ao tenant |
| Guards de escopo (`platform`/`establishment`) por sessão | Personificação de usuário (explicitamente proibida, não só adiada) |
| Rate limiting básico no login (seção 10) | Detecção de anomalia/dispositivo novo |

## 5. Comissões

Entidades TypeORM equivalentes a `RegraComissao`/`LancamentoComissao`
(`src/lib/types.ts:268-316`), preservando toda regra já provada por 25 testes no
frontend (`src/lib/comissoes/engine.test.ts`,
`src/lib/repositories/comissoes.test.ts`).

### 5.1 Regra de comissão — `CommissionRule`

```text
CommissionRule
  id             String         @id @default(cuid())
  tenantId       String
  professionalId String
  serviceId      String
  type           CommissionType
  value          Int                          // percentual: 0-100 inteiro; fixo: centavos inteiro
  createdAt      DateTime       @default(now()) @db.Timestamptz(3)
  updatedAt      DateTime       @updatedAt @db.Timestamptz(3)

  tenant       Tenant       @relation(fields: [tenantId], references: [id], onDelete: Restrict)
  professional Professional @relation(fields: [professionalId], references: [id], onDelete: Cascade)
  service      Service      @relation(fields: [serviceId], references: [id], onDelete: Cascade)

  @@unique([tenantId, professionalId, serviceId])
  @@index([tenantId])
  @@map("commission_rules")
```

- `value` como `Int`, não `Float` — percentual guardado como inteiro 0–100 (não
  fração), fixo em centavos. Mesma decisão de "dinheiro sempre inteiro" já
  aplicada em `priceCents` no resto do schema.
- Unicidade `(tenantId, professionalId, serviceId)` — mesma garantia estrutural
  que `comissaoRegraRepository.salvar` já impõe por upsert no frontend
  (`src/lib/repositories/index.ts:214-256`): no máximo uma regra ativa por
  combinação, sem campo `ativa` paralelo.
  `onDelete: Cascade` em `professional`/`service` (regra órfã não faz sentido se
  o profissional ou o serviço for removido) mas `Restrict` em `tenant` (mesmo
  padrão do resto do schema — nunca apagar tenant com dado operacional).
- **Validações replicadas do frontend** (`validarRegraComissao`,
  `src/lib/comissoes/engine.ts:44-64`), como guard de serviço antes de
  persistir — nunca só `CHECK` de banco (a checagem "serviço vinculado a este
  profissional" depende de outra tabela, `ProfessionalService`, não expressável
  em `CHECK` simples de coluna):
  1. `professional.tenantId === service.tenantId` (mesmo tenant).
  2. Existe linha em `ProfessionalService` para o par (serviço realmente
     vinculado ao profissional).
  3. `type = PERCENTAGE` → `0 <= value <= 100`.
  4. `type = FIXED` → `value >= 0` e, se `service.priceCents` não for nulo,
     `value <= service.priceCents`.
- **Isolamento por tenant**: toda leitura filtra por `tenantId` explícito (nunca
  só por `id`), mesma disciplina do resto do plano.

### 5.2 Lançamento de comissão — `CommissionEntry`

```text
CommissionEntry
  id                    String                 @id @default(cuid())
  tenantId              String
  appointmentId         String                 @unique
  professionalId        String
  serviceId             String
  priceCentsSnapshot    Int
  appliedType           CommissionType
  appliedValue          Int
  professionalCents     Int
  establishmentCents    Int
  serviceDate           DateTime               @db.Timestamptz(3)   // = Appointment.startAt no momento do cálculo
  calculatedAt          DateTime               @default(now()) @db.Timestamptz(3)
  status                CommissionEntryStatus  @default(CONFIRMED)
  reversedAt            DateTime?              @db.Timestamptz(3)
  reactivatedAt         DateTime?              @db.Timestamptz(3)

  tenant       Tenant       @relation(fields: [tenantId], references: [id], onDelete: Restrict)
  appointment  Appointment  @relation(fields: [appointmentId], references: [id], onDelete: Restrict)
  professional Professional @relation(fields: [professionalId], references: [id], onDelete: Restrict)
  service      Service      @relation(fields: [serviceId], references: [id], onDelete: Restrict)

  @@index([tenantId])
  @@index([professionalId, serviceDate])
  @@map("commission_entries")
```

- `@unique` em `appointmentId` — mesma garantia estrutural que
  `lancamentoComissaoRepository.obterPorAgendamentoId` já impõe: **no máximo um
  lançamento por agendamento, para sempre**, mesmo depois de estornado e
  reativado (o registro é o mesmo, nunca uma segunda linha).
- Todos os campos de valor (`priceCentsSnapshot`, `appliedType`, `appliedValue`,
  `professionalCents`, `establishmentCents`) são **snapshot imutável** — depois
  de criados, nenhuma alteração posterior em `CommissionRule` os toca. Mesma
  garantia já testada no frontend (`comissoes.test.ts`, teste "alterar a regra
  depois não muda um lançamento já criado").
- `onDelete: Restrict` em todas as FKs — um `CommissionEntry` é registro
  financeiro histórico, nunca apagado em cascata por remoção de profissional,
  serviço ou agendamento (agendamento em si também nunca é apagado, só muda de
  status — ver `AppointmentStatusChange`).
- **Conclusão idempotente**: se já existe `CommissionEntry` para o
  `appointmentId` (em qualquer status), concluir de novo é no-op — replica
  `lancamentoComissaoRepository.criar` (`src/lib/repositories/index.ts:278-283`).
- **Cancelamento/falta**: `Appointment.status = CANCELED | NO_SHOW` nunca gera
  `CommissionEntry` — a checagem de status acontece antes de qualquer cálculo.
- **Reativação sem recalcular regra**: reverter um `CONFIRMED` para
  `REVERSED` seguido de nova conclusão do mesmo agendamento **reativa o mesmo
  registro** (`status → CONFIRMED`, `reactivatedAt = now()`), nunca recalcula
  `appliedValue`/`professionalCents`/`establishmentCents` a partir da
  `CommissionRule` atual — mesma garantia do `lancamentoComissaoRepository.reativar`
  (`src/lib/repositories/index.ts:299-306`).
- **Transações**: consolidação/estorno/reativação de `CommissionEntry` sempre
  dentro da MESMA transação que grava `Appointment.status` +
  `AppointmentStatusChange` (seção 7.3) — nunca uma escrita solta depois.
- **Constraints**: além da `@unique(appointmentId)`, nenhuma constraint de
  banco adicional é necessária — a regra "profissional nunca recebe mais que o
  preço do agendamento" já é garantida pelo cálculo (`Math.max(0, Math.min(...))`
  em `calcularComissao`), replicado como validação de serviço antes do insert
  (não é um `CHECK` de banco porque depende de dois campos calculados no
  momento da escrita, não de uma relação simples entre colunas).
- **Testes de concorrência**: dois workers tentando concluir o mesmo
  `Appointment` ao mesmo tempo devem resultar em exatamente um
  `CommissionEntry` — testável com `@unique(appointmentId)` forçando o segundo
  `INSERT` a falhar com violação de unicidade, capturada pelo serviço como
  "já existe, retornar o existente" (mesma idempotência do path não-concorrente).
- **Relatório por período e profissional**: índice
  `(professionalId, serviceDate)` cobre o filtro mais comum
  (`/painel/comissoes` já filtra por profissional + intervalo de data, ver
  `src/app/painel/comissoes/page.tsx:980-989`). Endpoint de relatório soma
  `priceCentsSnapshot`/`professionalCents`/`establishmentCents` — mesma lógica
  pura de `calcularTotaisRelatorio` (`src/lib/comissoes/engine.ts:98-107`),
  portada para SQL agregado (`SUM(...) GROUP BY`) ou calculada em memória no
  serviço, decisão de implementação do Lote 9.

**Fora do escopo (reafirmado, mesma restrição do plano de frontend)**: nenhum
pagamento real, Pix, cartão, split bancário ou NFS-e. `CommissionEntry` é
registro interno de cálculo, nunca uma transação financeira executada.

## 6. Personalização e URL pública

Modelo do estabelecimento atualizado para representar tudo que
`IdentidadeVisual`/`RegrasAgendamento` já cobrem no frontend.

### 6.1 Logo — coluna nova, decisão de armazenamento

- `BrandIdentity.logoUrl String?` (coluna nova, seção 3.2) — mesmo padrão de
  `bannerUrl` já existente (nullable, string simples).
- **Decisão e justificativa**: a coluna guarda uma **URL**, nunca o binário nem
  uma Data URL. O frontend hoje aceita Data URL como conveniência de protótipo
  (`validarUrlFoto` aceita `data:image/...;base64,` além de `https://`,
  `src/lib/estabelecimentos/validacao.ts:105-116`) — isso é aceitável em
  `localStorage` (cada navegador guarda o próprio blob), mas **nunca** deve
  chegar ao Postgres em produção: uma Data URL de imagem facilmente passa de
  100 KB–1 MB em texto Base64, infla linha e índice, e não tem nenhum dos
  benefícios de um CDN/object storage (cache, redimensionamento, invalidação).
  DTO de escrita no NestJS **rejeita** `data:` e aceita só `https://` — a
  compatibilidade com a Data URL de demonstração é resolvida no Lote 13
  (adaptação gradual do frontend), convertendo o fluxo de upload para
  "enviar arquivo → backend grava em object storage → retorna URL → frontend
  salva a URL", nunca enviando a Data URL para a API.
- **Object storage futuro** (não implementado nesta migração, só desenhado):
  S3-compatível (Cloudflare R2, Backblaze B2 ou S3 mesmo) com upload via URL
  pré-assinada — o NestJS nunca recebe o binário completo no corpo da
  requisição JSON, só emite a URL assinada e depois recebe a confirmação com a
  URL pública final. Fica registrado como pré-requisito do Lote 10
  (personalização pública), não resolvido dentro dele — se o Lote 10 for
  executado antes de ter object storage disponível, ele usa uma URL fornecida
  manualmente (upload por outro meio) só para não bloquear o resto do lote,
  documentando a lacuna explicitamente no relatório desse lote.

### 6.2 Orientações antes da visita — coluna nova

- `BookingPolicy.visitGuidance String?` (coluna nova, seção 3.2) — texto livre
  opcional, **sempre renderizado como texto simples, nunca HTML** (mesma regra
  já documentada no tipo `RegrasAgendamento.orientacoesAntesVisita`,
  `src/lib/types.ts:101-104`) — o serviço de leitura nunca faz
  `dangerouslySetInnerHTML` equivalente do lado do consumo; sanitização não é
  necessária porque o dado nunca é interpretado como markup.

### 6.3 Colunas vs. JSONB — decisão campo a campo

| Campo | Tipo escolhido | Justificativa |
| --- | --- | --- |
| `slug`, `name`, `shortName`, `logoInitials`, `address`, `phone`, `email`, `instagram`, `facebook`, `presentationText`, `style` | Coluna simples | Valor único, consultado/validado individualmente (unicidade de `slug`, formato de `email`), sem benefício de agrupar. |
| `primaryColor`, `secondaryColor`, `accentColor` | 3 colunas `String` (já assim no schema) | São exatamente 3 valores fixos, cada um validado isoladamente (`validarCorHex`, formato `#RRGGBB`) — **não** viram JSONB porque não há variação de quantidade nem de forma; JSONB adicionaria uma camada de parsing sem ganho (mantido como já está no schema atual, sem mudança). |
| `photos` (`String[]`) | Array nativo Postgres (já assim) | Lista homogênea de URLs, sem estrutura interna — array nativo é mais simples e mais barato de consultar que JSONB para este caso. |
| `sectionOrder` (`String[]`) | Array nativo Postgres (já assim), **com validação de conteúdo no serviço** | É uma lista ordenada de um conjunto fixo e pequeno de valores (`"apresentacao" | "servicos" | "equipe" | "fotos"`, replicando `SecaoId` em `src/components/publico/secoes.ts:10`) — array nativo preserva ordem nativamente; JSONB não traria benefício. A validação (só os 4 valores permitidos, sem duplicata) é responsabilidade do serviço, não do banco — um `CHECK` de array com valores permitidos e sem duplicata é possível em Postgres mas frágil a mudanças de enum futuras; mais simples manter a checagem em TypeScript, testável. |
| `customFooter` | `String?` (já assim) | Texto livre único, sem estrutura. |
| `hidePlatformBranding` | `Boolean` (já assim) | Flag simples. |
| `logoUrl`, `bannerUrl` | `String?` | Ver seção 6.1 — sempre URL, nunca binário/Data URL em produção. |
| `visitGuidance` (novo) | `String?` | Texto livre único — mesmo raciocínio de `customFooter`. |

Nenhum campo desta seção precisa de JSONB — o padrão do schema já era "coluna
por campo estruturado, array nativo para lista homogênea", e os campos novos
(`logoUrl`, `visitGuidance`) seguem a mesma convenção. JSONB fica reservado
(não usado agora) para o dia em que a personalização ganhar uma estrutura
verdadeiramente variável (ex.: blocos de conteúdo arbitrários por tenant) — não
é o caso de nenhum campo hoje mapeado.

### 6.4 Slug — validação, unicidade, reservados

- **Unicidade**: `Tenant.slug @unique @db.Citext` já cobre case-insensitive no
  próprio banco — sem gap, sem mudança.
- **Formato**: `^[a-z0-9]+(-[a-z0-9]+)*$` (mesma regex de
  `src/lib/estabelecimentos/validacao.ts:28`) — validado no DTO de entrada
  (`class-validator` com `@Matches`), nunca só no frontend.
  `normalizarSlug` (acentos, minúsculas, hífens) roda no frontend antes de
  enviar; o backend **não confia** nisso e valida o resultado de novo — mesma
  disciplina de "nunca confiar em quem chamou" já aplicada em todo o resto do
  plano.
- **Slugs reservados**: `SLUGS_RESERVADOS` (`login`, `master`, `painel`,
  `profissional`, `403`, `api`, `admin`, `configuracoes`, `agendar`) —
  **decisão: constraint de aplicação, não de banco.** Um `CHECK (slug NOT IN
  (...))` é tecnicamente possível, mas a lista pertence à topologia de rotas do
  Next.js (`src/app/*`), que pode ganhar novas rotas de sistema no futuro sem
  relação nenhuma com o schema do banco — manter a lista em código
  (constante compartilhada, replicada no backend a partir da mesma lista do
  frontend, documentada como "manter as duas em sincronia manualmente até
  existir um pacote compartilhado") é mais fácil de evoluir do que uma migration
  toda vez que uma rota nova for adicionada.
- **Compatibilidade com dados atuais**: o seed já usa slugs válidos
  (`dom-navalha`, `clinica-sorriso-leve`, etc.) — nenhuma migração de dado
  necessária, só validação daqui em diante.

### 6.5 Isolamento por tenant

Sem mudança: todas as 5 tabelas de configuração (`BrandIdentity`,
`BookingPolicy`, `PublicSettings` 1:1 com `Tenant`, mais `CommissionRule`/
`CommissionEntry` novas) exigem `tenantId` e cascata/restrict já descritos —
nenhuma tabela de personalização é compartilhável entre tenants.

## 7. Agenda e disponibilidade

### 7.1 O que já está correto e deve ser preservado exatamente

- Duração real do serviço + intervalo posterior — `agendamentosParaOcupados`
  (`src/lib/availability/engine.ts:67-84`) usa `dataHoraFim` real, cai no
  fallback de duração cadastrada só se o valor for inválido/ausente, soma o
  intervalo posterior depois. Portar essa MESMA lógica para o serviço de
  disponibilidade do NestJS — não a versão anterior (bug do fallback fixo de 30
  min), a versão corrigida.
- Preço congelado no agendamento — `Appointment.priceCentsSnapshot`
  equivalente (mapeado via `AppointmentItem.priceCentsSnapshot`, já no schema
  original) nunca relê `Service.priceCents` atual — mesma regra que
  `calcularComissao` já assume (nunca reler preço do serviço).
- Reconfirmação dentro da transação antes de criar/remarcar — replicar
  `horarioAindaDisponivelParaProfissional`
  (`src/lib/availability/consulta.ts:47-57`) como parte da MESMA transação que
  faz o `INSERT`/`UPDATE` do agendamento (no frontend é sequencial dentro do
  mesmo processo síncrono; no backend, para ser uma proteção real contra
  corrida, precisa estar dentro da transação com a `EXCLUDE` do banco como
  segunda camada — nunca só a checagem de aplicação sozinha).
- Exclusão somente do próprio agendamento na remarcação —
  `agendamentoIdExcluir` já é parâmetro explícito em
  `horariosLivresDoProfissionalNoDia`/`horarioAindaDisponivelParaProfissional` —
  replicar a mesma assinatura no serviço (nunca excluir "qualquer agendamento
  do mesmo horário", só o que está sendo remarcado).
- Cancelados fora do bloqueio — `STATUS_OCUPA_AGENDA` não muda:
  `PENDING | CONFIRMED | IN_PROGRESS | COMPLETED` ocupam agenda; `CANCELED`/
  `NO_SHOW` liberam. Mesma regra que a `EXCLUDE` do banco já aplica
  (`WHERE status <> 'CANCELED'`) — **atenção**: a `EXCLUDE` do banco só exclui
  `CANCELED`, não `NO_SHOW`; o motor de disponibilidade da aplicação já trata
  os dois como liberando o horário (`STATUS_OCUPA_AGENDA` não inclui
  `nao_compareceu`). Essa é uma divergência preexistente entre as duas camadas
  de proteção (banco vs. aplicação) que já existe hoje mesmo antes desta
  migração — **decisão**: manter como está (documentar, não "corrigir" aqui,
  porque mudar a `EXCLUDE` para também liberar em `NO_SHOW` é uma mudança de
  regra de negócio fora do escopo desta auditoria, não um bug óbvio — um
  agendamento com falta do cliente já aconteceu no passado, sobrepor um novo
  agendamento no mesmo intervalo é discutível). Marcado como pergunta em aberto
  para o dono do produto, não decidido unilateralmente aqui.
- Proteção contra dupla reserva: `CHECK (endAt > startAt)` + `EXCLUDE USING
  gist` — inalterado, já confirmado nas linhas 641/651 da migration existente.
- Extensões `citext`/`btree_gist` — inalteradas.
- Validação de tenant em todas as relações — toda query de disponibilidade
  filtra por `tenantId` explícito, nunca confia em `professionalId`/`serviceId`
  sozinhos (podem existir em outro tenant por erro de payload).
- Bloqueio de remarcação de atendimento concluído —
  `agendamentoRepository.remarcar` agora lança `Error` se
  `anterior.status === "concluido"` (`src/lib/repositories/index.ts:440-442`,
  adicionado nesta integração, **não estava no plano anterior**). Replicar como
  regra de serviço: `remarcar` rejeita (`409` ou `422`, decisão de convenção do
  Lote 8) se o status atual for `COMPLETED`. Corrigir primeiro o status (o que
  estorna a comissão) é pré-requisito para depois remarcar — mesmo fluxo que o
  frontend já força.
- Criação idempotente de comissão ao concluir — ver seção 5.2 e 7.3.

### 7.2 O que é garantido por TypeORM, SQL manual e serviço de domínio

| Garantia | Camada |
| --- | --- |
| Tipos de coluna, FKs, índices simples, unicidades de coluna única/composta | TypeORM (decorators de entidade) |
| `CHECK (endAt > startAt)`, `EXCLUDE USING gist`, `CREATE EXTENSION` | SQL manual dentro da migration TypeORM (seção 3.3, herdado) |
| Duração real + intervalo posterior no cálculo de horários livres | Serviço de domínio (porta de `availability/engine.ts`) |
| Reconfirmação de disponibilidade imediatamente antes de gravar | Serviço de domínio, dentro da transação |
| Bloqueio de remarcação de atendimento concluído | Serviço de domínio (regra de negócio, não expressável em `CHECK` porque depende de uma transição de estado, não de um valor de coluna isolado) |
| Criação/estorno/reativação idempotente de `CommissionEntry` ao mudar status | Serviço de domínio, mesma transação do `Appointment` |
| Isolamento por tenant em toda query | Serviço de domínio (contexto de tenant explícito) |

### 7.3 Transação de conclusão de agendamento (nova, detalhada nesta revisão)

Sequência dentro de UMA transação (`QueryRunner` ou `DataSource.transaction()`):

1. `SELECT` do `Appointment` por `id + tenantId` (nunca `id` sozinho) —
   confirma que pertence ao tenant do contexto autenticado.
2. Se `status` já é `COMPLETED`, no-op (idempotência de conclusão repetida,
   mesma regra que `atualizarStatus` já garante no frontend
   `src/lib/repositories/index.ts:412-429` ao comparar `anterior.status`).
3. `UPDATE Appointment SET status = 'COMPLETED'`.
4. `INSERT AppointmentStatusChange` (`fromStatus`, `toStatus: COMPLETED`,
   `changedBy`).
5. Buscar `CommissionEntry` existente por `appointmentId`:
   - Não existe → calcular (buscar `CommissionRule` do par
     profissional+serviço; sem regra, `type: PERCENTAGE, value: 0`) e inserir
     novo `CommissionEntry` (`status: CONFIRMED`).
   - Existe e `status = REVERSED` → `UPDATE` só `status = CONFIRMED,
     reactivatedAt = now()`, sem tocar em nenhum valor calculado.
   - Existe e `status = CONFIRMED` → no-op (já coberto pelo passo 2 na prática,
     mantido como segunda barreira).
6. `COMMIT`.

Reversão (`status` sai de `COMPLETED` para qualquer outro) segue o espelho: um
`UPDATE CommissionEntry SET status = 'REVERSED', reversedAt = now()` dentro da
mesma transação que muda `Appointment.status`, só se existir um `CommissionEntry`
com `status = CONFIRMED` para aquele agendamento.

## 8. Migração do banco atual

O Neon **pode já ter** schema, migration Prisma e dado quando o Lote 4 começar
(depende de quando o checkpoint da seção 11 do plano original — hoje seção 8.6 —
foi cumprido). Nenhum reset automático é assumido nem planejado.

### 8.1 Inventário read-only do banco (primeiro passo, antes de qualquer DDL)

```sql
-- Tabelas existentes
SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
-- Extensões instaladas
SELECT extname, extversion FROM pg_extension;
-- Migrations Prisma já aplicadas (se a tabela existir)
SELECT * FROM _prisma_migrations ORDER BY started_at;
-- Constraints e índices da tabela mais sensível
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'appointments'::regclass;
```

Executado com um usuário só de leitura, se disponível; senão o mesmo usuário de
aplicação, mas só com `SELECT` — nenhum `CREATE`/`ALTER`/`DROP` nesta etapa.

### 8.2 Backup/checkpoint

- Neon oferece branching de banco (feature nativa) — antes de qualquer DDL do
  Lote 4/5, criar um branch Neon (`pré-typeorm-checkpoint` ou nome similar) a
  partir do estado atual, mesmo que "atual" seja um banco vazio. Isso dá
  rollback point-in-time sem depender só de `pg_dump`.
- Adicionalmente, `pg_dump --schema-only` do estado atual salvo fora do banco
  (arquivo local, nunca commitado) — cobre o caso de o branching não estar
  disponível no plano gratuito.

### 8.3 Comparação schema real vs. Prisma vs. TypeORM

Antes de gerar a migration TypeORM inicial:

1. Comparar o inventário do passo 8.1 contra `prisma/schema.prisma` — confirmar
   que o banco reflete exatamente o que o Prisma esperava (nenhum `ALTER`
   manual não documentado além do já conhecido, seção 8.7).
2. Comparar contra as entidades TypeORM do Lote 3 (ainda a escrever) — gerar o
   diff (`typeorm migration:generate`) e ler linha a linha antes de decidir se
   ele bate com o que a seção 3 deste plano especifica.
3. Qualquer divergência entre os três (banco real, Prisma, TypeORM) é motivo de
   parada e revisão manual — nunca "aplicar e ver o que acontece".

### 8.4 Criação de migration TypeORM revisável

- Se o banco já tiver as 25 tabelas do Prisma (schema criado por
  `migrate deploy` anterior): a migration TypeORM inicial **não recria** essas
  tabelas — ela assume um baseline (seção 8.6) e só adiciona o que é
  genuinamente novo desta revisão (as 5 tabelas da seção 3.2 + as 2 colunas
  novas em `brand_identities`/`booking_policies` + os 2 valores novos de enum).
- Se o banco estiver vazio (Neon novo, nunca usado pelo Prisma): a migration
  TypeORM inicial cobre as 30 tabelas completas desde o começo — mesmo fluxo já
  descrito na versão anterior (seção 4 herdada, "Estratégia de migrations").
- Em ambos os casos: gerar → inspecionar manualmente → editar para acrescentar
  o que o gerador de diff não produz sozinho (`CHECK`/`EXCLUDE`/`CREATE
  EXTENSION`, mesma seção 3.3) → só então aplicar.

### 8.5 Preservação dos dados

- Nenhum comando deste plano ou de sua execução usa `TRUNCATE`, `DROP TABLE`
  sem `IF EXISTS` guardado por inspeção manual, ou qualquer `DELETE` sem filtro
  por chave conhecida.
- Se o banco já tiver dado de seed Prisma: ele é preservado tal como está
  durante toda a fase de coexistência (Lotes 1–13) — a migration TypeORM só
  adiciona colunas/tabelas novas com `DEFAULT NULL` (nullable) ou `DEFAULT`
  explícito, nunca uma coluna `NOT NULL` sem default sobre uma tabela que já
  tem linhas (isso quebraria o `ALTER TABLE` na hora de aplicar).

### 8.6 Tratamento da tabela `_prisma_migrations`

- A tabela é propriedade do Prisma — o TypeORM não a lê nem escreve. Ela
  continua existindo no banco até o Lote 14 (remoção final do Prisma), sem
  interferir nas migrations do TypeORM (que usam sua própria tabela de
  controle, `typeorm_migrations` ou nome equivalente, criada automaticamente na
  primeira `migration:run`).
- As duas tabelas de controle (`_prisma_migrations` e a do TypeORM) coexistem
  sem conflito — são namespaces de controle independentes, cada ORM só lê a
  própria.

### 8.7 Baseline do TypeORM sem reaplicar tabelas existentes

- Se as 25 tabelas originais já existem (criadas pelo Prisma), a migration
  TypeORM inicial usa `queryRunner.query(...)` só para o que é genuinamente
  novo — **nunca** um `CREATE TABLE` para uma tabela que o inventário do passo
  8.1 já confirmou existir. Isso é o "baseline sem reaplicar", pedido
  explicitamente na tarefa: a migration parte do estado real, não de um banco
  vazio hipotético.
- Alternativa equivalente, se preferível na hora da execução: gerar a migration
  completa (30 tabelas) mas rodar `typeorm migration:run` só depois de marcar
  manualmente como "já aplicada" a parte que corresponde às 25 tabelas
  existentes (inserir a linha na tabela de controle do TypeORM sem executar o
  SQL correspondente) — decisão de execução do Lote 5, não deste documento de
  auditoria.

### 8.8 Verificação de checksums e constraints

Depois de aplicar, mesma auditoria somente-leitura da seção 8.1, repetida:
confirmar 30 tabelas, extensões, e a definição exata das duas constraints em
`appointments` batendo com a seção 3.3 (`pg_get_constraintdef`).

### 8.9 Rollback

- Todo `up()` de migration TypeORM tem `down()` simétrico, testado como
  critério de aceitação (mesma exigência herdada do Lote 5 original) — nunca
  `DROP DATABASE`/reset.
- O branch Neon do passo 8.2 é o rollback de última instância se uma migration
  aplicada precisar ser desfeita além do que `migration:revert` cobre.

### 8.10 Checksum divergente da migration Prisma (tratamento, sem reconciliar agora)

Herdado da seção 1.3/8 do plano anterior: o checksum de
`20260901155542_init` em `_prisma_migrations` não bate com o arquivo
`migration.sql` atual (a `EXCLUDE` foi corrigida depois do `deploy` original,
por `ALTER TABLE` direto, sem nova migration Prisma). **Esta auditoria não
executa nenhuma reconciliação** — nem `prisma migrate resolve`, nem edição da
tabela `_prisma_migrations`, nem nova migration Prisma para "consertar" o
checksum. Fica documentado para quem for tocar o lado Prisma antes do Lote 14:
qualquer `prisma migrate deploy`/`dev` futuro contra esse mesmo banco vai
detectar a divergência e pedir intervenção manual (`migrate resolve
--applied`). Como o Prisma está a caminho de ser removido (Lote 14), a
recomendação é **não tentar reconciliar o checksum** — só documentar, e deixar
morrer junto com o resto do Prisma.

**Só depois de todos os passos acima, e só depois do Lote 9 (verificação de
paridade) aprovado**: remoção do Prisma (Lote 14).

## 9. API e frontend

Endpoints necessários para substituir os repositórios de `localStorage` por API
NestJS, agrupados por domínio. Contratos preservam os nomes/formas já usados
pelo frontend sempre que possível (mesma disciplina do comentário em
`src/lib/repositories/index.ts:1-3`: "para trocar por uma API real no futuro,
basta reescrever este arquivo mantendo as mesmas assinaturas").

| Domínio | Endpoints (REST, prefixo `/api/v1`) | Repositório substituído |
| --- | --- | --- |
| Autenticação | `POST /auth/login`, `POST /auth/logout`, `POST /auth/logout-all` | `auth-context.tsx` (login simulado) |
| Sessão | `GET /auth/me` (retorna escopo + papel + tenant atual) | `auth-context.tsx` |
| Plataforma/Master | `GET/POST /platform/administrators`, `PATCH /platform/administrators/:id/status`, `PATCH /platform/administrators/:id/role`, `DELETE /platform/administrators/:id`, `POST /platform/invites`, `POST /platform/invites/:id/resend` | `usuarioPlataformaRepository`, `conviteRepository` (tipo plataforma) |
| Modo de suporte | `POST /platform/support-sessions` (entrar), `PATCH /platform/support-sessions/:id/end` (sair) | Novo (seção 4.4) |
| Estabelecimentos | `GET/POST /tenants`, `GET/PATCH /tenants/:id`, `GET /tenants/check-slug?slug=` | `estabelecimentoRepository` |
| Memberships | `GET/POST /tenants/:tenantId/memberships`, `PATCH /memberships/:id` | `membershipRepository` |
| Convites (tenant) | `GET/POST /tenants/:tenantId/invites`, `POST /invites/:id/resend`, `POST /invites/:token/accept` | `conviteRepository` (tipo estabelecimento) |
| Profissionais | `GET/POST /tenants/:tenantId/professionals`, `PATCH /professionals/:id` | `profissionalRepository` |
| Serviços | `GET/POST /tenants/:tenantId/services`, `PATCH/DELETE /services/:id` | `servicoRepository` |
| Consumidores | `GET /tenants/:tenantId/consumers`, `POST /consumers/find-or-create` | `consumidorRepository` |
| Agenda | `GET/POST /tenants/:tenantId/appointments`, `PATCH /appointments/:id/status`, `PATCH /appointments/:id/reschedule` | `agendamentoRepository` |
| Disponibilidade | `GET /availability?professionalId=&serviceId=&date=` | `availability/consulta.ts` |
| Bloqueios | `GET/POST/DELETE /time-blocks` | `bloqueioRepository` |
| Comissões | `GET/POST /commission-rules`, `DELETE /commission-rules/:id`, `GET /commission-entries?profissionalId=&status=&de=&ate=` | `comissaoRegraRepository`, `lancamentoComissaoRepository` |
| Personalização | `GET/PATCH /tenants/:tenantId/brand-identity`, `GET/PATCH /tenants/:tenantId/booking-policy`, `GET/PATCH /tenants/:tenantId/public-settings` | `estabelecimentoRepository` (subconjunto de campos) |
| Planos/features | `GET /plans`, `GET /tenants/:tenantId/features` | `planos.ts` (dado estático vira dado real) |
| Público | `GET /public/:slug`, `GET /public/:slug/services`, `GET /public/:slug/professionals` | Leitura pública sem autenticação, mesma composição de `/[slug]/page.tsx` |
| Auditoria | `GET /platform/audit-logs`, `GET /tenants/:tenantId/audit-logs` | `auditoriaRepository` |

### 9.1 Adaptação gradual do frontend

Mesma ordem já sugerida no plano anterior e no plano de UX
(`admin-master-experiencia-usuarios.md` Lote 8): começar pela área `master`
(menor superfície, menos telas) antes do `painel` do tenant. Autenticação real
é pré-requisito de qualquer troca — nenhuma tela troca de `localStorage` para
API antes do Lote 6 (autenticação) estar pronto e testado.

Ordem recomendada dentro do Lote 13:
1. `/master/administradores` (menor tela, já usa as funções puras que vão
   virar chamadas de API).
2. `/master/estabelecimentos*`.
3. `/painel/comissoes` (isolado, sem dependência de outras telas do painel).
4. Resto do `/painel/*` e `/[slug]*` (público) por último, por serem a
   superfície mais usada e mais arriscada de regressão.

### 9.2 Preservar contratos e regras puras

Toda função pura já testada no frontend (`calcularAcessoEfetivo`,
`calcularHorariosDisponiveis`, `calcularComissao`, `validarRegraComissao`,
`podeReceberAgendamentoPublico`, as quatro funções de guarda de administrador)
é **portada, não reinventada** — mesma assinatura de entrada/saída sempre que
o contexto permitir, para que os testes de frontend continuem servindo como
especificação de comportamento esperado do backend.

## 10. Segurança

- **Validação DTO**: `class-validator`/`class-transformer` em todo payload de
  entrada — nunca confiar em tipo TypeScript sozinho (que desaparece em
  runtime).
- **Guards**: guard de autenticação (sessão válida) + guard de escopo
  (`platform`/`establishment`, seção 4.3) + guard de permissão
  (`Permission`/`PermissaoPlataforma`) em cascata, mesma ordem de precedência
  de `calcularAcessoEfetivo`.
- **Tenant vindo da sessão, não do body**: todo endpoint de tenant lê
  `tenantId` do contexto de sessão (ou de um path param validado contra a
  sessão), nunca de um campo no corpo da requisição — mesma regra já
  obrigatória no frontend (`tenant-context.tsx`, "tenantId sempre da sessão").
- **Autorização dentro do service**: guard de rota é defesa em profundidade,
  nunca a única barreira — toda mutação confere a permissão de novo dentro do
  método de serviço, mesma disciplina que todo o frontend já pratica
  ("esconder botão nunca é suficiente").
- **Rate limiting**: `@nestjs/throttler` no mínimo em `/auth/login` (mitigar
  força bruta) — limite e janela exatos são decisão de implementação do
  Lote 6, não fixados aqui.
- **Hash de senha**: `argon2id` (preferencial) ou `bcrypt`, nunca MD5/SHA
  sozinho, nunca texto plano.
- **Cookies seguros**: `httpOnly`, `secure` (produção), `sameSite=lax` no
  mínimo.
- **CSRF**: se a sessão usar cookie, exigir token CSRF de dupla submissão em
  mutações (`POST`/`PATCH`/`DELETE`) — estratégia exata (header customizado vs.
  cookie+header) decidida no Lote 6.
- **CORS**: origem restrita ao domínio do Next.js (dev e produção), nunca `*`
  com credenciais habilitadas.
- **Logs sanitizados**: nenhuma senha, hash, token de sessão/convite ou valor
  de `.env` em log — nem em erro capturado, nem em log de acesso.
- **Idempotência**: conclusão de agendamento, criação de `CommissionEntry`,
  reenvio de convite (invalida o anterior) — todas já desenhadas como
  idempotentes na seção correspondente.
- **Transações**: toda escrita multi-tabela, listada na seção 2.1 e 7.3.
- **Auditoria**: `AuditLog` central, nunca espalhada em cada service
  individualmente sem passar por um serviço comum de escrita.
- **Proteção contra IDOR**: todo `findOne`/`update`/`delete` por `id` combina
  com `tenantId` (ou com o escopo de plataforma) do contexto autenticado —
  nunca um `id` sozinho decide o que é retornado/alterado.
- **Proteção contra escalada de privilégio**: seção 4.3, guards replicando as
  quatro funções puras já testadas no frontend.

## 11. Prisma e vulnerabilidades

Quatro vulnerabilidades altas relatadas anteriormente:

```text
prisma → @prisma/config → deepmerge-ts / mysql2
```

Decisão (reafirmada, sem mudança de análise nesta revisão):

- **Não** executar `npm audit fix --force` — historicamente já quebrou builds
  em projetos Prisma por forçar downgrade incompatível.
- **Não** fazer downgrade automático de `prisma`/`@prisma/config`.
- Remover Prisma e seus transitivos **só** depois de paridade comprovada
  (Lote 9) — é a única forma de eliminar as quatro vulnerabilidades sem
  arriscar quebrar a camada que ainda está em produção/uso ativo.
- Confirmar `npm audit` de novo **depois** da remoção (Lote 15) — critério de
  aceitação explícito desse lote, não assumido antecipadamente.
- Remover `src/generated/prisma`, `prisma/migrations/`, `prisma/schema.prisma`,
  `prisma/seed.ts`, `prisma.config.ts`, `vitest.db.config.ts` e as dependências
  (`prisma`, `@prisma/client`, `@prisma/adapter-pg`, `pg` da raiz — o `pg` do
  `backend/` é dependência separada e fica) **só no Lote 14**, nunca antes.

## 12. Lotes atualizados

Cada lote é um passo committável isoladamente, na branch
`integration/nestjs-typeorm-frontend` (ou branch de trabalho equivalente
derivada dela). Nenhum lote abaixo foi executado — esta auditoria é só
planejamento.

### Lote 1 — Estrutura NestJS

- **Objetivo:** scaffold do projeto NestJS em `backend/`, sem tocar em Next.js
  nem banco.
- **Arquivos:** `backend/package.json`, `backend/tsconfig.json`,
  `backend/nest-cli.json`, `backend/src/main.ts`, `backend/src/app.module.ts`,
  `.gitignore` (adicionar `backend/node_modules`, `backend/dist`).
- **Comandos:** `npx @nestjs/cli new backend --package-manager npm --skip-git`
  (ou scaffold manual equivalente) a partir da raiz do repo.
- **Testes:** `backend/test/app.e2e-spec.ts` gerado pelo Nest (smoke HTTP, sem
  banco).
- **Critérios de aceitação:** `npm --prefix backend run build` e
  `npm --prefix backend run start:dev` sobem sem erro; `npm run
  test`/`lint`/`build` na raiz continuam intactos.
- **Riscos:** nenhum — diretório novo, isolado.
- **Rollback:** apagar `backend/` inteiro.
- **Toca o banco:** não.
- **Ponto de parada para revisão:** depois do smoke test HTTP passar.

### Lote 2 — Configuração e DataSource TypeORM

- **Objetivo:** validação de env obrigatória, dois `DataSource` (runtime/
  migrations), sem conexão real ainda.
- **Arquivos:** `backend/src/config/env.validation.ts`,
  `backend/src/config/config.module.ts`,
  `backend/src/database/runtime-data-source.ts`,
  `backend/src/database/migrations-data-source.ts`, `backend/.env.example`.
- **Comandos:** nenhum contra banco.
- **Testes:** unitário do schema de validação (env incompleta → falha
  explícita).
- **Critérios de aceitação:** app recusa subir com env inválida/incompleta.
- **Riscos:** nenhum.
- **Rollback:** reverter o commit do lote.
- **Toca o banco:** não.
- **Ponto de parada:** depois do teste de validação de env passar.

### Lote 3 — Entidades e enums atualizados

- **Objetivo:** as 30 tabelas / 21 enums (16 herdados, 2 com valores novos, 5
  novos) da seção 3 como entidades TypeORM — só metadata, sem tocar banco.
- **Arquivos:** `backend/src/entities/*.entity.ts` (30 arquivos),
  `backend/src/entities/enums/*.ts` (21 enums).
- **Comandos:** nenhum contra banco (`tsc --noEmit` só).
- **Testes:** compilação limpa + teste unitário garantindo que toda entidade
  tem `@Entity({ name })` batendo com a tabela `snake_case` esperada e que a
  contagem bate com a seção 3 (30 entidades, 21 enums) — nunca conferido "de
  memória".
- **Critérios de aceitação:** build limpo; contagens exatas.
- **Riscos:** divergir de algum detalhe do mapeamento da seção 3 — mitigar
  conferindo cada entidade nova contra a tabela de mapeamento antes de fechar o
  lote.
- **Rollback:** reverter o commit; nenhum banco tocado.
- **Toca o banco:** não.
- **Ponto de parada:** depois da conferência de contagem (30/21) documentada no
  commit.

### Lote 4 — Auditoria/baseline seguro do Neon existente

- **Objetivo:** executar a seção 8.1–8.3 deste plano (inventário read-only,
  backup/checkpoint, comparação schema real × Prisma × TypeORM) **antes** de
  qualquer DDL.
- **Pré-requisito:** Neon criado (região São Paulo), `DATABASE_URL`/
  `DIRECT_URL` configuradas em `backend/.env` (nunca commitadas) — mesmo
  checkpoint da seção 11 do plano original (agora seção 8.6 aqui em espírito).
- **Arquivos:** nenhum de produto — só o relatório da auditoria (pode ser uma
  seção acrescentada a este documento, ou `docs/plans/auditoria-neon-<data>.md`
  novo).
- **Comandos:** as queries somente-leitura da seção 8.1; branch Neon de
  checkpoint (seção 8.2).
- **Testes:** nenhum — é auditoria, não código.
- **Critérios de aceitação:** relatório registrando exatamente o que existe no
  Neon agora (vazio, ou já com as 25 tabelas Prisma, ou outra coisa) — decide
  qual caminho o Lote 5 segue (baseline vazio vs. baseline existente, seção
  8.4/8.7).
- **Riscos:** nenhum — só leitura.
- **Rollback:** não aplicável.
- **Toca o banco:** só leitura (`SELECT`), sem DDL/DML.
- **Ponto de parada:** relatório revisado por humano antes do Lote 5 começar —
  **obrigatório**, porque o caminho do Lote 5 depende do resultado.

### Lote 5 — Migration inicial TypeORM compatível com banco existente

- **Objetivo:** gerar e aplicar a migration inicial, respeitando o baseline do
  Lote 4 (seção 8.4/8.7 — nunca recriar tabela que já existe).
- **Arquivos:** `backend/src/migrations/<timestamp>-Init.ts`.
- **Comandos:** `typeorm migration:generate` contra o Neon (vazio ou com
  baseline), usando o `migrations DataSource`.
- **Testes:** inspeção manual do SQL gerado (nenhum teste automatizado nesta
  etapa) + depois de aplicar, query de verificação (30 tabelas, 21 enums,
  extensões, `CHECK`/`EXCLUDE` batendo com a seção 3.3).
- **Critérios de aceitação:** `typeorm migration:show` reporta aplicada;
  inserir dois agendamentos sobrepostos falha com `23P01`; `endAt <= startAt`
  falha com violação de `CHECK`; `down()` testado explicitamente
  (`migration:revert` seguido de `migration:run` de novo, sem erro).
- **Riscos:** maior risco de todo o plano — primeiro DDL contra um banco que
  pode já ter dado real. Mitigação: Lote 4 obrigatório antes, checkpoint Neon
  (seção 8.2) permite reverter além do `down()` se necessário.
- **Rollback:** `typeorm migration:revert` testado; branch Neon do Lote 4 como
  último recurso.
- **Toca o banco:** sim — primeiro lote que aplica DDL.
- **Ponto de parada:** depois do `down()`/`up()` simétrico confirmado, antes do
  Lote 6.

### Lote 6 — Autenticação e sessões

- **Objetivo:** `Credential`, `Session`, endpoints `/auth/*`, hash de senha,
  cookies seguros, rate limiting no login (seções 4.1, 4.2, 10).
- **Arquivos:** `backend/src/modules/auth/*` (controller, service, guards,
  strategy), `backend/src/entities/credential.entity.ts`,
  `backend/src/entities/session.entity.ts`.
- **Comandos:** `typeorm migration:generate` para as duas tabelas novas
  (`credentials`, `sessions`) — segue o mesmo ciclo gerar→inspecionar→aplicar.
- **Testes:** unitário (hash/verificação de senha, geração/validação de
  sessão) + integração (login válido, login inválido, logout revoga sessão,
  rate limiting bloqueia após N tentativas).
- **Critérios de aceitação:** login real funcional contra o Neon; nenhuma
  senha em texto plano em nenhuma tabela nem log; sessão revogada não
  autentica mais.
- **Riscos:** escolha de biblioteca de hash (argon2 exige binding nativo,
  bcrypt é mais simples de instalar) — decisão de implementação, documentar a
  escolha no commit.
- **Rollback:** `migration:revert` das duas tabelas; reverter commits do
  módulo.
- **Toca o banco:** sim (duas tabelas novas).
- **Ponto de parada:** depois dos testes de integração de login/logout/rate
  limit passando.

### Lote 7 — Master, tenants, memberships e permissões

- **Objetivo:** provisionamento seguro dos dois `MASTER_OWNER` (comando
  protegido, seção 4.3), regra transacional "nunca zero owners" com lock,
  `SupportSession` (seção 4.4, entidade pronta mesmo sem UI ainda), CRUD de
  tenants/memberships, guards de escalada de privilégio.
- **Arquivos:** `backend/src/modules/platform/*`, `backend/src/modules/
  tenants/*`, `backend/src/modules/memberships/*`,
  `backend/src/entities/support-session.entity.ts`, comando
  `backend/src/commands/provision-master-owner.command.ts`.
- **Comandos:** `typeorm migration:generate` para `support_sessions` +
  `AuditLog.supportSessionId` (coluna nova); rodar o comando de provisionamento
  contra o Neon, usando env não commitada.
- **Testes:** unitário (as quatro guardas de administrador, portadas de
  `access-control.ts`) + integração (criar os 2 owners, tentar rebaixar os 2 ao
  mesmo tempo — concorrência — confirma que só um sucede e o outro é
  rejeitado, nunca zero owners).
- **Critérios de aceitação:** 2 `MASTER_OWNER` provisionados sem credencial no
  código-fonte; teste de concorrência (lock) comprovadamente impede zero
  owners; usuário de tenant não alcança nenhum endpoint de `/platform/*`.
- **Riscos:** teste de concorrência real (duas requisições simultâneas) é mais
  difícil de escrever de forma determinística — considerar `SELECT ... FOR
  UPDATE` com uma transação deliberadamente atrasada (`pg_sleep` de teste) para
  forçar a corrida no teste automatizado.
- **Rollback:** `migration:revert`; comando de provisionamento não tem
  "desfazer" automático — remoção manual dos 2 usuários se necessário
  (documentar no README do backend).
- **Toca o banco:** sim.
- **Ponto de parada:** depois do teste de concorrência de "zero owners"
  passar de forma repetível.

### Lote 8 — Agenda e disponibilidade

- **Objetivo:** portar `availability/engine.ts` (versão corrigida, com duração
  real + intervalo posterior) e `horarioAindaDisponivelParaProfissional` para
  serviço NestJS; bloqueio de remarcação de atendimento concluído; proteção de
  dupla camada (`EXCLUDE` do banco + checagem transacional).
- **Arquivos:** `backend/src/modules/appointments/*`,
  `backend/src/modules/availability/*`.
- **Comandos:** nenhum DDL novo (tabelas já existem desde o Lote 5).
- **Testes:** portar os mesmos casos de `engine.test.ts` (18 testes) para o
  serviço NestJS, mais teste de integração de reconfirmação sob concorrência
  (dois requests tentando o mesmo horário, só um sucede — o outro recebe 409
  da `EXCLUDE`, traduzido pelo `ExceptionFilter`).
- **Critérios de aceitação:** paridade de comportamento com os testes do
  frontend (mesmos casos, mesmo resultado); remarcar agendamento `COMPLETED` é
  rejeitado.
- **Riscos:** divergência sutil entre a versão do motor portada e a do
  frontend, se alguém "melhorar" a lógica na portagem — mitigação: portar
  literalmente, sem reescrever, e só depois considerar melhorias como lote
  separado.
- **Rollback:** reverter commits do módulo; nenhuma mudança de schema.
- **Toca o banco:** não (schema já existe; só leitura/escrita de dado).
- **Ponto de parada:** depois dos 18+ testes portados passando e do teste de
  concorrência de dupla reserva confirmado.

### Lote 9 — Comissões

- **Objetivo:** `CommissionRule`/`CommissionEntry` (seção 5), transação de
  conclusão (seção 7.3), relatório por período/profissional.
- **Arquivos:** `backend/src/modules/commissions/*`,
  `backend/src/entities/commission-rule.entity.ts`,
  `backend/src/entities/commission-entry.entity.ts`.
- **Comandos:** `typeorm migration:generate` para as duas tabelas novas.
- **Testes:** portar os 25 testes de `comissoes/engine.test.ts` +
  `repositories/comissoes.test.ts`, mais teste de concorrência (dois workers
  concluindo o mesmo agendamento simultaneamente resultam em um único
  `CommissionEntry`, forçado pela `@unique(appointmentId)`).
- **Critérios de aceitação:** paridade completa com o comportamento já provado
  no frontend (cálculo, arredondamento, idempotência, estorno, reativação sem
  recalcular, isolamento por tenant).
- **Riscos:** arredondamento (`Math.round` em JS vs. `ROUND`/cast em SQL, se
  algum cálculo for feito em SQL agregado) — decisão: cálculo de
  `professionalCents`/`establishmentCents` sempre em código da aplicação
  (TypeScript), nunca em SQL, para usar exatamente a mesma função portada de
  `calcularComissao` e nunca divergir por diferença de arredondamento entre
  motores.
- **Rollback:** `migration:revert`; reverter commits do módulo.
- **Toca o banco:** sim (duas tabelas novas).
- **Ponto de parada:** depois dos testes de concorrência e reativação
  passando.

### Lote 10 — Personalização pública

- **Objetivo:** colunas novas (`logoUrl`, `visitGuidance`, seção 3.2/6.1/6.2),
  validação de slug/cores/URL replicada do frontend, endpoints de leitura
  pública (`/public/:slug`).
- **Arquivos:** `backend/src/modules/branding/*`,
  `backend/src/modules/public/*`.
- **Comandos:** `typeorm migration:generate` para as 2 colunas novas.
- **Testes:** portar `validacao.test.ts`/`rascunho.test.ts`/`secoes.test.ts` (o
  que for aplicável a regra de servidor, não a estado de UI) + integração
  (slug reservado rejeitado, slug duplicado rejeitado, cor inválida rejeitada,
  Data URL rejeitada no DTO de logo).
- **Critérios de aceitação:** endpoint público retorna exatamente os campos
  que `/[slug]/page.tsx` consome hoje; nenhuma Data URL aceita pela API.
- **Riscos:** object storage real não estar pronto (seção 6.1) — mitigação
  documentada: usar URL fornecida manualmente até o object storage existir,
  sem bloquear o resto do lote.
- **Rollback:** `migration:revert` das 2 colunas; reverter commits do módulo.
- **Toca o banco:** sim (2 colunas novas).
- **Ponto de parada:** depois da rejeição de Data URL confirmada em teste de
  integração.

### Lote 11 — Seeds idempotentes

- **Objetivo:** `backend/src/database/seed.ts`, cobrindo as 30 tabelas
  (incluindo comissão de demonstração e as duas contas `MASTER_OWNER` via
  comando do Lote 7, não via seed direto — seed nunca grava senha).
- **Arquivos:** `backend/src/database/seed.ts`.
- **Comandos:** script via `tsx`/`ts-node`, `DIRECT_URL`.
- **Testes:** rodar 2x, contagens idênticas (mesmo teste já validado no seed
  Prisma).
- **Critérios de aceitação:** contagens finais por tabela comparáveis ao seed
  Prisma para as 25 tabelas herdadas; tabelas novas (comissão) com dado de
  demonstração coerente com `gerarRegrasComissaoSeed`
  (`src/lib/seed-data.ts:998`).
- **Riscos:** nenhum novo.
- **Rollback:** deletar pelas chaves determinísticas; nunca `TRUNCATE`.
- **Toca o banco:** sim (dado, não schema).
- **Ponto de parada:** depois da segunda execução do seed confirmando
  contagens idênticas.

### Lote 12 — Testes de integração

- **Objetivo:** suíte de integração completa cobrindo os cenários das seções
  6/7/8 do plano original mais os novos (comissão, suporte, personalização).
- **Arquivos:** `backend/test/*.integration.spec.ts`.
- **Comandos:** `test:integration` novo em `backend/package.json`.
- **Testes:** os próprios testes de integração.
- **Critérios de aceitação:** 100% passando contra o Neon, execução serial,
  nenhuma linha órfã sobrevive à suíte.
- **Riscos:** nenhum novo além dos já cobertos por lote.
- **Rollback:** reverter commit; nenhuma alteração permanente de schema/dado.
- **Toca o banco:** sim (leitura/escrita de teste, limpeza cirúrgica).
- **Ponto de parada:** suíte verde de ponta a ponta.

### Lote 13 — Adaptação gradual do frontend

- **Objetivo:** seção 9.1 — trocar `master/administradores` → `master/
  estabelecimentos*` → `painel/comissoes` → resto do `painel`/público, um de
  cada vez, sem quebrar o restante que ainda usa `localStorage`.
- **Arquivos:** um repositório de `src/lib/repositories/index.ts` por vez,
  reescrito para chamar a API mantendo a mesma assinatura pública.
- **Comandos:** nenhum contra banco além do que a API já expõe.
- **Testes:** os testes de frontend existentes continuam servindo de
  especificação — adaptar os que dependiam de `localStorage` síncrono para
  chamada assíncrona (mudança de teste, não de regra).
- **Critérios de aceitação:** cada tela migrada funciona ponta a ponta contra
  o backend real, sem regressão visível nas outras telas ainda em
  `localStorage`.
- **Riscos:** UI que assume operação síncrona (`repository.criar(...)` sem
  `await`) precisa de revisão tela a tela — risco de esquecer um `await` e
  mascarar erro de rede como sucesso.
- **Rollback:** reverter a tela específica para a versão `localStorage`
  (ambas coexistem até o fim deste lote).
- **Toca o banco:** sim, via API.
- **Ponto de parada:** um checkpoint por tela migrada (Master primeiro, ver
  seção 9.1), não um único ponto no fim do lote inteiro.

### Lote 14 — Remoção final do Prisma

- **Só inicia depois do Lote 9 (paridade) E do Lote 13 completo** — nenhuma
  tela pode depender de `@prisma/client` quando este lote começar.
- **Arquivos removidos:** `prisma/` inteiro, `prisma.config.ts`,
  `src/generated/prisma/`, `src/lib/db/prisma.ts`, `vitest.db.config.ts`,
  dependências `prisma`/`@prisma/client`/`@prisma/adapter-pg`/`pg` da raiz.
- **Critérios de aceitação:** `npm run test`/`lint`/`build` na raiz limpos sem
  nenhum arquivo Prisma.
- **Riscos:** algum script/CI ainda referenciando `npm run test:db` —
  conferir antes de remover.
- **Rollback:** `git revert` do commit de remoção.
- **Toca o banco:** não (o banco Prisma Postgres de demonstração nunca é
  restaurado — só tinha dado demonstrativo).
- **Ponto de parada:** depois de confirmar zero referência a `@prisma/*` fora
  do que já foi removido.

### Lote 15 — Auditoria de segurança e dependências

- **Objetivo:** `npm audit` limpo (ou com plano de ação para o que sobrar),
  confirmação de que as quatro vulnerabilidades da seção 11 desapareceram.
- **Arquivos:** nenhum de produto — relatório de auditoria.
- **Comandos:** `npm audit` (raiz e `backend/`).
- **Testes:** nenhum novo — é auditoria de dependências.
- **Critérios de aceitação:** as quatro vulnerabilidades relatadas na seção 11
  não aparecem mais (removidas junto com o Prisma); qualquer vulnerabilidade
  nova do lado NestJS/TypeORM documentada com decisão explícita (corrigir,
  aceitar risco, ou substituir dependência).
- **Riscos:** nenhum novo.
- **Rollback:** não aplicável.
- **Toca o banco:** não.
- **Ponto de parada:** relatório final revisado por humano — encerra a
  migração.

## 13. Perguntas em aberto para o dono do produto (não decididas nesta auditoria)

1. `NO_SHOW` deveria liberar a `EXCLUDE` do banco (hoje só `CANCELED` libera,
   ver seção 7.1) — manter a divergência preexistente entre banco e aplicação,
   ou alinhar as duas camadas?
2. Object storage para logo/fotos (seção 6.1) — qual provedor, e isso é
   pré-requisito bloqueante do Lote 10 ou pode ser adiado com URL manual?
3. Biblioteca de hash de senha — `argon2id` (mais forte, exige binding nativo)
   ou `bcrypt` (mais simples de instalar em qualquer ambiente)?
4. Estratégia de CSRF exata (seção 10) — dupla submissão via header customizado
   é suficiente, ou o produto quer algo mais forte desde o MVP?

Estas perguntas não bloqueiam o início dos Lotes 1–3 (nenhuma delas afeta
estrutura/config/entidades) — só precisam de resposta antes dos Lotes 6, 9, 10
respectivamente.
