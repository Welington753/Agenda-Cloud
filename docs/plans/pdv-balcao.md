# Plano complementar: PDV do Balcão

Data: 26/11/2026, revisão 2. Situação: decisões de negócio aprovadas em 26/11/2026. Nada foi implementado, migrado ou publicado.

Complementa `docs/plans/permissoes-individuais.md`. As permissões, o caixa e a lista "A receber" estão lá; este plano trata do que acontece dentro do Balcão.

Protótipo: `AgendaCloud-operacoes/prototipos/pdv-nova-venda/index.html`, fora do repositório. Ele simula as telas; onde diverge deste plano, vale o plano (seção 8).

Código inspecionado: árvore `4e0d841` (igual a `8f71335`, o que está no piloto).

## 1. Decisões aprovadas (26/11/2026, não reabrir)

- **Venda digitada:** um valor, com descrição e cliente opcionais, sem estoque, separada da venda de produtos (nunca na mesma venda). Permissão própria, `VENDAS_DIGITAR`, sem limite de valor nesta versão.
- **Venda em espera:** venda digitada e venda de produtos podem ficar em espera.
  - Cada pessoa vê as próprias esperas; o dono vê todas. Retomar a espera de outra pessoa exige permissão específica (`VENDAS_ESPERA_OUTRAS`), que também permite vê-las.
  - As esperas ficam no servidor, sem expiração automática nesta versão, com data e opção de descarte.
  - A espera não reserva estoque.
  - Ao retomar: os preços sugeridos são atualizados e a tela informa cada mudança. Preços manuais dependem da permissão atual de quem retoma e de nova autorização quando exigida. Saldo e disponibilidade são revalidados antes da confirmação.
- **"Disponível no PDV"** é uma marcação separada de arquivar. Produto pausado bloqueia nova confirmação, inclusive vinda de um carrinho antigo ou de uma espera.
- **Produto sem preço sugerido continua aparecendo;** só quem pode informar preço consegue vendê-lo (regra atual).
- **Troco:** valor entregue e troco são gravados no recebimento em dinheiro. A gaveta aumenta pelo valor do recebimento, que é o entregue menos o troco.
- **Categorias e subcategorias** em ordem alfabética, com busca.
- **Pagamento parcial ou dividido fica fora desta versão.** Continua um recebimento integral por venda.

## 2. O que existe hoje

- **Catálogo do Balcão** (`SalesService.catalog`):
  - mostra o produto não arquivado, com `purpose` VENDA ou AMBOS e com categoria e subcategoria não arquivadas;
  - aceita produto sem preço sugerido, vendável só com `VENDAS_ALTERAR_PRECO`;
  - mostra "disponível" quando o saldo é maior que zero, e o saldo numérico só para quem consulta o estoque;
  - busca só por nome, ordenada por nome. Não há filtro por categoria.
- **Categorias:** `stock_categories` e `stock_subcategories` já existem, cada subcategoria presa a uma categoria. O produto tem `category_id NOT NULL` e `subcategory_id NULL`. As três tabelas têm `archived_at`.
- **Venda:**
  - `sale_items` exige produto (`product_id NOT NULL`) e um movimento de estoque por item (`stock_movement_id NOT NULL`);
  - o gatilho adiado `sales_consistency` confere no commit que a soma dos itens é o total, que há pelo menos um item, uma baixa por item e, na venda cancelada, um estorno por item;
  - `uq_sale_items_product` impede o mesmo produto duas vezes na venda.
- **Recebimento:** um recebimento ativo por venda (`uq_sale_payments_active`), com valor igual ao total (`sale_payments_guard`). Não há troco gravado.
- **Contrato com o web atual:** `src/lib/api/vendas-api.ts` valida `productId` como texto em cada item. Um item sem produto quebra a leitura da venda pelo web atual (importa para o retorno, seção 6).

## 3. Itens

### 3.1 Categorias e subcategorias no Balcão

- **Esquema:** já existe, sem migration.
- **API:**
  - o catálogo aceita `categoryId` e `subcategoryId` opcionais, além da busca por nome;
  - rota nova com as categorias e subcategorias que têm pelo menos um produto visível no Balcão, com a mesma regra do catálogo, para nunca mostrar filtro vazio;
  - produto sem subcategoria aparece no filtro da categoria e em "Sem subcategoria".
- **Ordem:** alfabética.
- **Permissão:** ver o filtro vem com VENDAS_REGISTRAR. Cadastrar categorias continua com a permissão de produtos do estoque.

