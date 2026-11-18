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
- Visual (18/11/2026): seguir as três referências originais (Produtos, Categorias e Conferência), com Movimentações na mesma linguagem. O responsável descartou depois uma versão simplificada. As telas:
  - **Produtos:** trilha "Estoque / Produtos", cartões de resumo, busca e filtros de categoria e subcategoria, abas Ativos e Arquivados, "Somente estoque baixo" e uma tabela com saldo, mínimo e situação. O estoque baixo destaca a linha, e as ações ficam no menu "…".
  - **Categorias:** árvore com busca e "Mostrar arquivadas" ao lado do detalhe da categoria escolhida, que mostra as subcategorias (opcionais) e os produtos dela com o saldo.
  - **Movimentações:** tabela com tipo, quantidade com sinal e saldo antes → depois. O formulário mostra o saldo atual e o saldo depois, e o estorno abre numa janela com o motivo.
  - **Conferência:** etapas Contar, Revisar e Confirmar. A tela diz em cada etapa que nenhum saldo muda antes da confirmação, e a etapa Confirmar lista o saldo antes e depois de cada ajuste.
  - **Diferenças em relação às referências:**
    - o motivo dos ajustes continua opcional, como na API;
    - os cartões reutilizam o componente de indicador existente;
    - o menu lateral e as cores são os de cada tema.

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

**18/11/2026, noite: publicado e liberado.**

- **Merge:** PR #127 como `0dedc35`. CI verde no head `21759b4`, com a mesma árvore.
- **Backups:**
  - `pre-mig21-20-backup-2026-11-18T20-46-56Z`, usado nos ensaios;
  - `pre-mig21-20-backup-2026-11-18T21-28-01Z`, feito logo antes das migrations.
  - Os dois foram restaurados no PostgreSQL 17 local com TLS, com hash igual nas 54 tabelas.
- **Ensaios na cópia:**
  - migrations 21 e 22 aplicadas uma por vez (`aplicarSomenteAPendente`);
  - janelas 1a, 1b, 2 e 3 do H0 verdes, com as suítes gerente, equipe, agendamento público, administração e agenda (e estoque na janela 3);
  - únicas falhas esperadas: o teste antigo que afirma o ESTOQUE como "futuro", e o limite de aceites (429) quando várias suítes usaram a mesma API, resolvido reiniciando a API;
  - H3 passou com ressalva (runbook, seção H3).
- **Piloto:**
  - 21 aplicada às 21:28 UTC e 22 às 21:29 UTC;
  - API `dep-dbv1hf15efls73cv9080` e web `dep-dbv1io6k1f9s73b4speg`, os dois em `0dedc35`;
  - log "22 de 22".
- **H2:**
  - 22 migrations, e o ESTOQUE `AVAILABLE` com nome, descrição e preço ("a definir") iguais aos do backup;
  - `0 | 0 | 0 | 0`;
  - `/health` 200; estoque sem sessão 401; `/conta/estoque/produtos` e `/login` 200; agendamento público 200 em dois estabelecimentos.
  - Um terceiro estabelecimento, ativo e sem serviços nem profissionais, responde 404, como antes. A release não toca o agendamento público.
- **Limite do retorno:** seguro enquanto a última consulta da H2 der `0 | 0 | 0 | 0`. Depois da primeira contratação ou concessão, o retorno é possível com a ressalva do H3.
- **Próximo passo:** o roteiro curto de teste do runbook, a começar pelo preço do Controle de estoque, que está "a definir".
- **Só neste computador:**
  - os backups e as capturas em `%USERPROFILE%\AgendaCloud-operacoes`;
  - os clusters descartáveis (pastas temporárias das sessões);
  - a cópia do trabalho visual anterior à retomada (`C:/wt/_backups/estoque-visual-wip-20261118T195755Z`).

**18/11/2026 (fim da tarde, depois da queda de energia):**

- **Feito:**
  - PR #127 aberto; CI verde em `e2b6f4f` (os dois workflows);
  - ajuste visual das quatro telas pelas três referências originais (seção 1, "Visual"). Validado localmente com `test:browser:estoque`, `test:browser:layout-temas`, a suíte web inteira, lint e build. Capturas com dados fictícios nos quatro temas, em computador e celular: `%USERPROFILE%\AgendaCloud-operacoes\capturas-estoque-2026-11-18` (só neste computador).
- **Piloto e Render** (conferido só por leitura): API e web em `208d7ee`, banco com 20 migrations pelo registro de operações. A publicação do estoque não começou, e não há backup `pre-mig21`.
- **Ainda não feito:**
  - CI verde no commit final;
  - merge;
  - publicação pelo runbook: backup, restauração, ensaios das janelas H0 e do H3, migrations 21 e 22 no piloto, API e web no mesmo SHA, liberação.
- **Próximo passo:** acompanhar os dois workflows no head do PR. Com CI verde, merge e depois a seção H do runbook.
- **Só neste computador:** o PostgreSQL descartável (pasta temporária da sessão), as capturas e a cópia do trabalho visual feita antes da retomada (`C:/wt/_backups/estoque-visual-wip-20261118T195755Z`).
