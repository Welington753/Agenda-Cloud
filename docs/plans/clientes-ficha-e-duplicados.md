# Clientes: ficha, duplicados e unificação (Lote C)

Plano aprovado em 19/11/2026. A entrega é separada da navegação do celular (Lote N, publicado em `0d8f479`).

## Contexto

A tela de Clientes era só lista e cadastro: não havia ficha, edição, histórico nem unificação. O responsável relatou clientes repetidos.

**Diagnóstico C0** (19/11/2026). Feito no backup de 18/11 21:28, schema 20, restaurado num PostgreSQL descartável e apagado no fim. Só agregados:

| Medida | Valor |
|---|---|
| estabelecimentos com clientes / clientes | 1 / 9 |
| telefone exato repetido | 0 grupos |
| variação de 9º dígito ou DDD com zero | 0 grupos |
| DDD com zero (`+550…`) | 0 |
| mesmo nome com telefones diferentes | 1 grupo, 4 cadastros |
| cadastros com mais de um nome nos agendamentos | 1 |
| opt-in / opt-out preenchidos | 0 / 0 |
| celular com 9 seguido de 0–5 (válido) | 1 |
| fora de qualquer padrão | 1 |

**O que os números mostram:**
- Os "repetidos" são cadastros diferentes, com o mesmo nome e telefones diferentes.
- A consulta não repete linhas: a listagem lê só `consumers`.
- **Os números valem para o backup de 18/11.** Na publicação, o estado atual do piloto é conferido de novo, no momento que o roteiro prevê.

## Decisões do responsável

- **Telefone compartilhado:** o mesmo WhatsApp pode ter cadastros distintos (ex.: mãe e filho).
  - "Cadastrar outra pessoa" vale mesmo com nome igual.
  - Nome e telefone são critérios de correspondência, não identidade. A identidade é `consumers.id`.
- **Agendamento público:**
  - reaproveita um cadastro só com **uma única** correspondência de telefone e nome normalizados;
  - com mais de uma correspondência, não escolhe nenhum cadastro e cria um novo;
  - nunca altera o nome do cadastro;
  - nunca revela cadastro ou histórico.
- **9º dígito e DDD:** uma variação só aparece como possível correspondência para revisão ("Número parecido").
- **Mesmo nome:** cadastros com o mesmo nome normalizado aparecem como **"Mesmo nome — confira"**. É só uma sugestão de revisão.
- **Unificação:**
  - só o dono unifica, depois de uma prévia e da confirmação;
  - nada é unificado nem excluído automaticamente;
  - o cadastro secundário vira lápide e nada é apagado;
  - o autor fica registrado.
- **Compras:** a ficha não mostra compras.
  - Uma saída de estoque (`SAIDA_VENDA`) não é compra de cliente.
  - Mostrar compras exige o módulo de vendas (C1 do plano de expansão).

## Regras

**Chaves de comparação:** vêm das funções imutáveis do banco (migration 24), nunca de uma cópia em TypeScript.
- `consumer_name_key(nome)`:
  - troca letras acentuadas, maiúsculas e minúsculas, pela letra sem acento, antes de `lower`. Assim a chave é a mesma em qualquer configuração de idioma do servidor;
  - colapsa os espaços.
- `consumer_phone_match_key(whatsapp_normalized)`:
  - `+55`, DDD (1–9, 1–9) e celular de 9 dígitos com o 2º dígito de 6 a 9: a chave fica **sem o 9**;
  - `+55`, DDD e celular de 9 dígitos com o 2º dígito de 0 a 5: o próprio número;
  - `+55`, DDD e 8 dígitos começando de 2 a 9: o próprio número;
  - `+550…`: tira o zero e aplica as regras acima;
  - outro `+55`: `NULL`, que nunca agrupa;
  - fora do Brasil, de 8 a 15 dígitos: o próprio número.
  - Fixo `3333-4444` e celular `9 3333-4444` não colidem.

