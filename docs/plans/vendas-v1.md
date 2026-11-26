# Vendas v1 (adicional VENDAS)

Branch do plano: `docs/plano-vendas`, a partir de `96c8ba1`. Lote C1 + B2 do `plano-de-expansao.md`, reduzido às decisões do responsável de 25/11/2026. Este documento só planeja: nenhum código, migration, acesso a banco real, merge ou publicação.

## 1. Decisões fechadas (25/11/2026)

- **Comercial:**
  - VENDAS é um adicional separado e exige ESTOQUE.
  - O preço do adicional e a primeira ativação real são decisões do responsável, ainda pendentes.
  - Nenhum contrato existente muda. Preço ausente nunca é gratuito: a contratação recusa com `PRECO_PENDENTE`, como já faz `quoteSubscription`.
  - O recebimento das vendas fica dentro de VENDAS e não exige PAGAMENTOS. PAGAMENTOS continua valendo só para atendimentos, com a regra atual, e não há terceira dependência comercial.
- **Escopo da primeira versão:**
  - venda de produtos e recebimento manual integral, como eventos separados;
  - cliente identificado por ID, ou venda de balcão sem cliente;
  - cancelamento integral, com motivo e senha confirmada há pouco;
  - compras na ficha do cliente.
- **Fora:** devolução parcial, comissão sobre produto, nota fiscal, cobrança automática, serviço avulso, desconto, cadastro de cliente novo pela venda e relatórios financeiros gerais.
- **Quem vende:** dono, gerente autorizado e recepcionista autorizada. Vender não dá acesso direto ao estoque, alteração de preço, cancelamento, estorno nem relatórios financeiros.
- **Recepcionista:**
  - o dono convida e concede as permissões em "Equipe e acessos";
  - a vaga conta normalmente no limite da equipe (`TEAM_SEAT_ROLES`, sem mudança);
  - autorizada, registra vendas e recebimentos e consulta as próprias operações;
  - nunca cancela, estorna nem consulta todas as vendas.
- **Catálogo e clientes:**
  - sem `ESTOQUE_VISUALIZAR`, só a disponibilidade, sem saldo numérico;
  - o servidor valida a quantidade na confirmação;
  - a busca de clientes mostra nome e os quatro últimos dígitos do telefone;
  - a seleção é sempre por ID, e nenhum resultado ambíguo é escolhido sozinho.
- **Recebimentos:**
  - as seis formas de pagamento existentes (`PAYMENT_METHODS`), em registro manual;
  - o indicador do Início não soma vendas neste lote e passa a dizer que é de atendimentos.

## 2. Ponto de partida (código em `96c8ba1`, banco do piloto em 26)

- **Estoque:**
  - `stock_movements` é só de inserção (gatilho `stock_history_append_only`);
  - `SAIDA_VENDA` já existe como saída manual, sem vínculo com venda;
  - o estorno manual (`ESTORNO` + `reverses_movement_id`, único por movimento) vale para qualquer tipo, exceto ajuste e estorno;
  - produto arquivado não recebe movimentação;
  - `stock_products` não tem preço.
- **Recebimentos:**
  - `appointment_payments` exige `appointment_id`, tem um recebimento ativo por atendimento (`uq_appointment_payments_active`) e estorno na mesma linha com `requireRecentReauth`;
  - o Início mostra "Recebido no período" (`visao-geral/blocos.tsx`), só desses recebimentos.
- **Recepcionista:**
  - o papel existe e ocupa vaga;
  - hoje não tem área nenhuma (`tenant-effective-access.ts`, `papel.ts`), e "Equipe e acessos" mostra o vínculo sem ações (`team.service.ts`).
- **Assinatura e gate:**
  - `quoteSubscription` não conhece dependência entre adicionais;
  - `resolveAuthorizedTenant` aceita um `recurso` por rota.
- **Unificação de clientes:**
  - `consumer-merge.service.ts` trava os cadastros e os agendamentos do secundário e move só `appointments`;
  - o gatilho `trg_appointments_consumer_active` impede um agendamento novo no cadastro unificado.
- **Migrations:**
  - a CLI usa `migrationsTransactionMode: 'each'` (`migrations-data-source.ts`, com spec);
  - no piloto, `aplicarSomenteAPendente` (`backend/scripts/operacao-piloto.mjs`) tira as `posteriores` do DataSource e aplica só a pendente esperada, numa transação por execução.

## 3. Acesso

### Permissões novas (enum `permission`)

| Permissão | Dá | Exige |
|---|---|---|
| `VENDAS_REGISTRAR` | Abrir o catálogo de venda, procurar o cliente para a venda, confirmar a venda e consultar as próprias operações (vendas e recebimentos que a pessoa registrou) | — |
| `VENDAS_RECEBER` | Registrar o recebimento de uma venda que a própria pessoa registrou. Para vendas de outras pessoas, só junto com `VENDAS_VISUALIZAR` (a consulta geral sozinha não recebe) | `VENDAS_REGISTRAR` |
| `VENDAS_ALTERAR_PRECO` | Ao registrar uma venda nova, aplicar preço diferente do sugerido, ou vender produto sem preço sugerido. Nunca edita venda concluída: os valores ficam congelados nos itens, com quem registrou | `VENDAS_REGISTRAR` |
| `VENDAS_VISUALIZAR` | Consultar todas as vendas e os recebimentos de vendas, com totais do período, e as compras na ficha do cliente | — |
| `VENDAS_CANCELAR` | Cancelar uma venda | `VENDAS_VISUALIZAR` |
| `VENDAS_ESTORNAR_RECEBIMENTO` | Estornar o recebimento de uma venda | `VENDAS_VISUALIZAR` |

- Dono: tem todas, e `DENIED` só tira (`algumaNegada`).
- Gerente: só `GRANTED` confirmado dá. As dependências seguem `MANAGER_PERMISSION_REQUIRES`, e a tela mostra o conjunto final.
- Recepcionista:
  - só `VENDAS_REGISTRAR`, `VENDAS_RECEBER` e `VENDAS_ALTERAR_PRECO` são concedíveis, cada uma explícita e separada pelo dono (decisão de 25/11/2026). Vender não traz preço;
  - o servidor recusa as outras três e qualquer `ESTOQUE_*` ou permissão de outra área.
