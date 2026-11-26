# Publicação de Vendas v1 (migrations 27 e 28, API e web)

Plano do lote: `docs/plans/vendas-v1.md` (seções 3.1, 3.2 e 5.7). Este roteiro não contém nenhuma credencial nem URL de banco. Os valores reais ficam com quem opera, fora do repositório e fora de conversa.

- **Nada aqui define preço nem ativa VENDAS.** O preço do adicional e a primeira ativação real são decisões do responsável, depois da seção V2. Até lá, o adicional fica no catálogo **sem preço** (a contratação recusa com `PRECO_PENDENTE`) e **ninguém liga `feat_vendas`** por override.
- **Publicação funcional = head do PR 4 mesclado**, com API e web no mesmo SHA. A integração com só os PRs 2 e 3 (migrations e API, sem telas) nunca é publicada sozinha. Se outra publicação for necessária antes, ela sai de um SHA anterior ao PR 2 (`8ea862f`).
- VENDAS exige ESTOQUE. Retirar o ESTOQUE com VENDAS ativo recebe 409 `MODULO_DEPENDENTE`.

## V. Sequência

1. **Conferir o ambiente** (só leitura):
   - SHAs live de API e web (`render deploys list <serviço> -o json --confirm`). No último registro (26/11/2026): API `59df5ba`, web `96c8ba1`, que são o **par anterior** deste roteiro. Se o que estiver live for outro par, ele passa a ser o par anterior, e as janelas da seção V0 precisam ser ensaiadas com ele.
   - `/health` responde.
   - Banco com 26 migrations, lido só com consulta de leitura em `typeorm_migrations`. Nunca usar `migration:show`, porque ele escreve.
   - Se algo divergir, parar.
2. **Backup novo** `pre-mig27-26-backup-<data>` em `%USERPROFILE%\AgendaCloud-operacoes` (`docs/runbooks/backup-piloto-automatico.md`). Usar `SET TIME ZONE 'UTC'` nas duas pontas e CA em PEM (no Windows, `sslrootcert=system` falha).
3. **Restauração validada** num cluster descartável com TLS e a **versão do piloto** (17), com hash por tabela igual ao original.
4. **Ensaio na cópia restaurada** (só esta cópia prova a compatibilidade com os dados reais; o CI prova o código):
   1. `aplicarSomenteAPendente` (`backend/scripts/operacao-piloto.mjs`) com `esperadasAntes` = as 26, `pendente` = `SalesEnumValues1794528000000` e `posteriores` = `["SalesModule1794614400000"]`. Conferir: 27 registradas e os onze valores novos presentes (`feature_key.VENDAS`, seis `permission.VENDAS_*`, quatro `audit_action.SALE_*`).
   2. Numa conexão nova, a mesma função com `esperadasAntes` = as 27 e `pendente` = `SalesModule1794614400000`. Conferir:
      - 28 registradas;
      - a consulta da condição de retorno (seção V3), com as sete contagens zero;
      - o adicional ESTOQUE (nome, descrição, preço) igual ao do backup.
   3. Rodar as janelas da seção V0 com verificação por navegador.
   4. **Par anterior em 28** (seção V3): subir API e web do par anterior sobre a cópia em 28 e conferir login do dono e do gerente, agenda, "Equipe e acessos" (abrir e salvar uma concessão existente), estoque (abrir e editar um produto), portal "Plano e adicionais" (abrir, sem contratar) e agendamento público. Se falhar, não há retorno ao par anterior depois da 28, nem com as sete contagens zero: só correção para frente.
5. **Piloto:** repetir os passos 4.1 e 4.2 contra o banco do piloto, em duas execuções separadas, conferindo depois de cada uma.
6. **Publicar a API** no SHA do merge do PR 4 e esperar o log "28 de 28" e o `/health`. Depois, **publicar o web** no mesmo SHA.
7. **Seção V2.** Se tudo passar, declarar a publicação concluída. A liberação comercial (preço e primeira ativação) continua com o responsável.
8. **Registrar:**
   - SHAs, ids de deploy e estado do banco;
   - o resultado das sete contagens da seção V3 e do passo 4.4 (se o retorno ao par anterior ficou disponível ou não);
   - "Estado e retomada" do plano e memória.

## V0. Intervalos entre migration, API e web

| Janela | Banco | API | Web | Situação |
|---|---|---|---|---|
| 1a | 27 | anterior | anterior | Só valores de enum novos, sem uso. |
| 1b | 28 | anterior | anterior | A API anterior ignora as tabelas novas. O portal anterior já mostra o adicional Vendas, sem preço: **não definir preço nem contratar**. |
| 2 | 28 | nova | anterior | Nenhum estabelecimento tem VENDAS: nenhuma área nova na sessão e as permissões `VENDAS_*` aparecem como não concedíveis no catálogo do gerente. |
| 3 | 28 | nova | nova | Final. |

