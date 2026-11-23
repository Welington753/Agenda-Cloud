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
- Telefone de um cadastro ativo: 409 `TELEFONE_EM_USO`, a não ser com `outraPessoa`. A aplicação confere isso sob a trava, com ou sem o UNIQUE antigo.
- `outraPessoa: true` (PR 2) cadastra outra pessoa no mesmo telefone, mesmo com nome igual. Exige `requestKey`. Sem ele, o 409 `TELEFONE_EM_USO` traz os cadastros desse telefone (`consumers`), para a tela oferecer "Usar este" ou "Cadastrar outra pessoa".

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

**Unificação** (PR 2, `consumer-merge.service.ts`, regras puras em `consumer-merge-rules.ts`):
- Só o dono (`canMergeConsumers`), e só pares sugeridos: mesmo telefone, número parecido ou mesmo nome. Fora disso, 409 `NAO_SUGERIDO`; o mesmo cadastro dos dois lados, 400 `MESMO_CADASTRO`.
- `GET consumers/:id/merge-preview?principalId=`: o cadastro do caminho é o secundário. Mostra os dois cadastros, as relações, o que vai para o principal (agendamentos por situação, recebimentos, comissões e pedidos públicos que seguem por eles) e a `versaoDaPrevia`.
- A versão é o SHA-256 do conteúdo apresentado: dados dos dois cadastros (com a situação de lápide), cada agendamento do secundário (situação, horário e preços dos itens), cada recebimento (valor, forma, data, estorno), cada comissão (valores e situação) e cada pedido público.
- `POST consumers/:id/merge` com `{ principalId, versaoDaPrevia }`, numa transação:
  1. trava, por ordem de id, os dois cadastros e as lápides que apontam para o secundário (`FOR UPDATE`);
  2. reenvio (o secundário já aponta para este principal): 200 com o resumo gravado, antes da checagem de lápide;
  3. lápide de outro, ou principal lápide: 409 `CLIENTE_UNIFICADO`;
  4. trava todos os agendamentos do secundário; o estorno passou a travar o agendamento antes do recebimento, como o registro já fazia;
  5. relê o conteúdo e recalcula a versão: diferente, 409 `PREVIA_DESATUALIZADA` com a prévia nova, e nada é transferido;
  6. move os agendamentos (snapshots intactos), redireciona as lápides antigas, grava a lápide com o autor e a auditoria `CONSUMER_MERGED` (versão confirmada e quantidades).
