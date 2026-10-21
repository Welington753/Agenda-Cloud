# Agendamento público, confirmação, avisos e WhatsApp — plano dos próximos lotes

**Ponto de partida:** `integration/nestjs-typeorm-frontend` em `a6c2902` mais o lote
que criou este documento (contato manual pelo WhatsApp). Este plano descreve o que
já existe, o que falta e as decisões que cada lote precisa tomar. Nada aqui foi
implementado além do que a seção "Já existe" diz; nenhuma migration foi aplicada.

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

**Não existe:** nenhuma rota pública (sem sessão) no backend; nenhuma tabela de
notificação, evento ou fila; nenhum provedor de mensagem; nenhuma permissão de
agenda para papéis além de DONO; nenhum processo em segundo plano.

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

### Lote E — Notificações automáticas pelo WhatsApp (oficial)

**Quem envia e quem recebe:**

| Mensagem | De | Para | Gatilho |
|---|---|---|---|
| Pedido recebido / pendente | número do Agenda Cloud | cliente | `booking_request.created` |
| Novo pedido para confirmar | número do Agenda Cloud | DONO (telefone do usuário) | `booking_request.created` |
| Confirmado / recusado / remarcado / cancelado | número do Agenda Cloud | cliente | evento correspondente |
| Lembrete (ex.: 24 h antes) | número do Agenda Cloud | cliente | agendado |

- **Número remetente:** no piloto, **um número do Agenda Cloud** na WhatsApp
  Cloud API (Meta, oficial), com o nome do estabelecimento no texto. Número
  próprio por estabelecimento (cada um com conta WhatsApp Business verificada)
  fica para depois — exige onboarding de cada negócio na Meta.
- **Provedor:** WhatsApp Cloud API direta (sem intermediário) como padrão;
  intermediário (Twilio, Zenvia, Gupshup) só se o processo de verificação da
  Meta travar o piloto. Nunca bibliotecas não oficiais (WhatsApp Web
  automatizado) — risco de banimento do número.
- **Templates:** mensagens iniciadas pela empresa fora da janela de 24 h exigem
  template aprovado pela Meta (categoria *utility*). Textos neutros, sem nome
  do serviço quando puder ser sensível.
- **Autorização de contato (opt-in):** o formulário público pede aceite
  explícito ("Quero receber avisos deste agendamento pelo WhatsApp"),
  gravado com data e origem; o DONO aceita no próprio cadastro/configuração.
  Sem aceite, nada é enviado (o aviso no painel continua). Opt-out por
  resposta "SAIR" registrada pelo webhook.
- **Custos:** cobrança da Meta por conversa/mensagem de template, por país e
  categoria — confirmar a tabela vigente antes de ligar. Decidir quem paga
  (embutido no plano ou franquia por estabelecimento) e impor limite mensal por
  tenant para nenhum abuso gerar conta.

**Gravação e envio (consistência):**

1. A mudança da reserva grava, **na mesma transação**, o `appointment_event` e
   as linhas de `notification_outbox` (uma por destinatário/canal), com
   `dedupe_key` única (ex.: `evento_id + destinatário + canal`).
2. O envio **só acontece depois do COMMIT**: um processo lê a outbox; nada é
   enviado de dentro da transação (rollback nunca deixa mensagem enviada de
   reserva inexistente).
3. **Falha e retentativa:** `status` (`PENDING → SENDING → SENT | FAILED |
   SKIPPED`), `attempts`, `next_attempt_at` com backoff exponencial (ex.: 1, 5,
   30 min, 2 h; máximo 5). Erro permanente do provedor (número inválido,
   opt-out) vira `FAILED`/`SKIPPED` sem retentar.
4. **Duplicidade:** `dedupe_key` única + `SELECT ... FOR UPDATE SKIP LOCKED` ao
   pegar o lote; o `message_id` do provedor é gravado e o webhook de status
   atualiza `delivered_at`/`read_at`. Retentar depois de timeout pode
   duplicar no provedor — aceitar e registrar, ou usar idempotência do
   provedor quando existir.
5. Mensagem que perdeu o sentido (reserva cancelada antes do envio do
   lembrete) é marcada `SKIPPED` na hora de enviar.

**Painel aberto × aplicativo fechado:** aviso no painel (Lote C) só aparece
para quem abrir a tela; **com o aplicativo fechado**, só o WhatsApp (ou, no
futuro, Web Push com service worker e permissão do navegador) chega ao
responsável. Os dois leem do mesmo `appointment_events`.

