# Edição do catálogo modular em "Planos e adicionais"

O proprietário da plataforma edita, **só na página "Planos e adicionais" do portal**:

- o nome, a descrição e o preço mensal padrão do **Agendamento essencial**;
- o nome, a descrição e o preço mensal padrão de cada **adicional**, inclusive os em desenvolvimento e os planejados.

Branch `feat/portal-catalogo-modular-edicao`, a partir da integration em `ac67d06`.

## 1. Decisões do responsável (18/11/2026)

- **Onde se edita:** cada cartão da página tem a ação "Editar". Na criação e na ficha do estabelecimento, nome e descrição são só leitura, sem campo, atalho ou ação para mudar o catálogo.
- **O que continua igual na ficha:** a escolha de adicionais, o limite de usuários e o valor contratado por estabelecimento seguem as regras existentes. Esses ajustes não mudam o catálogo.
- **Quem pode:** só os proprietários da plataforma (papel `MASTER_OWNER`), conferido pela API. O código não tem nome, e-mail nem id fixo, e nenhum papel de conta foi mudado.
- **Adicionais em desenvolvimento ou planejados:** são editáveis, mantêm a disponibilidade e continuam sem poder ser contratados.
- **Preço padrão:** mudar não reajusta contrato, pagamento nem período pago.
- **Renomear:** não muda o código, o recurso, as permissões, os vínculos nem a disponibilidade. O essencial continua sendo a base obrigatória, mesmo renomeado.
- **Preços:** os já cadastrados são preservados. Nenhum valor de exemplo é gravado.
- **Planos antigos:** ficam como estão. Não são editados, apagados nem convertidos.
- **Histórico administrativo:** registra quem mudou, quando, e os valores anteriores e novos.

## 2. Como funciona

- **Rotas novas:**
  - `PUT /platform/catalog/essential`
  - `PUT /platform/catalog/addons/:code`

  As duas recebem `requestKey`, `expected` (nome, descrição e preço que a tela leu), `name`, `description`, `priceCents` e `reason` opcional. O corpo é estrito: disponibilidade, código, recurso e estabelecimento são recusados com 400.

  Serviço: `backend/src/platform/modular-catalog.service.ts`. Regras puras: `backend/src/commercial/catalog-edit.ts`.

- **Permissão:**
  - Usa `lifecycleActor`: `MASTER_OWNER` ativo, com senha confirmada há pouco nesta sessão. É a mesma regra das rotas de preço que já existiam (`PUT /platform/plans/:planId/prices/:cycle` e `PUT /platform/addons/:code/price`), que continuam iguais.
  - Outro papel recebe 403. Sem a confirmação de senha, a resposta é `REAUTENTICACAO_NECESSARIA`.
  - Toda rota `/platform` também passa pelo guard do segundo fator.

- **Onde cada dado fica:**
  - Nome e descrição: na própria linha (`plans` do `plan_modular` ou `addon_modules`).
  - Preço: continua sendo uma linha **nova** em `plan_prices` (mensal) ou `addon_module_prices`. O histórico de preços fica inteiro.
  - Nunca são tocados: `feature_key`, `availability`, `sort_order`, `plan_features`, `tenant_feature_overrides`, `tenant_subscriptions` e itens, `tenant_contract_prices` e `tenant_access_periods`.

- **Trava:** a edição trava a linha do essencial e depois todas as linhas de adicionais, na mesma ordem das rotas de preço.

- **Recusas e repetição:**

  | Situação | Resposta |
  |---|---|
  | Pedido repetido com o estado já igual ao pedido (rede caiu, envio duplo) | `changed: false`, sem gravar de novo |
  | Leitura desatualizada | 409 `ALTERADO_POR_OUTRA_TELA` |
  | Nome igual ao de outro item, sem diferença de maiúsculas, acentos ou espaços | 409 `NOME_REPETIDO` |
  | Preço definido voltando a pendente | 409 `PRECO_OBRIGATORIO` |
  | Mesma chave já usada num preço com outro conteúdo | 409 `CHAVE_REPETIDA` |