**Trava por telefone:** cadastro pela tela, cliente novo da agenda, edição e agendamento público usam a mesma trava, `pg_advisory_xact_lock` com a chave `public-booking:<tenant>:<telefone>`. Na agenda, a trava vem antes das travas do cálculo, na mesma ordem do público.

**Cadastro pela tela** (`POST consumers`):
- `requestKey` é opcional, porque o web anterior não manda.
- A chave fica em `consumer_create_requests`, com a impressão SHA-256 dos dados normalizados do pedido original. A tabela só aceita inserção: um gatilho recusa UPDATE.
- Reenvio com a mesma impressão: 200, `repeated: true`, com o cadastro original. Se ele virou lápide, a resposta traz também `principal`.
- Reenvio com outra impressão: 409 `CHAVE_REUTILIZADA`.
- A comparação é sempre com a impressão gravada, nunca com o cadastro atual.
- Telefone de um cadastro ativo: 409 `TELEFONE_EM_USO`. A aplicação confere isso sob a trava, com ou sem o UNIQUE antigo.
- `outraPessoa` só existe no PR 2. Nesta versão, o corpo estrito recusa o campo com 400.

**Edição** (`PATCH consumers/:id`, `CONSUMIDORES_GERENCIAR`):
- Ordem das travas: o telefone novo, depois a linha (`FOR UPDATE`).
- `expectedUpdatedAt` diferente do atual: 409 `CLIENTE_ALTERADO`.
- Lápide: 409 `CLIENTE_UNIFICADO`, com o `principalId`.
- O id, o histórico e os snapshots não mudam.
- A auditoria `CONSUMER_UPDATED` grava só os nomes dos campos alterados.

**Vínculo com cadastro existente:**
- A agenda (`mode: 'existing'`) trava o cadastro com `FOR SHARE`. Uma lápide responde 409 `CLIENTE_UNIFICADO` com o principal.
- O gatilho `trg_appointments_consumer_active` é a garantia final, inclusive contra código antigo. Ele usa o SQLSTATE `AC001`, com o principal no DETAIL, e a API traduz esse erro para o mesmo 409.

**Agendamento público** (`clienteDoTelefone`), sob a trava:
- Candidatos: cadastros ativos com o mesmo telefone normalizado e a mesma `name_key`, travados com `FOR SHARE`.
- Exatamente um candidato: reaproveita. Nenhum: cria. Mais de um: cria e registra só a contagem.
- `INSERT … ON CONFLICT DO NOTHING` sem alvo funciona com e sem o UNIQUE antigo.
- No schema 24, o telefone com outro nome fica no cadastro existente daquele telefone, como hoje. O nome digitado fica só no snapshot.

**Ficha, histórico e lista agrupada:**
- Ficha (`GET consumers/:id`):
  - os números são "neste cadastro";
  - último concluído e próximo agendamento;
  - os nomes usados, um por nome normalizado, na grafia mais recente;
  - `historicoPossivelmenteCompartilhado` quando há mais de um nome;
  - outros cadastros com a relação: `MESMO_TELEFONE`, `NUMERO_PARECIDO` ou `MESMO_NOME`;
  - `telefoneAgrupavel: false` quando a chave de telefone é nula.
- Histórico (`GET consumers/:id/appointments`):
  - paginado, do mais recente para o mais antigo;
  - preço com a regra de `recortarParaQuemPediu`;
  - recebimento só com `canViewPayments` e o recurso `PAGAMENTOS`;
  - centavos inteiros.
- Lista agrupada (`GET consumers/groups`, rota nova):
  - um grupo por `phone_match_key`, só com cadastros ativos;
  - a relação de cada membro com os outros do grupo;
  - `mesmoNome`: quantos cadastros com o mesmo nome estão fora do grupo;
  - ordenada pelo menor nome do grupo, com desempate pela chave do grupo, que vai no cursor;
  - nenhum total somado entre cadastros.
