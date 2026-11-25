# Vendas v1 (adicional VENDAS)

Branch do plano: `docs/plano-vendas`, a partir de `96c8ba1`. Lote C1 + B2 do `plano-de-expansao.md`, reduzido às decisões do responsável de 25/11/2026. Este documento só planeja: nenhum código, migration, acesso a banco real, merge ou publicação.

## 1. Decisões fechadas (25/11/2026)

- **Comercial:**
  - VENDAS é um adicional separado e exige ESTOQUE.
  - O preço do adicional não é definido neste lote, e nenhum contrato existente muda.
  - O recebimento das vendas fica dentro de VENDAS. PAGAMENTOS continua valendo só para agendamentos, e não há terceira dependência comercial.
- **Escopo da primeira versão:**
  - venda de produtos e recebimento manual integral, como eventos separados;
  - cliente identificado por ID, ou venda de balcão sem cliente;
  - cancelamento integral, com motivo e senha confirmada há pouco;
  - compras na ficha do cliente.
- **Fora:** devolução parcial, comissão sobre produto, nota fiscal, cobrança automática, serviço avulso, desconto e relatórios financeiros gerais.
- **Quem vende:** dono, gerente autorizado e recepcionista autorizada. Vender não dá acesso direto ao estoque, alteração de preço, cancelamento, estorno nem relatórios financeiros.

## 2. Ponto de partida (código em `96c8ba1`, banco do piloto em 26)

- **Estoque:**
  - `stock_movements` é só de inserção (gatilho `stock_history_append_only`);
  - `SAIDA_VENDA` já existe como saída manual, sem vínculo com venda;
  - o estorno manual (`ESTORNO` + `reverses_movement_id`, único por movimento) vale para qualquer tipo, exceto ajuste e estorno;
  - produto arquivado não recebe movimentação;
  - `stock_products` não tem preço.
- **Recebimentos:** `appointment_payments` exige `appointment_id`, tem um recebimento ativo por atendimento (`uq_appointment_payments_active`) e estorno na mesma linha com `requireRecentReauth`.
- **Recepcionista:**
  - o papel existe e ocupa vaga (`TEAM_SEAT_ROLES`);
  - hoje não tem área nenhuma (`tenant-effective-access.ts`, `papel.ts`), e "Equipe e acessos" mostra o vínculo sem ações (`team.service.ts`).
- **Assinatura:**
  - `quoteSubscription` não conhece dependência entre adicionais;
  - o gate (`commercial-gate.ts`) libera por recurso, sem relação entre recursos.
- **Unificação de clientes:**
  - `consumer-merge.service.ts` trava os cadastros e os agendamentos do secundário e move só `appointments`;
  - o gatilho `trg_appointments_consumer_active` impede um agendamento novo no cadastro unificado.

## 3. Acesso

### Permissões novas (enum `permission`)

| Permissão | Dá | Exige |
|---|---|---|
| `VENDAS_REGISTRAR` | Abrir o catálogo de venda, procurar o cliente para a venda, confirmar a venda e consultar as vendas do dia que a própria pessoa registrou | — |
| `VENDAS_RECEBER` | Registrar o recebimento de uma venda | `VENDAS_REGISTRAR` |
| `VENDAS_ALTERAR_PRECO` | Vender por um preço diferente do sugerido, ou vender produto sem preço sugerido | `VENDAS_REGISTRAR` |
| `VENDAS_VISUALIZAR` | Consultar todas as vendas, com itens, valores e recebimentos, e as compras na ficha do cliente | — |
| `VENDAS_CANCELAR` | Cancelar uma venda | `VENDAS_VISUALIZAR` |
| `VENDAS_ESTORNAR_RECEBIMENTO` | Estornar o recebimento de uma venda | `VENDAS_VISUALIZAR` |

- Todas dependem dos recursos `VENDAS` **e** `ESTOQUE`. O gate confere os dois. Sem eles, a concessão fica guardada, sem efeito, como no estoque.
- Dono: tem todas, e `DENIED` só tira (`algumaNegada`).
- Gerente e recepcionista: só `GRANTED` confirmado dá. As dependências seguem `MANAGER_PERMISSION_REQUIRES`, e a tela mostra o conjunto final.
- Funcionário (PROFISSIONAL): nunca.