- Funcionário (PROFISSIONAL): nunca.
- A exigência dos adicionais por rota está na seção 3.1.

### Matriz

| | Dono | Gerente | Recepcionista | Funcionário |
|---|---|---|---|---|
| Registrar venda | sim | `VENDAS_REGISTRAR` | `VENDAS_REGISTRAR` | não |
| Registrar recebimento da própria venda | sim | `VENDAS_RECEBER` | `VENDAS_RECEBER` | não |
| Registrar recebimento de venda de outra pessoa | sim | `VENDAS_RECEBER` **e** `VENDAS_VISUALIZAR` | nunca | não |
| Alterar preço na venda | sim | `VENDAS_ALTERAR_PRECO` | `VENDAS_ALTERAR_PRECO` | não |
| Consultar as próprias operações | sim | `VENDAS_REGISTRAR` | `VENDAS_REGISTRAR` | não |
| Consultar todas as vendas, recebimentos de vendas e compras na ficha | sim | `VENDAS_VISUALIZAR` | nunca | não |
| Cancelar venda | sim | `VENDAS_CANCELAR` | nunca | não |
| Estornar recebimento de venda | sim | `VENDAS_ESTORNAR_RECEBIMENTO` | nunca | não |
| Estoque (telas e rotas atuais) | sim | `ESTOQUE_*` | nunca | nunca |

**O que cada um vê ao vender:**

- `GET sales/catalog`:
  - produto ativo de finalidade `VENDA` ou `AMBOS`, com nome, unidade, preço sugerido e "disponível" ou "sem saldo";
  - saldo numérico só para quem tem `ESTOQUE_VISUALIZAR`;
  - nunca mínimo, histórico, categoria arquivada nem produto de consumo interno.
- **Quantidade:** a disponibilidade é só indicação. O servidor confere cada quantidade na confirmação, e a recusa por saldo cita o produto, sem dizer quanto há (exceto para quem tem `ESTOQUE_VISUALIZAR`).
- `GET sales/consumers?q=`:
  - id, nome e os quatro últimos dígitos do telefone, só de cadastros ativos, com no mínimo 2 caracteres na busca;
  - nunca e-mail, telefone inteiro, observações nem histórico;
  - a tela só guarda um cliente quando a pessoa toca num resultado, e envia o `consumerId`. Nunca escolhe pelo texto digitado, nem quando há um resultado só. Dois cadastros iguais aparecem lado a lado, sem pré-seleção.

**Onde consultar** (`/conta/vendas`, grupo "Atendimento"):

- "Nova venda": quem tem `VENDAS_REGISTRAR`, com VENDAS e ESTOQUE ativos;
- "Minhas operações": vendas e recebimentos que a própria pessoa registrou, com a situação de cada um. Quem tem `VENDAS_RECEBER` recebe dali;
- "Vendas" e "Recebimentos de vendas": com `VENDAS_VISUALIZAR`. A segunda aba traz recebido, estornado e líquido do período, só de vendas, no molde de `/conta/recebimentos`;
- `/conta/recebimentos` continua só com atendimentos, sob PAGAMENTOS, e o título passa a "Recebimentos de atendimentos";
- no Início, "Recebido no período" passa a "Recebido em atendimentos", com o texto de ajuda dizendo que vendas ficam em Vendas.

### 3.1 Exigência dos adicionais por rota

| Rotas | Recurso exigido | Política |
|---|---|---|
| **Nova venda:** `GET sales/catalog`, `GET sales/consumers`, `POST sales` | `VENDAS` **e** `ESTOQUE` | `VENDAS_REGISTRAR` (+ preço) |
| **Manutenção:** listar e detalhar vendas, "Minhas operações", recebimentos de vendas, `POST sales/:id/payments`, estorno de recebimento, `POST sales/:id/cancel`, compras na ficha | nenhum (só a validade do acesso do estabelecimento) | a permissão da matriz |

- **Com VENDAS desligado**, por retirada ou por fim do adicional:
  - novas vendas são recusadas (403 do gate);
  - a manutenção continua para as vendas já registradas: consultar, receber, estornar e cancelar (com a devolução ao estoque), conforme as permissões.
- **Concessões de gerente e recepcionista:**
  - continuam valendo para a manutenção, porque essas rotas não exigem recurso;
  - "Equipe e acessos" só oferece concessão nova de `VENDAS_*` com VENDAS ativo. As já gravadas ficam e podem ser retiradas.
- **Área na sessão:**
  - `VENDAS_NOVA` só com os dois recursos;
  - `VENDAS_HISTORICO` com a permissão e pelo menos uma venda no estabelecimento, mesmo sem o recurso. O menu mostra "Vendas" só com a manutenção.
- **Implementação no gate:**
  - `resolveAuthorizedTenant` aceita uma lista de recursos (todos exigidos);
  - as rotas de manutenção passam `recurso: null`, como as rotas de núcleo. Nenhuma checagem fica na tela.

### 3.2 ESTOQUE não sai enquanto VENDAS estiver ativo

- **Assinatura modular:** `ADDON_REQUIRES = { VENDAS: ['ESTOQUE'] }` em `subscription.ts`.
  - Uma versão com VENDAS e sem ESTOQUE recebe 409 `MODULO_DEPENDENTE`, seja contratação nova, seja retirada só do ESTOQUE.
  - Tirar os dois na mesma versão é permitido.
- **Estabelecimento não modular** (overrides do portal):
  - desligar `feat_estoque` com `feat_vendas` ligado recebe o mesmo 409;
  - ligar `feat_vendas` sem `feat_estoque` também.
- **Fim do acesso** (validade vencida): bloqueia tudo, como hoje. Não é retirada.
- **Estado incoerente** (vindo de fora dessas rotas): a nova venda exige os dois recursos e é recusada; a manutenção segue.
- **Sem VENDAS ativo:** a retirada do ESTOQUE é livre. Um cancelamento posterior ainda devolve as quantidades ao saldo, que fica guardado sem tela até uma recontratação.

## 4. Regras

