# Estoque v1 (adicional ESTOQUE)

Branch `feat/estoque-v1` (worktree `C:/wt/estoque`), a partir de `208d7ee`. Plano aprovado pelo responsável em 18/11/2026, depois de duas revisões (transação das migrations, FK da categoria, reenvio com impressão digital, conferência por unidade e compatibilidade de publicação).

## 1. Decisões do responsável (18/11/2026)

- Estoque de produtos vendidos e de materiais de consumo interno. Movimentações só manuais, sem lote nem validade.
- Fica em `/conta`, na seção "Estoque": Produtos, Categorias, Movimentações e Conferência de estoque. Mesma estrutura nos quatro temas, em computador e celular.
- Acesso:
  - o dono acessa sempre;
  - o gerente só com concessão do dono em "Equipe e acessos": "Ver estoque" (`ESTOQUE_VISUALIZAR`) e "Operar estoque" (`ESTOQUE_GERENCIAR`), e operar inclui ver;
  - funcionário e recepcionista nunca acessam;
  - papel de plataforma sem vínculo não opera estoque de ninguém.
- Todas as permissões dependem do adicional ESTOQUE contratado. Sem ele, a concessão é recusada, e uma concessão já gravada fica guardada sem efeito até a recontratação.
- O adicional ESTOQUE é o que já existia no catálogo. Nome, descrição e preço são preservados, e nenhum estabelecimento é ligado automaticamente.
- O adicional fica contratável na mesma publicação. O estoque só é considerado liberado depois de API e web confirmados e das verificações finais (runbook, seção H2).
- Fora do escopo: PDV, recebimentos, comissão sobre produto, nota fiscal e integração financeira. "Saída por venda" é só estoque.

## 2. Regras

- **Unidades:**
  - `UN`, `CX`, `PCT`, `FR`, `G` e `ML` só aceitam inteiros; `KG` e `L` aceitam até 3 casas.
  - Não há conversão entre unidades.
  - A unidade só muda antes da primeira movimentação.
- **Quantidades:**
  - Gravadas como inteiros em milésimos (`*_milli bigint`).
  - Limites: 1.000.000 por movimentação e saldo até 1.000.000.000.
  - O banco confere as casas pela unidade.
- **Saldo negativo bloqueado:** a API responde 409 `SALDO_INSUFICIENTE`, e `CHECK balance_milli >= 0` é a garantia final.
- **Movimentações:**
  - Tipos:
    - saldo inicial (nasce com o produto);
    - entrada por compra ou reposição;
    - saída por venda, consumo interno ou perda;
    - ajuste de conferência;
    - estorno.
  - Venda só para produto de venda; consumo só para consumo interno.
  - Motivo obrigatório em perda, ajuste e estorno.
  - A data é a hora do servidor.
  - O histórico é só de inserção (gatilho no banco).
  - Estorno: uma vez por lançamento, com motivo. Não se aplica a ajuste nem a outro estorno.
- **Categorias:**
  - Um nível de subcategoria.
  - Nome único sem diferenciar maiúsculas.
  - Arquivar com produto ativo vinculado recebe 409 `CATEGORIA_COM_PRODUTOS`. Arquivar a categoria arquiva as subcategorias dela.
  - Produto só se liga a categoria e subcategoria ativas, e a subcategoria precisa ser da categoria escolhida. A API confere e o banco garante, com as FKs `fk_stock_products_category` e `fk_stock_products_subcategory`.
- **Produtos:**
  - Arquivar preserva saldo e histórico.
  - Produto arquivado não recebe movimentação e não entra na conferência.
  - O código interno é único por estabelecimento.
- **Reenvio:**
  - Toda criação leva `requestKey` e uma impressão digital dos dados normalizados.
  - Mesma chave com os mesmos dados devolve o original; com outros dados, 409 `CHAVE_REUTILIZADA`, sem gravar.
  - Acesso e estabelecimento são conferidos antes, inclusive no reenvio.