**Por que a janela 2 deve funcionar** (precisa ser **provado** no ensaio):

- O web anterior valida o catálogo de permissões só pelos tipos dos campos e ignora campos que não conhece (`receptionistPermissions` na visão da equipe, `salePriceCents` no produto, `saleId` na movimentação).
- Editar um produto pelo web anterior não manda `salePriceCents`, e a API nova mantém o preço gravado quando o campo é omitido.
- A recepcionista que não existia continua sem área no web anterior (só configurações pessoais).

Verificação em cada janela: login de dono e de gerente, agenda, "Equipe e acessos" (abrir e salvar uma concessão existente), estoque (produtos e movimentações), Recebimentos, portal "Plano e adicionais" e agendamento público.

**Se a janela 2 falhar no ensaio:** parar antes de mudar qualquer coisa no piloto e escolher com o responsável entre corrigir a compatibilidade na API nova (novo PR e novo ensaio) ou uma janela de manutenção controlada (horário de pouco uso, aviso aos donos, do deploy da API até o web live e verificado; se o web falhar dentro dela, a API volta ao par anterior).

## V1. Se algo falhar durante a publicação

- **Migration 27 falha:** a transação é desfeita e o banco continua em 26. Nada segue.
- **Migration 28 falha:**
  - A primeira instrução confere que os valores da 27 estão confirmados; se não estiverem, falha sem gravar.
  - Ela é desfeita sozinha, e o banco fica em 27. O par anterior roda em 27 (janela 1a).
  - A API nova **não** pode ser publicada, porque recusa subir em 27.
  - Corrigir num PR novo, ensaiar de novo e reaplicar só a 28.
- **Deploy da API falha:** o Render mantém a API anterior (janela 1b, ensaiada). Não publicar o web. Conferir a versão live e o `/health`.
- **Deploy do web falha:** fica a janela 2 (ensaiada). Se não resolver numa tentativa, voltar a API ao par anterior (só com a condição de retorno da seção V3 atendida).
- **Verificação de V2 falha:** não liberar. Se afetar agendamento, login, estoque ou portal, API e web voltam ao par anterior (só com a condição de retorno da seção V3 atendida). Se for só Vendas, ficam no ar sem preço nem ativação até a correção.
- **Schema:** nunca há `down` das migrations 27 e 28 no piloto. A correção é sempre para frente.

## V2. Conferências só de leitura

1. API e web live no mesmo SHA do merge do PR 4.
2. `/health` responde, e o log da API mostra "28 de 28".
3. Consultas no piloto:

```sql
SELECT count(*) FROM typeorm_migrations;                       -- 28
SELECT name FROM typeorm_migrations ORDER BY id DESC LIMIT 2;  -- SalesModule…, SalesEnumValues…
SELECT code, feature_key, availability
  FROM addon_modules WHERE code = 'VENDAS';                    -- VENDAS | VENDAS | AVAILABLE
```

4. A consulta da condição de retorno (seção V3): as sete contagens zero.

5. HTTP sem sessão:
   - `GET /tenants/x/sales/catalog` responde 401;
   - `/conta/vendas` carrega o shell;
   - login, agenda e agendamento público respondem como antes.

## V3. Condição de retorno ao par anterior

Esta é a **única definição** das condições de retorno do lote (o plano remete a ela). Antes da 28, o retorno é livre. Depois da 28, o par anterior só é candidato quando **as duas** condições valem:

1. **As sete contagens de uso de VENDAS são zero**, lidas na consulta abaixo:
   - `precos`: preços gravados para o adicional Vendas;
   - `contratos`: itens de assinatura modular com Vendas;
   - `overrides`: exceções de recurso com `feat_vendas`, ligadas ou desligadas;
   - `planos`: planos com `feat_vendas`;
   - `concessoes`: concessões `VENDAS_*` de gerente ou recepcionista;
   - `vendas`: vendas mais recebimentos de vendas;
   - `precos_sugeridos`: produtos com preço sugerido de venda.
2. **O passo 4.4 da seção V aprovou** o par anterior sobre a cópia restaurada em 28.

Contagens zeradas **não provam** que a API e o web anteriores sobem e operam em 28: isso só o ensaio do passo 4.4 prova. Sem o ensaio aprovado, não há retorno depois da 28, mesmo com tudo zero.