- **Cliente:** `consumer_id` nulo (balcão) ou um cadastro ativo do estabelecimento. Cadastro unificado recebe 409 `CLIENTE_UNIFICADO`.
- **Preço:**
  - `stock_products.sale_price_cents` (nulo = sem preço sugerido), editado no cadastro de produto, com `ESTOQUE_GERENCIAR`;
  - o item congela `product_name`, `unit` e `unit_price_cents`;
  - preço diferente do sugerido, ou produto sem sugerido, sem `VENDAS_ALTERAR_PRECO`: 403 com `code: PRECO_NAO_AUTORIZADO`;
  - cada item leva o preço sugerido que a tela mostrou (`expectedSuggestedPriceCents`, nulo quando não havia) e o preço aplicado (`unitPriceCents`). Se o sugerido mudou, 409 `PRECO_ALTERADO` com o preço atual, e nada é gravado.
- **Quantidade e unidade:**
  - milésimos, com as regras atuais (inteiro, exceto `KG` e `L` com 3 casas);
  - o corpo leva `expectedUnit`;
  - uma linha por produto, e linha repetida recebe 400;
  - até 50 itens.
- **Arredondamento** (uma fonte por projeto, mesma tabela de casos nos dois):
  - `line_total_cents = floor((unit_price_cents × quantity_milli + 500) / 1000)`, metade para cima, só com inteiros;
  - total = soma das linhas, sem novo arredondamento;
  - backend em `backend/src/sales/sale-math.ts`, web em `src/lib/vendas/calculo.ts`, com os mesmos vetores (0,001 KG a R$ 0,01; meio centavo exato; teto de preço × teto de quantidade);
  - preço até 100.000.000 centavos. O produto máximo, 1e17, cabe em `bigint`.
- **Confirmação** (uma transação):
  1. trava os produtos por ordem de id (`FOR UPDATE`) e o cliente (`FOR SHARE`);
  2. confere finalidade, arquivamento, unidade, preço e saldo de todos;
  3. grava `sales`, os movimentos `SAIDA_VENDA` com `sale_id` e os `sale_items`.

  Um item sem saldo recusa tudo: 409 `SALDO_INSUFICIENTE`, com os produtos, e nada é gravado. `ck_stock_products_balance` é a garantia final.
- **Recebimento:**
  - integral, numa tabela própria (seção 5.5), com as seis formas;
  - venda cancelada não recebe;
  - estorno com motivo e senha recente, na mesma linha.
- **Cancelamento:**
  - integral, com motivo (pelo menos 3 letras), `requireRecentReauth` e a venda travada;
  - com recebimento ativo, 409 `RECEBIMENTO_ATIVO`;
  - grava um `ESTORNO` por item, com `sale_id` e o motivo, inclusive para produto arquivado. O produto continua arquivado e fora do catálogo;
  - repetir o pedido devolve a venda já cancelada (idempotente pelo estado).
- **Saída manual com VENDAS ativo:**
  - `POST stock/movements` com `SAIDA_VENDA` recebe 409 `USE_VENDAS`;
  - sem VENDAS, nada muda;
  - movimentos antigos continuam legíveis e estornáveis como hoje.
- **Ficha do cliente:** seção "Compras" (data, itens, total, situação e recebimento) para quem tem `VENDAS_VISUALIZAR` e `CONSUMIDORES_VISUALIZAR`. Uma `SAIDA_VENDA` manual antiga não é compra.
- **Auditoria:** `SALE_RECORDED`, `SALE_CANCELLED`, `SALE_PAYMENT_RECORDED` e `SALE_PAYMENT_REFUNDED`, na mesma transação. O preço sugerido muda pelo `STOCK_PRODUCT_CHANGED` existente.

## 5. Como o plano resolve os sete pontos

### 5.1 Vínculo item ↔ movimento: estorno manual bloqueado, cancelamento permitido

**Estrutura:**

- `stock_movements.sale_id` (nulo), com FK `(tenant_id, sale_id) → sales` e `UNIQUE (tenant_id, sale_id, id)`.
- `CHECK (sale_id IS NULL OR kind IN ('SAIDA_VENDA','ESTORNO'))`.
- `sale_items.stock_movement_id` é `NOT NULL UNIQUE`, com FK composta `(tenant_id, sale_id, stock_movement_id) → stock_movements (tenant_id, sale_id, id)`. O movimento é da mesma venda e do mesmo estabelecimento, e serve a um item só.
- A ordem de inserção é venda, movimento e depois item, sem FK circular.

**O que separa o estorno manual do cancelamento:** um gatilho `BEFORE INSERT` em `stock_movements` (`stock_movements_sale_link`). Quando `NEW.reverses_movement_id` aponta para um movimento com `sale_id = S`, a inserção só passa se:

1. `NEW.sale_id = S`; e
2. a venda `S`, lida com `FOR SHARE`, já está `CANCELADA`.

Senão, `RAISE EXCEPTION` com um `CONSTRAINT` próprio, que a API traduz em 409 `BAIXA_DE_VENDA`.

- **Estorno manual:**
  - a rota `stock/movements/:id/reverse` nunca grava `sale_id` (a API nova recusa antes, com o mesmo código);
  - a API anterior não conhece a coluna;
  - nos dois casos, a condição 1 falha no banco.
- **Cancelamento legítimo**, na mesma transação, nesta ordem:
  1. trava a venda;
  2. muda a venda para `CANCELADA`;
  3. insere um `ESTORNO` por item, com o `sale_id`.

  As duas condições valem. Alguém que tentasse marcar `sale_id` num estorno de venda ativa falha na condição 2.
- **Outros movimentos com `sale_id`:** uma `SAIDA_VENDA` com `sale_id` só entra com a venda `ATIVA` e sem nenhum item ainda ligado a ela (o mesmo gatilho). Nada se acrescenta a uma venda já confirmada.
- **Cancelamento completo:** um `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` em `sales` confere no commit que uma venda `CANCELADA` tem exatamente um `ESTORNO` por item. `uq_stock_movements_reverses` impede o segundo.
- O gatilho de só inserção continua valendo. `ADD COLUMN` nulo não reescreve linhas.

### 5.2 Total autoritativo e consistência