- **Conferência:**
  - Até 200 itens, tudo ou nada.
  - Cada item leva a versão do saldo e a unidade que a pessoa viu. Se mudou, a API responde 409 `CONFERENCIA_DESATUALIZADA` com o estado atual, e nada é gravado.
  - O rascunho fica no `sessionStorage`, isolado por usuário e estabelecimento. É apagado em quatro casos: ao trocar de contexto, no logout, sem permissão de operar e depois de confirmar.
- **Auditoria:** `STOCK_CATEGORY_CHANGED` e `STOCK_PRODUCT_CHANGED` para o cadastro. As movimentações são o próprio histórico.

## 3. Migrations

- **21 `StockEnumValues1794009600000`:** só `ADD VALUE`:
  - `feature_key.ESTOQUE`;
  - `permission.ESTOQUE_VISUALIZAR` e `permission.ESTOQUE_GERENCIAR`;
  - `audit_action.STOCK_CATEGORY_CHANGED` e `audit_action.STOCK_PRODUCT_CHANGED`.
- **22 `StockModule1794096000000`:**
  - Confere primeiro que os valores da 21 estão confirmados. Se não estiverem, falha com mensagem clara e não grava nada.
  - Cria as seis tabelas e o gatilho do histórico.
  - Insere `features.feat_estoque`.
  - Muda só `feature_key` e `availability` do ESTOQUE, que passa a `AVAILABLE`.
  - Não grava em `plan_features` nem em overrides.
  - O `down` recusa se houver qualquer dado, contratação, concessão ou histórico.
- **Transação:** o DataSource de migrations usa `migrationsTransactionMode: 'each'` (CLI do CI e do banco descartável). No piloto, `scripts/operacao-piloto.mjs` aplica uma por execução.
- **Prontidão:** a API nova exige as 22 e recusa subir com o banco em 21. A API `208d7ee` (manifesto de 20) deve subir em 21 e em 22, o que ainda precisa ser provado no ensaio do runbook.

## 4. Testes

- **Backend unitários:** acesso, quantidade, impressão digital, DTOs, migrations 21 e 22, DataSource `each`, enums e listas de migrations.
- **HTTP:** `test/stock.e2e-spec.ts`.
- **Banco:**
  - `test/stock-postgres.db-e2e-spec.ts`: regras, FKs direto no banco, concorrência, reenvio e conferência;
  - `test/stock-access-postgres.db-e2e-spec.ts`: isolamento, papéis, plataforma, sem adicional, concessão e retirada/recontratação pela assinatura real;
  - `test/stock-migrations.db-e2e-spec.ts`: banco novo, atualização a partir das 20, falha seguida de retomada e modo `all` indevido;
  - `schema-readiness`: o caso 21/22.
- **Web:** `src/lib/estoque/*.test.ts`, `src/lib/api/estoque-api.test.ts`, `navegacao.test.ts` e `papel.test.ts`.
- **Navegador:**
  - `test:browser:estoque`: contratação no portal, fluxo do dono, gerente, funcionário, retirada e recontratação, rascunho apagado no logout e menu no celular;
  - `test:browser:layout-temas`: as quatro páginas nos quatro temas, 1280 e 390 px.

## 5. Publicação

Roteiro, intervalos, falhas, liberação e limite do retorno: `docs/runbooks/publicacao-estoque-v1.md`.

## 6. Estado e retomada

Atualizado a cada checkpoint (abaixo).

**18/11/2026:**

- **Feito:** backend, migrations, web, testes, documentação e CI local.
- **Ainda não feito:**
  - PR e CI no GitHub;
  - merge;
  - publicação: backup, ensaio e janelas H0, migrations no piloto, API e web, liberação.
- **Próximo passo:** abrir o PR para `integration/nestjs-typeorm-frontend` e acompanhar os dois workflows.
- **Só neste computador:** o PostgreSQL descartável da sessão (pasta temporária) e as capturas locais. Nada a recuperar.
