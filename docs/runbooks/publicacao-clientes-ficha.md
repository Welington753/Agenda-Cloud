# Publicação de clientes: ficha e duplicados (migrations 23 a 25, API e web)

Plano do lote: `docs/plans/clientes-ficha-e-duplicados.md`. Este roteiro não contém nenhuma credencial nem URL de banco. Os valores reais ficam com quem opera, fora do repositório e fora de conversa.

**Antes de começar:**
- Nada aqui é autorizado por este texto. Cada passo no piloto depende de pedido explícito do responsável.
- Os SHAs ficam assim:
  - **SHA_A = `15e2790`:** merge do PR #139, com as migrations 23–24 e o manifesto até 24;
  - **SHA_B:** merge do PR #140, com a migration 25 (`ConsumerSharedPhone1794355200000`) e o manifesto até 25;
  - **atual:** o par API e web no ar (hoje `0d8f479`).

## P. Sequência

1. **Conferir o ambiente:**
   - API e web live no SHA atual (`render deploys list <serviço> -o json --confirm`), fila vazia e Auto-Deploy `off`.
   - `/health` responde.
   - O banco tem 22 migrations, lido só com consulta de leitura em `typeorm_migrations`. Nunca usar `migration:show`, porque ele escreve.
   - Se algo divergir, parar.
2. **Backup novo** `pre-mig23-22-backup-<data>` em `%USERPROFILE%\AgendaCloud-operacoes`:
   - usar `SET TIME ZONE 'UTC'` nas duas pontas;
   - CA em PEM (no Windows, `sslrootcert=system` falha).
3. **Restauração conferida** num cluster descartável com TLS, com hash por tabela igual ao original.
4. **Estado atual, só agregados.** Rodar na cópia restaurada as consultas do diagnóstico C0 do plano (sem nome, telefone nem id). Não presumir os números de 18/11; registrar os de agora no plano:
   - clientes por estabelecimento;
   - repetições exatas;
   - variação de 9º dígito e DDD com zero;
   - mesmo nome com telefones diferentes;
   - cadastros com mais de um nome nos agendamentos;
   - **opt-in e opt-out preenchidos**, que dizem quantos eventos o backfill vai criar.
5. **Ensaio na cópia restaurada, os 5 passos:**
   1. `aplicarSomenteAPendente` (`backend/scripts/operacao-piloto.mjs`) com:
      - `esperadasAntes` = as 22;
      - `pendente` = `ConsumerAuditActions1794182400000`;
      - `posteriores` = `["ConsumerIdentity1794268800000"]` (o kit é o `dist-migrations` do SHA_A, que só tem até a 24).
      
      Depois, a mesma função para `ConsumerIdentity1794268800000`, com `posteriores` vazio. Conferir a seção P2 (24).
   2. API SHA_A sobre a cópia, com o web atual. Conferir a janela 2 da seção P0.
   3. Migration 25 com o kit do SHA_B: `esperadasAntes` = as 24, `pendente` = `ConsumerSharedPhone1794355200000`, `posteriores` vazio. Conferir a seção P2 (25) e a janela 3.
   4. API SHA_B. Conferir a janela 4.
   5. Web SHA_B. Conferir a janela 5 e o roteiro curto.
   6. Ensaio de retorno: a seção P3, antes do passo 3.
6. **Piloto:** repetir os passos 5.1 a 5.5 contra o piloto, um de cada vez, com `pilot:check-database` antes e depois de cada migration e a conferência de cada janela.
   - Entre os passos, parar se algo divergir.
   - O passo 3 (migration 25) é o ponto sem volta para a API atual (seção P3).
7. **Registrar:**
   - SHAs, ids de deploy e estado do banco;
   - os agregados do passo 4;
   - "Estado e retomada" do plano e a memória.

## P0. Janelas entre migration, API e web

| Janela | Banco | API | Web | Situação |
|---|---|---|---|---|
| 1 | 24 | atual | atual | A API atual ignora as colunas e tabelas novas; o UNIQUE de telefone continua. |
| 2 | 24 | SHA_A | atual | O web atual usa `consumers/page`, `consumers?q=`, `POST consumers` e a agenda, todos com o mesmo contrato. As lápides somem das listas (ainda não há nenhuma). Público: telefone com outro nome fica no cadastro do telefone, como hoje. |
| 3 | 25 | SHA_A | atual | Sem o UNIQUE, o público passa a criar outro cadastro para o mesmo telefone com outro nome. O cadastro pela tela continua recusando telefone em uso (409, conferido pela API). |
| 4 | 25 | SHA_B | atual | `outraPessoa`, prévia e unificação existem na API, sem tela. O web atual continua com o mesmo contrato. |
| 5 | 25 | SHA_B | SHA_B | Final: lista agrupada, ficha, edição e unificação. |

