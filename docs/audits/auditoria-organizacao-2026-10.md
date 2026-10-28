# Auditoria de organização do código (2026-10-28)

Base: `3d0ab1a` (merge do PR #78) em `integration/nestjs-typeorm-frontend`.
Branch do trabalho: `chore/organizacao-mapa-tecnico`. O mapa resultante está
em `docs/arquitetura/mapa-tecnico.md`, e os lotes propostos em
`docs/plans/plano-de-expansao.md`.

**Classificação usada**

- **Defeito:** comportamento errado ou dado incorreto, comprovado pelo código
  lido ou por execução. Diz qual dos dois.
- **Risco:** não está errado hoje, mas fica caro ou frágil com o crescimento.
- **Organização:** duplicação ou acúmulo de responsabilidade com custo
  concreto de manutenção.
- **Preferência:** estilo. Registrada, sem prioridade.

## 1. O que foi examinado e o que não foi

**Lido com atenção**

- Backend:
  - autorização: `common/tenant-authorization.ts`, `common/manager-permissions.ts`
    e todos os `*-access.ts`;
  - `auth/session.guard.ts` e `auth/tenant-access.ts`;
  - cabeçalho e listagens de `appointments/appointments.service.ts`;
  - cabeçalho de `payments/payments.service.ts`;
  - consultas de `dashboard/dashboard.service.ts`;
  - `notifications/whatsapp-provider.ts`;
  - os índices e as tabelas `tenants`, `units`, `consumers`, `public_settings`,
    `commission_*` e `appointment_payments` nas migrations.
- Frontend:
  - camada `src/lib/api/*` (tratamento de erro);
  - `src/lib/contato/whatsapp.ts`;
  - a rota de demonstração `src/app/[slug]/page.tsx`;
  - `next.config.ts`.
- CI: `.github/workflows/test-frontend-auth.yml` (etapas).
- Planos existentes:
  - `mensagens-e-proximos-lotes.md`;
  - `agendamento-publico-e-notificacoes.md`, seções 3 a 6;
  - `senha-do-dono-calendario-profissional.md`;
  - o runbook do Render.

**Varrido por busca, sem leitura linha a linha**

- Uso de `resolveAuthorizedTenant`: presente nos 13 serviços de estabelecimento.
- SQL de uma linha sem `tenant_id` sobre tabelas do estabelecimento: 2
  ocorrências, as duas sobre ids já provados (`accounts-admin.service.ts:220`
  e `tenant-authorization.ts:72`). Consultas em várias linhas não foram
  cobertas por essa busca.
- Locks (`FOR UPDATE`, `pg_advisory_xact_lock`), transações por arquivo,
  limites (`take`/`LIMIT`) e exclusões de dados antigos (`DELETE FROM`).
- Tamanho de cada módulo e duplicação dos scripts operacionais (por `diff`).

**Não examinado (pendente)**

- Telas e componentes de `src/app/conta/*` e `src/components/*` além do
  tamanho dos arquivos.
- A lógica interna de `accounts/` (convites, redefinição, diretório),
  `platform/`, `push/push-dispatcher.ts`, do motor de disponibilidade e de
  `team.service.ts`.
- O conteúdo dos scripts de `backend/scripts/` e do `public/sw.js`.
- Cobertura medida (nenhuma ferramenta de cobertura foi rodada).
- O workflow `apply-lote6b2-production.yml`, além do gatilho.

## 2. Achados

### Defeitos

**F1. O endereço curto `/<slug>` mostra "não existe" para um estabelecimento real.**

- **Arquivos:** `src/app/[slug]/page.tsx` e `src/lib/repositories/index.ts`.
- **Evidência:** a página lê só `estabelecimentoRepository.obterPorSlug(slug)`,
  que vem do `localStorage` da demonstração, e sem resultado mostra "Não
  existe nenhum estabelecimento com o endereço "/<slug>" nesta
  demonstração". O link real é `/agendar/<slug>`. Comprovado pela leitura,
  não reproduzido no navegador.
- **Consequência:** um cliente que digita o endereço curto do estabelecimento
  vê uma página de erro de demonstração.
- **Correção proposta (muda comportamento, lote E1):** encaminhar `/<slug>`
  que não seja da demonstração para `/agendar/<slug>`, ou retirar a
  demonstração (lote E2).

**F2. 26 erros de tipo nos testes do backend, fora do CI.**

- **Arquivos:** `src/auth/auth.controller.spec.ts`,
  `src/auth/testing/in-memory-data-source.ts` e os `test/*.e2e-spec.ts`
  (`supertest/types`).
- **Evidência:** `npx tsc --noEmit -p tsconfig.json` dá 26 erros, com a mesma
  contagem antes e depois deste lote. O build usa `tsconfig.build.json`,
  sem specs, e o Vitest só transpila.
- **Consequência:** o duplo de teste em memória já está fora do contrato
  (`TenantContext` sem `areas`; usuário sem `username` e
  `mustChangePassword`). Um teste pode passar sobre uma forma que a API
  não devolve mais.
- **Correção proposta (lote E1):** corrigir os tipos e acrescentar ao CI
  `npx tsc --noEmit -p tsconfig.json`.

**F3. O `tsc --noEmit` do frontend falha sem os tipos gerados do Next.**

- **Evidência:** sem `next typegen`, o `tsc` dá `Cannot find name
  'LayoutProps'` em `src/app/layout.tsx`. Depois de `npx next typegen`, dá
  zero erros (executado).
- **Consequência:** só confunde quem valida localmente. O CI usa
  `lint:types`.
- **Correção feita:** o comando está documentado no CLAUDE.md.

**F4. Um teste com banco dependia da hora em que o CI rodava.**

- **Arquivo:** `backend/test/team-manager-postgres.db-e2e-spec.ts`, teste
  "gerente com profissional ligado vê a própria agenda".
- **Evidência:** a reserva do colega ficava 2 h depois da do gerente, e as
  duas eram lidas no dia local da primeira. Com o teste rodando entre 20h e
  22h de Brasília, a do colega passava para o dia seguinte. O CI do head
  `adde58e` deste PR falhou assim às 23h44 UTC (`expected [] to deeply
  equal [ '…' ]`); o mesmo teste tinha passado no head anterior.
- **Consequência:** CI vermelho sem defeito no código, em duas horas por dia.
- **Correção feita:** as duas reservas no mesmo instante, em profissionais
  diferentes, como o teste equivalente de `team-access-postgres` já faz. A
  asserção não mudou.

### Riscos

**R1. A agenda do estabelecimento inteiro e as contagens do Início leem
todo o histórico do estabelecimento.**

- **Arquivos:** `appointments/appointments.service.ts` (`list` e `listRange`
  sem `professionalId`), `dashboard/dashboard.service.ts` (contagens por
  período) e a migration `InitialSchema` (índices).
- **Evidência:** o filtro é `tenant_id` mais faixa de `start_at`/`end_at`.
  Os índices são `(tenant_id, professional_id, start_at, end_at)` e
  `(tenant_id, status, start_at)`, e nenhum tem `start_at` logo depois de
  `tenant_id`. Não foi medido com `EXPLAIN`.
- **Consequência:** o custo cresce com os anos de histórico do
  estabelecimento, não com o tamanho do dia pedido.
- **Correção proposta (lote E3):**
  - medir com `EXPLAIN (ANALYZE, BUFFERS)` num banco descartável com volume
    sintético;
  - se confirmado, migration nova com índice `(tenant_id, start_at)`.

**R2. Contadores de cliente que nada atualiza.**

- **Arquivos:** colunas `consumers.total_visits`, `total_no_shows`,
  `last_served_at` e `next_appointment_at` (migration `InitialSchema`;
  entidade `consumer.entity.ts`).
- **Evidência:** nenhum código de runtime escreve essas colunas (busca), e
  nenhuma tela as mostra.
- **Consequência:** valem sempre 0 ou nulo. Quem montar "retorno de
  clientes" em cima delas mostraria números falsos.
- **Correção proposta:** calcular a partir de `appointments` (lote F-A1). Só
  manter cópia agregada se a medição mostrar necessidade, e então
  atualizada na mesma transação da mudança de status.

**R3. Tabelas que só crescem.**

- **Tabelas:** `sessions` (validade fixa de 30 dias; linhas vencidas nunca
  apagadas), `push_deliveries`, `booking_request_alerts`,
  `notification_jobs`, `audit_logs` e `staff_account_requests`.
- **Evidência:** nenhum `DELETE FROM` para elas no runtime.
- **Consequência:** é pequeno no piloto. Também é dado pessoal guardado sem
  prazo (IP e agente de usuário das sessões).
- **Correção proposta (lote O3):** rotina de retenção com prazos escritos,
  rodada pelo mesmo agendador externo do backup.

**R4. Não há índice para o histórico por cliente.**

- **Evidência:** não existe índice com `consumer_id` em `appointments`, só a
  FK composta.
- **Consequência:** as consultas de retorno de clientes (frente A) varreriam
  a agenda inteira do estabelecimento.
- **Correção proposta:** índice `(tenant_id, consumer_id, start_at)` na
  migration do lote F-A1.

**R5. Endereço do estabelecimento em dois lugares e vazio nos dois.**

- **Evidência:** `units.address` nasce `''` na criação por convite
  (`invites.service.ts:155`). `brand_identities.address` existe só na
  entidade, sem uso.
- **Correção proposta:** a frente D usa `units.address` da unidade
  principal como fonte única. A outra coluna fica sem uso até uma decisão.

### Organização

**O1. Feito neste lote: uma checagem de `DENIED` para as políticas do dono.**

- **Antes:** seis políticas tinham cópia própria (`negado`,
  `isDeniedByOverride` ou código em linha), e duas redeclaravam
  `PermissionOverrideLike`.
- **Agora:** `algumaNegada` em `common/tenant-authorization.ts`; 51 linhas a
  menos.
- **Validado:** 578 testes dos módulos afetados e a suíte completa do
  backend.

**O2. Feito neste lote: leitura única do `message` de erro da API.**

- **Antes:** oito cópias iguais nos clientes de `src/lib/api`.
- **Agora:** `mensagemDoBackend` em `http-client.ts`, com teste. A
  classificação por status continua em cada área, porque cada uma
  classifica de um jeito.

**O3. Feito neste lote: `linhasDe` mudou de módulo.**

- **Antes:** nove módulos importavam `notifications/` só por esse
  normalizador do retorno do `pg`.
- **Agora:** fica em `common/linhas-de.ts`.

**O4. Os scripts de publicação são copiados a cada lote de migration.**

- **Evidência:**
  - `aplicar-equipe-piloto.mjs` e `aplicar-gerente-piloto.mjs` têm cerca de
    505 linhas cada e diferem em 108 linhas depois de igualar os nomes;
  - `conferir-restauracao-equipe/gerente` têm cerca de 380 linhas e diferem
    em 81;
  - o conjunto `abrir-*`, `aplicar-*`, `conferir-*` e `*-piloto.mjs` soma
    3.361 linhas.
- **Consequência:** uma correção num roteiro não chega aos outros.
- **Correção proposta (lote E4):** extrair o núcleo comum, sem mexer agora.
  O PR #74, aberto, muda esses mesmos arquivos e acrescenta
  `scripts/lib/publicacao-lote.ts`. A consolidação espera a decisão sobre
  ele.

**O5. Serviços grandes.**

- **Arquivos:** `appointments.service.ts` (1.313 linhas: criação, pedido
  público, dia, período, cancelar, andamento, remarcar e opções),
  `invites.service.ts` (920) e `team.service.ts` (639).
- **Consequência:** é difícil revisar uma mudança pequena no meio do
  arquivo. Não há defeito associado.
- **Correção proposta (lote E5):** separar a leitura (`list`, `listRange`,
  `get`, montagem das views) da escrita em `appointments/`, só quando a
  área for tocada por outra mudança. Sem camada genérica nova.

**O6. Demonstração e Prisma legados.**

- **Tamanho:** cerca de 11 mil linhas de demonstração (`painel`, `master`,
  `profissional`, `onboarding`, `[slug]`, repositórios, seed) e 3,7 mil de
  Prisma. O `README.md` ainda descreve a fase de protótipo.
- **Consequência:** é o dobro de lugares para procurar uma regra, e F1.
- **Correção proposta (lote E2):** decidir se a demonstração continua. Se
  não, retirá-la num PR só de remoção, junto com `test:db` e Prisma.

**O7. Contrato de erro.**

- **Situação:** a maior parte das recusas manda só `message`, e as telas
  classificam pelo status. `code` existe em poucos casos (`SENHA_INCORRETA`,
  `TROCA_DE_SENHA_OBRIGATORIA`, convites).
- **Avaliação:** é coerente e não precisa de migração em massa.
- **Regra registrada no CLAUDE.md:** recusa nova que a tela precise
  distinguir de outra com o mesmo status leva `code`. Nenhuma tela decide
  pelo texto da mensagem.

**O8. Comentário desatualizado (corrigido).**

O cabeçalho de `appointments.service.ts` dizia que o arquivo não tinha
cancelamento, remarcação nem andamento, e o arquivo tem os três.

### Preferências (sem prioridade)

- **Autenticação:** cada requisição autenticada faz 3 leituras no guard e 3
  ou 4 em `resolveAuthorizedTenant`, todas por chave. `must_change_password`
  é lido numa consulta separada da do usuário. Juntar as duas economiza uma
  ida ao banco, mas não é urgente.
- **Nomes:** o backend mistura nomes em inglês (`canViewServices`,
  `isMembershipActive`) e em português (`algumaNegada`, `criarPedidoPublico`).
  Os dois padrões estão espalhados e trocar não traz ganho. A regra no
  CLAUDE.md é seguir o arquivo vizinho.

## 3. Regras críticas e cobertura

| Regra | Cobertura que existe |
|---|---|
| Isolamento entre estabelecimentos | `*-access.spec.ts` por área; `*-postgres.db-e2e-spec.ts` com tentativas entre estabelecimentos; suítes de navegador com "cross-tenant attacks on the API" (CI) |
| Permissões do gerente | `manager-permissions` nos specs de cada área; `team-manager` e `gerente-acessos-flow` |
| Sessão e senha temporária | 18 specs em `auth/`; `staff-login-postgres`; `acesso-por-usuario-flow` |
| Agenda (sobreposição, buffer, concorrência) | `appointments-postgres.db-e2e-spec.ts`, `availability-*`, `professional-service-link-concurrency` |
| Senhas e logs | `safe-typeorm-logger.spec.ts`; `senha-do-dono-postgres` com falha real de gravação |
| Idempotência de recebimentos e pedido público | `payments-postgres`, `public-booking-postgres` |
| Transições de andamento | `appointment-status-transitions.spec.ts` |

**Lacuna:** os testes não conferem os tipos do duplo em memória (F2).

## 4. Validação deste lote

| Verificação | Resultado |
|---|---|
| Build do backend (`tsc -p tsconfig.build.json`) | 0 erros |
| `oxlint src/ test/ scripts/` | passou |
| `npm run test` no backend | 95 arquivos, 1.511 testes passaram |
| `npm run test:e2e` no backend | 13 arquivos, 137 testes passaram |
| `tsc -p tsconfig.json` no backend | 26 erros, os mesmos da base (F2) |
| Frontend: `npx vitest run src/lib/api` | 16 arquivos passaram |
| Frontend: `eslint src/lib/api` | 0 erros, 1 aviso antigo de tamanho |
| Frontend: `next typegen` + `tsc --noEmit` | 0 erros |

Não rodados: `test:db-e2e` e as suítes de navegador. Nenhuma consulta,
transação ou tela mudou de comportamento. O CI do PR roda as duas.