```sql
SELECT
  (SELECT count(*) FROM addon_module_prices WHERE module_code = 'VENDAS') AS precos,
  (SELECT count(*) FROM tenant_subscription_items WHERE module_code = 'VENDAS') AS contratos,
  (SELECT count(*) FROM tenant_feature_overrides WHERE feature_id = 'feat_vendas') AS overrides,
  (SELECT count(*) FROM plan_features WHERE feature_id = 'feat_vendas') AS planos,
  (SELECT count(*) FROM membership_permission_overrides WHERE permission::text LIKE 'VENDAS_%') AS concessoes,
  (SELECT count(*) FROM sales) + (SELECT count(*) FROM sale_payments) AS vendas,
  (SELECT count(*) FROM stock_products WHERE sale_price_cents IS NOT NULL) AS precos_sugeridos;
-- todas as sete colunas: 0
```

- **Qualquer contagem acima de zero: somente correção para frente.** A API anterior:
  - grava `SAIDA_VENDA` manual com VENDAS ativo (sem passar pela venda);
  - apaga concessões que não conhece ao salvar o acesso do gerente (como no estoque, H3 de `publicacao-estoque-v1.md`);
  - não mostra vendas, recebimentos de vendas nem compras;
  - os gatilhos da migration 28 só evitam corromper o vínculo com o estoque e a unificação de clientes.
- Em nenhum caso há `down` das migrations no piloto.

## V4. Contingência quando só cabe corrigir para frente

1. **Conter:**
   - **Defeito em nova venda:** o proprietário retira VENDAS dos estabelecimentos afetados no portal ("Plano e adicionais"). Novas vendas passam a ser recusadas (403 do gate) e a manutenção continua para as vendas já registradas: consultar, receber, estornar e cancelar (com a devolução ao estoque), conforme as permissões. O menu mantém "Vendas" com "Minhas operações" e a consulta geral.
   - **Defeito na manutenção ou nas vendas já gravadas:** a orientação ao estabelecimento é não cancelar nem receber até a correção. Não há interruptor por rota.
   - Retirar o adicional **não é rollback**: o código novo, as tabelas e as vendas ficam.
2. **Preservar evidência:** um backup novo do piloto antes de qualquer correção. **Nunca restaurar backup antigo sobre o piloto**, porque apagaria vendas e recebimentos reais. Restauração só em descartável, para diagnóstico.
3. **Corrigir:** PR de correção a partir da integração, com o teste que reproduz o defeito, CI verde e publicação de API e web no mesmo SHA por este roteiro.
   - Defeito no schema: migration NOVA, sem `down` e sem editar a 27 ou a 28.
   - Dado errado: a correção é um lançamento, nunca edição. Cancelamento ou estorno pelo fluxo, ou uma migration de dados revisada, com backup e conferência antes e depois.
4. **API nova não sobe ou falha** (manifesto, configuração, defeito): republicar o **último SHA comprovadamente compatível com o schema e os dados já existentes**, isto é, um SHA cujo manifesto aceita o banco atual e que passou pelo ensaio na cópia restaurada com os mesmos tipos de dado (vendas, recebimentos, concessões). Se não existir versão assim, manter a contenção e corrigir para frente. Nunca voltar automaticamente à API anterior às vendas: ela só é candidata com a condição de retorno da seção V3 atendida (sete contagens zero **e** passo 4.4 aprovado).
5. **Registrar** no "Estado e retomada" do plano o que foi contido, o backup e o SHA da correção.

## Roteiro curto de teste (depois da decisão de preço e ativação pelo responsável)

Num estabelecimento de teste, nunca num real sem decisão do responsável:

1. Em "Planos e adicionais", conferir o Controle de estoque contratado no estabelecimento e definir o preço de Vendas (decisão do responsável).
2. Em "Plano e adicionais" do estabelecimento de teste, marcar Vendas (o ESTOQUE precisa estar marcado), revisar e salvar.
3. No cadastro de um produto de finalidade Venda, definir o preço sugerido.
4. Como dono, em Vendas: "Nova venda" com um produto e uma venda de balcão; depois outra com cliente escolhido por toque (dois cadastros com o mesmo nome aparecem lado a lado). Tentar vender um produto sem saldo: nada é gravado.
5. Receber a venda (forma de pagamento), estornar o recebimento e cancelar a venda, com motivo e senha. O saldo volta.
6. Em "Equipe e acessos", criar uma recepcionista com "Registrar vendas" e "Receber vendas": ela vê só Vendas, sem saldo numérico, sem alterar preço, sem cancelar nem estornar.
7. Conferir a seção "Compras" na ficha do cliente e "Recebido em atendimentos" no Início.
8. Em Movimentações, a baixa da venda aparece com "Venda" e sem "Estornar"; "Saída por venda" manual é recusada com o aviso para usar Vendas.
9. Retirar Vendas: "Nova venda" some, e as vendas registradas continuam consultáveis, recebíveis, estornáveis e canceláveis.