- `GET consumers/page` e `GET consumers?q=` continuam iguais para o web anterior, só sem lápides.

**Preferências de mensagem por telefone** (`whatsapp_consent_events`, só inserção):
- A decisão de envio usa `whatsapp_consent_current(tenant, telefone)`:
  - vale o evento mais recente do número que vai receber;
  - no empate de horário, o opt-out vence;
  - sem evento, a mensagem não é enviada.
- **Backfill:** as colunas antigas viram eventos, com o telefone atual da linha e a data da própria coluna. As colunas ficam congeladas.
- Trocar o telefone não leva a autorização para o número novo.
- O opt-out de um número continua valendo para qualquer cadastro que use esse número, inclusive depois de unificar.

## Etapas e compatibilidade

| Etapa | Commit | Manifesto (`required-migrations.ts`) | Funciona em | O que libera |
|---|---|---|---|---|
| C1 | SHA_A (PR 1) | até 24 | schemas 24 e 25 | lista agrupada, ficha, histórico, edição, novo público, preferências por telefone |
| C2 | migration 25 no kit do PR 2 | — | — | remove `uq_consumers_tenant_whatsapp` |
| C3 | SHA_B (PR 2) | até 25 | schema 25 | `outraPessoa`, prévia e unificação, telas finais |

**Publicação no piloto:** pelo roteiro, com backup novo e restauração conferida, e `pilot:check-database` antes e depois. Antes de tudo, os 5 passos são ensaiados numa cópia restaurada:
1. migrations 23–24;
2. API SHA_A, com o web ainda em `0d8f479`;
3. migration 25;
4. API SHA_B;
5. web SHA_B.

**Retorno:**
- Antes do passo 3, a API `0d8f479` volta sem problema, porque o schema 24 é compatível.
- Depois do passo 3, o piso é a API SHA_A, sempre para frente.

## Testes (PR 1)

- **Unidade:**
  - `consumer-rules.spec.ts`: impressão do pedido, recusas com `code`, erro do gatilho;
  - `consumer.dto.spec.ts`: `requestKey`, recusa de `outraPessoa`, PATCH;
  - `consumer-profile.spec.ts`: o que o histórico mostra por papel;
  - spec da migration 23.
- **HTTP sem banco:** `test/appointments.e2e-spec.ts`, com 200 no reenvio, 400 para `outraPessoa` e o PATCH.
- **Banco:**
  - `test/consumer-migrations.db-e2e-spec.ts`:
    - atualização a partir das 22 com dados: chaves, backfill, UNIQUE mantido, gatilhos e índices;
    - a regra das chaves;
    - o retorno.
  - `test/consumers-identity-postgres.db-e2e-spec.ts`, nos schemas 24 e 25 (banco temporário sem o UNIQUE):
    - chave de pedido: depois de editar, com dados diferentes, simultânea e depois de unificar;
    - telefone em uso simultâneo;
    - edição;
    - ficha e histórico, com o recebimento conforme o recurso;
    - lista agrupada, com o desempate da paginação;
    - agendamento público nos dois schemas;
    - vínculo com lápide;
    - preferências;
    - isolamento;
    - o contrato do web publicado (`test/support/contrato-web-anterior-clientes.ts`, cópia de `0d8f479`).
  - `test/isolamento-estabelecimentos-postgres.db-e2e-spec.ts`: as quatro rotas novas.

## Estado e retomada

**Encerramento de 19/11/2026, 20:07 UTC.** Nada do Lote C foi mesclado, aplicado no piloto nem publicado.

**Lote N (navegação no celular): publicado.**
- PR #137 mesclado como `0d8f479`, com CI verde no head `27f4151`.
- API e web live em `0d8f479`. O banco do piloto continua com **22 migrations**: o Lote N não tem migration e o banco não foi tocado.
- Deploys:
  - API `dep-dbvkl6bl550s73856vt0`, 19:14:33–19:15:31 UTC;
  - web `dep-dbvklocipgvc73dgklb0`, 19:15:45–19:18:11 UTC.
