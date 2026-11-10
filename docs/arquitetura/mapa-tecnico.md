# Mapa técnico do Agenda Cloud

Referência de onde cada coisa mora e de onde cada regra vive. Descreve o
código em `integration/nestjs-typeorm-frontend` a partir de `3d0ab1a`
(PR #78). Quando um módulo mudar de responsabilidade, atualize esta página
no mesmo PR.

Os achados da auditoria que gerou esta página estão em
`docs/audits/auditoria-organizacao-2026-10.md`, e o que vem depois está em
`docs/plans/plano-de-expansao.md`.

## 1. Visão de cima

```
navegador ── web Next.js (raiz) ── /agenda_api/* (proxy) ── API NestJS (backend/) ── PostgreSQL (Neon no piloto)
```

- **Web** (`src/`): App Router. Não tem acesso a banco. Fala com a API só
  por `src/lib/api/http-client.ts`. Em produção, o caminho passa pelo proxy
  de mesma origem; em desenvolvimento, vai direto a `http://localhost:3001`.
- **API** (`backend/src/`): um módulo Nest por domínio, TypeORM com
  `snake-naming-strategy`, sessão por cookie `HttpOnly`.
- **Banco**: o schema nasce só das migrations em `backend/src/migrations/`
  (12 aplicadas no piloto; `PlatformPortal1793318400000` ainda não). Prisma (`prisma/`, `src/generated/prisma`) é
  legado congelado e só serve aos testes antigos de `test:db`.

## 2. Backend: módulos

| Módulo | Responsabilidade | Depende de |
|---|---|---|
| `auth/` | Login (e-mail ou usuário interno), sessão, `/auth/me`, troca de senha, rate limit por IP, `SessionGuard`, áreas da sessão (`session-areas.ts`) | `config/` (cookie, IP do cliente), `entities/` |
| `common/` | Prova de vínculo com o estabelecimento (`tenant-authorization.ts`), catálogo de permissões do gerente (`manager-permissions.ts`), `ZodValidationPipe`, filtro de erro de banco, `exclusion-violation`, `linhasDe` (retorno de `manager.query`) | `entities/` |
| `team/` | Equipe e acessos (dono): criar acesso, senha do dono, editar perfil e profissional, permissões, vagas do plano (`seats.ts`); "Minha agenda" (`my-agenda.service.ts`) | `common/`, `auth/`, `accounts/` (auditoria) |
| `appointments/` | Criar, listar (dia e período), cancelar, remarcar, mudar andamento; pedido público vira `PENDING` aqui | `availability/`, `consumers/`, `notifications/` (agendador), `push/` |
| `availability/` | Motor de horários livres, jornada, fuso (`time-zone.ts`), `STATUS_QUE_OCUPAM` | `common/` |
| `professionals/` | Profissionais, vínculo com serviços, jornada semanal | `common/` |
| `services/` | Catálogo de serviços do estabelecimento | `common/` |
| `consumers/` | Clientes do estabelecimento: busca, página, criação | `common/`, `auth/phone-normalizer.ts` |
| `public-booking/` | Página pública por slug, horários e pedido público com idempotência e rate limit | `appointments/`, `availability/` |
| `payments/` | Recebimentos manuais e estornos dos atendimentos | `appointments/` (política de agenda), `common/` |
| `dashboard/` | Início do estabelecimento: contagens do período e dinheiro registrado | `payments/`, `common/` |
| `push/` | Web Push: inscrições, alertas de pedido, entregas, retomada ao subir | `common/` |
| `notifications/` | Base do WhatsApp automático: política, agendador na transação da reserva, fila, executor e provedor **simulado**. Nada chama o executor em produção | `appointments/` (chamado por ele) |
| `accounts/` | Administração de contas da plataforma, convites, redefinição de senha, auditoria (`audit_logs`) | `email/`, `auth/` |
| `platform/` | Portal da plataforma (só `MASTER_OWNER`, `platform-access.ts`): estabelecimentos, Ativo/Inativo, validade, sem vencimento (`no-expiry.service.ts`), preços do catálogo e contratados (`pricing.service.ts`), pagamentos das assinaturas | `accounts/`, `commercial/` |
| `email/` | Envio de e-mail (opcional; desligado sem variáveis) | — |
| `config/` | Validação de ambiente, cookie, IP do cliente | — |
| `database/` | DataSource de runtime (logger que omite segredos) e de migrations (logger padrão) | — |
| `entities/` | Entidades TypeORM e enums. Várias tabelas novas não têm entidade e são lidas por SQL explícito | — |

### Padrão de cada módulo de estabelecimento

```
<area>.controller.ts   rotas /tenants/:tenantId/..., @UseGuards(SessionGuard), ZodValidationPipe
<area>.dto.ts          schemas zod (corpo estrito)
<area>-access.ts       política PURA: (papel, ajustes) -> pode? + mensagem do 403
<area>.service.ts      resolveAuthorizedTenant(...) primeiro; regra e SQL depois
```

- O `tenantId` que vale é o devolvido por `resolveAuthorizedTenant`, nunca o
  da URL sem prova.
- Sem vínculo ou com estabelecimento inativo, a resposta é 404 (não 403),
  para não revelar que o estabelecimento existe.
- Ajustes (`membership_permission_overrides`): no dono, `DENIED` só tira
  acesso (`algumaNegada`). No gerente, só o `GRANTED` confirmado pelo dono
  dá acesso (`managerCan` e `effectiveOverrides`).

## 3. Frontend

| Pasta | O que tem |
|---|---|
| `src/app/conta/*` | Área real (dono, gerente, profissional): `agendamentos`, `minha-agenda`, `clientes`, `recebimentos`, `visao-geral`, `configuracoes` (serviços, profissionais, equipe, aparência) |
| `src/app/plataforma/*` | Portal da plataforma, layout e menu próprios (`components/administracao/shell-plataforma.tsx`); `/administracao/**` e `/conta/administracao/**` encaminham para cá |
| `src/app/agendar/[slug]` | Agendamento público real. `/agendar/<slug>` é o endereço canônico, o que a tela copia (`linkPublico`). O endereço curto `/<slug>` (`src/app/[slug]/page.tsx`, regra em `src/lib/agendamento-publico/endereco-curto.ts`) é decidido no servidor: 308 para cá quando a API confirma, 404 quando ela responde 404, 307 na dúvida; os slugs da semente da demonstração ficam na demonstração. As colisões com rotas da raiz e com a semente seguem pendentes (R6 da auditoria) |
| `src/app/login`, `convite`, `redefinir-senha`, `cadastro` | Entrada e ativação de conta |
| `src/app/agenda_api/[...caminho]` | Proxy de mesma origem |
| `src/app/sitemap.ts`, `robots.ts`, `not-found.tsx`, `imagem-de-compartilhamento.png` | Indexação, 404 e imagem de compartilhamento. Regras em `src/lib/site/` (`origem-do-site.ts`, `indexacao.ts`, `metadados-do-site.ts`, `dados-estruturados.ts`, `cabecalhos.ts`) |
| `src/lib/api/*` | Um cliente por área. Cada um valida a forma da resposta (`eh<Coisa>`) e classifica a falha pelo status. `mensagemDoBackend` (em `http-client.ts`) lê o `message` |
| `src/lib/<area>/*` | Regras puras da tela de cada área (`equipe`, `agendamento-publico`, `conta`, `contato`, `administracao`, `push`, `pwa`, `aparencia`) com teste ao lado |
| `src/lib/auth/real-auth-context.tsx` | Sessão real e `RequireRealSession` |
| `src/components/conta`, `agendamento`, `publico`, `ui` | Componentes da área real, do público e de base |

**Demonstração (legado):** `src/app/painel`, `master`, `profissional`,
`onboarding`, `src/app/[slug]`, `src/lib/repositories`, `src/lib/seed*`,
`src/lib/storage`, `src/components/painel` e `master`. São cerca de 11 mil
linhas sobre `localStorage`, sem API. Não misture com a área real:
`src/app/conta/layout.tsx` proíbe importar `@/lib/repositories`.

## 4. Onde mora cada regra (fonte única)

| Regra | Fonte |
|---|---|
| Este usuário opera este estabelecimento | `backend/src/common/tenant-authorization.ts` (`resolveAuthorizedTenant`) |
| Estabelecimento utilizável para sessão | `backend/src/auth/tenant-access.ts` |
| Permissões do gerente e dependências | `backend/src/common/manager-permissions.ts`; a tela recebe o catálogo da API (`team.service.ts`), e `src/lib/equipe/contratos.ts` espelha só o tipo |
| Quem vê e faz o quê em cada área | `backend/src/<area>/<area>-access.ts` |
| Serviços de uma reserva (um ou mais, mesmo profissional) | `appointments/service-selection.ts` (escolha), `AvailabilityService.calcular` (soma e maior intervalo), `appointment-items-sql.ts` (leituras em SQL) |
| Que status ocupam horário | `STATUS_QUE_OCUPAM` em `availability/availability.service.ts`, igual à constraint `appointments_no_overlap_excl` |
| Transições de andamento | `appointments/appointment-status-transitions.ts` |
| Fuso e dia local | `availability/time-zone.ts` (sempre o fuso do estabelecimento) |
| Telefone normalizado | `backend/src/auth/phone-normalizer.ts`; `src/lib/contato/whatsapp.ts` repete a regra, com teste |
| Política de senha | `passwordSchema` no backend; a tela confere o mesmo limite |
| Quando notificar | `notifications/notification-policy.ts` |
| Áreas visíveis na sessão | `auth/session-areas.ts`; a tela lê de `/auth/me` (`src/lib/conta/navegacao.ts`) |
| Invariantes de publicação | `render.yaml` + `src/lib/publicacao/render-blueprint.test.ts` |
| Origem pública do frontend (proxy e endereços canônicos) | `valorDaOrigemPublica` em `src/lib/api/proxy-config.ts`; o site valida em `src/lib/site/origem-do-site.ts` (só HTTPS, nunca de cabeçalho) |
| O que entra na busca (sitemap, robots, `noindex`) | `src/lib/site/indexacao.ts` e `ROTAS_SEM_INDEXACAO` em `src/lib/site/cabecalhos.ts` |
| Título, descrição e JSON-LD da página pública | `src/lib/agendamento-publico/metadados-publicos.ts`, com a leitura no servidor em `pagina-no-servidor.ts` (uma por requisição, `leitura-da-requisicao.ts`) |
| Estabelecimento de teste fora da busca | marca em `tenants.is_test`, gravada só por `setTestFlag` (`platform/establishment-admin.service.ts`, `manageEstablishments`); `indexable` em `GET /public/:slug`; uma decisão por requisição em `src/proxy.ts` (`proxy-da-pagina-publica.ts`, regras em `indexacao-da-pagina.ts`: API, memória de até 1 h, senão 503) vale para o `X-Robots-Tag` e, pelo cabeçalho interno `x-agenda-indexacao`, para o meta robots do layout |
| Slugs que nenhum cadastro novo recebe | `backend/src/common/reserved-slugs.ts`, aplicado em `resolveSlug` (`auth/slug.ts`, slug gerado do nome); `assertSlugChangeAllowed` (409 `SLUG_RESERVADO`) para uma rota futura que receba slug escolhido; `src/lib/agendamento-publico/slugs-reservados.test.ts` confere contra `src/app` e a semente; `scripts/lib/slugs-reservados-check.ts` copia a lista (conferida por teste) |

## 5. Segurança transversal

- **Sessão:** token aleatório, só o hash (`session-token.ts`) fica no banco,
  com validade fixa de 30 dias (`DEFAULT_SESSION_MAX_AGE_MS`). O guard relê
  sessão, usuário e `must_change_password` a cada requisição.
- **Senhas:** Argon2id em `credentials` (`password-hasher.ts`). Nunca voltam
  na resposta nem vão para log ou auditoria.
- **Logs:** `safe-typeorm-logger.ts` e `database-error.filter.ts` omitem
  parâmetros, hashes e tokens no runtime.
- **IP do cliente:** `config/client-ip.ts` (ver o runbook do Render, seção 5).
- **Cabeçalhos do web:** CSP sem nonce, `frame-ancestors 'none'`, nosniff,
  Referrer-Policy, Permissions-Policy e HSTS sem `preload`, todos em
  `src/lib/site/cabecalhos.ts`, aplicados pelo `next.config.ts`. A CSP lista
  no `connect-src` só a própria origem e a origem da API do build. Ela
  permite script inline, então não barra um script injetado por XSS.
- **Concorrência:** `FOR UPDATE`/`FOR SHARE` nas linhas decisivas,
  constraints como garantia final (`23P01`/`23505` viram 409) e travas do
  estabelecimento nas filas de equipe e convite.
- **Idempotência:** com chave de pedido (`request_key`/`idempotency_key`):
  pedido público, recebimentos, criação de acesso. Sem chave: criação de
  reserva interna (o cliente confere a lista antes de repetir). Cancelar e
  mudar andamento são idempotentes pelo estado.

## 6. Testes: o que roda onde

| Suíte | Comando | Banco |
|---|---|---|
| Unitários do backend (`src/**/*.spec.ts`, `scripts/**/*.spec.ts`) | `cd backend && npm run test` | nenhum |
| HTTP do backend (`test/*.e2e-spec.ts`) | `npm run test:e2e` | nenhum (DataSource em memória) |
| Banco do backend (`test/*.db-e2e-spec.ts`) | `npm run test:db-e2e` com `DB_E2E_DIRECT_URL` | PostgreSQL descartável com TLS |
| Unitários do web (`src/**/*.test.ts`) | `npm run test` | nenhum |
| Navegador (`tests/browser/*.spec.ts`) | `npm run test:browser:<suite>` | API real + PostgreSQL descartável |
| Proxy de mesma origem | `npm run test:browser:proxy` | idem, com bordas HTTPS locais |

O CI (`.github/workflows/test-frontend-auth.yml`) roda tudo isso, menos
`test:db`, começa pelo `npm run typecheck` do backend (specs e testes não
passam pelo build, e o Vitest só transpila) e é um dos dois checks do
processo de merge (a branch não tem proteção no GitHub; a regra é de
processo). O outro
(`test-migration-lote6b2.yml`) roda `migration:show/run` quando
`backend/src/database/**` ou as migrations mudam.

**Como escolher o que rodar localmente:**

- Política (`*-access.ts`, `common/`): os specs do módulo e de quem importa a
  política (`npx vitest run src/<area>`).
- Serviço com SQL ou transação: o spec do módulo e o `*.db-e2e-spec.ts` da
  área.
- Contrato de rota (DTO, status): o `test/<area>.e2e-spec.ts`.
- Tela: o teste da regra em `src/lib/<area>` e a suíte de navegador da área.
- Migration: o spec estrutural, `migration:run` em banco descartável e o
  workflow de migrations.
- Só documentação: nenhum teste.

## 7. Operação

- Publicação: `render.yaml` e `docs/runbooks/publicacao-piloto-render.md`.
  Deploy manual, primeiro a API e depois o web, no mesmo SHA.
- Migrations no piloto: um roteiro por lote em `docs/runbooks/`, com os
  scripts em `backend/scripts/` (lançador `.ps1`, aplicador `.mjs`,
  conferência de restauração e conferência do schema em `scripts/lib/`).
  Backup é manual (`pg_dump` no PC de quem opera). Não há monitoramento
  além do health check (ver o plano de expansão, lote O1/O2).