- O servidor recalcula tudo e não aceita total nem linha vindos da tela.
- Na linha: `CHECK line_total_cents = (unit_price_cents * quantity_milli + 500) / 1000` (inteiros positivos; a divisão inteira trunca), mais as casas por unidade.
- A soma entre tabelas **não** é `CHECK`. É um `CONSTRAINT TRIGGER` diferido em `sales` e em `sale_items`, que no commit confere `sales.total_cents = SUM(line_total_cents)` e pelo menos um item.
- `sale_items` é só de inserção. Em `sales`, um gatilho só permite `ATIVA → CANCELADA`, uma vez, com motivo, autor e data juntos, e sem recebimento ativo.

### 5.3 Idempotência, concorrência e isolamento

- **Reenvio:**
  - `sales` tem `request_key` e `request_fingerprint`, com `UNIQUE (recorded_by_user_id, request_key)`;
  - mesma chave e mesmos dados devolvem a original; outros dados, 409 `CHAVE_REUTILIZADA`;
  - acesso conferido antes, inclusive no reenvio;
  - o web não reenvia sozinho.
- **Último saldo:** as vendas se serializam na trava do produto, e a segunda vê o saldo novo e recebe 409. A ordem por id evita impasse.
- **Concorrência com o estoque:** conferência e movimentação travam o mesmo produto. A venda incrementa `balance_version`, e a conferência desatualizada recebe `CONFERENCIA_DESATUALIZADA`.
- **Cancelamento repetido ou simultâneo:** `sales` `FOR UPDATE`. O segundo vê `CANCELADA` e devolve o estado.
- **Repetição de cancelamento e estorno:** não usam chave de pedido. A repetição é reconhecida pelo ID da venda (cancelamento) ou do recebimento (estorno) e pelo conteúdo da operação, o motivo normalizado:
  - mesmo ID e mesmo motivo devolvem o registro já gravado (`created: false`), sem novo lançamento: nenhum `ESTORNO` de estoque, nenhuma auditoria e nenhuma linha nova;
  - mesmo ID com outro motivo recebe 409 `JA_CANCELADA` ou `JA_ESTORNADO`;
  - antes de devolver um resultado anterior, a repetição passa pelas mesmas verificações da primeira vez: vínculo e estabelecimento (`resolveAuthorizedTenant`), permissão (`VENDAS_CANCELAR` ou `VENDAS_ESTORNAR_RECEBIMENTO`) e a confirmação recente de senha. Quem perdeu o acesso recebe a recusa, não o registro.
- **Cancelar contra receber:** os dois travam a venda primeiro. `uq_sale_payments_active` e o gatilho de `sales` são a garantia final.
- **Isolamento:**
  - `tenant_id` e FKs compostas em todas as tabelas;
  - `resolveAuthorizedTenant` no início de todo serviço;
  - id de outro estabelecimento recebe 404;
  - db-e2e com dois estabelecimentos por rota, inclusive nas rotas de manutenção sem recurso.

### 5.4 Unificação de clientes

- `sales.consumer_id` tem FK `(tenant_id, consumer_id) → consumers`. O gatilho `trg_sales_consumer_active`, no molde do de agendamentos, pede `FOR SHARE` no cadastro e recusa lápide.
- A unificação acrescenta à trava 2 as vendas do secundário (`FOR UPDATE`, por id), move `sales.consumer_id` e inclui o número de compras na prévia (`PREVIA_DESATUALIZADA` se mudar).
- **Venda simultânea à unificação:**
  - a venda que pegou o `FOR SHARE` antes termina, e a unificação a encontra na trava 2;
  - a que chega depois espera e encontra a lápide: 409 `CLIENTE_UNIFICADO`, sem gravar nada. A tela pede para escolher de novo, e a chave permite repetir.
- **Unificação feita pela API anterior:** um gatilho `AFTER UPDATE OF merged_into_consumer_id ON consumers` move as vendas do secundário.

### 5.5 Recebimentos de vendas

- Tabela nova `sale_payments`, com a forma de `appointment_payments`, as mesmas seis formas (`PAYMENT_METHODS`) e `sale_id NOT NULL` em vez de `appointment_id`.
- `appointment_payments` e PAGAMENTOS não mudam.
- Garantias:
  - `uq_sale_payments_active (tenant_id, sale_id) WHERE refunded_at IS NULL`;
  - gatilho `BEFORE INSERT`: `amount_cents = sales.total_cents` e venda `ATIVA`;
  - FK composta com a venda.
- **Valor vendido não é dinheiro recebido:**
  - a venda guarda só `total_cents`;
  - "recebido de vendas" é a soma de `sale_payments` não estornados, mostrada só em "Recebimentos de vendas" (seção 3);
  - o Início e o relatório de comissões continuam lendo só `appointment_payments`, com o rótulo do Início corrigido.

### 5.6 Migrations e commit real entre 27 e 28

- **27 `SalesEnumValues1794528000000`:** só `ADD VALUE`:
  - `feature_key.VENDAS`;
  - `permission.VENDAS_*` (seis);
  - `audit_action.SALE_*` (quatro).
- **28 `SalesModule1794614400000`:**
  - primeira instrução: confere que os valores da 27 estão confirmados (molde de `conferirEnumsConfirmados` da 22). Se não estiverem, falha sem gravar;
  - tabelas, colunas e gatilhos das seções 5.1 a 5.5;
  - `features.feat_vendas` e o adicional VENDAS em `addon_modules`, com `price_cents NULL` e `AVAILABLE`. Sem preço, a contratação recusa (`PRECO_PENDENTE`);
  - nada em `plan_features` nem em overrides;
  - o `down` recusa se houver venda, recebimento, contratação ou concessão.
- **Commit entre as duas, por mecanismo:**
  - **CLI** (CI, banco descartável, `migration:run:compiled`): `migrationsTransactionMode: 'each'`. O TypeORM confirma a 27 antes de abrir a transação da 28.
    - O spec de `migrations-data-source` já fixa `each`.
    - O PR 2 acrescenta ao db-e2e de migrations o caso `transaction: 'all'` com 27 e 28 pendentes: a 28 falha na primeira instrução, e nem a 27 fica registrada (rollback da transação única).
  - **Piloto:** duas execuções separadas de `aplicarSomenteAPendente`:
    1. `esperadasAntes` = as 26, `pendente` = 27, `posteriores` = [28]. A função tira a 28 do DataSource, aplica só a 27 e confirma ao sair. O operador confere 27 registradas e os onze valores presentes;
    2. `esperadasAntes` = as 27, `pendente` = 28, numa conexão nova.

    `runMigrations({ transaction: 'all' })` dentro da função só recebe uma migration por vez. A guarda `ERR_MIGRATIONS_COMPILADAS_INESPERADAS` recusa se a 28 sobrar no DataSource.
  - **Nunca:** a API não roda migrations ao subir (só confere o manifesto), e o `migration:run` com as duas num modo `all` está coberto pela falha da primeira instrução da 28.