- **Histórico administrativo:** a ação nova `CATALOG_ITEM_CHANGED` ("Catálogo modular alterado") guarda:
  - em `previous_data` e `new_data`: item, nome, descrição e preço;
  - também: quem fez e quando;
  - o resumo, que diz que assinaturas, pagamentos e períodos não mudam.

  Mudança e registro entram na mesma transação.

- **Linha do essencial:** se `plan_modular` ainda não existir, a edição do essencial a cria, como já fazia o primeiro preço base (`ensureModularPlan`).

- **Nomes atuais nas telas:**
  - `GET /platform/addons` e a aba "Plano e adicionais" trazem `essential` (nome, descrição e preço atuais, via `loadEssential`).
  - A criação, a aba, a revisão, o resumo e o histórico de versões usam esse nome. Os adicionais já vinham de `addon_modules`.
  - A Visão geral do dono sem o adicional de indicadores mostra o nome atual dele (`indicators.addonName`).
  - Versões antigas guardam código e preço da data. O nome exibido é o atual, porque o código não muda.
  - Os resumos antigos do histórico administrativo ficam com o texto da época.

## 3. Migration 20: `CatalogItemEdit1793923200000`

- **O que faz:** só `ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CATALOG_ITEM_CHANGED'`. Nenhuma tabela, coluna ou linha muda.
- **Down:** vazio, porque o PostgreSQL não remove valor de enum.
- **API anterior (`ac67d06`) num banco com 20:** sobe. A checagem de inicialização exige as migrations do manifesto dela e não recusa uma a mais. A API anterior nunca grava esse valor.
- **Web anterior com a API nova:** os validadores do web anterior aceitam campos a mais. As rotas novas só são chamadas pelo web novo.
- **Ordem de publicação:** migration (backup novo, restauração conferida, ensaio na cópia) → API → web, no mesmo SHA.

## 4. Testes

- **Unitários:**
  - backend: `commercial/catalog-edit.spec.ts` e spec da migration;
  - web: `src/lib/administracao/catalogo-modular.test.ts` e `assinatura.test.ts` (validadores com `essential` e nome atual na revisão).
- **HTTP** (`backend/test/catalogo-modular.e2e-spec.ts`):
  - corpo estrito nas rotas novas;
  - 401 sem sessão, e o 403 do serviço chega à resposta;
  - a aba da ficha e a criação recusam nome, descrição ou preço do catálogo, inclusive por chamada direta.
- **db-e2e** (`backend/test/catalogo-modular-postgres.db-e2e-spec.ts`):
  - persistência e histórico (quem, quando, antes e depois);
  - essencial renomeado nas telas;
  - planejado editável e não contratável;
  - preço padrão sem reajuste de versão, contrato, pagamento ou período;
  - renomear sem mudar código, recurso, liberação nem vínculos;
  - permissões nas rotas novas e nas rotas de preço antigas (`MASTER_ADMIN`, `MASTER_SUPPORT`, conta comum, sem confirmação de senha);
  - repetição em paralelo, leitura desatualizada, nome repetido, preço pendente e chave reaproveitada;
  - criação e alteração da assinatura sem mudar o catálogo.

  A lista de rotas do portal em `platform-portal-postgres` ganhou as duas rotas novas: 403 para todo papel que não é proprietário.
- **Navegador** (`tests/browser/catalogo-modular-flow.spec.ts`, em `test:browser:administracao`):
  - "Editar" em cada cartão, Cancelar, validação, nome repetido;
  - planejado editável e não contratável;
  - criação e ficha com os nomes atuais e sem edição;
  - os quatro temas, a 1280 e a 390 px, sem rolagem horizontal.

  `assinatura-modular-flow` passou a usar o "Editar".

## 5. Estado e retomada

**Feito e publicado em 18/11/2026 (PC do trabalho):**

- **PR #125:** CI verde nos dois workflows no head final `179949d`. Mesclado como `208d7eebd380e2b0a0539c7dd35cc6668d3d7ccc`.
  - O primeiro head (`109886b`) falhou só na suíte de temas: a leitura do menu de `/conta` vinha logo depois de `goto`, sem espera, e dava corrida. As três leituras passaram a esperar o menu (`c0b6c82`, `179949d`), e a suíte passou local e no CI.