### 3.2 Produto disponível no PDV

- Coluna `stock_products.pdv_available boolean NOT NULL DEFAULT true`: nenhum produto some do Balcão na migração.
- O catálogo filtra por ela. A confirmação da venda (inclusive a partir de espera) recusa um produto pausado com código próprio, `PRODUTO_PAUSADO_NO_PDV`, para a tela explicar.
- Pausar não arquiva: o produto continua no estoque, nas movimentações e nas conferências.
- Editar a marcação usa a permissão de produtos do estoque.

### 3.3 Venda digitada

- **Permissão:** VENDAS_DIGITAR, com dependência técnica em VENDAS_REGISTRAR. Entra no enum pela migration do PDV.
- **Recurso:** o mesmo da nova venda, VENDAS e ESTOQUE, para não criar um segundo gate.
- **Venda:** coluna `sales.kind varchar(10) NOT NULL DEFAULT 'PRODUTOS'`, com CHECK em PRODUTOS ou DIGITADA. Uma venda DIGITADA tem exatamente uma linha.
- **Linha:** coluna `sale_items.kind` com o mesmo domínio. Na linha DIGITADA, `product_id`, `stock_movement_id` e `suggested_price_cents` ficam NULL, a descrição vai em `product_name` (até 80 caracteres; sem descrição, "Venda digitada"), com quantidade 1 e unidade UN, para manter as constraints atuais de linha. Um CHECK amarra cada tipo às colunas dele.
- **Gatilhos:**
  - `sale_items_movement` confere só as linhas PRODUTO;
  - `sales_consistency` mantém as regras atuais na venda PRODUTOS; na venda DIGITADA, exige exatamente uma linha DIGITADA e nenhum movimento de estoque, ativa ou cancelada;
  - o tipo da linha precisa ser o da venda.
- **Cancelamento e recebimento:** iguais aos atuais. Uma venda digitada não gera estorno de estoque.
- **Contrato da API:** `productId` passa a aceitar nulo, com `kind` na venda e no item.
- **Repetição:** a chave de pedido da venda continua valendo.

### 3.4 Venda em espera

- **Tabela `sale_drafts`:**
  - `tenant_id`, `id`, `number` (sequência por estabelecimento, para "Espera 3"), `kind` (PRODUTOS ou DIGITADA), `created_by_membership_id`, `consumer_id NULL`, `created_at`, `updated_at` e `request_key`, com UNIQUE `(created_by_membership_id, request_key)`;
  - na espera digitada: `description` e `amount_cents`.
- **Tabela `sale_draft_lines`** (espera de produtos): `product_id`, `quantity_milli`, posição e `manual_price_cents NULL` (preço digitado, nunca o sugerido).
- **Não é venda:** sem número de venda, sem movimento de estoque, sem reserva, fora do caixa, dos relatórios e das comissões. Sem expiração automática.
- **Alcance:** lista, retomada e descarte das próprias esperas com VENDAS_REGISTRAR (ou VENDAS_DIGITAR, na espera digitada); o dono vê todas; outras pessoas com VENDAS_ESPERA_OUTRAS. Fora do alcance, 404.
- **Retomar:**
  - devolve as linhas com o preço sugerido atual de cada produto e a lista de mudanças desde a espera (preço sugerido alterado, produto pausado, arquivado ou sem saldo);
  - um preço manual guardado só volta ao carrinho se quem retoma pode alterar preço agora; com a ação em "com autorização", a autorização é pedida de novo na confirmação. Uma autorização dada antes da espera nunca é reaproveitada;
  - a espera continua gravada até a confirmação ou o descarte.
- **Confirmar a partir da espera:**
  - a rota da venda recebe `draftId`;
  - na mesma transação: trava a espera com `FOR UPDATE`, confere o alcance, revalida saldo, disponibilidade no PDV e preços pelo caminho atual da venda, grava a venda e apaga a espera;
  - repetição: a chave de pedido da venda devolve a venda já gravada; outra chave encontra a espera apagada e recebe 404 `ESPERA_NAO_ENCONTRADA`;
  - duas pessoas confirmando a mesma espera: a trava garante uma venda só.
- **Descartar:** apaga a espera, com a mesma regra de alcance, e registra em `audit_logs` quem descartou a espera de quem.
- **Cliente:** a espera guarda só a referência. A unificação de clientes leva as esperas do secundário para o principal, como faz com as vendas.

### 3.5 Troco