- **Dependência ESTOQUE:** seção 3.2, em código.
- Manifesto `required-migrations.ts` com 28. A API nova recusa subir em 27.
- Enums TS e `MANAGER_PERMISSIONS` no mesmo PR das migrations.

### 5.7 Publicação, retorno e contingência

**A API atual não é retorno seguro depois da primeira venda:**

- grava `SAIDA_VENDA` manual com VENDAS ativo;
- apaga concessões desconhecidas ao salvar o acesso do gerente (H3 do estoque);
- não mostra vendas, recebimentos de vendas nem compras;
- os gatilhos de 5.1 e 5.4 só evitam corromper o vínculo e a unificação.

**Ordem:**

1. backup;
2. duas validações, nesta ordem:
   - **banco descartável** (CI e local, dados fictícios): migrations a partir do schema vazio e a partir de 26, o modo `all` recusado, gatilhos e suítes. Prova o código, não o piloto;
   - **ensaio numa cópia restaurada do backup do piloto**, depois e separado: 27 e 28 aplicadas uma por vez com `aplicarSomenteAPendente`, a API anterior e a nova sobre a cópia nos dois estados, e as janelas como no estoque. Só este ensaio prova a compatibilidade com os dados reais;
3. 27 no piloto;
4. 28 no piloto;
5. API nova;
6. web no mesmo SHA;
7. conferências só de leitura.

**Limites do retorno:**

- antes da 28: livre;
- depois da 28, enquanto valer a **condição de retorno** (as sete contagens de uso de VENDAS, todas zero; definição única e consulta em `docs/runbooks/publicacao-vendas-v1.md`, seção V3): a API anterior, **somente** se o ensaio na cópia restaurada provar que ela sobe e opera em 28. Contagens zeradas não provam essa compatibilidade;
- depois: **só correção para frente**.

**Retirar o adicional não é rollback.** Só para novas vendas: o código novo, as tabelas e as vendas ficam. Serve para conter um defeito do fluxo de venda, não da manutenção, do estoque ou do resto da API.

**Contingência quando só cabe corrigir para frente** (detalhada no runbook do PR 4):

1. **Conter:**
   - defeito em nova venda: o proprietário retira VENDAS dos estabelecimentos afetados no portal (a manutenção continua, seção 3.1);
   - defeito na manutenção ou nas vendas já gravadas: a orientação ao estabelecimento é não cancelar nem receber até a correção. Não há interruptor por rota.
2. **Preservar evidência:** um backup novo do piloto antes de qualquer correção. Nunca restaurar backup antigo sobre o piloto, porque apagaria vendas e recebimentos reais. Restauração só em descartável, para diagnóstico.
3. **Corrigir:** PR de correção a partir da integração, com o teste que reproduz o defeito, CI verde e publicação de API e web no mesmo SHA pelo runbook.
   - Se o defeito estiver no schema, migration NOVA, sem `down` e sem editar a 27 ou a 28.
   - Se houver dado errado, a correção é um lançamento, nunca edição: cancelamento ou estorno pelo fluxo, ou uma migration de dados revisada, com backup e conferência antes e depois.
4. **API nova não sobe ou falha** (manifesto, configuração, defeito): republicar o **último SHA comprovadamente compatível com o schema e os dados já existentes**, isto é, um SHA cujo manifesto aceita o banco atual e que passou pelo ensaio na cópia restaurada com os mesmos tipos de dado (vendas, recebimentos, concessões). Se não existir versão assim, manter a contenção e corrigir para frente. Nunca voltar automaticamente à API atual (anterior às vendas): ela só é candidata com a condição de retorno valendo **e** o ensaio aprovado.
5. **Registrar** no "Estado e retomada" o que foi contido, o backup e o SHA da correção.

Antes do preço definido, o adicional não pode ser contratado. A primeira ativação real é decisão do responsável, depois do H2. Roteiro: `docs/runbooks/publicacao-vendas-v1.md`, no PR 4.

## 6. PRs

| PR | Conteúdo | Depende | Testes |
|---|---|---|---|
| **1 — Plano** (este) | `docs/plans/vendas-v1.md` e referência no plano de expansão | — | nenhum |
| **2 — Schema e acesso** | Migrations 27 e 28, enums, manifesto, `ADDON_REQUIRES` e a recusa nos overrides (3.2), gate com lista de recursos e rotas de manutenção sem recurso (3.1), permissões `VENDAS_*` com dependências, recepcionista convidável e concedível em `team`, `sales-access.ts`, `USE_VENDAS` e `BAIXA_DE_VENDA` na movimentação, unificação movendo vendas | 1 | Specs das migrations e de `each`, `required-migrations`, `subscription.spec` (dependência, retirada, preço nulo nunca gratuito), `manager-permissions`, `sales-access.spec`, `staff-access`, `team`, `tenant-effective-access`; db-e2e: `sales-migrations` (banco novo, a partir de 26, modo `all` indevido, falha e retomada), gatilhos direto no banco (estorno manual com e sem `sale_id`, cancelamento legítimo, soma e cancelamento diferidos, lápide, só inserção), `stock-postgres` (`USE_VENDAS`), `consumer-merge` com vendas e corrida, `pilot-team-manager-check` e kits antigos |
| **3 — API de vendas e recebimentos** | `backend/src/sales/`: catálogo, busca limitada de cliente, criar, minhas operações, listar, detalhar, cancelar, receber, estornar, totais de recebimentos de vendas; `sale-math.ts`; compras na ficha | 2 | Unitários de cálculo (vetores), DTOs e impressão digital; `test/sales.e2e-spec.ts`; db-e2e `sales-postgres` (último saldo com duas conexões, tudo ou nada, preço, reenvio, cancelamento repetido, cancelar com recebimento, produto arquivado, isolamento) e `sales-access-postgres` (matriz, catálogo sem saldo numérico, busca sem e-mail e telefone inteiro, VENDAS retirado com manutenção ativa, ESTOQUE não retirável) |
| **4 — Web, navegador e runbook** | `vendas-api.ts`, `src/lib/vendas/` (cálculo com os mesmos vetores, carrinho, seleção de cliente só por toque), telas de Vendas, preço sugerido no produto, recepcionista em Equipe e acessos, menu (`VENDAS_NOVA` e `VENDAS_HISTORICO`), compras na ficha, rótulos de atendimentos no Início e em Recebimentos, aviso `USE_VENDAS`, guardas da demonstração; runbook com a contingência | 3 | `src/lib/vendas/*.test.ts`, `vendas-api.test.ts`, `navegacao.test.ts`, `papel.test.ts`; nova `test:browser:vendas` (dono, gerente, recepcionista, cliente ambíguo, sem saldo, cancelamento com senha, recebimento e estorno, VENDAS retirado com manutenção); `layout-temas` nas telas novas; `estoque` sem VENDAS; teste do Início com o rótulo novo |