**Execução confiável no Render gratuito:** o web service gratuito **hiberna
sem tráfego** e não há worker nem cron no plano gratuito — um laço em memória
ou `setInterval` no backend perderia mensagens e não rodaria com o serviço
dormindo. Decisão: o envio **não depende do processo web estar acordado**.
Opções, em ordem de preferência:

1. Plano pago com **Background Worker** (ou **Cron Job** do Render a cada
   1–5 min) processando a outbox — o mais simples e confiável.
2. Sem plano pago: um agendador externo (GitHub Actions `schedule`, cron
   externo) chamando uma rota interna protegida por segredo que processa um
   lote da outbox. Atrasos de minutos e acordar o serviço a cada chamada são
   aceitáveis para piloto; a outbox garante que nada se perde enquanto dorme.
3. Processar também logo após o COMMIT, no próprio request (melhor esforço),
   sem substituir 1 ou 2.

Lembretes com hora marcada exigem 1 ou 2 — nunca só o item 3.

## 4. O que o contato manual (este lote) é e não é

O botão "WhatsApp" e "Combinar outro horário" abrem `https://wa.me/<telefone>`
com texto pronto, no WhatsApp do próprio responsável. Não gravam evento, não
marcam envio, não mudam a reserva e **não substituem** o Lote E. A remarcação
continua pelo fluxo da agenda, depois do acordo.

## 5. Mudanças de schema necessárias (propostas, não aplicadas)

```sql
-- Lote A: pedido público e expiração do pendente
ALTER TABLE appointments
  ADD COLUMN source varchar(20) NOT NULL DEFAULT 'INTERNAL', -- INTERNAL | PUBLIC
  ADD COLUMN pending_expires_at timestamptz(3) NULL;
-- A EXCLUDE anti-sobreposição hoje ignora só CANCELED. Pendente vencido
-- precisa liberar o horário: ou um job marca PENDING vencido como CANCELED
-- (motivo "expirado", registrado em appointment_status_changes) antes de a
-- disponibilidade/constraint considerarem o horário — preferível, mantém a
-- constraint como está —, ou a constraint passa a depender de tempo (inviável
-- em EXCLUDE, que exige expressão imutável).

-- Lote A: opt-in de contato (por cliente, por tenant)
ALTER TABLE consumers
  ADD COLUMN whatsapp_opt_in_at timestamptz(3) NULL,
  ADD COLUMN whatsapp_opt_in_source varchar(30) NULL,
  ADD COLUMN whatsapp_opt_out_at timestamptz(3) NULL;

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

-- Lote E: outbox de notificações (envio só depois do COMMIT)
CREATE TABLE notification_outbox (
  id varchar(30) PRIMARY KEY,
  tenant_id varchar(30) NOT NULL REFERENCES tenants(id),
  event_id varchar(30) NOT NULL REFERENCES appointment_events(id),
  channel varchar(20) NOT NULL,       -- WHATSAPP
  recipient_kind varchar(20) NOT NULL,-- CONSUMER | USER
  recipient_ref varchar(30) NOT NULL, -- consumer_id ou user_id
  template varchar(60) NOT NULL,
  dedupe_key varchar(120) NOT NULL UNIQUE,
  status varchar(20) NOT NULL DEFAULT 'PENDING',
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz(3) NOT NULL DEFAULT now(),
  provider_message_id varchar(120) NULL,
  last_error varchar(500) NULL,
  sent_at timestamptz(3) NULL,
  delivered_at timestamptz(3) NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX idx_notification_outbox_due ON notification_outbox (status, next_attempt_at);
```

`time_blocks` (Lote D) não precisa de coluna nova para o primeiro corte; só de
rotas e tela. Cada tabela nova segue as regras já usadas no projeto: entidade
TypeORM, migration versionada com `down()`, isolamento por `tenant_id` em toda
consulta e testes contra o PostgreSQL descartável.

## 6. Próximo lote para o cliente agendar sozinho e o dono ser avisado

**Lote A + Lote C juntos, sem WhatsApp automático:** rotas públicas por slug,
pedido sempre `PENDING` com expiração e rate limit, página pública real, e
aviso persistente no painel para o DONO confirmar ou recusar. Isso entrega o
fluxo completo sem custo de mensagem e sem depender de processo em segundo
plano. O Lote E (WhatsApp automático) vem depois, quando houver número
verificado na Meta, templates aprovados, decisão de custo e um executor que
não dependa do serviço gratuito acordado.
