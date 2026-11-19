# Publicação do Estoque v1 (migrations 21 e 22, API e web)

Plano do lote: `docs/plans/estoque-v1.md`. Este roteiro não contém nenhuma credencial nem URL de banco. Os valores reais ficam com quem opera, fora do repositório e fora de conversa.

O estoque só é declarado **liberado** depois da seção H2. Até lá, **ninguém contrata o ESTOQUE** no portal. O proprietário da plataforma é o único que contrata, então isso é uma regra de operação.

## H. Sequência

1. **Conferir o ambiente:**
   - API e web live em `208d7ee` (`render deploys list <serviço> -o json --confirm`).
   - `/health` responde.
   - Banco com 20 migrations, lido só com consulta de leitura em `typeorm_migrations`. Nunca usar `migration:show`, porque ele escreve.
   - Se algo divergir, parar.
2. **Backup novo** `pre-mig21-20-backup-<data>` em `%USERPROFILE%\AgendaCloud-operacoes`. Usar `SET TIME ZONE 'UTC'` nas duas pontas e CA em PEM (no Windows, `sslrootcert=system` falha).
3. **Restauração validada** num cluster descartável com TLS, com hash por tabela igual ao original.
4. **Ensaio na cópia restaurada:**
   1. `aplicarSomenteAPendente` (`backend/scripts/operacao-piloto.mjs`) com `esperadasAntes` = as 20, `pendente` = `StockEnumValues1794009600000` e `posteriores` = `["StockModule1794096000000"]`. Conferir: 21 registradas e os cinco valores de enum presentes.
   2. A mesma função com `esperadasAntes` = as 21 e `pendente` = `StockModule1794096000000`. Conferir:
      - 22 registradas;
      - consultas da seção H2;
      - nome, descrição e preço do ESTOQUE iguais aos do backup.
   3. Rodar as janelas da seção H0, com verificação por navegador.
   4. Fazer o ensaio pós-uso da seção H3.
5. **Piloto:** repetir os passos 4.1 e 4.2 contra o banco do piloto, conferindo depois de cada um.
6. **Publicar a API** no SHA do merge e esperar o log "22 de 22" e o `/health`. Depois, **publicar o web** no mesmo SHA.
7. **Seção H2.** Se tudo passar, declarar a liberação.
8. **Registrar:**
   - SHAs, ids de deploy e estado do banco;
   - o limite de retorno da seção H3 que valeu;
   - "Estado e retomada" do plano e memória.

## H0. Intervalos entre migration, API e web

| Janela | Banco | API | Web | Situação |
|---|---|---|---|---|
| 1a | 21 | `208d7ee` | `208d7ee` | Só valores de enum novos, sem uso. |
| 1b | 22 | `208d7ee` | `208d7ee` | A API antiga ignora as tabelas novas. O portal antigo já mostra ESTOQUE contratável: **não contratar**. |
| 2 | 22 | nova | `208d7ee` | Nenhum estabelecimento tem o recurso: sessões sem área nova e catálogo do gerente com o estoque não concedível (`grantable:false`). |
| 3 | 22 | nova | nova | Final. Liberação só depois da seção H2. |

**Por que é compatível:**

- O web `208d7ee` valida o catálogo de permissões só pelos tipos dos campos (`src/lib/equipe/contratos.ts`).
- Ele agrupa as áreas pelo que a API manda.
- Aceita qualquer `featureKey` de adicional.
- Lê `areas` como lista de textos.

Isso precisa ser **provado** no ensaio: login de dono e de gerente, agenda, "Equipe e acessos" (abrir e salvar uma concessão existente), portal "Plano e adicionais" e agendamento público, em cada janela.

**Se a janela 2 falhar no ensaio:** parar antes de mudar qualquer coisa no piloto e escolher com o responsável entre:

- **(a) corrigir a compatibilidade na API nova** (por exemplo, só listar as permissões de estoque quando o estabelecimento tem o recurso), com novo PR e novo ensaio;
- **(b) janela de manutenção controlada:**
  - horário de pouco uso combinado e aviso aos donos;
  - começa no deploy da API e termina com o web live e verificado;
  - se o web falhar dentro dela, a API volta para `208d7ee`.

## H1. Se algo falhar

- **Migration 21 falha:** a transação é desfeita e o banco continua em 20. Nada segue.
- **Migration 22 falha:**
  - Ela é desfeita sozinha, e o banco fica em 21.
  - API e web continuam em `208d7ee`, que roda em 21 (provado no ensaio).
  - A API nova **não** pode ser publicada, porque recusa subir em 21.
  - Corrigir num PR novo, ensaiar de novo e reaplicar só a 22.
- **Deploy da API falha:**
  - O Render mantém `208d7ee` no ar (roda em 22, ensaiado).
  - Não publicar o web.
  - Conferir a versão live e o `/health`.
  - Não liberar e não contratar.
- **Deploy do web falha:**
  - Fica a janela 2 (ensaiada).
  - Se não resolver numa tentativa, voltar a API para `208d7ee`, deixando o par antigo em 22.
- **Verificação de H2 falha:**
  - Não liberar.
  - Se afetar agendamento, login ou portal: API e web voltam para `208d7ee`.
  - Se for só o estoque: ficam no ar sem contratação até a correção.