- Integração com os PRs 2 e 3 mesclados não é publicada sozinha: a publicação funcional é o head do PR 4, com venda e recebimento juntos.
- Se outra publicação for necessária nesse intervalo, sai de um SHA anterior ao PR 2.

## 7. Pendências

Respondidas em 25/11/2026: recebimento sem consulta geral (só as próprias vendas, com `VENDAS_RECEBER`) e `VENDAS_ALTERAR_PRECO` concedível à recepcionista em separado.

- **Preço do adicional e primeira ativação real:** decisão do responsável. Até lá, VENDAS fica no catálogo sem preço e não contratável.
- **Teste instável `src/config/env.validation.spec.ts` (backend), fora deste lote:** o teste gera a chave VAPID com `createECDH` aleatório; quando a chave privada começa com o byte zero (cerca de 1 em 256), `getPrivateKey()` devolve 31 bytes e a validação recusa. Falhou assim no CI do PR 3 (`50805e2`, tentativa 1) e passou na reexecução. Correção em PR separado, sem mistura com as vendas.
- **Ensaio da API anterior em 28:** só a cópia restaurada prova que a API atual sobe com os valores novos de enum e com o adicional VENDAS no catálogo (o web anterior lê `addon_modules`). Se falhar, não há retorno à API anterior nem com a condição de retorno valendo: o retorno é só para frente desde a 28.

## 8. Estado e retomada

**26/11/2026, ajustes da revisão visual no #152, sem merge.**

- **Cliente cadastrado sem seleção:** o modo do cliente passou para a nova venda e a regra para `clienteDoPedido` (`src/lib/vendas/apresentacao.ts`). Com "Cliente cadastrado" marcado e nenhum resultado tocado, o resumo mostra "Selecione um cliente.", o botão fica desligado e `confirmar` não monta corpo (o envio não sai nem por clique forçado). Nenhum resultado é escolhido pela tela; venda sem cliente só com "Venda de balcão" marcada (o padrão da tela continua balcão marcado). "Trocar cliente" volta à busca, com o bloqueio.
- **Recusa desatualizada:** `descartarRecusa` (`src/lib/vendas/envio.ts`) apaga a mensagem da recusa definitiva quando produtos ou cliente mudam; a chave continua. Resultado desconhecido e envio em curso não são tocados (mesma chave, mesmo corpo, formulário travado).
- **Textos:** "Valor da venda", "Total da venda" e o subtítulo "Registre vendas de produtos e acompanhe os recebimentos."; a orientação de que confirmar baixa o estoque e o recebimento vem depois ficou.
- **Rolagem no celular:** sem obstrução real; o CSS não mudou. O cabeçalho é `sticky` e o menu inferior é `fixed`, com `pb-28` no conteúdo; nas capturas `fullPage` o Playwright desenha os dois sobre o conteúdo emendado, e é só isso. A suíte confere agora em 360×640 e 390×664 (área visível do navegador): seleção de cliente, resultado, "Confirmar venda" e "Estornar recebimento", rolados até o meio da tela, recebem o toque (`elementFromPoint`), e o fim do conteúdo fica pelo menos 16 px acima do menu.
- **Cobertura:** unitários de `clienteDoPedido` (sem seleção, seleção por ID, balcão explícito) e de `descartarRecusa`; no navegador, a tentativa sem seleção (botão desligado, clique forçado e Enter sem POST), a escolha pelo ID, "Trocar cliente", a troca explícita para balcão e a remoção do produto recusado (mensagem e aviso somem). Casos A, B e C sem mudança.
- **Capturas da área visível (sem fullPage):** `vendas-cliente-sem-selecao-390-visivel.png` e `vendas-detalhe-estornar-390-visivel.png`, no artefato `vendas-*` do run.
- **Validação local** (PostgreSQL 18 descartável com TLS, web e API compilados do head): `test:browser:vendas` com os quatro casos verdes; Vitest de `src/lib/vendas` (65); `eslint`, `lint:types`, `tsc`.
- **Próximo passo:** CI do novo head e decisão de merge pelo responsável.

**26/11/2026, lacunas do PR 4 completadas no #152, sem merge.** Pedidas na conferência antes do merge:

- **Três casos de navegador novos** em `tests/browser/vendas-flow.spec.ts`, cada um com o próprio estabelecimento, API real e PostgreSQL descartável:
  - **A** "venda gravada e recebimento que falha antes de chegar à API: a tela repete só o recebimento": a primeira tentativa de recebimento é abortada antes da API; a tela mantém a venda (a receber) e oferece só "Enviar de novo" do recebimento. Banco: uma venda, uma baixa por item (2), saldo descontado uma vez, um recebimento; um único POST de criação de venda;
  - **B** "resposta da criação da venda perdida depois de gravada": a criação vai à API real (`route.fetch`), a gravação é conferida no banco e só então a resposta é bloqueada. A repetição pela tela leva a mesma chave e o mesmo corpo e devolve a mesma venda (`created: false`), sem venda nem baixa duplicada;
  - **C** "resposta do recebimento perdida depois de gravado": o mesmo com o recebimento; mesmo recebimento, um só registro e uma só auditoria `SALE_PAYMENT_RECORDED`.
  - Nenhum caso revelou defeito de produto: o fluxo não mudou.
