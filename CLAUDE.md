# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Visão geral

Agenda-Cloud: SaaS multi-tenant de agendamento para pequenos negócios (barbearias, salões, clínicas…). Dois projetos Node independentes no mesmo repositório, cada um com seu `package-lock.json` (Node `>=24 <25`; use `npm ci`):

- **Raiz** — frontend Next.js 16 (App Router, React 19, Tailwind 4) em `src/`.
- **`backend/`** — API NestJS 12 + TypeORM 1 sobre PostgreSQL (ESM, imports com sufixo `.js`).

O piloto roda no Render (`render.yaml`: `agenda-cloud-piloto-api` e `agenda-cloud-piloto-web`) com banco Neon. Branch de integração: `integration/nestjs-typeorm-frontend`. Código, comentários, docs e mensagens de UI são em português.

## Comandos

Frontend (raiz):

```bash
npm run dev              # Next em :3000 (NEXT_PUBLIC_API_URL, padrão http://localhost:3001)
npm run build
npm run lint             # eslint
npm run lint:types       # eslint com regras dependentes de tipo (eslint.typed.config.mjs)
npx tsc --noEmit
npm test                 # vitest (unitários; ignora *.db.test.ts)
npx vitest run src/lib/format.test.ts      # um arquivo
npx vitest run -t "nome do teste"          # por nome
```

Backend (`backend/`):

```bash
npm run start:dev                       # API em :3001
npm run build                           # nest build -> dist/
npm run lint                            # oxlint
npm test                                # unitários (*.spec.ts em src/ e scripts/)
npm run test:e2e                        # HTTP e2e (test/*.e2e-spec.ts), sem banco
npm run test:db-e2e                     # contra PostgreSQL real; exige DB_E2E_DIRECT_URL
npm run test:db-e2e -- test/platform-postgres.db-e2e-spec.ts   # um arquivo
npm run build:migrations-runtime && npm run migration:run:compiled   # aplica migrations (DIRECT_URL)
```

Navegador (Playwright, raiz): `npm run test:browser:<suíte>` (auth, services, administracao, agendamento-publico, push…; ver `package.json`). O `webServer` do `playwright.config.ts` sobe `backend/dist/main.js` e `next start` **já compilados**, então rode `npm run build` nos dois projetos antes, com `NEXT_PUBLIC_API_URL` definido no build do frontend. Banco e migrations ficam por conta de quem chama. Algumas suítes têm configuração própria (`playwright.proxy.config.ts`, `playwright.relogio-de-teste.config.ts`). Cada suíte roda numa invocação separada porque os rate limits (login, aceite de convite, redefinição de senha) ficam em memória no processo do backend. O cadastro público está fechado: as suítes criam contas por convite (`tests/browser/support/contas-de-teste.ts`). O workflow `.github/workflows/test-frontend-auth.yml` é a referência exata de variáveis e ordem.

## Regras de ambiente e banco

- Testes de banco e de navegador só rodam contra **PostgreSQL descartável** com TLS (certificado autoassinado via `NODE_EXTRA_CA_CERTS`). Nunca usar Neon, o piloto, production ou `agenda_dev` em testes.
- Defina `IGNORE_DOTENV_FILE=true` ao subir o backend ou as migrations localmente, para o Nest não ler `backend/.env` (que pode apontar para infraestrutura real). Ver `backend/src/config/ignore-env-file.ts`.
- `DATABASE_URL` é a conexão com pooling em runtime; `DIRECT_URL` é a conexão direta (sem `-pooler`) para migrations. As variáveis são validadas em `backend/src/config/env.validation.ts`.
- Mudanças de schema são migrations TypeORM em `backend/src/migrations/` (`synchronize` sempre falso). Production usa o fluxo protegido de `docs/runbooks/migrations-production.md`; publicação em `docs/runbooks/publicacao-piloto-render.md`.

## Arquitetura

**Backend.** `app.module.ts` registra um módulo por domínio (`auth`, `services`, `professionals`, `availability`, `consumers`, `appointments`, `public-booking`, `push`, `platform`). Entidades ficam em `backend/src/entities/`, com `SnakeNamingStrategy`.
- Sessão por cookie `HttpOnly` com token opaco guardado como hash em `sessions` (nunca JWT). Senhas em `argon2id`. Rotas autenticadas usam `SessionGuard`.
- Multi-tenancy: rotas de estabelecimento são `tenants/:tenantId/...`. O `tenantId` da URL só vale depois de provado por `common/tenant-authorization.ts`: exige `Membership` do usuário naquele tenant e tenant utilizável, e carrega os overrides de permissão. A política de papéis e permissões fica numa função pura por módulo (`*-access.ts`). "Não existe" e "sem vínculo" devolvem a mesma mensagem, para não revelar tenants de terceiros.
- Administração da plataforma (`platform/`): o acesso vem de `users.platform_role` / `platform_permissions`, relido do banco a cada requisição (`platform-access.ts`). `MASTER_OWNER` vê tudo; admin e suporte precisam de `ESTABLISHMENTS_MANAGE`. Ser DONO de um estabelecimento nunca concede acesso global. A promoção a `MASTER_OWNER` é manual, por script operacional, e não tem rota.
- Validação de entrada com zod (`common/zod-validation.pipe.ts`). A disponibilidade usa um motor puro e testado. Conflitos de agenda são resolvidos por exclusion constraints no Postgres (`common/exclusion-violation.ts`).

**Frontend.**
- `src/lib/api/` concentra o cliente HTTP e os contratos tipados de cada recurso. O `leitura-com-recuperacao` e o `acordar-api` tratam a API hibernada do plano gratuito do Render: falha de rede nunca vira "não autenticado".
- `src/app/agenda_api/[...caminho]` é um proxy de mesma origem para a API (`src/lib/api/proxy*.ts`).
- Coexistem dois mundos que não devem se misturar:
  - **Real**: sessão por cookie, em `src/lib/auth/real-auth-context.tsx`. Usado em `/conta`, `/administracao`, na agenda, nos serviços, profissionais e clientes reais e no agendamento público por slug.
  - **Demonstração legada**: dados em `localStorage`/`sessionStorage`, via `src/lib/repositories/`, `src/lib/storage/` e `seed-data.ts`. Usado em `/master`, partes de `/painel` e `/dom-navalha`.
- Prisma (`prisma/`, `src/generated/prisma`, `src/lib/db/prisma.ts`) está congelado como legado, só para os `*.db.test.ts`. O TypeORM do backend é a única fonte do schema. `src/architecture-prisma-boundary.test.ts` falha se código de runtime importar Prisma.
- Testes unitários ficam ao lado do código (`*.test.ts[x]`). Os specs de navegador ficam em `tests/browser/`.

**Docs.** `docs/plans/` guarda o plano e o registro de validação de cada lote. `docs/runbooks/` guarda os procedimentos operacionais. O `README.md` descreve a fase de protótipo e está parcialmente desatualizado: várias áreas que ele chama de simuladas já são reais.