- **Schema:** nunca há `down` das migrations 21 e 22 no piloto. A correção é sempre para frente.

## H2. Liberação

1. API e web live no mesmo SHA do merge.
2. `/health` responde, e o log da API mostra "22 de 22".
3. Consultas só de leitura no piloto:

```sql
SELECT count(*) FROM typeorm_migrations;                       -- 22
SELECT name FROM typeorm_migrations ORDER BY id DESC LIMIT 2;  -- StockModule…, StockEnumValues…
SELECT code, name, description, feature_key, availability
  FROM addon_modules WHERE code = 'ESTOQUE';                   -- ESTOQUE | (igual ao backup) | ESTOQUE | AVAILABLE
SELECT amount_cents FROM addon_module_prices WHERE module_code = 'ESTOQUE'
  ORDER BY recorded_at DESC, id DESC LIMIT 1;                  -- igual ao backup (ou nenhuma linha)
SELECT
  (SELECT count(*) FROM tenant_feature_overrides WHERE feature_id = 'feat_estoque') AS overrides,
  (SELECT count(*) FROM plan_features WHERE feature_id = 'feat_estoque') AS planos,
  (SELECT count(*) FROM membership_permission_overrides WHERE permission::text LIKE 'ESTOQUE_%') AS permissoes,
  (SELECT count(*) FROM stock_categories) + (SELECT count(*) FROM stock_products)
    + (SELECT count(*) FROM stock_movements) + (SELECT count(*) FROM stock_counts) AS dados;  -- 0 | 0 | 0 | 0
```

4. HTTP sem sessão:
   - `GET /tenants/x/stock/products` responde 401;
   - `/conta/estoque/produtos` carrega o shell;
   - login e agendamento público respondem como antes.

## H3. Até quando o retorno para `208d7ee` é seguro

- **Seguro (ensaiado):** enquanto a última consulta da seção H2 der `0 | 0 | 0 | 0`. Isso vale para qualquer momento da publicação e para depois da liberação, até a primeira contratação ou concessão.
- **Depois da primeira contratação ou concessão** (mesmo sem produto): **somente correção para frente**. O ensaio pós-uso reprovou (abaixo), então não há retorno para `208d7ee` a partir desse ponto.
  - O ensaio é feito na cópia restaurada, antes de publicar:
    1. Com a API nova, contratar ESTOQUE, conceder as duas permissões a um gerente e criar categoria, produto e movimentação.
    2. Voltar API e web para `208d7ee`.
    3. Verificar: login do dono e do gerente, "Equipe e acessos" (abrir e salvar), portal "Plano e adicionais" (abrir e salvar sem alterar o ESTOQUE) e agendamento.
  - Critério: passa só se a versão antiga funcionar **e** preservar o que a nova gravou. Se falhar, somente correção para frente a partir da primeira contratação ou concessão.
  - Resultado do ensaio (18/11/2026, cópia restaurada de `pre-mig21-20-backup-2026-11-18T20-46-56Z`): **reprovou**.
    - Funcionaram com API e web `208d7ee` sobre a cópia já usada: login do dono e do gerente, "Equipe e acessos" (abrir e salvar), portal "Plano e adicionais" (salvar sem mexer no ESTOQUE, que continua contratado) e agendamento público. Nenhum erro de tela.
    - **Falha:** a versão antiga não conhece as permissões de estoque. Salvar o acesso de um gerente na tela antiga **apaga** as concessões "Ver estoque" e "Operar estoque" dele. O retorno não preserva as concessões de estoque.
    - Contratação, categorias, produtos e movimentações ficaram intactos.
  - **Decisão (19/11/2026):** depois da primeira contratação ou concessão, somente correção para frente. Nenhum rollback foi feito. Problema na versão nova se resolve com versão nova: PR, CI verde, ensaio quando houver migration, e API e web no mesmo SHA.
- Em nenhum caso há `down` das migrations no piloto.

## Roteiro curto de teste (depois da liberação)

1. Em "Planos e adicionais", definir o preço do Controle de estoque, se estiver "A definir".
2. Num estabelecimento de teste, em "Plano e adicionais", marcar o Controle de estoque, revisar e salvar.
3. Entrar como dono e conferir o grupo "Estoque" no menu: Produtos, Categorias, Movimentações e Conferência de estoque.
4. Em "Equipe e acessos", conceder "Ver estoque" ou "Operar estoque" a um gerente.
5. Criar categoria e subcategoria; cadastrar um produto com saldo inicial usando "Cadastrar e continuar" (a janela fica aberta e limpa, com o foco no Nome) e outro com "Cadastrar produto" (a janela fecha); no "Novo produto", criar uma categoria e uma subcategoria pelos atalhos "+ Nova…" sem perder o que já foi preenchido; usar "Duplicar cadastro" num produto, conferir que código e saldo inicial vêm vazios e cadastrar a cópia; registrar entrada e saída; estornar uma saída. Tentar uma perda e um estorno sem motivo: a tela recusa e o saldo não muda.
6. Fazer uma conferência com diferença. Sem motivo, a tela não avança para a confirmação. Com motivo, conferir o ajuste e o motivo no histórico.
7. Retirar o adicional: o menu some, o endereço direto mostra o motivo e os dados ficam preservados. Recontratar devolve tudo.