### Matriz

| | Dono | Gerente | Recepcionista | Funcionário |
|---|---|---|---|---|
| Registrar venda | sim | com `VENDAS_REGISTRAR` | com `VENDAS_REGISTRAR` | não |
| Registrar recebimento | sim | com `VENDAS_RECEBER` | com `VENDAS_RECEBER` | não |
| Alterar preço na venda | sim | com `VENDAS_ALTERAR_PRECO` | com `VENDAS_ALTERAR_PRECO` | não |
| Consultar todas as vendas e compras na ficha | sim | com `VENDAS_VISUALIZAR` | **não concedível (Q2)** | não |
| Cancelar venda | sim | com `VENDAS_CANCELAR` | **não concedível (Q2)** | não |
| Estornar recebimento | sim | com `VENDAS_ESTORNAR_RECEBIMENTO` | **não concedível (Q2)** | não |
| Estoque (telas e rotas atuais) | sim | `ESTOQUE_*` | nunca | nunca |

**O que cada um vê ao vender**, pela rota `GET sales/catalog`:

- produto ativo de finalidade `VENDA` ou `AMBOS`, com nome, unidade, preço sugerido e um indicador "disponível" ou "sem saldo" (Q3);
- nunca custo, mínimo, histórico, categoria arquivada nem produto de consumo interno;
- saldo numérico só para quem tem `ESTOQUE_VISUALIZAR`.

Cliente na venda, pela rota `GET sales/consumers?q=`:

- devolve id, nome e os 4 últimos dígitos do telefone, só de cadastros ativos;
- não devolve e-mail, observações nem histórico;
- quem tem `CONSUMIDORES_VISUALIZAR` continua usando a busca normal (Q4).

Recepcionista no `/conta`:

- vê só o item "Vendas" (com a área) e "Configurações";
- o perfil passa a ser concedível em "Equipe e acessos", só com as permissões `VENDAS_*` da matriz (Q1).

## 4. Regras

- **Cliente:** `consumer_id` nulo (balcão) ou um cadastro ativo do estabelecimento. Cadastro unificado recebe 409 `CLIENTE_UNIFICADO`.
- **Preço:**
  - `stock_products.sale_price_cents` (nulo = sem preço sugerido), editado no cadastro de produto, com `ESTOQUE_GERENCIAR`;
  - o item congela `product_name`, `unit` e `unit_price_cents`;
  - preço diferente do sugerido, ou produto sem sugerido, sem `VENDAS_ALTERAR_PRECO`: 403 com `code: PRECO_NAO_AUTORIZADO`;
  - o corpo leva o preço visto (`expectedUnitPriceCents`). Se o sugerido mudou, a resposta é 409 `PRECO_ALTERADO` com o preço atual, e nada é gravado.
- **Quantidade e unidade:**
  - milésimos, com as regras atuais de cada unidade (inteiro, exceto `KG` e `L` com 3 casas);
  - o corpo leva `expectedUnit`, como a movimentação;
  - um produto por venda aparece em uma linha só; linha repetida recebe 400;
  - até 50 itens por venda.
- **Arredondamento** (uma fonte por projeto, com a mesma tabela de casos nos dois):
  - `line_total_cents = floor((unit_price_cents × quantity_milli + 500) / 1000)`, metade para cima, só com inteiros;
  - total = soma das linhas, sem arredondar de novo;
  - backend em `backend/src/sales/sale-math.ts`, web em `src/lib/vendas/calculo.ts`, com os mesmos vetores de teste (0,001 KG a R$ 0,01; 1,499 e 1,500 milésimo-centavo; teto de preço × teto de quantidade);
  - o teto do preço é 100.000.000 centavos (o mesmo dos recebimentos). O produto máximo, 1e17, cabe em `bigint`.