- **Duas capturas novas** no cenário existente: `vendas-detalhe-recebida-390.png` (detalhe do dono com recebimento ativo) e `vendas-recebimentos-de-vendas-1280.png` (aba Recebimentos de vendas com dois lançamentos e os totais R$ 75,00, R$ 50,00 e R$ 25,00). As anteriores foram mantidas.
- **Condição de retorno:** definição única na seção V3 do roteiro, com as sete contagens identificadas e a exigência do ensaio do par anterior; o plano (seções 5.7 e 7) remete a ela, sem a referência ambígua a três contagens.
- **Limpeza da suíte:** a suspensão dos gerentes passou para `test.afterEach`, restrita aos estabelecimentos criados pela própria suíte; vale também em falha ou tempo esgotado. Encerramento forçado do processo continua sem garantia de limpeza.
- **Validação local** (PostgreSQL 18 descartável com TLS; web do build anterior, que só difere no ícone do menu): `test:browser:vendas` com os quatro casos verdes (fluxo completo, A, B e C); nenhum gerente ativo no banco depois; `eslint`, `lint:types` e `tsc` do arquivo. Nenhuma outra suíte foi repetida (só o spec, a documentação e comentários do workflow mudaram).
- **Próximo passo:** CI do novo head e decisão de merge pelo responsável.

