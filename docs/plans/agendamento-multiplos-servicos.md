# Agendamento com vários serviços

Lote que permite escolher vários serviços num mesmo agendamento, atendidos em
sequência pelo mesmo profissional, no agendamento interno e no público.

Branch `feat/agendamento-multiplos-servicos`, a partir da integration em
`99242a6` (API e web publicados nesse SHA; piloto com 12 migrations).

## 1. O que existia

- `appointment_items` existe desde a migration inicial: um item por serviço,
  com `price_cents_snapshot`, `duration_minutes_snapshot` e `position`. O
  código gravava sempre um item só (`position = 0`) e lia só o primeiro.
- O nome do serviço não era congelado: a tela lia o nome atual do cadastro.
- `end_at` já guarda a ocupação inteira (duração + intervalo depois), e a
  constraint `appointments_no_overlap_excl` protege esse intervalo.

## 2. Decisões

- **Uma reserva, vários itens.** Nunca reservas independentes: a reserva e
  todos os itens entram na mesma transação; uma falha desfaz tudo.
- **Mesmo profissional, que faz todos.** O motor de disponibilidade
  (`AvailabilityService.calcular`) recebe a lista de serviços e confere cada
  um: existe neste estabelecimento, está ativo e tem vínculo com o
  profissional. Um vínculo faltando recusa a combinação inteira ("não realiza
  todos os serviços selecionados"); serviço de outro estabelecimento é "não
  encontrado". Serviço repetido é recusado.
- **Duração e intervalo.** Duração = soma das durações. Intervalo depois do
  atendimento = o MAIOR entre os serviços escolhidos (não a soma: entre um
  serviço e o seguinte não há troca de cliente). `end_at` = início + soma +
  maior intervalo. Disponibilidade, criação, pedido público, remarcação e a
  constraint usam esse intervalo completo.
- **Ordem.** A ordem escolhida é a do atendimento (`position`). Os locks dos
  serviços são tomados em ordem de id (sempre a mesma), para duas reservas com
  os mesmos serviços em outra ordem não travarem em sentidos opostos.
- **Preço.** Total = soma dos preços congelados. Um item sob consulta (preço
  nulo) deixa o total sob consulta: nunca soma parcial nem zero.
- **Estado inicial.** Basta um serviço exigir confirmação manual para a reserva
  interna nascer pendente; o pedido público continua sempre pendente.
- **Servidor decide.** O navegador manda só `serviceIds` (ou `serviceId`, a
  forma antiga), o profissional e o instante. Preço, duração, total, nomes e
  ocupação são recalculados no servidor; campo de total ou preço no corpo é
  recusado (`.strict()`). Máximo de 6 serviços por reserva.
- **Histórico contratado.** Cada item congela nome, preço e duração. Renomear,
  mudar preço ou duração, ou desativar o serviço depois não reescreve a
  reserva. A remarcação usa a ocupação congelada (soma das durações dos itens
  e o intervalo derivado de `end_at`) e confere de novo, com as linhas atuais,
  o direito de atender (serviços ativos e vinculados).
- **Reservas antigas.** Itens anteriores ficam com `service_name_snapshot`
  nulo e mostram o nome atual, como antes. Nada é inventado: preço e duração
  continuam vindo dos snapshots que já existiam.
- **Visibilidade.** A agenda individual e as restrições do gerente continuam:
  sem a consulta de recebimentos, o gerente não vê preço (nem dos itens nem do
  total, também no resumo da consulta de horários); sem a de clientes, não vê
  contato.
- **Recebimentos, visão geral e agenda própria** leem todos os itens
  (`ITENS_DA_RESERVA_SQL`): rótulo "Corte + Barba", duração e valor esperado
  somados. As mensagens automáticas e os avisos não citam o serviço; não
  mudaram.
- **Idempotência e duplicidade** continuam: o pedido público usa a mesma chave
  de envio (o hash do conteúdo de um serviço só tem o formato de antes, então
  uma chave enviada antes da publicação continua reconhecida); a reserva
  interna segue sem chave (a tela confere a lista antes de repetir); a
  constraint continua sendo a garantia final contra sobreposição.

## 3. Schema (migration nova `1793404800000-AppointmentServiceSnapshots`)

Só acrescenta `appointment_items.service_name_snapshot varchar NULL`. As 12
migrations aplicadas não mudam. `down()` remove a coluna.

## 4. API

- `POST /tenants/:id/appointments`: `serviceIds` (lista) ou `serviceId`.
- `GET .../availability`: `serviceIds=a,b` ou `serviceId`. A resposta ganha
  `serviceIds`, `services` (nome, duração, preço), `totalPriceCents` e
  `priceHidden`; `durationMinutes` e `bufferAfterMinutes` passam a ser os da
  combinação.
- Público: `GET /public/:slug/availability` e `POST .../booking-requests`
  aceitam `serviceIds`; o recibo ganha `services`, `totalDurationMinutes` e
  `totalPriceCents` (preço só quando o serviço mostra preço no online).
- A reserva (`AppointmentView`) ganha `services` (itens contratados);
  `service` continua com o primeiro id e o nome de todos; `durationMinutes` e
  `priceCents` são os totais.

## 5. Telas

- **Interna:** o profissional continua primeiro; os serviços dele aparecem
  como opções marcáveis (o primeiro já vem marcado), com a ordem do
  atendimento. A consulta de horários devolve o resumo (itens, preço total e
  duração total), mostrado antes de confirmar. O cartão da agenda lista os
  itens quando há mais de um.
- **Pública:** tocar no cartão continua escolhendo só aquele serviço e
  seguindo (o caminho de sempre); "Adicionar"/"Retirar" monta a combinação,
  com o resumo e "Continuar". Só aparecem os profissionais que fazem todos; sem
  nenhum, a tela avisa e não deixa seguir. A revisão e o recibo mostram itens,
  duração total e total.

## 6. Compatibilidade e publicação

- **API nova com web anterior:** o web anterior manda `serviceId` e lê
  `service.name`, `durationMinutes` e `priceCents`, que continuam (agora com
  os totais e o nome combinado). Campos novos são extras.
- **Web novo com API anterior:** para um serviço, o web novo usa `serviceId`
  na consulta; a criação usa `serviceIds`, que a API anterior recusa. Ordem:
  migration, API, web, do mesmo SHA.
- **Migration:** coluna anulável sem valor padrão (instantânea). Precisa de
  procedimento protegido próprio antes do piloto, no padrão dos anteriores
  (backup, `pilot:check-database` antes e depois, aplicar só
  `AppointmentServiceSnapshots1793404800000`). Não está escrito neste PR.
- **Ordem com o portal (PR do portal da plataforma):** as duas migrations são
  independentes (`1793318400000` e `1793404800000`). Quem for mesclado depois
  precisa ajustar as listas de migrations dos testes
  (`lote6b2-migration.migration-e2e-spec.ts`, contagem em
  `migrations-runtime-compiled.spec.ts`).

## 7. Testes

- Unitários do backend: seleção (`serviceId`/`serviceIds`, repetido, vazio,
  teto, campos de total recusados), totais e rótulo.
- Banco descartável (`test/multi-services-postgres.db-e2e-spec.ts`): Corte
  R$ 42,50/30 min + Barba R$ 25,00/30 min = uma reserva de R$ 67,50/60 min com
  dois itens (e o resumo da consulta); maior intervalo; conflito no intervalo
  completo; profissional incompatível; serviço de outro estabelecimento;
  repetido; duas reservas simultâneas (uma só, sem itens parciais); mudar e
  desativar o serviço sem reescrever; remarcar preservando a largura;
  cancelar sem apagar itens e liberando o intervalo; reserva antiga sem nome
  congelado; pedido público com vários serviços e recusa quando um está fora
  do online. A suíte pública existente passou a conferir o recibo com itens e
  totais.
- Web: seleção, compatibilidade, resumo, parâmetros da consulta e fluxo
  público com combinação.
- Navegador: `appointments` (cenário novo de reserva interna com dois
  serviços), `servicos-publicos` (combinação Barba + Corte, profissional
  compatível, intervalo completo) e as suítes que leem reservas.

## 8. Estado e retomada

Ver a descrição do PR para os resultados de cada rodada e o SHA final.
Pendências: procedimento protegido da migration no piloto.
