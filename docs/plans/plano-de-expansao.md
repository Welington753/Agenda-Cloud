# Plano de expansão: organização, operação e quatro frentes novas

Base: `3d0ab1a` (PR #78). Este plano **não substitui**
`mensagens-e-proximos-lotes.md` (operação A1–A7, financeiro da plataforma B,
financeiro do estabelecimento C, estoque D) nem
`agendamento-publico-e-notificacoes.md` (Lote E, WhatsApp). Ele parte
deles, acrescenta o que mudou desde então (recebimentos, Início, equipe) e
põe tudo numa ordem só. Os achados citados (F1, R1...) estão em
`docs/audits/auditoria-organizacao-2026-10.md`.

Regras que valem para todo lote abaixo:

- Um PR por lote, revisável sozinho, com testes de banco e de navegador da
  área. A tela só mostra botão do que já funciona.
- **Migration nova** só em arquivo novo. As 11 já aplicadas no piloto
  nunca são editadas nem reaplicadas. Cada migration tem roteiro de
  publicação próprio (`docs/runbooks/`), com backup antes, e publicação na
  ordem migration, API, web.
- Toda tabela nova tem `tenant_id`, FK composta `(tenant_id, id)` para o
  que referencia e consulta sempre filtrada pelo estabelecimento provado
  (`resolveAuthorizedTenant`).
- Permissão nova é um valor novo no enum `permission` (migration), na
  política pura da área (`*-access.ts`) e, se o gerente puder receber, em
  `common/manager-permissions.ts`.
- Dinheiro é sempre em centavos inteiros (`bigint`), sem `float` e sem
  arredondar no banco.
- Nada é enviado, cobrado ou contratado sem decisão registrada na seção 7.

## 1. Pendências operacionais (antes de cliente pagante)

| Lote | O quê | Estado | Depende de |
|---|---|---|---|
| **O1 — Backup automático** | É o A1 de `mensagens-e-proximos-lotes.md`: dump agendado fora dos PCs, criptografado, com retenção, manifesto (contagens e hash) e restauração ensaiada em banco descartável a cada ciclo | Hoje o backup é manual (`backend/scripts/operacao-piloto.mjs`) e fica no PC de quem operou. Proposta com duas alternativas em `backup-e-monitoramento.md` | Decisões 7.1 e 7.2 |
| **O2 — Monitoramento** | É o A2: registro de erros sem token, senha, e-mail ou telefone; alerta de deploy com falha, de health check e de pico de 5xx. Sem ping para manter acordado | Só existe o health check do Render. Proposta em `backup-e-monitoramento.md` | Decisão 7.2 |
| **O3 — Retenção** | Apagar sessões vencidas e entregas, alertas e tarefas antigas, com prazos escritos (R3). Roda no mesmo agendador externo de O1 | Nenhuma exclusão existe | O1 (agendador), decisão 7.8 |

O agendador de O1 também é o que falta para o executor de notificações
(frente A e Lote E). Escolher um que sirva aos dois.

## 2. Lotes estruturais (sem funcionalidade nova)

| Lote | O quê | Por quê | Risco |
|---|---|---|---|
| **E1 — Rede de segurança dos testes** (mesclado no PR #80, `7620bc7`) | Corrigir os 26 erros de `tsc -p tsconfig.json` do backend e acrescentar a etapa ao CI (F2). Encaminhar `/<slug>` que não é da demonstração para `/agendar/<slug>` (F1) | O duplo de teste já diverge do contrato real; o endereço curto mostra erro a cliente real | Baixo |
| **E2 — Demonstração e Prisma** | Decidir (7.3). Se sair: remover `painel`, `master`, `profissional`, `onboarding`, `[slug]` da demonstração, `src/lib/repositories`, `seed*`, `storage`, Prisma e `test:db`; atualizar o README | Cerca de 15 mil linhas que não são o produto (O6) | Médio: tela inicial e login citam a demonstração |
| **E3 — Índice da agenda** | `EXPLAIN (ANALYZE, BUFFERS)` com volume sintético (anos de histórico) em banco descartável; se confirmado, migration com `(tenant_id, start_at)` (R1) | O custo da agenda do estabelecimento e do Início cresce com o histórico | Baixo, mas é migration (roteiro de publicação) |
| **E4 — Núcleo dos scripts de publicação** | Extrair o comum de `abrir-*`, `aplicar-*` e `conferir-restauracao-*` (O4) | Cada lote copia cerca de 1.000 linhas | Espera o desfecho do PR #74, que mexe nos mesmos arquivos |
| **E5 — Leitura e escrita da agenda** | Separar `appointments.service.ts` em leitura e escrita, sem mudar rota nem regra (O5) | Arquivo de 1.313 linhas, que a frente A vai tocar | Só junto com a primeira mudança na área |

## 3. Frente A — Gestão e retorno de clientes

### Já existe

- `consumers` (nome, WhatsApp normalizado, e-mail) e a tela Clientes, com
  busca e página (`consumers.service.ts`, `listPage`).
- O histórico real está em `appointments` + `appointment_items` (serviço,
  preço congelado, duração) e `appointment_status_changes`. "Concluído" é
  `status = 'COMPLETED'`.
- O consentimento de WhatsApp já está no schema: `consumers.whatsapp_opt_in_at`,
  `whatsapp_opt_in_source` e `whatsapp_opt_out_at` (migration
  NotificationJobs). Nenhuma tela grava esses campos.
- A fila de notificações já está pronta: `notification_jobs` com
  `dedupe_key` UNIQUE, prazo (`not_after`), estados, tentativas, retorno do
  provedor; executor que confere tudo de novo antes de enviar; contrato
  `ProvedorWhatsapp` com resultado aceito, recusado ou incerto. **Só existe
  o provedor simulado, e nada chama o executor em produção.**
- Contato manual: `src/lib/contato/whatsapp.ts` monta `wa.me` com o texto
  pronto, e quem envia é a pessoa. Não grava nada e **não é** automação.
- O link público do estabelecimento é `/agendar/<slug>`.

### Não reaproveitar

`consumers.total_visits`, `total_no_shows`, `last_served_at` e
`next_appointment_at` (R2). Nada os atualiza.

### Regras propostas

- **Visitas:** reservas `COMPLETED` do cliente, por serviço e no total, num
  período escolhido.
- **Intervalo habitual:** a mediana dos intervalos entre visitas concluídas
  consecutivas do mesmo serviço. A mediana resiste a um intervalo atípico
  melhor que a média.
- **Histórico mínimo:** com menos de 3 visitas concluídas (2 intervalos)
  daquele serviço, a tela diz "histórico insuficiente" e não mostra
  previsão.
- **Previsão:** "por volta de <data>", calculada como última visita +
  mediana, com a faixa entre o menor e o maior intervalo observados. Nunca
  um dia exato apresentado como certeza.
- **Quando não lembrar:**
  - o cliente já tem reserva futura `PENDING` ou `CONFIRMED` no
    estabelecimento;
  - ele já recebeu ou recusou o lembrete daquele ciclo;
  - ele se descadastrou (`whatsapp_opt_out_at`);
  - não há consentimento (`whatsapp_opt_in_at` nulo, só no envio
    automático);
  - o telefone é inválido.
- **Janela e horário de envio:** a partir de N dias antes da data prevista
  (configurável pelo estabelecimento, padrão 3), só dentro de uma faixa de
  horário local (padrão 09:00–19:00, fuso do estabelecimento), com no
  máximo um lembrete por cliente e serviço a cada ciclo.
- **Texto:** pergunta se o cliente quer agendar de novo, com o link público
  `/agendar/<slug>` e com o nome do estabelecimento. Sem preço e sem dado de
  outro cliente.

### Lotes

| Lote | Entrega | Migration |
|---|---|---|
| **A1 — Histórico e previsão** | Na ficha do cliente: atendimentos concluídos (data, serviço, profissional), visitas no período, intervalo habitual e previsão com o tratamento de histórico insuficiente. Lista "clientes perto da data de retorno" (sem envio). Cálculo puro e testado (`consumers/retorno.ts`), SQL com limite | Índice `(tenant_id, consumer_id, start_at)` em `appointments` (R4) |
| **A2 — Lembrete manual** | Botão "Convidar para agendar" com `wa.me`, no padrão do contato manual, e registro de que o responsável **abriu** o convite (não de que foi entregue), para não sugerir de novo naquele ciclo. Preferência por cliente "não sugerir lembrete" | Tabela `consumer_return_prompts` (tenant, cliente, serviço, ciclo previsto, aberto em, por quem; UNIQUE por tenant, cliente, serviço e ciclo) |
| **A3 — Consentimento e descadastro** | Tela para registrar o aceite do cliente (data e origem: pedido público com caixa de aceite própria, ou declaração do responsável); descadastro pela tela e, no envio automático, pela resposta "SAIR" | Nenhuma: as colunas existem |
| **A4 — Envio automático** | Implementar `ProvedorWhatsapp` para a Cloud API, webhook de entrega e de descadastro, agendador externo chamando o executor (o mesmo de O1), tipo `RETORNO` em `notification_jobs` com chave de deduplicação por cliente, serviço e ciclo, e falhas com a política que já existe (recusa definitiva não repete; incerta só repete se o provedor for idempotente) | Ampliar o CHECK de tipo de `notification_jobs` (migration nova) |

**Permissões:**

- ver o histórico usa `CONSUMIDORES_VISUALIZAR`;
- convidar e registrar a preferência usam `CONSUMIDORES_GERENCIAR`;
- configurar a janela e o horário é só do dono (`CONFIGURACOES_GERENCIAR`).

O profissional não vê clientes de outro profissional. Fica a decidir se
ele vê os próprios clientes (decisão 7.6).

**Critérios de aceitação de A1:**

1. Um cliente com visitas concluídas em 10/01, 10/02 e 12/03 mostra o
   intervalo habitual de cerca de 30 dias e a previsão por volta de 11/04,
   com faixa.
2. Com 2 visitas, a tela diz "histórico insuficiente", sem data.
3. Reservas canceladas e faltas não contam como visita.
4. Um cliente de outro estabelecimento responde 404, e um gerente sem a
   permissão recebe 403.
5. A lista de retorno exclui quem já tem reserva futura.

### O que falta para o envio automático (A4)

Conferido na documentação oficial da Meta em 2026-10-28:

- **Conta e número:** conta WhatsApp Business verificada, número remetente e
  credenciais da Cloud API.
- **Fora da janela de atendimento, só modelo aprovado:** a janela de 24 h
  abre quando o cliente escreve. Fora dela, a empresa só pode mandar
  modelos (*templates*) aprovados. Um lembrete de retorno sai sempre fora
  da janela.
- **Categoria do modelo:**
  - um convite para voltar tende a ser classificado como **Marketing**; a
    confirmação e o lembrete de horário marcado, como **Utility**;
  - quem classifica é a Meta, na aprovação.
- **Cobrança:** desde 1/7/2025, por mensagem **entregue**, conforme a
  categoria. Desde 1/10/2026, Utility dentro da janela também é cobrada, e
  as mensagens de serviço têm 1.000 gratuitas por número por mês.
- **Preço:** a tabela muda no primeiro dia de cada trimestre. Confira o
  valor antes de decidir (7.5).
- **Consentimento:** precisa dizer claramente que a pessoa aceita receber
  mensagens e de qual empresa; o descadastro precisa ser simples e
  respeitado. Recomenda-se aceite separado por categoria: um para
  confirmações e lembretes de horário, outro para convites de retorno.
- **Qualidade:** bloqueios e denúncias derrubam a avaliação do número e
  limitam o envio. Isso reforça as regras de "quando não lembrar".

Fontes: [preços](https://developers.facebook.com/docs/whatsapp/pricing) e
[consentimento](https://developers.facebook.com/docs/whatsapp/overview/getting-opt-in).

Conferência das fontes (2026-10-28, só a documentação oficial da Meta; a
página de preços não mostra data de atualização):

| Regra | Vigência na fonte |
|---|---|
| Cobrança por mensagem entregue | desde 1/7/2025 |
| Utility em resposta ao cliente, dentro da janela | grátis de 1/7/2025 a 30/9/2026; cobrada desde 1/10/2026 |
| 1.000 mensagens de serviço entregues grátis por mês, por número | de 1/10/2026 a 31/12/2027 |
| Fora da janela de 24 h, só modelo | sem data (regra corrente) |
| Preço muda só no 1º dia do trimestre | aviso de 1 mês (tabela), 3 meses (adicionais) e 6 meses (modelo de cobrança) |

**Pendências para a etapa de automação (A4), não bloqueiam o E1:**

- Não foram comparadas fontes de terceiros (provedores parceiros). Se o
  provedor escolhido (7.5) cobrar diferente da Meta, registrar a
  divergência antes de decidir.
- A franquia gratuita de serviço tem fim marcado (31/12/2027): o custo
  estimado do A4 não pode contar com ela depois disso.
- Reconferir a página no trimestre em que o A4 começar, porque a tabela
  muda a cada trimestre.

## 4. Frente B — Estoque

Ainda não existe nada (`mensagens-e-proximos-lotes.md`, D1–D4). Mantém
aquela sequência, com estas regras fixadas:

- **Produto ou material:** nome, tipo (`VENDA`, `CONSUMO` ou ambos),
  unidade (`UN`, `ML`, `G`, `KG`, `L`), quantidade mínima e custo
  opcional em centavos. Quantidade é inteira na menor unidade (mililitro e
  grama), sem decimal.
- **Movimento:** tabela só de inserção (`stock_movements`), com tipo
  (`ENTRADA`, `SAIDA`, `AJUSTE`, `DEVOLUCAO`), quantidade com sinal, motivo
  obrigatório em ajuste, quem, quando e origem (`MANUAL`, `VENDA`,
  `CONSUMO_SERVICO`, `ESTORNO`) com o id da origem.
- **Saldo:** soma dos movimentos. Uma cópia por produto
  (`stock_balances`) é atualizada na mesma transação com `FOR UPDATE`, para
  ler barato e impedir saldo negativo, se for a regra (decisão 7.7).
- **Correção:** um movimento não é editado nem apagado; a correção é um
  ajuste novo.
- **Sem baixa duplicada:** cada movimento automático tem
  `UNIQUE (tenant_id, origem, id_da_origem, produto)`. O estorno gera
  `DEVOLUCAO` com a própria chave única, apontando o movimento original.
  Repetir a venda, o estorno ou a conclusão não gera segunda linha.

**Quando o movimento acontece:**

- **Venda de produto:** na mesma transação da venda (depende de C1).
- **Consumo em serviço:** ao **concluir** o atendimento (`COMPLETED`), não
  ao agendar. Cancelar uma reserva concluída não existe hoje: as
  transições não permitem sair de `COMPLETED`. Se isso mudar, o estorno do
  consumo entra no mesmo lote.

**Permissões novas:** `ESTOQUE_VISUALIZAR` e `ESTOQUE_GERENCIAR` (enum,
política e catálogo do gerente).

| Lote | Entrega | Migration |
|---|---|---|
| **B1** (= D1+D2) | Cadastro, entradas, saídas e ajustes manuais, histórico, aviso de mínimo | `products`, `stock_movements`, `stock_balances`, valores no enum `permission` |
| **B2** (= D3) | Baixa pela venda de produto | Depende de C1 |
| **B3** (= D4) | Consumo por serviço (receita de material por serviço) | `service_materials` |

**Critérios de aceitação de B1:**

1. O saldo é sempre igual à soma dos movimentos.
2. Um ajuste sem motivo dá 400.
3. Dois ajustes simultâneos não perdem nenhum.
4. Repetir o mesmo formulário (chave de pedido) não duplica.
5. Produto de outro estabelecimento responde 404.

## 5. Frente C — Faturamento do estabelecimento

### Já existe

- **Valor previsto:** `appointment_items.price_cents_snapshot`, o preço
  congelado na reserva.
- **Recebido:**
  - `appointment_payments`: quitação integral de atendimento concluído,
    forma, data, quem registrou, chave de pedido, estorno integral com
    motivo e reautenticação;
  - permissões `RECEBIMENTOS_VISUALIZAR`, `RECEBIMENTOS_REGISTRAR` e
    `RECEBIMENTOS_ESTORNAR`;
  - tela Recebimentos.
- **Início:** recebido, estornado e líquido do período, atendimentos pagos
  e ticket médio (`resumoFinanceiro`).
- **Comissões:** `commission_rules` e `commission_entries` estão no schema,
  sem uso no runtime.

### As quatro grandezas, sempre separadas

| Grandeza | De onde vem | Hoje |
|---|---|---|
| **Previsto** | soma de `price_cents_snapshot` das reservas `PENDING`/`CONFIRMED`/`IN_PROGRESS` do período | não mostrado |
| **Realizado** | a mesma soma, das reservas `COMPLETED` | não mostrado |
| **Recebido** | `appointment_payments.amount_cents` por `received_on` | mostrado |
| **Estornado** | os mesmos registros, por `refunded_on` | mostrado |

Realizado menos recebido é "a receber" de atendimento, uma conta, não um
lançamento. Nada disso se chama lucro.

### O que falta

| Lote | Entrega | Migration |
|---|---|---|
| **C0 — Relatório por período** | Previsto, realizado, recebido, estornado e a receber, por dia, profissional, serviço e forma de pagamento, sobre o que já existe. Exportação CSV | Nenhuma (talvez o índice de E3) |
| **C1 — Vendas** (produto e serviço avulso) | `= C1` do plano anterior | `sales`, `sale_items` |
| **C2 — Recebimento parcial** | Hoje o recebimento é só integral. Permitir mais de um recebimento por atendimento até o total e estorno por registro | Mudar `uq_appointment_payments_active` (migration nova; a antiga não é editada) |
| **C3 — Despesas e contas a pagar** | Despesa com categoria, vencimento, pagamento, recorrência simples | `expenses`, `expense_categories` |
| **C4 — Fluxo de caixa** | Entradas (recebimentos) − saídas (despesas pagas) por dia; abertura e fechamento de caixa conferido | `cash_sessions` |

**Permissões:** relatórios usam `RELATORIOS_VISUALIZAR`, que já existe no
enum e não tem uso; despesas, `DESPESAS_VISUALIZAR` e `DESPESAS_GERENCIAR`
(novas).

**Precisão e histórico:**

- valores em `bigint` centavos;
- somas no SQL em `bigint`;
- nenhum registro financeiro é editado: correção é estorno ou lançamento
  novo, com quem e quando.

**Separado da plataforma:** a mensalidade do Agenda Cloud (B1–B4 do plano
anterior) fica em tabelas e módulo próprios (`platform/`), nunca em
`appointment_payments` nem nos relatórios do estabelecimento.

**Critérios de aceitação de C0:**

1. Para um período com reservas em todos os estados, cada grandeza bate
   com a soma manual dos registros.
2. O estorno feito em outro mês aparece no mês do estorno e não muda o
   recebido do mês original.
3. A troca de preço do serviço depois da reserva não altera nada.

## 6. Frente D — Localização no agendamento

### Já existe

- `units.address` (texto, unidade principal), que nasce vazio
  (`invites.service.ts:155`). `brand_identities.address` existe e não é
  usado (R5).
- A página pública `/agendar/<slug>` (`GET /public/:slug`) devolve o nome,
  o fuso, os serviços e os profissionais, sem endereço.
- O pedido público nasce `PENDING`, e a confirmação é do estabelecimento.

### Solução simples (sem API, sem chave, sem custo)

Pelos Google Maps URLs, que não exigem chave de API:

- **Ver o local:** `https://www.google.com/maps/search/?api=1&query=<endereço codificado>`.
- **Como chegar:** `https://www.google.com/maps/dir/?api=1&destination=<endereço codificado>`.
  Sem `origin`, o Maps usa a posição do próprio aparelho.
- **Limite:** URL de até 2.048 caracteres.
- **Link próprio:** opcionalmente, o dono cola o link de compartilhamento do
  próprio Maps, mais preciso para endereço difícil.

Mapa embutido, autocompletar endereço e geocodificação exigem a Maps
Platform (chave e cobrança por uso) e **não** entram aqui.

Fonte: [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started).

### Regras

- O endereço é da unidade principal (`units.address`), editado em
  Configurações → Estabelecimento, só pelo dono (`CONFIGURACOES_GERENCIAR`).
- **Página pública:** "Como chegar" só aparece com endereço preenchido.
  Abre em nova aba, `rel="noopener noreferrer"`.
- **Pedido enviado (`PENDING`):** a tela diz que o pedido aguarda
  confirmação e pode mostrar o endereço, mas nunca diz "confirmado".
- **Confirmação** (WhatsApp manual de A6 e o texto automático de
  `notification-messages.ts`): inclui o link "Como chegar" só quando a
  reserva está `CONFIRMED`. Recusa e cancelamento não levam link.
- O link é montado no servidor (ou numa função pura com teste) a partir do
  endereço salvo. O navegador nunca escolhe o destino.

| Lote | Entrega | Migration |
|---|---|---|
| **D1** | Editar o endereço, "Como chegar" na página pública, link na confirmação manual e no modelo automático | Opcional: `units.maps_url varchar(500) NULL` para o link colado. Sem ela, só endereço |

**Critérios de aceitação de D1:**

1. Sem endereço, nenhum botão.
2. Com endereço, o link abre a busca do Maps com o texto codificado
   (acentos, `#`, `&`).
3. O pedido pendente nunca mostra "confirmado".
4. O link colado só aceita `https://` de domínios do Google Maps.
5. Outro estabelecimento não altera o endereço (404).

## 7. Decisões pendentes (do dono do produto)

1. **Backup:** onde armazenar, retenção e quem tem a chave (O1). A janela
   do Neon Free foi conferida: 6 horas. Proposta em
   `backup-e-monitoramento.md`: recomendada a alternativa 1 (repositório
   privado no GitHub, dump criptografado com age e guardado no Backblaze B2
   com Object Lock, US$ 0/mês no tamanho atual). O código do O1 para a
   alternativa 1 está pronto e testado com dados fictícios (PR #81). Falta
   o dono aprovar a alternativa e dizer quem guarda a chave privada e a
   cópia offline.
2. **Agendador e monitoramento:** qual serviço roda as tarefas agendadas
   (O1, O3, A4) e qual ferramenta de alertas, com custo (O2). Proposta no
   mesmo documento:
   - workflow agendado num repositório privado (o público não serve: logs e
     artifacts abertos e `schedule` só na `main`);
   - notificações do Render e Sentry Developer, sem custo;
   - nenhum ping frequente, que estouraria as 750 h do Render.
   Falta o e-mail que recebe os alertas. O Neon Free inclui 5 GB de saída
   por projeto por mês (conferido em 2026-10-29).
3. **Demonstração:** continua no produto ou sai (E2).
4. **Retorno de clientes:** a janela padrão (dias antes) e o horário de
   envio. Se o profissional vê os próprios clientes (A1).
5. **WhatsApp automático:** provedor (Cloud API direta ou um parceiro),
   número, custo mensal estimado por categoria e quem aprova os modelos
   (A4).
6. **Permissões:** quais áreas novas (estoque, relatórios, despesas) o dono
   pode conceder ao gerente.
7. **Estoque:** o saldo pode ficar negativo? Quais unidades de medida?
8. **Retenção:** prazo de guarda de sessões, entregas e auditoria (O3).

## 8. Ordem proposta

```
1. E1  rede de segurança dos testes + /<slug>          (baixo risco, protege o resto)
2. O1  backup automático  ─┐
3. O2  monitoramento       ├─ antes de cliente pagante
4. D1  localização         │  (pequeno, sem custo, valor visível no piloto)
5. C0  relatório por período (sem migration; reaproveita recebimentos)
6. A1  histórico e previsão de retorno (+ índice R4; junto com E5 se tocar a agenda)
7. A2  convite manual de retorno
8. E3  índice da agenda (após medir)
9. B1  estoque manual
10. C1 vendas ── B2 baixa por venda ── C2..C4
11. A3 consentimento ── A4 envio automático (depois de 7.2 e 7.5)
12. O3 retenção (junto do agendador)
E2 (demonstração) e E4 (scripts, depois do PR #74) entram quando decididos.
```

**Justificativa:**

- **Primeiro, segurança:** E1 e O1/O2 protegem o piloto e não dependem de
  decisão de produto, salvo o armazenamento.
- **Depois, o que já tem base:** D1 e C0 trazem valor visível sem custo
  externo e sem migration obrigatória.
- **A frente A** vem antes do estoque porque reaproveita dados que já
  existem (agenda e clientes) e começa útil sem WhatsApp automático (A1 e
  A2).
- **Por último, o que depende de fora:** o envio automático (A4) depende de
  decisões externas e de custo por mensagem, por isso fica no fim.
- **Estoque:** B1 é independente, mas B2 depende de vendas (C1).

## 9. Estado e retomada

**Checkpoint de 2026-10-29 (revisão final), branch `feat/o1-backup-agendado` (PR #81).**

- **Revisão final feita:** seis defeitos corrigidos (seção 7.6 de
  `backup-e-monitoramento.md`):
  - conclusão do backup separada da falha de monitoramento;
  - envio sem resposta conferido por HEAD;
  - conferência da versão gravada;
  - mensal como primeiro backup completo do mês;
  - pasta própria por tentativa de re-run;
  - privilégios efetivos do papel.
- **Documentação:** expiração e regras de ciclo de vida do B2; 24 h como
  intervalo pretendido, não como perda máxima; alertas como configuração
  prevista; franquia compartilhada de US$ 12 do GitHub.
- **Checks:** os três passaram no head `614a1d0`. O backup com age real
  passou em 17 de 17.
- **Pronto para aprovação.** Sem merge.

Estado anterior, no mesmo dia:

- **O1 implementado e testado com dados fictícios:** backup sem terminal,
  restauração conferida, age, envio ao B2 com retenção e conferência,
  check-ins do cron e recuperação com a chave offline.
  - O workflow operacional é só um modelo, em
    `docs/runbooks/modelos/backup-piloto.yml`.
  - O CI novo (`test-backup-agendado.yml`) roda o caminho completo com
    simuladores.
  - O estado, as limitações e as medidas estão na seção 7 de
    `backup-e-monitoramento.md`.
  - O roteiro é `docs/runbooks/backup-piloto-automatico.md`.
- **Nada contratado, configurado ou conectado:** sem conta, bucket, chave
  real, papel no piloto, agendamento ou alerta. Sem deploy, sem migration,
  sem banco real.
- **Neon Free:** 5 GB de saída por projeto por mês, conferido em
  2026-10-29.

**Próximo passo concreto:**

1. Revisar o PR #81 e fazer o merge normal, com `[skip render]`.
2. O dono decide e autoriza o que está na seção 7.5 de
   `backup-e-monitoramento.md`, inclusive as regras de ciclo de vida do
   bucket.
3. Configuração pela seção 3 do roteiro.
4. Depois, o O2.

**Inalterado:** a publicação do PR #78 no Render continua sem confirmação.
O PR #74 segue aberto.

**Só neste computador:** a worktree `C:\Projetos\Agenda-Cloud-o1` (branch
`feat/o1-backup-agendado`) tem `node_modules` próprio em `backend/`, sem
junction. O `CLAUDE.md` modificado da pasta principal foi preservado.

---

**Checkpoint de 2026-10-28 (madrugada), branch `docs/proposta-backup-monitoramento`.**

- **PR #80 (E1) revisado e mesclado:**
  `7620bc7be6d3e9ad81ef6077a6781665c52cdf42`.
  - A revisão final só acrescentou documentação: `/agendar/<slug>` é o
    endereço canônico, e R6 segue aberto.
  - Os dois checks passaram no head `797f70e`.
- **Proposta O1/O2 em `backup-e-monitoramento.md`:** duas alternativas
  com preços e limites oficiais consultados em 2026-10-28, e a
  recomendação (alternativa 1).
- **Nada contratado, configurado ou conectado:** sem banco real, sem
  deploy, sem migration.

**Pendências de processo (registradas, sem mudar configuração agora):**

- **Integration sem proteção automática:** a branch
  `integration/nestjs-typeorm-frontend` não tem regra de proteção nem
  ruleset no GitHub (`branch not protected`, conferido em 2026-10-28).
  - "Merge só com o CI verde, sem bypass nem force push" é só disciplina.
    Nada impede um push direto, um force push ou um merge com check
    vermelho.
  - Proposta para quando o dono decidir: um ruleset na integration exigindo
    PR, os dois checks e bloqueio de force push e de exclusão.
  - Com filtro de caminhos, um check que não dispara fica "pendente" para
    sempre. Por isso o check de migrations não pode ser exigido como está;
    ele precisaria rodar sempre, com um passo que sai cedo quando nada
    relevante mudou.
- **Filtros dos workflows com lacunas antigas:**
  - Mudanças nestes arquivos não disparam o CI principal:
    `backend/package-lock.json`, `backend/vitest.config*.ts` (menos o de
    db-e2e), `backend/oxlint.json`, e na raiz `next.config.ts`,
    `tsconfig.json` e as configs de eslint e vitest.
  - O workflow de migrations não observa `backend/tsconfig.json`, que
    `tsconfig.migrations.json` estende.
  - Corrigir junto com o ruleset, num PR só de CI.
- **`main` parada desde 2026-09-10 e branch padrão:** qualquer
  `schedule` neste repositório rodaria nela. A proposta O1/O2 evita isso
  com o repositório privado.

**Próximo passo concreto:**

1. O dono escolhe a alternativa e responde às decisões listadas na
   resposta desta rodada.
2. Depois, os passos da seção 4 de `backup-e-monitoramento.md`, na ordem:
   - A: contas e chave, feitos pelo dono;
   - B: PR do O1;
   - C: PR do O2;
   - D: configuração e primeira execução, com autorização explícita.

**Inalterado:** a publicação do PR #78 no Render continua sem confirmação.
O PR #74 segue aberto.

**Só neste computador:** igual ao checkpoint abaixo (worktree com
`node_modules` em junction).

---

**Checkpoint de 2026-10-28 (noite), branch `fix/e1-tipos-testes-endereco-curto`.**

PR #79 revisado e mesclado na integration
(`b88fb2819181c3ea0f0649fe743cc077c39f0621`). Na revisão entraram um teste
próprio de `algumaNegada`, a correção da redação sobre checks "exigidos"
(a branch não tem proteção no GitHub) e o teste com banco que dependia da
hora (F4).

**E1 feito (mesclado depois no PR #80):**

- F2: `npm run typecheck` com 0 erros e etapa no CI antes das demoradas.
- F1: `/<slug>` fora da demonstração vai para `/agendar/<slug>`, com
  testes no fluxo de navegador do agendamento público.
- R6 registrado (slug real igual a rota ou a slug da demonstração), sem
  correção neste lote.

**Não feito, de propósito:** nenhuma migration, deploy, conexão com banco
real ou mudança nos scripts do PR #74; demonstração mantida.

**Próximo passo concreto:** acompanhar o CI do PR do E1 no head final;
com ele verde, revisão e merge normal com `[skip render]`. Depois, O1/O2
(backup e monitoramento), que dependem das decisões 7.1 e 7.2.

**Só neste computador:** a worktree `C:\Projetos\Agenda-Cloud-organizacao`
usa `node_modules` em junction para as pastas `Agenda-Cloud` e
`Agenda-Cloud-publicacao`. Não remova com `rm -rf` (apagaria os
destinos); o Turbopack não sobe o web nela.

---

**Checkpoint anterior: 2026-10-28, branch `chore/organizacao-mapa-tecnico`.**

**Feito**

- Auditoria em `docs/audits/auditoria-organizacao-2026-10.md`.
- Mapa técnico em `docs/arquitetura/mapa-tecnico.md`.
- Este plano.
- CLAUDE.md atualizado.
- Três simplificações sem mudança de comportamento: `algumaNegada`,
  `mensagemDoBackend` e `linhasDe` em `common/`.
- Comentário desatualizado de `appointments.service.ts` corrigido.

**Não feito, de propósito**

- Nenhuma migration.
- Nenhum deploy.
- Nenhuma conexão com banco real.
- Nenhuma mudança nos scripts de publicação (o PR #74 está aberto).
- Nenhuma mudança de comportamento: F1 e F2 ficam para E1.

**Próximo passo**

1. Acompanhar os dois checks do PR deste lote.
2. Revisão e merge normal com `[skip render]`.
3. Depois, o lote E1.