- **Antes da publicação:**
  - os dois serviços estavam live em `e78c3d1`;
  - a fila estava vazia;
  - o Auto-Deploy estava `off`.
- **Depois da publicação:**
  - API: `/` e `/health` respondem 200; o log mostra "Nest application successfully started", sem aviso de `SchemaReadiness`;
  - web: `/`, `/login` e `/conta` respondem 200, e o pacote de `/conta` contém `faixa-de-areas`;
  - `/agenda_api/auth/me` sem sessão responde 401 em JSON.
- O registro está no PR de documentação **#138** (`docs/navegacao-celular-publicada`, `83ee0e7`), **aberto**.
- **Falta:** o teste no celular com sessão real, feito pelo responsável.

**Lote C, PR 1 (SHA_A): PR #139 aberto.**
- Branch `feat/clientes-identidade`, head de código `413a14e`. O commit desta seção é só de documentação.
- **Migrations 23 e 24: NÃO aplicadas no piloto.** Nenhum backup, migration ou deploy foi feito para o Lote C.
- **CI no encerramento, no head `413a14e`:**
  - `test-migration-lote6b2.yml` (migration:show/run reais): **falhou**. Em `scripts/lote6b2-migration.migration-e2e-spec.ts`, o teste "estado final do banco bate exatamente com o baseline pós-migration esperado" deu `expected 62 to be 60`: a contagem de tabelas do baseline não inclui as duas tabelas novas da migration 24 (`consumer_create_requests` e `whatsapp_consent_events`). Ainda não foi corrigido.
  - `test-frontend-auth.yml` (navegador + API): **em andamento** no encerramento. O resultado está pendente.
- **Testes locais (PostgreSQL descartável, porta 55433):**
  - unitários do backend: 145 arquivos e 2161 testes, todos verdes; `typecheck` e `lint` limpos;
  - HTTP sem banco (`test:e2e`): 18 arquivos e 199 testes, verdes;
  - testes de banco novos, verdes: `consumer-migrations` (3), `consumers-identity-postgres` (a versão final, com o caso do contrato, passou na 2ª rodada completa) e `isolamento-estabelecimentos` (1);
  - bateria completa de banco (`test:db-e2e`), em banco novo:
    - **1ª rodada:** só `stock-migrations` falhou, porque esperava 22 migrations; corrigido para migrar até a 22;
    - **2ª rodada:** 426 de 427 passaram;
    - **falha intermitente:** `commercial-access-postgres` › "pagamento manual: registra, repete sem duplicar, disputa entre telas e renova encadeado". No log apareceu `ck_teste_falha` em `tenant_access_periods`. O mesmo teste passou na 1ª rodada completa e passou sozinho (8/8) logo depois. **Não está resolvida:** a causa não foi investigada e pode voltar no CI.
- **PR 2 (SHA_B): não iniciado.**

**Próxima ação:**
1. Reler o Git (branch e PRs #138 e #139) e o CI do #139.
2. Corrigir a contagem de tabelas do baseline em `scripts/lote6b2-migration.migration-e2e-spec.ts`, de 60 para 62, com as duas tabelas da migration 24. Conferir o resultado do `test-frontend-auth.yml` e qualquer outra falha, inclusive se a intermitente de `tenant_access_periods` aparecer.
3. Com o CI verde, pedir autorização para o merge do #139. Depois retomar o plano aprovado: PR 2, ensaio dos 5 passos numa cópia restaurada de um backup novo e publicação só com pedido explícito.

**Só neste computador:**
- o PostgreSQL descartável local (dados em `scratchpad/pg`, porta 55433), parado no encerramento;
- os scripts auxiliares do scratchpad (`novo-banco.sh`, `q.cjs`).
Nada disso precisa ser levado: os bancos de teste são recriados pelas migrations.