- Coluna `sale_payments.tendered_cents bigint NULL`.
- CHECK: NULL, ou forma DINHEIRO com valor entregue maior ou igual ao valor do recebimento e dentro do teto.
- O troco não é gravado à parte: é sempre entregue menos valor, calculado na leitura.
- O gatilho de imutabilidade passa a cobrir a coluna.
- No caixa (plano de permissões), a gaveta aumenta pelo valor do recebimento; o troco nunca é um movimento. O estorno devolve o valor do recebimento, não o entregue.
- A tela exige o valor entregue na forma Dinheiro e recusa valor menor que o total.

## 4. Permissões usadas

Todas vêm do plano de permissões:

| Ação | Permissão |
|---|---|
| Ver o Balcão e os filtros, vender produtos, guardar e retomar a própria espera de produtos | VENDAS_REGISTRAR |
| Venda digitada e a própria espera digitada | VENDAS_DIGITAR |
| Preço diferente do sugerido, inclusive na retomada | VENDAS_ALTERAR_PRECO, com três níveis |
| Ver e retomar a espera de outra pessoa | VENDAS_ESPERA_OUTRAS (o dono sempre) |
| Receber no Balcão | VENDAS_RECEBER ou VENDAS_RECEBER_OUTRAS, e caixa aberto se o controle estiver ativo |
| Pausar produto no PDV e cadastrar categorias | permissão de produtos do estoque |

Nenhum item do PDV exige o controle de caixa.

## 5. Fora desta versão

- **Pagamento parcial ou dividido.** Se entrar no futuro, muda o gatilho `sale_payments_guard` e o índice `uq_sale_payments_active`; a venda ganha saldo a receber; o cancelamento exige estornar todas as partes; cada parte tem o próprio vínculo de caixa; e a publicação seria só para frente desde o primeiro recebimento parcial. Exigiria plano próprio.
- Expiração automática de esperas, reserva de estoque, limite de valor na venda digitada e ordem manual de categorias.

## 6. Migration e retorno

- **Migration do PDV,** separada das migrations do plano de permissões e só aditiva:
  - enum: VENDAS_DIGITAR e VENDAS_ESPERA_OUTRAS, numa migration própria;
  - `sales.kind`, `sale_items.kind`, as colunas que passam a aceitar NULL, os CHECKs e os gatilhos reescritos;
  - `sale_drafts` e `sale_draft_lines`;
  - `stock_products.pdv_available` e `sale_payments.tendered_cents`.
- **Ensaio:** igual ao de Vendas, com as janelas do par anterior. O par anterior precisa ler as vendas antigas sem mudança.
- **Retorno ao par anterior** somente com todas estas contagens em zero:

| Contagem | Por quê |
|---|---|
| vendas com `kind = 'DIGITADA'` | O web anterior valida `productId` como texto e quebra ao abrir a venda. |
| `sale_drafts` | O par anterior não mostra as esperas, e os carrinhos guardados se perderiam. |
| `stock_products` com `pdv_available = false` | A API anterior volta a vender o produto pausado. |
| `sale_payments` com `tendered_cents` preenchido | O par anterior não mostra entregue e troco. |
| linhas com VENDAS_DIGITAR ou VENDAS_ESPERA_OUTRAS | O par anterior não conhece esses valores. |

- Com qualquer contagem acima de zero, a publicação é só para frente. Nunca se usa `down` e nunca se restaura backup antigo sobre o piloto.

## 7. Etapas

| Etapa | Depende de |
|---|---|
| P1. Filtro por categoria e subcategoria, com busca | Nada; não usa permissão nova nem migration. |
| P2. Migration do PDV (seção 6), com ensaio | Etapa 2 do plano de permissões publicada (migrations em ordem). |
| P3. Disponível no PDV e troco gravado | P2. |
| P4. Venda digitada | P2 e a etapa 3 do plano de permissões (matriz nova). |
| P5. Venda em espera | P4 (a espera digitada usa a venda digitada) e a etapa 4 do plano de permissões (nova autorização de preço na retomada). |

Cada etapa tem PR próprio, com spec das funções puras, `db-e2e` para gatilhos, travas e repetição (confirmação simultânea da mesma espera, venda digitada cancelada, produto pausado em carrinho antigo), `test/sales.e2e-spec.ts` para as rotas e a suíte de navegador de vendas.

## 8. Diferenças do protótipo

O protótipo não foi alterado.

- A lista de esperas não distingue as próprias, as de outras pessoas e a visão do dono.
- A retomada não lista as mudanças de preço e disponibilidade.
- A venda digitada aparece só com descrição e valor, sem cliente opcional e sem espera.