- **Confirmação:** uma transação:
  1. trava os produtos por ordem de id (`FOR UPDATE`) e o cliente (`FOR SHARE`);
  2. confere finalidade, arquivamento, unidade, preço e saldo de todos;
  3. grava `sales`, os movimentos `SAIDA_VENDA` com `sale_id` e os `sale_items`.

  Qualquer item sem saldo recusa tudo: 409 `SALDO_INSUFICIENTE`, com a lista dos produtos e nenhum saldo. `ck_stock_products_balance` é a garantia final.
- **Recebimento:**
  - integral, numa tabela própria (seção 5.5);
  - venda cancelada não recebe;
  - estorno com motivo e senha recente, na mesma linha.
- **Cancelamento:**
  - integral, com motivo (pelo menos 3 letras), `requireRecentReauth` e a venda travada;
  - com recebimento ativo, 409 `RECEBIMENTO_ATIVO`;
  - grava um `ESTORNO` por item, com `sale_id` e o motivo, inclusive para produto arquivado. O produto continua arquivado e fora do catálogo;
  - repetir o pedido devolve a venda já cancelada (idempotente pelo estado). Outro cancelamento da mesma venda nunca grava um segundo estorno (`uq_stock_movements_reverses`).
- **Saída manual com VENDAS ligado:**
  - `POST stock/movements` com `SAIDA_VENDA` recebe 409 `USE_VENDAS`, com a orientação de usar Vendas;
  - sem VENDAS, nada muda;
  - movimentos antigos continuam legíveis e estornáveis como hoje.
- **Ficha do cliente:** seção "Compras" com data, itens, total, situação e recebimento, para quem tem `VENDAS_VISUALIZAR` e `CONSUMIDORES_VISUALIZAR`. Uma saída manual `SAIDA_VENDA` antiga não é compra.
- **Auditoria:** `SALE_RECORDED`, `SALE_CANCELLED`, `SALE_PAYMENT_RECORDED` e `SALE_PAYMENT_REFUNDED`, na mesma transação. O preço sugerido muda pelo `STOCK_PRODUCT_CHANGED` que já existe.

## 5. Como o plano resolve os sete pontos

### 5.1 Vínculo item ↔ movimento e estorno manual bloqueado

- `stock_movements` ganha `sale_id` (nulo) com FK `(tenant_id, sale_id) → sales`, e `UNIQUE (tenant_id, sale_id, id)`.
- `CHECK (sale_id IS NULL OR kind IN ('SAIDA_VENDA','ESTORNO'))`.
- `sale_items.stock_movement_id` é `NOT NULL UNIQUE`, com FK composta `(tenant_id, sale_id, stock_movement_id) → stock_movements (tenant_id, sale_id, id)`. O movimento é obrigatoriamente da mesma venda e do mesmo estabelecimento, e cada movimento serve a um item só.
- A ordem de inserção na transação é venda, movimento e depois item, sem FK circular.
- Gatilho `BEFORE INSERT` em `stock_movements`:
  - se `reverses_movement_id` aponta para um movimento com `sale_id`, o novo precisa ter o mesmo `sale_id`, e a venda precisa estar `CANCELADA` na mesma transação;
  - se não, a inserção é recusada.

  O estorno manual (que nunca leva `sale_id`) falha no banco, inclusive vindo de uma API anterior. A API nova recusa antes, com 409 `BAIXA_DE_VENDA`.
- O gatilho de só inserção continua valendo. `ALTER TABLE ... ADD COLUMN` nulo não reescreve linhas.

### 5.2 Total autoritativo e consistência

- O servidor recalcula tudo e não aceita total nem linha vindos da tela. O corpo só leva produto, quantidade, unidade e preço visto ou alterado.
- Na linha: `CHECK line_total_cents = (unit_price_cents * quantity_milli + 500) / 1000`, com inteiros positivos (a divisão inteira do PostgreSQL trunca), mais as `CHECK` de casas por unidade.
- A soma entre tabelas **não** é `CHECK`. É um `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` em `sales` e em `sale_items`, que no commit confere `sales.total_cents = SUM(line_total_cents)` e pelo menos um item.
- `sale_items` é só de inserção. Em `sales`, um gatilho permite mudar só a situação e as colunas do cancelamento, uma vez, de `ATIVA` para `CANCELADA`.

