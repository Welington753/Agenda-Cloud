# Plano — Protótipo Agenda Barber (Dom Navalha)

## Contexto
Protótipo web (sem backend real) para validar produto de agendamento para barbearias
pequenas, com caminho de evolução para salões/manicures/estética. Stack: Next.js 16
(App Router, Turbopack), TypeScript, Tailwind CSS v4, React 19. Persistência simulada
via `localStorage`, atrás de uma camada de repositório trocável por API depois.

## Decisões de arquitetura
- **Rotas dinâmicas por slug**: `/[slug]`, `/[slug]/agendar`, `/[slug]/agendamento/[id]`
  em vez de rotas fixas — mantém `/dom-navalha` funcionando hoje e já suporta múltiplos
  estabelecimentos amanhã.
- **Client-side first**: como não há backend, as páginas que leem/gravam dados usam
  `"use client"` e leem parâmetros de rota com `useParams()`/`useSearchParams()`,
  evitando a API assíncrona de `params` do Next 16 (que só importa para Server Components).
- **Camada de dados**: `src/lib/repositories/*` define interfaces (`TenantRepository`,
  `AppointmentRepository`, etc.) com uma implementação `localStorage` (`*.local.ts`).
  Trocar por API no futuro = trocar a implementação, não os componentes.
- **Motor de disponibilidade**: `src/lib/availability/engine.ts`, funções puras e
  testáveis (Vitest), sem depender de React ou de storage.
- **Autenticação simulada**: contexto React (`AuthContext`) guarda o "usuário logado"
  (perfil + tenant) em `sessionStorage`; sem senha, comentado como simulação.
- **Multi-tenant conceitual**: todas as entidades carregam `tenantId`; o repositório
  filtra por tenant a partir do contexto, nunca confia em `tenantId` vindo da UI sem
  cruzar com a sessão simulada.
- **Design tokens**: variáveis CSS em `globals.css` (`--color-ink`, `--color-paper`,
  `--color-accent-copper` etc.) consumidas pelo Tailwind v4 via `@theme inline`.

## Módulos e arquivos principais
1. `src/lib/types.ts` — modelos de domínio (Tenant, Professional, Service, Availability,
   Client, Appointment, Block, HistoryEntry, User, Platform stats).
2. `src/lib/seed-data.ts` — dados simulados (Dom Navalha + 2 estabelecimentos extra para
   o painel master, profissionais, serviços, clientes, agendamentos, bloqueios).
3. `src/lib/storage/local-storage.ts` — wrapper genérico de leitura/escrita/reset.
4. `src/lib/repositories/*` — repositórios (tenants, professionals, services, clients,
   appointments, blocks) implementados sobre o wrapper acima.
5. `src/lib/availability/engine.ts` + `engine.test.ts` — cálculo de horários livres,
   checagem de sobreposição, escolha de "qualquer profissional".
6. `src/lib/auth/auth-context.tsx` — contexto de sessão simulada + hook `useAuth`.
7. `src/lib/permissions.ts` — helpers de permissão por papel (master, dono, profissional, cliente).
8. `src/lib/format.ts` — formatação pt-BR (data, hora, telefone mascarado, moeda).
9. `src/components/ui/*` — Button, Card, Badge, Modal, Toast/ToastProvider, EmptyState,
   Skeleton, StepProgress, Sidebar/MobileNav.
10. `src/app/*` — páginas conforme rotas abaixo.

## Rotas
- `/` — landing curta do produto + acessos de demonstração.
- `/login` — escolha de perfil simulado (master, dono, profissional, cliente).
- `/[slug]` — página pública da barbearia (ex.: `/dom-navalha`).
- `/[slug]/agendar` — fluxo de agendamento (wizard de 5 etapas).
- `/[slug]/agendamento/[id]` — confirmação/cancelamento/remarcação.
- `/painel` — dashboard do dono.
- `/painel/agenda` — agenda dia/semana.
- `/painel/profissionais` — CRUD de profissionais.
- `/painel/servicos` — CRUD de serviços.
- `/painel/clientes` — lista de clientes.
- `/painel/configuracoes` — dados do estabelecimento e regras da agenda.
- `/profissional/agenda` — agenda restrita do profissional logado.
- `/master` — dashboard master.
- `/master/estabelecimentos` — lista de estabelecimentos simulados.

## Regras de disponibilidade (com testes unitários)
1. Sem sobreposição de horários para o mesmo profissional.
2. Respeita duração do serviço (só mostra horário se todo o intervalo cabe).
3. Respeita almoço, folgas e bloqueios manuais.
4. "Qualquer profissional" escolhe automaticamente quem está livre.
5. Cancelamento libera o horário novamente.
6. Antecedência mínima e limite de dias futuros.

## Etapas de execução
1. Tipos, dados simulados e wrapper de storage.
2. Repositórios + motor de disponibilidade + testes (Vitest).
3. Auth simulada, permissões, tokens de design/CSS, componentes de UI base.
4. Página pública + fluxo de agendamento + confirmação/cancelamento.
5. Painel do dono (dashboard, agenda, profissionais, serviços, clientes, configurações).
6. Agenda do profissional + login + landing + master (dashboard + estabelecimentos).
7. Polimento (estados vazios, toasts, responsividade, acessibilidade) + botão de reset.
8. Lint, testes, build de produção; correção de erros.

## Fora de escopo nesta etapa
Backend real, banco de dados, WhatsApp real, pagamentos, autenticação real, emissão
fiscal, estoque, financeiro completo, CRM avançado.