- **Antes da migration:**
  - piloto com API e web em `ac67d06` e banco com 19;
  - backup `pre-mig20-19-backup-2026-11-18T16-14-25Z` em `%USERPROFILE%\AgendaCloud-operacoes`, no PC do trabalho, com `pg_dump` 17.12 em snapshot `REPEATABLE READ READ ONLY` e conexão `verify-full`;
  - restauração conferida num PostgreSQL 17.12 descartável: sha256, 54 tabelas com contagem e md5 iguais, e a mesma lista de 19 migrations.
- **Ensaio na cópia restaurada:**
  - partiu da cópia limpa `C:/wt/mig20` (`208d7ee`) e aplicou só `CatalogItemEdit1793923200000`, chegando a 20;
  - a conferência de inicialização da API anterior (`ac67d06`, mesmo `backend/` de `4585af0`) nesse banco deu "19 de 19", com aviso da migration a mais, sem bloquear.
- **Piloto:**
  - migration aplicada às 16:15 UTC; conferência depois: 20 migrations e o valor `CATALOG_ITEM_CHANGED` no enum;
  - API `dep-dbusuj68bjmc739r0fn0` live às 16:17 UTC, com log "20 de 20";
  - web `dep-dbusvbec6qcc73ba5190` live às 16:19 UTC;
  - os dois em `208d7ee`.
- **Dados preservados:** 2 preços de adicional, 8 preços de plano, 1 versão de assinatura e 3 estabelecimentos. Nenhuma edição de catálogo foi feita pela operação: `CATALOG_ITEM_CHANGED` = 0.
- **Verificações sem sessão no piloto:**
  - 200: API `/`, web `/login`, `/portal`, `/portal/planos` e `/conta`;
  - 401: `auth/me`, `GET platform/addons`, `PUT platform/catalog/essential`, `PUT platform/catalog/addons/COMISSOES` e `PUT platform/addons/COMISSOES/price`.
- **Testes com login:** só locais, num PostgreSQL descartável com TLS e dados fictícios. Ver a seção 4.

**Pendente:**

- Teste manual com sessão no piloto, pelo proprietário. Ninguém entrou no piloto nesta operação.
- Um backup incompleto ficou de uma tentativa que falhou por certificado (`pre-mig20-19-backup-2026-11-18T16-12-12Z`, `piloto.dump` vazio). Há também um backup completo de 16:13 (`pre-mig20-19-backup-2026-11-18T16-13-22Z`), mas a restauração dele não confere, porque o md5 do manifesto foi calculado com o fuso da sessão. Os dois foram preservados. O ponto de recuperação é o de 16:14.

**Retorno compatível:**

- API e web juntos para `ac67d06` (API `dep-dbuqs2c9v7es739cvnmg`, web `dep-dbuqsiu7bikc73aojkeg`).
- O banco fica com 20, porque o valor do enum não sai, e a API anterior sobe assim, como ensaiado.
- Edições já feitas permanecem: nomes, descrições e preços continuam valendo na API anterior. Ela só não tem a tela de edição.

**Como testar no piloto (com sessão de proprietário):**

1. Abra Portal → Planos e adicionais. Cada cartão da "Assinatura modular", inclusive os planejados, tem "Editar".
2. Edite um item (por exemplo, o nome de um planejado) e salve. Confirme a senha se pedida. O cartão mostra o novo nome, e o planejado continua "Planejado".
3. Em Histórico administrativo, aparece "Catálogo modular alterado", com os valores antes e depois.
4. Em Estabelecimentos → Novo estabelecimento e na aba "Plano e adicionais" de uma ficha, os nomes são os atuais e não há campo nem botão para editar o catálogo.
5. Para voltar ao nome anterior, edite de novo. A volta também fica no histórico.

**Só neste computador:**

- os backups acima;
- os PostgreSQL descartáveis e o script de operação, na pasta temporária da sessão (descartáveis).