- Telefone, nome e preferências do principal não mudam; os eventos de preferência ficam no número ao qual foram dados.

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
| C1 | SHA_A = `15e2790` (PR #139) | até 24 | schemas 24 e 25 | lista agrupada, ficha, histórico, edição, novo público, preferências por telefone |
| C2 | migration 25 no kit do PR 2 | — | — | remove `uq_consumers_tenant_whatsapp` |
| C3 | SHA_B (PR #140) | até 25 | schema 25 | `outraPessoa`, prévia e unificação, telas finais |

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

## Testes (PR 2)

- **Unidade:** `consumer-merge-rules.spec.ts` (par sugerido, versão da prévia muda com cada campo apresentado, resumo), `consumer-access.spec.ts` (`canMergeConsumers`: só o dono, `DENIED` tira), `consumer.dto.spec.ts` (`outraPessoa` exige chave; prévia e unificação estritas), spec da migration 25.
- **HTTP sem banco:** `test/appointments.e2e-spec.ts` (outraPessoa com e sem chave, prévia e unificação).
- **Banco:**
  - `test/consumers-merge-postgres.db-e2e-spec.ts` (schema 25): telefone compartilhado (409 com os cadastros, outra pessoa com nome igual, reenvio, simultâneos, edição, agenda), público no schema 25, unificação completa, prévia desatualizada por agendamento, recebimento, estorno, comissão apurada ou revertida, situação e e-mail; gravação antes e depois da trava da unificação (duas conexões); concorrência com público, agenda, INSERT direto, edição, outra unificação e a mesma repetida; preferências; recusas (mesmo cadastro, par não sugerido, lápide, outro estabelecimento, gerente com permissões concedidas);
  - `test/consumer-migrations.db-e2e-spec.ts`: a 25 a partir da 24 com dados e o retorno recusado com telefone repetido;
  - `test/consumers-identity-postgres.db-e2e-spec.ts`: agora o banco principal é o 25 e o 24 é o temporário (UNIQUE recriado), para o código que funciona nos dois;
  - `test/public-booking-postgres.db-e2e-spec.ts`: outro nome no mesmo telefone vira outro cadastro; mesmo nome reaproveita;
  - `test/isolamento-estabelecimentos-postgres.db-e2e-spec.ts`: prévia e unificação;
  - `test/schema-readiness-postgres.db-e2e-spec.ts`: esta versão recusa o banco sem a 25.
- **Navegador:** `tests/browser/clients-flow.spec.ts`, teste "telefone compartilhado, ficha, edição, unificação e gerente sem Unificar".

## Estado e retomada

**Retomada curta (encerrado no PC do trabalho em 23/11/2026):**
- **Última publicação:** API e web em `63f1cd6`, banco com 25 migrations.
- **Testes manuais concluídos pela pessoa responsável, sem problemas:** fluxos de clientes e navegação no celular.
- **Próxima prioridade: a experiência no celular**, que deve ser o principal meio de uso.
  - Na retomada, primeiro identificar problemas concretos.
  - Depois, fazer ajustes pequenos, um de cada vez, sem mudar o desktop.
  - Nenhuma alteração de interface foi começada.
- **Pendências que continuam:** as listadas abaixo, no fim desta seção.

**23/11/2026 (PC do trabalho): Lote C publicado.** Piloto com API e web em `63f1cd6` (SHA_B) e banco com 25 migrations.

**Merges:**
- #138 (docs): `41fe1e1`.
- #139 (PR 1): `15e2790` = SHA_A. CI dos dois workflows verde no head `298a2e1`. Correções antes do merge: contagem de tabelas do `lote6b2-migration` de 60 para 62 (a diferença é exatamente `consumer_create_requests` e `whatsapp_consent_events`) e a falha intermitente de `commercial-access-postgres`, que vinha de estabelecimentos do plano modular criados por outro arquivo no banco compartilhado (filtro pela marca do arquivo).
- #140 (PR 2): `63f1cd6` = SHA_B. CI dos dois workflows verde no head `4d449ec`. Correções no fim:
  - `whatsapp-contato-flow` interceptava `/consumers/page`, mas a busca da tela agora usa `/consumers/groups`;
  - o job de navegador + API ganhou 30 minutos, porque as execuções verdes anteriores já levavam cerca de 20 (o limite);
  - `web-push-crypto.spec.ts` falhou uma vez e passou ao rodar de novo: a chave privada gerada no teste às vezes tem 31 bytes (cerca de 1 vez em 256). O teste é anterior a este lote e não foi corrigido.

**Backup e restauração:** `%USERPROFILE%\AgendaCloud-operacoes\pre-mig23-22-backup-2026-11-23T14-13-11Z` (PG 17.12, 22 migrations, 60 tabelas). Restaurado num PostgreSQL 17 descartável com TLS: contagem e md5 iguais em todas as tabelas (`restauracao-conferida.json` na mesma pasta).

**Diagnóstico C0 de 23/11 (cópia restaurada, só agregados):** igual ao de 18/11.
- 1 estabelecimento com clientes, 9 clientes;
- 0 grupos com telefone repetido;
- 0 grupos com variação de 9º dígito ou DDD com zero, e nenhum DDD com zero;
- 1 grupo com mesmo nome e telefones diferentes (4 cadastros);
- 1 cadastro com mais de um nome nos agendamentos;
- opt-in e opt-out: 0 e 0;
- 1 celular com 9 seguido de 0–5;
- 1 telefone fora de qualquer padrão. É o cadastro com `phone_match_key` nulo depois da migration 24.

**Ensaio na cópia (todas OK, pela API e pela tela):**
- janela 1: API e web atuais no schema 24;
- janela 2: API A com o web atual;
- retorno da seção P3: telefone editado pela API A, depois a API atual de volta;
- migration 25 aplicada com a API A no ar;
- janela 3: API A no schema 25;
- janela 4: API B com o web atual;
- janela 5: API B com o web B.

**Publicação no piloto (23/11, UTC).** As consultas da seção P2 rodaram antes e depois de cada migration, no lugar de `pilot:check-database`.
1. Migration 23 com o kit do SHA_A. Depois, a 24. Resultado: 24 migrations, gatilho presente, UNIQUE ainda presente, 9 clientes, 0 lápides, 1 sem chave, 0 pedidos de cadastro, 0 eventos de consentimento.
2. API `15e2790`, deploy `dep-dc24nfm8bjmc739jsjtg`. `/health` 200.
3. Migration 25 com o kit do SHA_B. Resultado: 25 migrations, UNIQUE removido, os mesmos 9 clientes.
4. API `63f1cd6`, deploy `dep-dc24ofp42hec739098og`. `/health` 200, sem erro no log.
5. Web `63f1cd6`, deploy `dep-dc24p2bm8hqs73b67cn0`. Fila vazia nos dois serviços.

**Retorno:** depois da migration 25 o piso é a API SHA_A. A API `0d8f479` não volta (seção P3).

**Teste manual (responsável), concluído sem problemas:** a pessoa responsável confirmou, em 23/11, que fez o roteiro curto de teste do runbook com sessão real no piloto em `63f1cd6`. O roteiro cobre:
- grupo e ficha;
- aviso de "mesmo nome";
- edição de telefone mantendo o histórico;
- "Usar este" e "Cadastrar outra pessoa";
- unificação como dono, conferindo também que cancelar não grava nada e que o gerente não vê "Unificar".

O teste no celular do Lote N (navegação) também foi concluído sem problemas.

**Pendências que continuam:**
- `web-push-crypto.spec.ts` segue instável (cerca de 1 falha em 256, por causa da chave privada de 31 bytes) e não foi corrigido;
- o backup de 23/11 deve ser guardado (abaixo).

**Só neste computador:**
- o backup acima, que deve ser guardado;
- os clusters descartáveis da sessão (scratchpad), que podem ser apagados.