**26/11/2026, PR 4 aberto (#152: telas, navegador e roteiro), sem merge.** Branch `feat/vendas-web` (worktree `C:/wt/vendas-pr4`), a partir de `d836994` (#151 mesclado). A sessão anterior foi interrompida pelo limite de uso com todo o primeiro bloco sem commit; nada foi descartado, e o bloco foi commitado como estava (as validações relatadas valiam para aqueles arquivos).

- **Feito (commits `6229cf2` a `31879da`):**
  - vetores do arredondamento em `backend/src/sales/sale-math-vectors.json`, lidos pelo spec da API e por `src/lib/vendas/calculo.test.ts`;
  - `vendas-api.ts`, `src/lib/vendas/` (cálculo, carrinho, envio sem chave nova para resultado incerto, apresentação), telas de `/conta/vendas` (Nova venda, Minhas operações, Vendas, Recebimentos de vendas, detalhe com recebimento, estorno e cancelamento), compras na ficha, preço sugerido no produto, recepcionista em Equipe e acessos, menu pelas áreas (ícone próprio), rótulos "Recebido em atendimentos" e "Recebimentos de atendimentos";
  - estoque: baixa de venda com "Venda" e sem "Estornar"; textos próprios para `USE_VENDAS` e `BAIXA_DE_VENDA`, escolhidos pelo `code`;
  - `test:browser:vendas` (passo próprio no CI, com capturas), Vendas em `layout-temas`, `configuracoes-navegacao` com o rótulo novo;
  - roteiro `docs/runbooks/publicacao-vendas-v1.md` (seção 5.7 detalhada) e o lado web no mapa técnico.
- **Testes locais** (PostgreSQL 18 descartável com TLS, dados fictícios): web `tsc`, `lint`, `lint:types` e Vitest (135 arquivos, 1.295 testes); backend `sale-math.spec.ts` (21, sessão anterior, arquivos sem mudança depois); navegador `vendas`, `configuracoes-navegacao`, `layout-temas`, `estoque`, `equipe`, `gerente`, `acesso-usuario`, `recebimentos` e `clients`, todos verdes (antes do commit do ícone, que só troca o desenho do item no menu).
- **CI** (`test-frontend-auth.yml`; `test-migration-lote6b2.yml` não dispara, porque o PR não toca migrations, `database` nem `scripts`):
  - `b5b1eba`: cancelado pela execução seguinte;
  - `8f88058` (run 45807715584): verde, com a suíte de vendas e as capturas;
  - `f96bed3` (registro só documental; o filtro de caminho do PR olha o diff inteiro contra a base, então dispara): falha em `pilot-team-manager-check` na segunda passada do db-e2e, que roda **depois** das suítes de navegador no mesmo banco. O gerente deixado ativo por `test:browser:vendas` empurrou o estabelecimento da conferência para fora do levantamento limitado a 50. Corrigido em `31879da`: a suíte suspende o próprio gerente no fim, como as outras suítes desfazem o papel de gerente;
  - `31879da` (run 45814866342): verde.
- **Capturas** (dados fictícios, 1280 e 390 px; Vendas em escuro e azul pelo `layout-temas`): `%USERPROFILE%\AgendaCloud-operacoes\capturas-vendas-pr4-2026-11-26` (só neste computador; feitas antes do ícone próprio) e o artefato `vendas-*` do run.
- **Não feito (fora do PR 4, decisão do responsável):** preço do adicional e primeira ativação real; ensaio na cópia restaurada e publicação pelo roteiro.
- **Próximo passo:** revisão e merge do #152 com o CI verde no head final (este registro dispara o CI de novo); depois, a publicação pelo roteiro (backup, ensaio da seção V, 27 e 28 uma por vez, API e web no mesmo SHA).
- **Só neste computador:** a worktree `C:/wt/vendas-pr4`, as capturas e o cluster descartável da sessão (pasta temporária).

**25/11/2026, PR 3 aberto (API de vendas e recebimentos), sem merge.** Branch `feat/vendas-api` (worktree `C:/wt/vendas-pr3`), a partir de `420c904` (#150 mesclado).

- **Antes do merge do #150:** head `17d79ab` conferido, os dois workflows verdes e a cobertura pedida já existia em `test/sales-integrity-postgres.db-e2e-spec.ts`: `USE_VENDAS` com VENDAS e ESTOQUE ligados ("saída manual de venda com o adicional"), nova venda contra manutenção depois de desligar VENDAS ("gate: nova venda contra manutenção", dono e recepcionista, com as áreas da sessão). A exclusão de `feat_vendas` da fixture dos testes antigos é explícita em `test/support/plano-de-teste.ts` (`SEMPRE_FORA_DO_PLANO`, com o motivo). Sem mudança de código, a bateria não foi repetida.
- **Endpoints entregues** (`backend/src/sales/`, prefixo `tenants/:tenantId`):
  - nova venda (VENDAS e ESTOQUE, `VENDAS_REGISTRAR`): `GET sales/catalog`, `GET sales/consumers?q=`, `POST sales`;
  - manutenção (sem recurso, permissão da matriz): `GET sales?scope=mine|all`, `GET sales/:saleId`, `POST sales/:saleId/cancel`, `POST sales/:saleId/payments`, `GET sales/payments?scope=mine|all`, `POST sales/payments/:paymentId/refund`, `GET consumers/:consumerId/purchases`;
  - produto: `salePriceCents` em `POST`/`PATCH stock/products` e nas leituras. Omitido na edição mantém o preço; `null` tira; zero é recusado.
- **Idempotência:** venda pela chave com impressão digital (itens ordenados por produto); recebimento pela chave comparando venda, forma, data e observação (a tabela não tem impressão); cancelamento e estorno pelo estado: o mesmo motivo devolve o que está gravado, outro motivo recebe 409 `JA_CANCELADA`/`JA_ESTORNADO`. Nenhuma repetição cria lançamento.
- **Concorrência:** produtos travados por ordem de id; receber, estornar e cancelar travam a venda primeiro. Os gatilhos do PR 2 ficaram como estavam.
- **Testes locais** (PostgreSQL 18.6 descartável com TLS, dados fictícios): typecheck, lint, unitários (155 arquivos, 2.316 testes), e2e HTTP (19 arquivos, 216 testes), `sales-postgres` (22) e `sales-access-postgres` (10) novos, as dez rotas novas na guarda de isolamento HTTP (`isolamento-estabelecimentos-postgres`, com VENDAS ligado nos dois estabelecimentos; o caso da saída manual passou a `SAIDA_CONSUMO`, porque com VENDAS a `SAIDA_VENDA` manual responde `USE_VENDAS`) e a suíte db-e2e inteira num banco novo (47 arquivos, 535 testes).
- **Versões do PostgreSQL:** local 18.6; CI `postgres:17` (`test-frontend-auth.yml`); piloto 17 (Neon, pelos runbooks; não conferido nesta etapa, sem acesso ao banco real). O ensaio na cópia restaurada (seção 5.7) usa a versão do piloto.
- **CI no head `50805e2`:** `test-frontend-auth.yml` (run 45673708930), job "auth real e serviços reais (navegador + API) contra PostgreSQL descartável" em `postgres:17`:
  - tentativa 1: falha só em `src/config/env.validation.spec.ts`, o teste instável da chave VAPID (seção 7), sem relação com as vendas;
  - reexecução apenas do job que falhou (`rerun-failed-jobs`), sem mudança de código: tentativa 2 verde, com unitários, e2e, db-e2e e navegador;
  - `test-migration-lote6b2.yml` não dispara (o PR 3 não toca migrations, `database` nem `scripts`).
- **Repetição de cancelamento e estorno:** pelo ID da venda ou do recebimento e pelo motivo, sem novo lançamento, com acesso e senha recente conferidos antes de devolver o registro anterior (seção 5.3).
- **Não feito (PR 4):** telas, `vendas-api.ts`, cálculo do web com os mesmos vetores de `sale-math.spec.ts`, rótulos das permissões e ações de auditoria no portal, rótulo "Recebido em atendimentos" no Início, runbook. Preço do adicional e primeira ativação continuam com o responsável.
- **Próximo passo:** merge do #151 (este registro é só documental e não dispara workflow; o CI verde de `50805e2` vale para o código) e o PR 4 a partir da integração com o PR 3 mesclado.
- **Só neste computador:** a worktree `C:/wt/vendas-pr3`.

**25/11/2026, PR 2 aberto (schema, integridade e acesso), sem merge.** Branch `feat/vendas-schema-acesso` (worktree `C:/wt/vendas-pr2`), a partir de `8ea862f` (#149 mesclado).

- **Feito:**
  - migrations 27 `SalesEnumValues1794528000000` e 28 `SalesModule1794614400000` (seção 5.6), manifesto com 28;
  - gate com lista de recursos, `sales/sales-access.ts`, seis `VENDAS_*`, recepcionista criável em Equipe e acessos (sem profissional, vaga normal), áreas da sessão (nova venda e manutenção), `ADDON_REQUIRES`, `USE_VENDAS` e `BAIXA_DE_VENDA` no estoque, unificação com vendas;
  - testes locais em PostgreSQL 18 descartável com TLS: unitários, e2e HTTP, `sales-migrations` e `sales-integrity-postgres` novos e a suíte db-e2e inteira num banco novo (45 arquivos, 503 testes).
- **Diferença em relação à seção 3.2:** não existe rota de override de recurso fora da assinatura; a recusa `MODULO_DEPENDENTE` fica só em `quoteSubscription`, e o gate exige os dois recursos na nova venda.
- **Não feito (PR 3 e 4):** rotas de venda e recebimento, preço sugerido na API do produto, telas, rótulos das permissões novas no portal, runbook. O preço do adicional e a primeira ativação continuam com o responsável.
- **Próximo passo:** revisão do PR 2 e CI verde no head; depois o PR 3 a partir da integração com o PR 2 mesclado.
- **Só neste computador:** a worktree `C:/wt/vendas-pr2` e o cluster descartável da sessão (pasta temporária).

**25/11/2026, terceira versão:** recebimento e preço confirmados (seção 3), retorno pelo último SHA comprovadamente compatível e as duas validações separadas (seção 5.7). Plano aprovado; o PR 2 começa a partir da integração com este plano mesclado.

**25/11/2026, segunda versão:** decisões de recepcionista, catálogo, clientes, recebimentos e comercial incorporadas, com manutenção sem o adicional, bloqueio da retirada do ESTOQUE, contingência e commit entre 27 e 28. Ainda sem código.

- **CI:** os dois workflows filtram por caminho (`test-frontend-auth.yml`: `src/**`, `backend/src/**` e outros; `test-migration-lote6b2.yml`: migrations, database, scripts). Um PR só com `docs/**` não dispara nenhum, e nenhuma suíte foi rodada.
- **Próximo passo:** o responsável aprova o plano e responde as pendências da seção 7. Depois, o PR 2 numa branch nova a partir da integração.
- **Só neste computador:** a worktree `C:/wt/plano-vendas`.