### 5.3 Idempotência, concorrência e isolamento

- **Reenvio:**
  - `sales` tem `request_key` e `request_fingerprint` (os dados normalizados, como no estoque), com `UNIQUE (recorded_by_user_id, request_key)`;
  - mesma chave e mesmos dados devolvem a venda original; outros dados, 409 `CHAVE_REUTILIZADA`;
  - acesso e estabelecimento são conferidos antes, inclusive no reenvio;
  - o web não reenvia sozinho.
- **Último saldo:** duas vendas do último item se serializam na trava do produto. A segunda vê o saldo novo e recebe 409. Travar por ordem de id evita impasse entre vendas com os mesmos produtos em ordem diferente.
- **Concorrência com o estoque:** conferência e movimentação manual travam o mesmo produto. A conferência que viu uma versão anterior recebe `CONFERENCIA_DESATUALIZADA`, porque a venda incrementa `balance_version` por `registrarMovimentacao`.
- **Cancelamento repetido ou simultâneo:** trava `sales` `FOR UPDATE`. O segundo vê `CANCELADA` e devolve o estado.
- **Cancelar contra receber:**
  - recebimento e cancelamento travam a venda primeiro;
  - `uq_sale_payments_active` garante um recebimento ativo por venda;
  - o cancelamento confere "sem recebimento ativo" depois da trava.
- **Isolamento:**
  - toda tabela tem `tenant_id` e FKs compostas com o estabelecimento (produto, cliente, venda, movimento, usuário pelo vínculo);
  - todo serviço começa com `resolveAuthorizedTenant`;
  - id de outro estabelecimento recebe 404;
  - db-e2e com dois estabelecimentos para cada rota.

### 5.4 Unificação de clientes

- `sales.consumer_id` tem FK `(tenant_id, consumer_id) → consumers`.
- Um gatilho `trg_sales_consumer_active`, no molde do de agendamentos, pede `FOR SHARE` no cadastro e recusa lápide.
- A unificação acrescenta à trava 2 `SELECT id FROM sales WHERE tenant_id = $1 AND consumer_id = $2 ORDER BY id FOR UPDATE`, move `sales.consumer_id` para o principal e inclui o número de compras na prévia (`PREVIA_DESATUALIZADA` se mudar).
- Os itens não mudam, porque guardam só o produto. Recebimentos e cancelamentos seguem pela venda.
- **Venda simultânea à unificação:**
  - a venda que pegou o `FOR SHARE` antes termina, e a unificação a encontra na trava 2;
  - a que chega depois espera e, quando a unificação termina, encontra a lápide: 409 `CLIENTE_UNIFICADO`, sem gravar nada. A tela pede para escolher o cliente de novo, e a chave permite repetir.
- **Retorno à API anterior** (que unifica sem conhecer vendas): um gatilho `AFTER UPDATE OF merged_into_consumer_id ON consumers` move as vendas do secundário. A unificação nunca deixa compra presa numa lápide, qualquer que seja a API.

### 5.5 Recebimentos de vendas

- Tabela nova `sale_payments`, com a mesma forma de `appointment_payments` (método, data local, chave, estorno na mesma linha), e `sale_id NOT NULL` em vez de `appointment_id`.
- `appointment_payments` e as regras de PAGAMENTOS não mudam.
- Garantias:
  - `uq_sale_payments_active (tenant_id, sale_id) WHERE refunded_at IS NULL`;
  - gatilho `BEFORE INSERT`: `amount_cents = sales.total_cents` e venda `ATIVA` (integral);
  - FK composta com a venda.
- **Valor vendido não é dinheiro recebido:**
  - a venda guarda só `total_cents`;
  - "recebido" é soma de `sale_payments` não estornados;
  - nenhuma tela soma vendas como recebimento;
  - o Início e o relatório de comissões continuam lendo só `appointment_payments` neste lote (Q5).

