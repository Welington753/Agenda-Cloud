# Agenda Barber — protótipo

Protótipo de uma aplicação web de agendamento para barbearias pequenas (com estrutura
pensada para expandir depois para salões, manicures e outros prestadores de serviço).

Este ainda é majoritariamente um **protótipo de demonstração**: agenda, equipe,
serviços, comissões, onboarding etc. continuam simulados em `localStorage`. Desde o
Lote 6C.1, porém, **login, restauração de sessão e logout são reais**, contra um
backend NestJS próprio (`backend/`) com PostgreSQL — ver "Autenticação real" abaixo.

## Como rodar localmente

Backend (numa aba/terminal):

```bash
cd backend
npm install
cp .env.example .env   # aponte DATABASE_URL/DIRECT_URL para um Postgres seu, nunca Neon local
npm run build:migrations-runtime && npm run migration:run:compiled
npm run start:dev
```

Frontend (noutra aba/terminal, na raiz do projeto):

```bash
npm install
cp .env.example .env   # NEXT_PUBLIC_API_URL já aponta para http://localhost:3001 por padrão
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

Outros comandos úteis (frontend):

```bash
npm run lint          # ESLint
npm run lint:types    # ESLint com regras dependentes de tipo
npm run test          # Testes unitários (Vitest)
npm run test:browser  # Teste de navegador (Playwright) do fluxo real de login/sessão/cookies —
                       # precisa do backend rodando contra um Postgres de verdade (nunca Neon)
npm run build         # Build de produção
npm run start         # Sobe o build de produção
```

## Autenticação real (Lote 6C.1)

- `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` no
  backend — sessão por cookie `HttpOnly` (nunca JWT, nunca lido pelo JavaScript da
  página).
- `src/lib/api/` — cliente HTTP e contrato tipado do backend real.
- `src/lib/auth/real-auth-context.tsx` (+ `real-session-state.ts`, puro e testado) —
  estado da sessão real: carregando / autenticado / não autenticado / falha de
  comunicação (uma falha de rede nunca é tratada como "não autenticado" nem libera a
  demonstração).
- `/conta` (+ `/conta/selecionar-estabelecimento`) — portal da conta real, guardado
  por `RequireRealSession`. Mostra o estabelecimento vinculado quando existe; quando
  a conta ainda não tem estabelecimento, ou quando a funcionalidade em si (agenda,
  equipe...) ainda não tem API própria, mostra isso claramente em vez de simular.
- O cadastro de estabelecimento para conta real (equivalente ao onboarding
  demonstrativo) **ainda não existe no frontend** — só o backend tem
  `POST /auth/register`. É o próximo passo natural depois deste lote.
- `npm run test:browser` (raiz) — teste real de navegador (Playwright): registra uma
  conta fictícia via API, faz login pela UI, confirma cookie `HttpOnly`, recarrega a
  página (restauração de sessão), desloga e confirma que o acesso a `/conta` é
  recusado depois. Roda no CI (`.github/workflows/test-frontend-auth.yml`) contra um
  PostgreSQL descartável — nunca Neon.

## Fluxos para testar

- **Landing** (`/`) — apresentação do produto.
- **Login** (`/login`) — formulário principal fala com o backend real (e-mail +
  senha de uma conta criada via `POST /auth/register`). A seção "Ambiente de
  demonstração" continua disponível para navegar pelas telas simuladas (Administrador
  master, Dono da Barbearia Dom Navalha, Profissional João Silva etc.) sem senha e
  sem se conectar ao backend — é um fluxo deliberadamente separado, nunca misturado
  com uma conta real.
- **Página pública** (`/dom-navalha`) — serviços, profissionais e horário de
  funcionamento da barbearia demonstrativa.
- **Agendamento do cliente** (`/dom-navalha/agendar`) — fluxo completo em 5 etapas
  (serviço → profissional → data/horário → dados → confirmação).
- **Confirmação/cancelamento/remarcação** (`/dom-navalha/agendamento/[id]`) — link
  gerado ao final do agendamento.
- **Painel do dono** (`/painel`) — dashboard, agenda (dia/semana, criar agendamento,
  bloquear horário, mudar status), profissionais, serviços, clientes e configurações.
- **Agenda do profissional** (`/profissional/agenda`) — visão restrita à própria
  agenda de João Silva.
- **Painel master** (`/master`) — visão geral da plataforma e lista de
  estabelecimentos simulados.

Um botão "Restaurar demonstração" (na barra lateral dos painéis e em
Configurações) apaga os dados salvos no navegador e recarrega a semente original.

## Arquitetura

- `src/lib/types.ts` — modelos de domínio (multi-tenant: toda entidade carrega
  `tenantId`).
- `src/lib/seed-data.ts` — dados simulados iniciais.
- `src/lib/storage/` — wrapper sobre `localStorage`.
- `src/lib/repositories/` — camada de acesso a dados (trocável por API real).
- `src/lib/availability/engine.ts` — motor de disponibilidade, puro e testado
  (`engine.test.ts`).
- `src/lib/availability/consulta.ts` — ponte entre o motor e os repositórios.
- `src/lib/auth/` — dois fluxos separados: `auth-context.tsx`/`autenticacao.ts` (sessão
  simulada via `sessionStorage`, sem senha) e `real-auth-context.tsx`/`real-session-state.ts`
  (sessão real via cookie `HttpOnly`, ver "Autenticação real" abaixo).
- `src/components/ui/` — componentes visuais de base.
- `src/components/agendamento/`, `src/components/painel/`, `src/components/master/`
  — componentes específicos de cada área.
- `src/app/` — páginas e layouts (Next.js App Router).

Veja `docs/plans/prototipo-agenda-barbearia.md` para o plano detalhado desta etapa.

## Fora de escopo nesta etapa

Cadastro de estabelecimento para conta real, migração de agenda/equipe/serviços/
comissões para API própria, WhatsApp real, pagamentos, emissão fiscal, estoque e
financeiro completo.
