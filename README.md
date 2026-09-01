# Agenda Barber — protótipo

Protótipo de uma aplicação web de agendamento para barbearias pequenas (com estrutura
pensada para expandir depois para salões, manicures e outros prestadores de serviço).

Este é um **protótipo de demonstração**: não há backend real, banco de dados,
autenticação real, pagamentos ou envio de WhatsApp. Os dados vivem no `localStorage`
do navegador, atrás de uma camada de repositórios pensada para ser trocada por uma
API no futuro sem alterar as telas.

## Como rodar localmente

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

Outros comandos úteis:

```bash
npm run lint    # ESLint
npm run test    # Testes unitários (Vitest) do motor de disponibilidade
npm run build   # Build de produção
npm run start   # Sobe o build de produção
```

## Fluxos para testar

- **Landing** (`/`) — apresentação do produto.
- **Login simulado** (`/login`) — escolha entre Administrador master, Dono da
  Barbearia Dom Navalha, Profissional João Silva, ou abrir a página pública como
  cliente. Não há senha nesta etapa.
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
- `src/lib/auth/` — autenticação simulada (sem senha) via `sessionStorage`.
- `src/components/ui/` — componentes visuais de base.
- `src/components/agendamento/`, `src/components/painel/`, `src/components/master/`
  — componentes específicos de cada área.
- `src/app/` — páginas e layouts (Next.js App Router).

Veja `docs/plans/prototipo-agenda-barbearia.md` para o plano detalhado desta etapa.

## Fora de escopo nesta etapa

Backend real, banco de dados, WhatsApp real, pagamentos, autenticação real, emissão
fiscal, estoque e financeiro completo.