### 5.6 Migrations e ordem de execução

- **27 `SalesEnumValues1794528000000`:** só `ADD VALUE`:
  - `feature_key.VENDAS`;
  - `permission.VENDAS_*` (seis);
  - `audit_action.SALE_*` (quatro).

  Confirmada sozinha: CLI em `migrationsTransactionMode: 'each'`; no piloto, `operacao-piloto.mjs` aplica uma pendente por execução.
- **28 `SalesModule1794614400000`:**
  - primeira instrução: confere que os valores da 27 estão confirmados (molde da 22). Se não estiverem, falha sem gravar;
  - cria `sales`, `sale_items` e `sale_payments`;
  - acrescenta `stock_movements.sale_id` e `stock_products.sale_price_cents`;
  - cria os gatilhos das seções 5.1 a 5.5;
  - insere `features.feat_vendas` e o adicional VENDAS em `addon_modules`, com `price_cents NULL` e `availability` `AVAILABLE`. Sem preço, a contratação recusa com `PRECO_PENDENTE`, e é o responsável quem define o preço em "Planos e adicionais";
  - nada em `plan_features` nem em overrides;
  - o `down` recusa se houver venda, recebimento, contratação ou concessão.
- **Dependência ESTOQUE:** fica em código, em `subscription.ts` (`ADDON_REQUIRES = { VENDAS: ['ESTOQUE'] }`):
  - contratar VENDAS sem ESTOQUE recebe `MODULO_DEPENDENTE`;
  - tirar ESTOQUE com VENDAS ativo também;
  - para estabelecimento não modular (overrides do portal), a mesma regra na rota de override. O gate confere os dois recursos de qualquer forma.
- Manifesto `required-migrations.ts` com 28. A API nova recusa subir em 27.
- Enums TS (`Permission`, `FeatureKey`, `AuditAction`) e `MANAGER_PERMISSIONS` no mesmo PR das migrations.

### 5.7 Publicação e retorno

- A API atual não conhece vendas e **não é** retorno seguro depois da primeira venda:
  - ela grava `SAIDA_VENDA` manual com VENDAS ligado;
  - ela apaga concessões desconhecidas ao salvar o acesso do gerente (H3 do estoque);
  - ela não mostra compras;
  - os gatilhos de 5.1 e 5.4 só evitam corromper o vínculo e a unificação.
- **Ordem:**
  1. backup;
  2. restauração e ensaio na cópia (27, 28, a API anterior nos dois estados e as janelas como no estoque);
  3. 27 no piloto;
  4. 28 no piloto;
  5. API nova;
  6. web no mesmo SHA;
  7. conferências só de leitura.
- **Limites do retorno:**
  - antes da 28: livre;
  - depois da 28, sem nenhuma contratação, concessão ou venda (`0 | 0 | 0`): a API anterior, se o ensaio provar que ela sobe e opera em 28;
  - depois: **só correção para frente**.
- **Desligamento funcional sem voltar código:** tirar VENDAS da assinatura no portal. A API nova recusa todas as rotas de venda, a tela esconde, e o estoque volta ao comportamento atual (saída manual liberada).
- Antes do preço definido, o adicional não pode ser contratado. Liberar para um estabelecimento é decisão do responsável depois do H2.
- Roteiro: `docs/runbooks/publicacao-vendas-v1.md`, no PR 4.

## 6. PRs