**Prova em cada janela, no ensaio:**
- login do dono;
- Clientes: lista, busca, cadastro e o cadastro repetido (mensagem de WhatsApp em uso);
- agenda: reserva com cliente novo e existente;
- agendamento público: telefone novo, o mesmo telefone e nome, e o mesmo telefone com outro nome.

Os testes `test/consumers-identity-postgres.db-e2e-spec.ts` (contrato do web `0d8f479` nos schemas 24 e 25) e `test/schema-readiness-postgres.db-e2e-spec.ts` (API do manifesto até 24 sobe com a 25 aplicada) cobrem a parte automática.

## P1. Se algo falhar

- **Migration 23 ou 24 falha:** a transação é desfeita. O banco fica no anterior, e API e web atuais seguem.
- **Deploy da API SHA_A falha:** o Render mantém a API atual, que roda no schema 24. Não seguir.
- **Migration 25 falha:** desfeita sozinha; o banco fica em 24 e a API SHA_A segue.
- **Deploy da API SHA_B falha:** o Render mantém a SHA_A, que roda no schema 25. Não publicar o web.
- **Deploy do web SHA_B falha:** fica a janela 4. Ela é compatível com o web atual.
- **Schema:** nunca há `down` destas migrations no piloto. A correção é sempre para frente.

## P2. Conferências só de leitura

```sql
SELECT count(*) FROM typeorm_migrations;                         -- 24 (ou 25 depois do passo 3)
SELECT name FROM typeorm_migrations ORDER BY id DESC LIMIT 3;
SELECT count(*) AS clientes,
       count(*) FILTER (WHERE merged_into_consumer_id IS NOT NULL) AS lapides,
       count(*) FILTER (WHERE phone_match_key IS NULL) AS sem_chave
  FROM consumers;                                                -- clientes igual ao passo 4 | 0 | (registrar)
SELECT kind, count(*) FROM whatsapp_consent_events GROUP BY kind; -- igual aos opt-in/opt-out do passo 4
SELECT count(*) FROM consumer_create_requests;                   -- 0 logo depois da migration
SELECT conname FROM pg_constraint WHERE conname = 'uq_consumers_tenant_whatsapp'; -- 1 linha em 24; nenhuma em 25
SELECT tgname FROM pg_trigger WHERE tgname = 'trg_appointments_consumer_active';  -- 1 linha
```

HTTP sem sessão: `GET /tenants/x/consumers/groups` responde 401; login e agendamento público respondem como antes.

## P3. Até quando o retorno é seguro

- **Antes do passo 3:** a API atual roda no schema 24, porque a migration só acrescenta.
  - O retorno da API SHA_A para a atual é seguro enquanto nenhum telefone tiver sido editado pela ficha.
  - Motivo: a API atual decide o envio de mensagem pelas colunas antigas, que ficam congeladas no número anterior.
  - Se houver opt-in preenchido (passo 4) e um telefone editado, avaliar com o responsável antes de voltar.
  - Ensaiar na cópia: editar um cliente com a SHA_A, voltar para a atual e conferir lista, busca, cadastro e agenda.
- **Depois do passo 3:** o piso é a API SHA_A, porque a atual depende do UNIQUE para não duplicar o cadastro do telefone. Somente correção para frente.

## Roteiro curto de teste (depois do passo 5)

1. Clientes: um grupo com "Mesmo WhatsApp" e "Número parecido", cada nome levando à ficha.
2. "Mesmo nome — confira" no cartão e na ficha, só como sugestão.
3. Ficha: resumo "neste cadastro", histórico, o aviso de nomes diferentes e Editar (trocar o telefone mantém o histórico).
4. Cadastrar com um WhatsApp já usado: "Usar este" e "Cadastrar outra pessoa" (nome igual permitido).
5. Unificar como dono: escolher o principal, revisar a prévia e confirmar. Cancelar não grava nada. O gerente não vê "Unificar".
