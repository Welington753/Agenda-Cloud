# Agendamento público, confirmação, avisos e WhatsApp — plano dos próximos lotes

**Ponto de partida:** criado com o contato manual pelo WhatsApp (PR #52) e
atualizado com a base de confirmação e lembretes automáticos (Lote E, parte 1)
e com o agendamento público real e as solicitações no painel (Lote A + aviso
persistente, seção 7). Descreve o que já existe, o que falta e as decisões de
cada lote. Nada aqui está implementado além do que as seções "Já existe" e 7
dizem. Migrations novas: `1792540800000-NotificationJobs` e
`1792627200000-PublicBooking` (seção 5), aplicadas só em banco descartável.

## 1. Para quais negócios o modelo atual serve

O modelo real de reserva é **um cliente + um profissional + um serviço + um
intervalo de tempo** (`appointments`: `professional_id`, `consumer_id`, `start_at`,
`end_at`; um `appointment_items` por serviço; anti-sobreposição por profissional
via `EXCLUDE USING gist`). A disponibilidade sai da jornada semanal do
profissional, das reservas que ocupam e de `time_blocks`.

**Serve bem** a quem atende com hora marcada, um cliente por vez, com um
profissional responsável: salão e barbearia, estética, manicure, clínicas e
consultórios (psicologia, nutrição, fisioterapia, odontologia de cadeira única
por profissional), terapias, aulas particulares, personal trainer, tatuagem,
banho e tosa com um tosador por horário, consultoria.

**Não serve sem novo modelo** (não prometer):

- **Recursos compartilhados** — mesas, quartos, salas disputadas por vários
  profissionais, equipamentos, veículos. O schema já tem `resources` e
  `appointment_resources` (tipos `CHAIR`, `ROOM`, `TABLE`, `EQUIPMENT`, ...),
  mas **nenhum serviço da API os usa**: a disponibilidade não considera
  recurso. Exigiria regra de ocupação por recurso e constraint própria.
- **Capacidade > 1** — turmas, aulas em grupo, eventos com vagas: hoje um
  horário ocupado por uma reserva fica indisponível.
- **Vários serviços ou profissionais na mesma reserva** e **diárias/pernoites**
  (hotelaria, hospedagem pet): o fluxo e a ocupação assumem um serviço curto.

Linguagem: a área real (`/conta/**`), o cadastro, o login e o site comercial já
usam termos genéricos (estabelecimento, cliente, serviço, profissional,
agendamento). O que ainda cita barbearia é **dado da demonstração** (nomes de
estabelecimentos fictícios e contas de exemplo em `/login`), o segmento "Salão
e barbearia" entre outros no site comercial e chaves internas
(`agenda-barber:v3:` no `localStorage`, nome do pacote). Trocar as chaves
internas apagaria dados salvos da demonstração sem ganho para quem usa;
ficam como estão.

## 2. Já existe

| Peça | Onde | Observação |
|---|---|---|
| Disponibilidade real (jornada, reservas, `time_blocks`, antecedência) | `backend/src/availability/` | Protegida por sessão; só DONO. |
| Criação de reserva com cliente novo ou existente na mesma transação | `appointments.service.ts` | Só DONO, pela agenda interna. |
| Estado inicial `PENDING` quando `services.requires_manual_confirmation` | `appointments.service.ts:283` | Já é a regra do backend. |
| Confirmar / iniciar / concluir / falta / cancelar / remarcar com `expectedStartAt` | `appointments.controller.ts` | Histórico em `appointment_status_changes`. |
| `time_blocks` | `entities/time-block.entity.ts` | **Lido** pela disponibilidade; não há rota nem tela para criar/remover. Sem recorrência. |
| `booking_policies` (`auto_confirm`, `min_lead_minutes`, `max_future_days`, `require_client_phone`, ...) | `entities/booking-policy.entity.ts` | Só antecedência e limite futuro são usados; o cadastro não cria a linha. |
| `public_settings.is_published` | `entities/public-settings.entity.ts` | Sem uso na API real. |
| Contato manual pelo WhatsApp (links `wa.me`) | `src/lib/contato/whatsapp.ts`, `src/components/conta/contato-whatsapp.tsx` | **Não é notificação**: o responsável abre e envia. |
| Página pública `/[slug]` e `/[slug]/agendar` | `src/app/[slug]/` | **Demonstração**: lê repositórios locais do navegador, não a API. |
| Tarefas de confirmação e lembretes gravadas na transação da reserva | `backend/src/notifications/`, migration `1792540800000-NotificationJobs` | Base do Lote E. **Nada é enviado**: sem provedor real nem executor agendado. |
| Agendamento público real por slug | `backend/src/public-booking/`, `src/app/agendar/[slug]/`, migration `1792627200000-PublicBooking` | Só para quem o DONO ativou. Pedido sempre `PENDING`. Ver seção 7. |
| Solicitações pendentes no painel | `src/app/conta/solicitacoes/`, `GET /tenants/:id/booking-requests` | Contador no menu e aviso na Visão geral; confirmar/recusar com as ações existentes. |
| Autorização de contato por cliente | `consumers.whatsapp_opt_in_at` / `_source` / `whatsapp_opt_out_at` | Colunas existem, todas NULAS; não há tela nem rota para registrar. |

**Não existe:** rota pública além de `/public/:slug` (seção 7); tabela de
eventos/avisos lidos por usuário (o aviso do painel é a própria lista de
pendentes); nenhum provedor real de mensagem nem executor
agendado; nenhuma permissão de agenda para papéis além de DONO. **A existência
de `notification_jobs` não entrega agendamento público nem aviso ao dono** —
esses continuam nos Lotes A e C.

## 3. Sequência de lotes

### Lote A — Agendamento público real (cliente agenda sozinho)

- Rotas **públicas e separadas** por `slug`, sem `tenantId` interno nem sessão:
  `GET /public/:slug` (nome, serviços com `active_in_public_booking`,
  profissionais ativos), `GET /public/:slug/availability` (mesmo motor, sem
  dados de outras reservas) e `POST /public/:slug/booking-requests`.
- **Nunca** reaproveitar `GET /tenants/:id/consumers` (busca privada): o
  público só informa os próprios dados; o backend procura/cria o cliente pelo
  telefone normalizado dentro do tenant, sem devolver nada sobre cadastro
  existente (resposta igual para cliente novo e antigo).
- Página real nova (ex.: `/agendar/[slug]`), sem importar a demonstração;
  `/[slug]` da demonstração fica como está até ser aposentada.
- `public_settings.is_published = false` ou tenant inativo → 404 genérico.

**Proteção contra solicitações falsas e horários presos (decisões):**

1. Rate limit por IP **e** por telefone normalizado (ex.: 3 solicitações por
   telefone por dia por tenant, 10 por IP por hora), com o mesmo cuidado de
   cabeçalho de IP já aplicado ao login.
2. Pedido público **sempre nasce `PENDING`** neste primeiro lote, mesmo se o
   serviço não exigir confirmação — até existir verificação do telefone.
3. **Expiração do pendente:** coluna `pending_expires_at`; um `PENDING`
   vencido deixa de ocupar. Valor inicial proposto: 2 h ou até 1 h antes do
   início, o que vier primeiro. A disponibilidade e a constraint precisam
   tratar "PENDING vencido" como livre (ver schema, item 5) — sem isso, um
   formulário falso prende a agenda indefinidamente.
4. Limite de pendentes simultâneos por telefone (ex.: 2 por tenant).
5. Opcional depois: verificação do telefone por código (custo de mensagem —
   decidir junto com o provedor).
6. Captcha leve (Turnstile/hCaptcha) só se o rate limit não bastar.

### Lote B — Confirmação manual

- Reaproveitar `requires_manual_confirmation` (já define `PENDING`) e a ação
  `confirm` existente. `booking_policies.auto_confirm` passa a valer **só** para
  pedidos públicos de serviços sem confirmação manual, e só depois do Lote A
  ter verificação do telefone; até lá, público = sempre `PENDING`.
- Recusar pedido = ação `cancel` existente com motivo "recusado pelo
  estabelecimento" (sem novo status).
- Tela: filtro "Aguardando confirmação" na agenda e contador na Visão geral.

### Lote C — Aviso persistente ao responsável (painel)

- Tabela `appointment_events` (item 5): cada pedido público, confirmação,
  cancelamento ou remarcação grava um evento **na mesma transação** da
  mudança da reserva.
- Painel: lista de avisos não lidos (`read_at` por destinatário) e badge no
  menu. É aviso **com o painel aberto** (ou na próxima visita) — não chega com
  o aplicativo fechado.
- **Quem recebe:** neste lote, só membros com papel **DONO** do tenant (a
  única política de agenda que existe hoje). Para outro responsável receber e
  agir, um lote de papéis precisa antes definir, no backend, permissões padrão
  de `RECEPCIONISTA`/`GERENTE` para `AGENDA_VISUALIZAR` e `AGENDAMENTO_EDITAR`
  (os valores já existem no enum) — receber aviso sem poder agir não ajuda, e
  inferir essa permissão aqui seria ampliar acesso por suposição.

### Lote D — Bloqueios de horário

- Rotas `GET/POST/DELETE /tenants/:id/professionals/:pid/time-blocks`, só DONO,
  usando a tabela existente (`start_at`, `end_at`, `reason`). A
  disponibilidade **já** respeita `time_blocks`.
- Recusar bloqueio que sobreponha reserva que ocupa (ou exigir confirmação
  explícita listando as reservas afetadas — decisão de produto).
- Fora deste lote: bloqueio recorrente, feriados do estabelecimento inteiro
  (exigem modelo próprio — hoje `time_blocks` é por profissional).

### Lote E — Notificações automáticas pelo WhatsApp

**Estado:** a BASE está implementada e testada (ver seção 4); o envio real
**não**. Falta: provedor real, número remetente verificado, templates
aprovados, tela/rota para registrar a autorização de contato, retorno de
entrega (webhook) e um executor agendado em produção.

**Regras de confirmação e lembretes (implementadas):**

1. **Confirmação:** ao confirmar uma reserva grava-se a intenção de enviar a
   confirmação ao cliente. A reserva criada que já nasce `CONFIRMED` (serviço
   sem confirmação manual) segue a mesma política, sem exigir clique. Repetir
   a confirmação não gera outra mensagem: o serviço sai antes quando o estado
   já é o destino, e a chave `<reserva>:CONFIRMATION` é UNIQUE.
2. **Lembrete da véspera:** às 09:00 do dia anterior, no fuso do
   estabelecimento. "Véspera" é a data de calendário local menos um dia, não
   "início − 24 h" (no horário de verão as contas divergem; um atendimento às
   00:30 tem véspera no dia anterior). Não é programado quando a reserva ficou
   confirmada na própria véspera ou no dia do atendimento.
3. **Lembrete próximo:** 2 h antes. Se esse instante já passou ao criar ou
   confirmar, não é programado — nada de lembrete atrasado colado na
   confirmação.
4. Só reserva `CONFIRMED` gera lembretes. Cancelar, iniciar, concluir e
   registrar falta invalidam tudo o que está pendente (`CANCELED`, com motivo).
5. **Remarcação:** invalida os lembretes do horário antigo e recalcula os do
   novo a partir do momento da remarcação. A confirmação **não** é repetida:
   o horário novo acabou de ser combinado com o cliente (normalmente pelo
   próprio WhatsApp, com o "Combinar outro horário"); uma confirmação ainda
   não enviada passa a citar o horário novo. **Mudança feita na véspera:**
   pela regra 2 não há "lembrete de amanhã", e pela regra 3 o lembrete de 2 h
   só existe se ainda for futuro — nenhuma mensagem sai na hora só porque a
   reserva mudou. Voltar ao horário anterior reaproveita a linha cancelada
   (mesma chave) em vez de criar outra.
6. **Antes de enviar**, o executor confere com a reserva travada: estado
   `CONFIRMED`, início vigente igual ao programado, atendimento ainda futuro,
   prazo da tarefa (`not_after`), estabelecimento ativo, autorização de
   contato e telefone utilizável. O destinatário é o telefone ATUAL do
   cadastro do cliente (não o snapshot da reserva). As mensagens levam só
   primeiro nome, estabelecimento, data e hora locais — nunca serviço, preço,
   profissional ou observações.

**Quem envia e quem recebe:**

| Mensagem | De | Para | Gatilho | Estado |
|---|---|---|---|---|
| Confirmação | número do Agenda Cloud | cliente | reserva passa a `CONFIRMED` | base pronta |
| Lembrete da véspera (09:00) | número do Agenda Cloud | cliente | programado | base pronta |
| Lembrete 2 h antes | número do Agenda Cloud | cliente | programado | base pronta |
| Pedido recebido / pendente | número do Agenda Cloud | cliente | pedido público (Lote A) | falta |
| Novo pedido para confirmar | número do Agenda Cloud | DONO | pedido público (Lotes A/C) | falta |

- **Número remetente:** no piloto, **um número do Agenda Cloud** na WhatsApp
  Business Platform (Cloud API, Meta), com o nome do estabelecimento no
  texto. Número próprio por estabelecimento fica para depois — exige
  onboarding de cada negócio na Meta.
- **Provedor:** Cloud API direta como padrão; intermediário (Twilio, Zenvia,
  Gupshup) só se a verificação da Meta travar o piloto. Nunca automação não
  oficial do WhatsApp Web (risco de banimento). A interface `ProvedorWhatsapp`
  declara se o provedor é **idempotente** pela chave da tarefa; só nesse caso
  um resultado incerto é reenviado.
- **Templates:** mensagem iniciada pela empresa fora da janela de 24 h exige
  template aprovado (categoria *utility*). Os três textos já existem em
  `notification-messages.ts`, com os parâmetros na ordem (nome,
  estabelecimento, data, hora).
- **Autorização de contato:** colunas `consumers.whatsapp_opt_in_at`,
  `whatsapp_opt_in_source` e `whatsapp_opt_out_at`. **Todo cliente existente
  fica sem autorização** (NULL) — nenhuma é inventada. Sem autorização, a
  tarefa termina `SKIPPED (SEM_AUTORIZACAO)`. Falta a tela/rota que registra o
  aceite (no agendamento público: caixa explícita; no balcão: o responsável
  registra que o cliente aceitou) e o opt-out ("SAIR" pelo webhook).
- **Custos (conferir antes de ligar):** a Meta cobra por mensagem de template
  conforme categoria e país; a tabela vigente vale desde 01/04/2026 e a
  cobrança em BRL está disponível no Brasil desde 01/07/2026. Há indicação de
  que, a partir de 01/10/2026, template *utility* dentro da janela de 24 h
  também passa a ser cobrado. Os valores em BRL **não** foram confirmados
  aqui — usar a tabela oficial ao decidir. Três mensagens por reserva
  confirmada é o teto deste desenho; decidir quem paga e impor limite mensal
  por estabelecimento.

**Gravação e envio (implementado):**

1. A mudança da reserva grava as tarefas em `notification_jobs` **na mesma
   transação** (`AgendadorDeNotificacoes`, chamado por `AppointmentsService`).
   Rollback desfaz as duas coisas — nenhuma tarefa órfã.
2. Nenhuma chamada externa acontece nessa transação. O
   `ExecutorDeNotificacoes` lê a tabela depois do COMMIT.
3. **Reserva por executor:** um `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE
   SKIP LOCKED)` marca `PROCESSING` com concessão por tempo. Dois executores
   nunca pegam a mesma linha; linha travada é pulada, não esperada.
4. **Decisão antes do envio:** conferência e passagem para `SENDING` numa
   transação curta com a reserva `FOR SHARE`; o cancelamento trava a mesma
   reserva `FOR UPDATE` e invalida o que está `SCHEDULED`/`PROCESSING`.
   **Janela residual aceita:** se o cancelamento chega depois do COMMIT do
   `SENDING` e antes da chamada ao provedor (milissegundos), a mensagem sai.
5. **Estados:** `SCHEDULED` (programada) → `PROCESSING` (reservada) →
   `SENDING` (decidida) → `SENT` (aceita pelo provedor — **não** é entrega) →
   `DELIVERED` (entrega confirmada pelo retorno do provedor). Desvios:
   `SKIPPED` (conferência falhou), `CANCELED` (reserva mudou), `FAILED`
   (recusa definitiva ou tentativas esgotadas), `UNCERTAIN` (sem resposta
   conclusiva).
6. **Falhas e retomada:** recusa temporária volta para a fila com espera de
   1, 5, 30 e 120 min (máximo 5 tentativas, sempre dentro do prazo).
   `PROCESSING` com concessão vencida (executor morreu antes de chamar o
   provedor) é retomado normalmente. `SENDING` vencido (morreu depois de
   decidir) vira `UNCERTAIN` — ou volta à fila se o provedor for idempotente.
7. **Duplicidade:** `dedupe_key` UNIQUE impede a mesma intenção duas vezes;
   `provider_message_id` UNIQUE (parcial) amarra o retorno de entrega.
   **Entrega exatamente uma vez não é prometida:** entre o provedor aceitar e
   o resultado ser gravado o processo pode morrer; a linha fica `UNCERTAIN`
   para revisão em vez de arriscar mensagem duplicada ao cliente.
8. Envio **desligado por padrão**: sem `envioHabilitado` e um provedor
   explícito, `processarLote` não toca em nenhuma linha. Não há provedor real
   nem executor agendado neste lote.

**Painel aberto × aplicativo fechado:** aviso no painel (Lote C) só aparece
para quem abrir a tela; **com o aplicativo fechado**, só o WhatsApp (ou, no
futuro, Web Push com service worker e permissão do navegador) chega ao
responsável.

**Execução apesar da hibernação do Render gratuito:**

- Fatos (documentação do Render): o web service gratuito hiberna depois de
  15 min sem tráfego e leva cerca de 1 min para acordar; o workspace tem 750 h
  gratuitas por mês; manter o serviço gratuito acordado artificialmente com
  pings é tratado pelo Render como abuso. Cron Job do Render é cobrado por
  minuto de execução, com mínimo de US$ 1/mês por cron job (conferir o valor
  vigente); o primeiro plano pago de web service fica sempre ligado.
- **Estratégia escolhida:** um **Render Cron Job** (pago, a cada 5 min) que
  roda um comando do backend: inicializa o DataSource, chama
  `ExecutorDeNotificacoes.processarLote()` até esvaziar o que venceu e
  termina. Não depende do web service acordado e não precisa de rota HTTP
  exposta. Requisitos: mesma URL do banco com TLS, variável de habilitação
  explícita, credenciais do provedor como segredo e um identificador de
  executor (`locked_by`) por execução.
- **Alternativa sem custo do Render:** GitHub Actions `schedule` rodando o
  mesmo comando com acesso ao banco. Limitações conhecidas: intervalo mínimo
  de 5 min, atrasos de vários minutos em horário de pico e desativação
  automática de agendamentos em repositório público sem atividade por 60
  dias. Os prazos das tarefas (`not_after`) evitam lembrete fora de hora
  quando o atraso acontece. Não se promete operação gratuita sem antes medir
  esses atrasos.
- Nunca: `setInterval`/timer no processo web como mecanismo de agenda.

## 4. O que já foi entregue do Lote E (base) e o que não é

- **Contato manual (PR #52):** "WhatsApp" e "Combinar outro horário" abrem
  `https://wa.me/<telefone>` no WhatsApp do próprio responsável. Não gravam
  nada e **não são** notificação automática.
- **Base automática:** `notification-policy.ts` (quando),
  `notification-scheduler.ts` (grava na transação da reserva),
  `notification-jobs.repository.ts` (SQL), `notification-dispatcher.ts`
  (executor), `notification-messages.ts` (textos) e `whatsapp-provider.ts`
  (contrato + provedor SIMULADO para testes), em `backend/src/notifications/`.
  Provado em `notification-policy.spec.ts` e
  `backend/test/notifications-postgres.db-e2e-spec.ts`.
- **Ainda exige configuração externa para mensagem real:** conta WhatsApp
  Business verificada, número remetente, templates aprovados, credenciais,
  implementação de `ProvedorWhatsapp` para a Cloud API, webhook de entrega e
  opt-out, registro do aceite do cliente e o Cron Job (ou agendador externo).

## 5. Schema

**Aplicada neste lote (só em banco descartável):** `1792540800000-NotificationJobs`
— colunas de autorização em `consumers` e a tabela `notification_jobs` (FK
composta para `appointments`, `dedupe_key` UNIQUE, CHECK de tipo, estado e
prazo, índices de fila e de reserva). Sem entidade TypeORM: acesso por SQL
explícito (as specs estruturais comparam cada entidade com a migration inicial).

**Publicação futura:** o workflow guardado do Lote 6B.2 só aplica as
migrations dele e passa a **recusar** um banco com esta migration
(`unexpected_names`) — de propósito. Aplicar em produção exige roteiro
próprio, com backup antes (ver `docs/runbooks/publicacao-piloto-render.md`,
sobre publicações que trazem migration).

**Aplicada no Lote A (só em banco descartável):** `1792627200000-PublicBooking`
— `public_booking_settings` (uma linha por tenant, criada só quando o DONO
liga ou desliga; ausência = desligado) e `public_booking_requests` (uma linha
por pedido público, FK composta para `appointments`, `UNIQUE (tenant_id,
idempotency_key)`, `UNIQUE (appointment_id)` e índice por telefone e data).
Sem entidade TypeORM, mesmo motivo de `notification_jobs`. Não mexe na
constraint anti-sobreposição nem em `appointments`.
`public_settings.is_published` não foi reaproveitada: nasce `DEFAULT true` e
exporia quem nunca pediu.

**Ainda propostas (não aplicadas):**

```sql
-- Expiração do pendente (NÃO aplicada; ver seção 7, "Expiração")
ALTER TABLE appointments
  ADD COLUMN source varchar(20) NOT NULL DEFAULT 'INTERNAL', -- INTERNAL | PUBLIC
  ADD COLUMN pending_expires_at timestamptz(3) NULL;
-- A EXCLUDE anti-sobreposição hoje ignora só CANCELED. Pendente vencido
-- precisa liberar o horário: ou um job marca PENDING vencido como CANCELED
-- (motivo "expirado", registrado em appointment_status_changes) antes de a
-- disponibilidade/constraint considerarem o horário — preferível, mantém a
-- constraint como está —, ou a constraint passa a depender de tempo (inviável
-- em EXCLUDE, que exige expressão imutável).

-- Lote C: eventos da reserva (gravados na mesma transação da mudança)
CREATE TABLE appointment_events (
  id varchar(30) PRIMARY KEY,
  tenant_id varchar(30) NOT NULL REFERENCES tenants(id),
  appointment_id varchar(30) NOT NULL,
  type varchar(40) NOT NULL,          -- booking_request.created, appointment.confirmed, ...
  payload jsonb NOT NULL,             -- só o necessário para o texto; sem dado sensível
  occurred_at timestamptz(3) NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointments(tenant_id, id)
);
CREATE INDEX idx_appointment_events_tenant_occurred ON appointment_events (tenant_id, occurred_at DESC);

CREATE TABLE appointment_event_reads (
  event_id varchar(30) NOT NULL REFERENCES appointment_events(id) ON DELETE CASCADE,
  user_id varchar(30) NOT NULL REFERENCES users(id),
  read_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

-- appointment_events/appointment_event_reads continuam PROPOSTAS (Lote C).
```

`time_blocks` (Lote D) não precisa de coluna nova para o primeiro corte; só de
rotas e tela. Cada tabela nova segue as regras já usadas no projeto: migration
versionada com `down()`, isolamento por `tenant_id` em toda consulta e testes
contra o PostgreSQL descartável.

## 6. Próximos lotes

**Lote A + Lote C juntos, sem WhatsApp automático:** rotas públicas por slug,
pedido sempre `PENDING` com expiração e rate limit, página pública real, e
aviso persistente no painel para o DONO confirmar ou recusar. Isso entrega o
fluxo completo sem custo de mensagem e sem depender de processo em segundo
plano. O restante do Lote E (envio real) vem depois, quando houver número
verificado na Meta, templates aprovados, decisão de custo, registro do aceite
do cliente e o Cron Job do executor.

## 7. Lote A + aviso persistente — entregue

**Rotas públicas (sem sessão, limite próprio por IP):** `GET /public/:slug`,
`GET /public/:slug/availability` e `POST /public/:slug/booking-requests`.
Estabelecimento inexistente, inativo ou com o online desligado recebe o mesmo
404. O perfil expõe só nome (unidade primária), fuso, serviços ativos no
online (preço só se visível) e profissionais ativos no online com vínculo; a
disponibilidade expõe só instante, hora local e deslocamento.

**Rotas privadas (SessionGuard + Membership):** `GET/PUT
/tenants/:id/public-booking` (só DONO; DENIED de `CONFIGURACOES_GERENCIAR` ou
`AGENDA_GERENCIAR` restringe) e `GET /tenants/:id/booking-requests` (mesma
política da agenda). Confirmar e recusar são `/appointments/:id/confirm` e
`/cancel`, com `expectedStartAt`.

**Pedido:** uma transação com a configuração `FOR SHARE`, advisory lock por
telefone + estabelecimento, chave de envio, limites por telefone, cliente pelo
telefone (sem alterar cadastro existente nem autorização de contato), reserva
`PENDING` revalidada por `AvailabilityService.calcular({ travar: true })` e a
linha em `public_booking_requests`. A constraint de sobreposição segue como
proteção final (409). Reservas internas não mudaram
(`requires_manual_confirmation` continua decidindo `PENDING`/`CONFIRMED`).
Confirmar um pedido programa as tarefas do PR #53; nada é enviado.

**Limites explícitos (testados):** 10 envios por hora e 120 leituras por 10 min
por IP (limiters próprios — login e cadastro continuam 5 por 15 min); por
telefone e estabelecimento, 3 pedidos em 24 h e 2 pendentes futuros, contados
no banco.

**Envio duplicado e resposta perdida:** a página gera uma chave por pedido;
repetir com a mesma chave devolve o MESMO pedido (HTTP 200, `replayed`), e a
mesma chave com outros dados é 409. Sem resposta, a página não afirma nada
sobre o resultado, trava o formulário e oferece "Verificar envio" (mesma
chave). Nunca reenvia sozinha.

**Expiração do pendente — NÃO implementada (decisão pendente).** O valor do
item 3 do Lote A (2 h ou até 1 h antes do início) é proposta, não decisão.
Hoje um pedido pendente ocupa o horário até o dono confirmar ou recusar,
exatamente como a constraint enxerga — cálculo e banco nunca divergem.

Recomendação: expirar o pedido público pendente **24 h depois do pedido ou
2 h antes do início, o que vier primeiro**, executado pelo **mesmo Cron Job do
executor de notificações** (seção 3, Lote E). O job marca o `PENDING` vencido
como `CANCELED` (motivo `EXPIRADO`, registrado em `appointment_status_changes`),
e só depois disso o horário volta a ser oferecido — a disponibilidade não
ganha regra de tempo nenhuma e a constraint fica como está. Impacto: depende
do Cron Job pago no Render (ou do GitHub Actions `schedule`, com os atrasos já
descritos) e de uma coluna `pending_expires_at` (ou do cálculo a partir de
`public_booking_requests.created_at`); sem o job ligado, nada expira (o
comportamento de hoje). Até a decisão, a proteção contra horário preso é:
online desligado por padrão, limites por IP e por telefone, e o dono recusando
pelo painel.

**Aviso no painel:** é a lista persistida de pendentes — contador no menu
(inclusive o ponto no "Mais" do celular) e cartão na Visão geral. Relido ao
navegar, ao voltar o foco para a janela e depois de cada ação. Não há push nem
aviso com o aplicativo fechado; abrir a lista não aprova nada.

**Publicação futura (nada foi publicado):**

1. Backup do banco.
2. Migrations, nesta ordem: `1792540800000-NotificationJobs` e
   `1792627200000-PublicBooking`. O workflow guardado do 6B.2 recusa as duas
   de propósito (`unexpected_names`); é preciso roteiro próprio.
3. Backend (Nest) com o `PublicBookingModule`. Conferir `CLIENT_IP_SOURCE` e
   `API_PROXY_SECRET`: os limites por IP dependem deles, como os do login.
4. Frontend com `/agendar/[slug]` e `/conta/solicitacoes`.
5. Nenhum estabelecimento fica público até o DONO ativar.