| PR | Conteúdo | Depende | Testes |
|---|---|---|---|
| **1 — Plano** (este) | `docs/plans/vendas-v1.md` e referência no plano de expansão | — | nenhum |
| **2 — Schema e acesso** | Migrations 27 e 28, enums, manifesto, `ADDON_REQUIRES`, permissões `VENDAS_*` com dependências, perfil recepcionista em `team`, gate de dois recursos, `sales-access.ts`, `USE_VENDAS` na movimentação, unificação movendo vendas | 1 | Specs das migrations e de `each`, `required-migrations`, `subscription.spec`, `manager-permissions`, `sales-access.spec`, `staff-access`, `tenant-effective-access`; db-e2e: `sales-migrations` (banco novo, a partir de 26, modo `all` indevido, falha e retomada), gatilhos direto no banco (estorno manual bloqueado, soma diferida, lápide, só inserção), `stock-postgres` (`USE_VENDAS`), `consumer-merge` com vendas e corrida, `pilot-team-manager-check` e kits antigos (memória do banco compartilhado) |
| **3 — API de vendas e recebimentos** | `backend/src/sales/`: catálogo, busca de cliente, criar, listar, detalhar, cancelar, receber, estornar; `sale-math.ts`; ficha do cliente com compras | 2 | Unitários de cálculo (vetores), DTOs e impressão digital; `test/sales.e2e-spec.ts`; db-e2e `sales-postgres` (último saldo com duas conexões, tudo ou nada, preço, reenvio, cancelamento repetido, cancelar com recebimento, produto arquivado, isolamento entre dois estabelecimentos) e `sales-access-postgres` (matriz da seção 3, sem VENDAS, sem ESTOQUE, concessão guardada) |
| **4 — Web, navegador e runbook** | `src/lib/api/vendas-api.ts`, `src/lib/vendas/` (cálculo com os mesmos vetores, carrinho), telas de Vendas, preço sugerido no produto, recepcionista e `VENDAS_*` em Equipe e acessos, menu, compras na ficha, aviso `USE_VENDAS` na movimentação, guardas da demonstração; runbook | 3 | `src/lib/vendas/*.test.ts`, `vendas-api.test.ts`, `navegacao.test.ts`, `papel.test.ts`; nova `test:browser:vendas` (dono, gerente, recepcionista, sem saldo, cancelamento com senha, recebimento e estorno, ficha); `test:browser:layout-temas` nas telas novas; `test:browser:estoque` sem VENDAS |

- Integração com os PRs 2 e 3 mesclados não é publicada sozinha: a publicação funcional é o head do PR 4, com venda e recebimento juntos.
- Se outra publicação for necessária nesse intervalo, sai de um SHA anterior ao PR 2.

## 7. Questões em aberto (o código não responde)

- **Q1 — Recepcionista:** o perfil hoje é "antigo, sem área". O dono passa a convidar e trocar para RECEPCIONISTA em "Equipe e acessos"? E a vaga continua contando (`TEAM_SEAT_ROLES`)? Proposta: sim aos dois, com só as permissões `VENDAS_REGISTRAR`, `VENDAS_RECEBER` e `VENDAS_ALTERAR_PRECO`.
- **Q2 — Recepcionista com cancelamento, estorno ou consulta geral:** a decisão diz que vender não dá isso, mas não diz se o dono pode conceder. Proposta: não concedível neste lote.
- **Q3 — Saldo no catálogo:** quem vende sem `ESTOQUE_VISUALIZAR` vê o saldo numérico ou só "disponível/sem saldo"? Proposta: só o indicador. A recusa por falta de saldo diz o produto, não a quantidade.
- **Q4 — Busca de cliente na venda:** a recepcionista não tem `CONSUMIDORES_VISUALIZAR`. A busca limitada (nome e 4 últimos dígitos) é aceitável? Proposta: sim. Cadastrar cliente novo pela venda fica fora.
- **Q5 — Início e relatórios:** recebimentos de venda entram no "recebido" do Início? Proposta: não neste lote. O Início fica igual, e o relatório financeiro (C0) decide.
- **Q6 — Preço do adicional e liberação:** quem define o preço e quando liberar o primeiro estabelecimento (depois do H2, como no estoque).
- **Q7 — Formas de pagamento:** usar as mesmas seis de `PAYMENT_METHODS`? Proposta: sim.

## 8. Estado e retomada

**25/11/2026:** plano escrito, sem código. PR só de documentação para `integration/nestjs-typeorm-frontend`.

- **Próximo passo:** o responsável responde Q1 a Q7 e aprova o plano. Depois, o PR 2 numa branch nova a partir da integração.
- **Só neste computador:** a worktree `C:/wt/plano-vendas`.
