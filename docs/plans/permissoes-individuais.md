# Plano: permissões individuais, autorização pontual e caixas independentes

Data: 26/11/2026, revisão 4. Situação: decisões de negócio aprovadas em 26/11/2026; etapa 1 em andamento (Vendas, Estoque, Agenda e Recebimentos mesclados, Clientes em revisão; ver "Estado e retomada" no fim). Nada foi migrado ou publicado.

Protótipo: `AgendaCloud-operacoes/prototipos/pdv-nova-venda/index.html`, fora do repositório (tela "Fluxo e decisões" e cenário de exemplo). A seção 9 lista o que o protótipo ainda mostra diferente desta revisão.

Plano complementar: `docs/plans/pdv-balcao.md` (Balcão, venda digitada, venda em espera, troco e produto disponível).

Código inspecionado: árvore `4e0d841` (igual a `8f71335`, o que está no piloto), em `C:\wt\vendas-pr4`.

## Decisões aprovadas (26/11/2026, não reabrir)

As referências a "escolha N" no texto apontam para a decisão N da lista "Escolhas resolvidas" abaixo.

**Gerais:**
- **O cargo é texto livre e não concede nada.** Permissões são individuais.
- **Cada funcionário tem o próprio caixa.** Os caixas são independentes, e vários podem ficar abertos ao mesmo tempo.
- **Só o dono consulta caixas de outras pessoas e caixas fechados,** inclusive o próprio caixa depois de fechado e inclusive depois de "Liberar tudo". Nenhuma permissão concede essa consulta.
- **Abrir e fechar caixa são permissões separadas,** sem concessão automática. Quem hoje recebe não ganha caixa. As concessões de caixa são escolhidas pelo dono na ativação (seção 4.1), que é explícita, com conferência das pessoas afetadas e sem conceder nem retirar nada por omissão.
- **Unificar clientes é só do dono** (decisão de 19/11).
- **Venda digitada e venda em espera estão aprovadas** (plano do PDV).
- **Pagamento parcial ou dividido fica fora desta versão.** Continua um recebimento integral por venda.

**Escolhas resolvidas:**
1. **Recebimentos da Agenda entram no caixa** quando o controle estiver ativo, identificados como Atendimento. Vendas e atendimentos mantêm indicadores separados; o ticket médio nunca mistura os dois (seção 4.8).
2. **Áreas administrativas delegáveis:** Visão geral, configurações, comissões de todos e gestão da equipe viram permissões concedíveis separadamente. O delegado nunca altera o próprio acesso nem o do dono, e nunca concede o que não tem (seção 7). Titularidade, portal administrativo e contratação continuam fora do estabelecimento.
3. **Estorno:** sai do caixa aberto de quem executa a devolução, ligado ao recebimento original. Só dinheiro afeta a gaveta. Caixa fechado não muda.
4. **Caixa esquecido:** o dono pode encerrar o caixa de outra pessoa, com o valor realmente contado ou como "Encerrado sem conferência". Sem contagem, a diferença fica desconhecida (NULL), nunca zero por suposição (seção 4.4).
5. **Autorizar** exige a permissão `*_AUTORIZAR` e a ação em GRANTED (permissão direta), respeitando as restrições do dono. Sem limite de valor nesta versão.
6. **Cancelar a própria venda** não exige consultar as vendas de outras pessoas. Continuam o motivo, o histórico e o estorno prévio quando houver recebimento. Vale no modelo INDIVIDUAL; o LEGADO mantém a regra atual.
7. **Própria agenda** é concedível no modelo INDIVIDUAL (`ATENDIMENTO_PROPRIO_VER`); o LEGADO mantém o acesso automático de hoje.
8. **Controle de caixa é opcional por estabelecimento.** Depois de ativado, os recebimentos abrangidos exigem caixa aberto. Para desativar, todos os caixas precisam estar fechados; o histórico permanece.

## 1. Como a autorização funciona hoje

### Papéis e vínculo

- `memberships.role` usa o enum `establishment_role`, com os valores DONO, GERENTE, RECEPCIONISTA e PROFISSIONAL.
- Quando há profissional ligado, ele fica em `memberships.professional_id`, que tem um índice único parcial.
- `memberships.status` (ACTIVE ou SUSPENDED) é relido a cada requisição.

### Ajustes de permissão

Os ajustes ficam em `membership_permission_overrides`, que guarda `permission` e `mode` (GRANTED ou DENIED).

| Papel | Regra efetiva hoje |
|---|---|
| DONO | Tudo, menos o que tiver DENIED na ação ou numa dependência dela (`algumaNegada`). Só ele acessa Visão geral, configurações, agendamento online, avisos, Equipe e acessos, comissões de todos, unificar clientes e plano. |
| GERENTE | Recebe as 24 concessões de `MANAGER_PERMISSIONS`, mais as `STAFF_PERMISSIONS`, cada uma com as dependências (`managerCan`). As concessões só valem depois que o dono confirma (`permissions_confirmed_at`, ver `effectiveOverrides`); antes disso, os GRANTED são descartados e os DENIED ficam. Vê a própria agenda quando tem profissional ligado e as permissões estão confirmadas. |
| RECEPCIONISTA | Só vale `VENDAS_REGISTRAR`, `VENDAS_RECEBER` e `VENDAS_ALTERAR_PRECO` (`receptionistCan`). Qualquer outro GRANTED gravado é ignorado. |
| PROFISSIONAL | Vê a própria agenda automaticamente (`canViewOwnAgenda`), sem precisar de confirmação. Por concessão, recebe só as quatro `STAFF_PERMISSIONS`; qualquer outro GRANTED é ignorado. |

Em todos os papéis que não são DONO, um DENIED vence um GRANTED da mesma permissão.

### Regras que valem para todos

- **Concessão:** `validarConcessoes` recusa nestes casos:
  - permissão fora do papel (`PERMISSAO_NAO_SE_APLICA`);
  - recurso sem o adicional contratado (`RECURSO_NAO_CONTRATADO`);
  - permissão que o próprio dono não tem (`PERMISSAO_NAO_DISPONIVEL`);
  - conjunto sem as dependências (`PERMISSOES_INCOMPLETAS`).
- **Ordem da checagem:** `resolveAuthorizedTenant` confere, nesta ordem:
  1. vínculo (sem vínculo, a resposta é 404);
  2. situação do vínculo;
  3. situação do estabelecimento;
  4. acesso comercial;
  5. recurso do plano.

  Só depois aplica a política pessoal.
- **Manutenção de vendas:** consultar, receber, estornar e cancelar vendas já registradas não exige recurso (`SALES_MAINTENANCE_FEATURES = null`). Uma nova venda exige VENDAS e ESTOQUE. Assim, retirar o adicional VENDAS bloqueia novas vendas sem prender as antigas. As concessões VENDAS_* gravadas continuam valendo para essa manutenção.
- **Vagas:** `team/seats.ts` conta os vínculos que não são DONO mais os convites pendentes, com o estabelecimento travado.
- **Senha recente:** `accounts/reauth.ts` exige a senha confirmada nos últimos 10 minutos para cancelar, estornar e administrar contas. A marca fica na sessão de quem está conectado.
- **Auditoria:** `audit_logs` guarda o autor, o estabelecimento, a pessoa afetada e os dados de antes e depois.

### Vendas e estoque hoje

- **Vendas:**
  - `sales` guarda `recorded_by_user_id` e `request_key` (UNIQUE por autor), e um gatilho impede a mudança de colunas depois da gravação.
  - `sale_payments` tem no máximo um recebimento ativo por venda (`uq_sale_payments_active`), e o gatilho `sale_payments_guard` exige valor igual ao total da venda. O estorno é gravado na mesma linha: `refunded_at`, `refunded_by_user_id` e `refund_reason`.
  - Uma venda só é cancelada sem recebimento ativo, por isso o cancelamento de uma venda recebida tem dois passos.
  - A "venda própria" é a que a pessoa registrou (`recorded_by_user_id`), sem relação com o vínculo de profissional.
- **Como se encontra uma venda para receber hoje** (`canReceiveSale`, `canAccessSalesHistory`):
  - a própria venda: com `VENDAS_RECEBER`, que hoje exige `VENDAS_REGISTRAR`. A pessoa a encontra em "minhas operações", que lista as vendas que ela registrou e os recebimentos que ela gravou;
  - a venda de outra pessoa: só com `VENDAS_RECEBER` e `VENDAS_VISUALIZAR`. Para receber de outras pessoas, a pessoa precisa hoje da consulta geral de todas as vendas, com histórico, cancelamentos e estornos;
  - a consulta geral sozinha não recebe.
- **Estoque:**
  - `canManageStock` usa uma única permissão, `ESTOQUE_GERENCIAR`, para cadastrar produtos e categorias, movimentar, estornar movimentos e confirmar conferências.
  - Categorias e subcategorias já existem: `stock_categories`, `stock_subcategories` (cada uma presa a uma categoria) e, no produto, `category_id NOT NULL` e `subcategory_id NULL`. As três têm `archived_at`.
  - O produto tem `purpose`: VENDA, CONSUMO_INTERNO ou AMBOS.
  - O catálogo do Balcão hoje mostra o produto não arquivado, com `purpose` VENDA ou AMBOS e com categoria e subcategoria não arquivadas. Ele aceita produto sem preço sugerido, que só pode ser vendido por quem tem `VENDAS_ALTERAR_PRECO`. A busca é só por nome, e não há filtro por categoria.
- **Ainda não existem** caixa, turno, movimento de dinheiro, venda digitada, venda em espera nem troco.

## 2. Modelo proposto

### 2.1 Papel interno, modelo de acesso, cargo e vínculo

- **DONO continua igual.** Ele é o titular, tem tudo menos o que estiver em DENIED, e a equipe não pode editá-lo.
- **Modelo de acesso por pessoa.** A coluna nova `memberships.access_model` assume os valores `LEGADO` (padrão de todas as linhas existentes) ou `INDIVIDUAL`.
  - **LEGADO:** as concessões efetivas são calculadas exatamente pelas regras de hoje, incluindo o teto por papel, a confirmação do gerente e a agenda própria automática (seção 5.2).
  - **INDIVIDUAL:** vale só o que está concedido, com as dependências técnicas, e nenhuma permissão pode estar em DENIED. O papel deixa de limitar.
  - **Passagem para INDIVIDUAL:** só acontece quando o dono salva aquela pessoa na tela nova de Equipe e acessos, cria um acesso novo ou confirma a pessoa na ativação do controle de caixa (seção 4.1). Nunca é feita por migration.
- **Uma pergunta só nas políticas:** `staffCan(acesso, permissao)`, em que `acesso` são as concessões efetivas já calculadas para os dois modelos.
- **Os valores do enum não são removidos.** GERENTE, RECEPCIONISTA e PROFISSIONAL continuam nas linhas existentes e no enum.
- **Acessos novos são gravados como GERENTE**, já confirmados e com `access_model = INDIVIDUAL`. GERENTE é o papel que o par anterior da aplicação já lê só por concessões; com isso, nenhum valor novo entra no enum de papéis.
- **Cargo:** coluna nova `memberships.job_title varchar(40) NULL`. Quando o campo está vazio, a tela sugere um rótulo a partir do papel antigo ("Recepcionista", "Gerente" ou o termo do segmento), sem gravar nada.
- **Vínculo com profissional:** é exigido só para o que é do próprio profissional:
  - ver a própria agenda;
  - iniciar, concluir e marcar falta nos próprios atendimentos;
  - ver as próprias comissões.

  Vender, receber, estornar e operar o próprio caixa não exigem vínculo. Nesses casos, "próprio" é o que a pessoa registrou ou o caixa que ela abriu.

### 2.2 Matriz

A matriz completa está no protótipo. Em resumo:

| Área | Já existe | Muda a forma | Nova |
|---|---|---|---|
| Agenda | AGENDA_*, AGENDAMENTO_*, SOLICITACOES_*, ATENDIMENTO_PROPRIO_INICIAR/CONCLUIR/FALTA | A agenda própria passa a ser `ATENDIMENTO_PROPRIO_VER` no modelo INDIVIDUAL (escolha 7) | — |
| Clientes | CONSUMIDORES_VISUALIZAR/GERENCIAR | — | — |
| Profissionais e serviços | PROFISSIONAIS_*, SERVICOS_* | — | — |
| Estoque | ESTOQUE_VISUALIZAR | ESTOQUE_GERENCIAR dividido em quatro (seção 5.3) | ESTOQUE_PRODUTOS, ESTOQUE_MOVIMENTAR, ESTOQUE_ESTORNAR, ESTOQUE_CONFERIR |
| Vendas | VENDAS_REGISTRAR, VENDAS_VISUALIZAR, VENDAS_ALTERAR_PRECO, VENDAS_CANCELAR | Preço e cancelamento ganham três níveis | VENDAS_ALTERAR_PRECO_AUTORIZAR, VENDAS_CANCELAR_AUTORIZAR. Com o plano do PDV: VENDAS_DIGITAR e, só se a decisão do PDV pedir, VENDAS_ESPERA_OUTRAS |
| Recebimentos | VENDAS_RECEBER, VENDAS_ESTORNAR_RECEBIMENTO, RECEBIMENTOS_* | VENDAS_RECEBER passa a valer só para a venda própria (seção 2.5). Os dois estornos ganham três níveis | VENDAS_RECEBER_OUTRAS, VENDAS_ESTORNAR_RECEBIMENTO_AUTORIZAR, RECEBIMENTOS_ESTORNAR_AUTORIZAR |
| Caixa | — | — | CAIXA_ABRIR, CAIXA_FECHAR, CAIXA_ENTRADA, CAIXA_SANGRIA, CAIXA_SANGRIA_AUTORIZAR. Só aparecem depois da ativação do controle de caixa (seção 4.1) |
| Comissões | COMISSOES_PROPRIAS_VISUALIZAR | COMISSOES_VISUALIZAR/GERENCIAR passam a ser concedíveis (escolha 2) | — |
| Administração (escolha 2) | EQUIPE_GERENCIAR (hoje só do dono) | Passa a ser concedível, com as travas da seção 7 | Visão geral e configurações (códigos definidos na etapa 3, conferindo o enum) |

- **Ficam fora da matriz e de "Liberar tudo":**
  - consultar caixas de outras pessoas e caixas fechados (decidido);
  - unificar clientes (decidido);
  - CAIXA_*, enquanto o estabelecimento não ativou o controle de caixa.
- **Nunca são do estabelecimento:** titularidade, portal administrativo e contratação de adicionais, plano ou vagas.
- **Sem tela por trás:** `RELATORIOS_VISUALIZAR` e `EQUIPE_VISUALIZAR` existem no enum, mas nenhuma política os usa. Ficam fora da matriz.
- **Caixa e adicional:** o caixa faz parte do adicional Vendas, sem adicional novo e sem preço novo.
  - Ativar o controle de caixa e conceder CAIXA_* exigem o adicional, como VENDAS_*.
  - Operar o caixa segue a regra de manutenção: sem o adicional, quem tem a concessão ainda abre, recebe vendas antigas, estorna, faz sangria e fecha. Assim, retirar o adicional não prende dinheiro em nenhum caixa.

### 2.3 Dependências: técnicas e de conveniência

- **Dependência técnica:** sem ela, a ação não consegue ser executada. Fica em `MANAGER_PERMISSION_REQUIRES`, e o servidor recusa um conjunto incompleto.
- **Dependência técnica condicional:** só vale depois que o estabelecimento ativa o controle de caixa. Fica numa tabela própria (`CASH_CONTROL_REQUIRES`), lida por `validarConcessoes` quando `cash_control_enabled_at` está preenchido.
- **Conveniência:** a ação funciona sem ela. Vira uma sugestão da tela ("costuma vir junto"), que o dono pode desmarcar, e nunca é imposta pelo servidor.

| Permissão | Exige hoje | Classificação proposta |
|---|---|---|
| VENDAS_RECEBER | VENDAS_REGISTRAR | **Conveniência.** A própria venda a receber aparece na lista da seção 2.5, que faz parte da permissão de receber. Quem só recebe no balcão, sem vender, deixa de ganhar "Balcão" junto. **Condicional:** com o controle de caixa ativo, exige CAIXA_ABRIR, porque o recebimento entra no caixa aberto de quem recebe. Antes da ativação, não exige nada de caixa. |
| VENDAS_RECEBER_OUTRAS | — (hoje é VENDAS_RECEBER mais VENDAS_VISUALIZAR) | **Técnica:** exige VENDAS_RECEBER. **Não exige VENDAS_VISUALIZAR.** A tela pode sugerir a consulta geral, e o dono pode desmarcar. |
| VENDAS_ALTERAR_PRECO, VENDAS_DIGITAR | VENDAS_REGISTRAR | Técnica: só existem dentro de uma venda nova. |
| VENDAS_CANCELAR, VENDAS_ESTORNAR_RECEBIMENTO | VENDAS_VISUALIZAR | Técnica para a venda de outra pessoa. Cancelar a própria venda não exige VENDAS_VISUALIZAR no modelo INDIVIDUAL (escolha 6). **Condicional:** com o controle de caixa ativo, o estorno exige CAIXA_ABRIR, porque ele sai do caixa de quem estorna (escolha 3). |
| CAIXA_FECHAR, CAIXA_ENTRADA, CAIXA_SANGRIA | — | Técnica: exigem CAIXA_ABRIR, porque só o próprio funcionário abre o caixa dele. |
| CAIXA_ABRIR | — | Sem dependência. Quem pode abrir mas não fechar depende do dono para encerrar (escolha 4). A tela sugere CAIXA_FECHAR junto e avisa quando ele fica desmarcado. |
| ESTOQUE_PRODUTOS/MOVIMENTAR/ESTORNAR/CONFERIR | — | Técnica: exigem ESTOQUE_VISUALIZAR, porque operar pede ver o produto e o saldo. |
| RECEBIMENTOS_* | RECEBIMENTOS_VISUALIZAR, AGENDA_VISUALIZAR, PROFISSIONAIS_VISUALIZAR | Técnica: o recebimento é lançado sobre um atendimento da agenda. |
| AGENDA_VISUALIZAR | PROFISSIONAIS_VISUALIZAR | Técnica hoje, porque a tela busca as colunas por outra rota. Poderia virar conveniência se a agenda devolvesse os nomes. |
| AGENDAMENTO_CRIAR | serviços, clientes e agenda | Técnica: escolher serviço e cliente. |
| *_AUTORIZAR | — | Exige a mesma ação em GRANTED (escolha 5). |
| *_GERENCIAR em geral | o *_VISUALIZAR da área | Técnica. |

**Efeito na migração:** relaxar uma dependência não muda o acesso de ninguém. Os conjuntos gravados já têm todas as dependências atuais, e o modelo LEGADO continua aplicando o cálculo atual. As dependências condicionais só passam a valer na ativação, com as concessões escolhidas pelo dono.

### 2.4 Três níveis

- **Quais ações:**
  - estornar recebimento de venda;
  - estornar recebimento de atendimento;
  - cancelar venda;
  - alterar preço;
  - fazer sangria.
- **Gravação:** um valor novo de `permission_mode`, `APPROVAL`.
  - Linha ausente: bloqueado.
  - `APPROVAL`: somente com autorização.
  - `GRANTED`: permitido diretamente.
- **Leitura pelo par anterior:** a versão atual só procura GRANTED. Por isso, ela lê `APPROVAL` como "não concedido", que é o lado seguro.
- **Liberar tudo:** o servidor calcula o conjunto que o dono pode conceder, com o adicional contratado e fora das áreas da seção 2.2. A tela mostra esse conjunto e o resumo, e o dono pode desmarcar depois.

### 2.5 Como quem só recebe encontra as vendas

O alcance de receber é dado por duas concessões explícitas, e nenhuma delas inclui a consulta geral de vendas.

| Concessão | O que a pessoa recebe | O que a pessoa vê |
|---|---|---|
| VENDAS_RECEBER | Só a venda que ela mesma registrou. | Na lista "A receber", as próprias vendas ativas sem recebimento ativo. Em "Meus recebimentos", os recebimentos que ela gravou. |
| VENDAS_RECEBER_OUTRAS (com VENDAS_RECEBER) | Também a venda registrada por outra pessoa. | Na lista "A receber", também as vendas ativas sem recebimento ativo de outras pessoas. |
| VENDAS_VISUALIZAR (consulta geral) | Nada por si só, como hoje. | Todas as vendas, com histórico, cancelamentos, estornos e recebimentos de todos. |

**Lista "A receber"** (`GET /sales/receivable`, rota nova):
- **Conteúdo:** só vendas `ATIVA` sem recebimento ativo, filtradas pelo alcance acima no SQL, sempre com `tenant_id`.
- **Campos:** número, data e hora, quem registrou, nome do cliente quando houver, itens com quantidade e preço, e total.
- **Fica de fora:** telefone e e-mail do cliente, vendas recebidas, canceladas ou estornadas, recebimentos de outras pessoas e as compras do cliente na ficha.
- **Busca:** por número da venda ou nome do cliente, só dentro do mesmo alcance.
- **Ordem:** da mais recente para a mais antiga, paginada como as listas atuais.
- **Depois de receber:** a venda sai da lista. A pessoa continua vendo aquela venda só pelo recebimento que gravou, em "Meus recebimentos", e o detalhe dela fica acessível porque existe um recebimento dela nessa venda, inclusive depois de estornado.
- **Detalhe de uma venda de outra pessoa:** acessível só enquanto ela está na lista "A receber" da pessoa, ou quando a pessoa gravou um recebimento nela. Fora disso, 404, como hoje.
- **Estornar** continua exigindo VENDAS_ESTORNAR_RECEBIMENTO, que é outra concessão.

**Política:**
- `canReceiveSale(acesso, { ownSale })`: venda própria com VENDAS_RECEBER; de outra pessoa com VENDAS_RECEBER_OUTRAS.
- `canListReceivable(acesso)`: VENDAS_RECEBER.
- O alcance da lista vem de uma única função, usada pela lista, pelo detalhe e pelo recebimento, para que a lista nunca mostre uma venda que a pessoa não pode receber.

**Modelo LEGADO:** VENDAS_RECEBER_OUTRAS é efetiva somente quando VENDAS_RECEBER e VENDAS_VISUALIZAR estão efetivas, que é a regra de hoje. Essas pessoas já têm a consulta geral, então a lista "A receber" não lhes mostra nada novo. Quem tem só VENDAS_RECEBER, no LEGADO, também tem VENDAS_REGISTRAR, e a lista mostra só um subconjunto das próprias operações que essa pessoa já consulta.

**Modelo INDIVIDUAL:** o dono pode dar a uma pessoa receber de todos sem a consulta geral. Também pode dar a consulta geral com recebimento só das vendas próprias. As duas combinações são escolha explícita dele.

**Leitura pelo par anterior:** o par anterior não conhece VENDAS_RECEBER_OUTRAS e libera receber de outras pessoas a quem tem VENDAS_RECEBER e VENDAS_VISUALIZAR. Uma pessoa INDIVIDUAL com a consulta geral mas sem VENDAS_RECEBER_OUTRAS ganharia, no par anterior, o recebimento de outras pessoas. Não há sincronia que evite isso sem tirar a consulta geral. Por isso a contagem de pessoas INDIVIDUAL já impede o retorno (seção 6.1).

## 3. Autorização pontual no servidor

### 3.1 Pedido

- A rota da operação aceita, no mesmo corpo estrito, `approval: { approverMembershipId, password }`.
- A senha nunca vai para log, auditoria ou resposta.

### 3.2 Quem pode autorizar

Função pura `canAuthorize(autorizador, acao)`, em `common/approval-access.ts`:

- **Dono:** autoriza só o que ele mesmo pode fazer. Basta um DENIED na ação, numa dependência dela ou no `*_AUTORIZAR` correspondente para o dono não poder autorizar. A autorização do dono não passa por cima de uma restrição gravada pela administração.
- **Demais:** precisa ter `*_AUTORIZAR` nas concessões efetivas e a ação em GRANTED (escolha 5).
- **Recurso:** é o mesmo gate da rota. Estornar e cancelar vendas antigas continuam sem recurso, e com isso a autorização dessas manutenções segue funcionando depois que o adicional VENDAS é retirado. Uma venda nova com preço alterado exige VENDAS e ESTOQUE, como hoje.
- **Situação:** o vínculo do autorizador precisa estar ACTIVE, no mesmo estabelecimento, e o autorizador não pode ser quem executa.

### 3.3 Sequência

1. **Fora da transação:** carregar o autorizador pelo `membershipId` filtrado pelo `tenant_id` da operação.
   - Conferir o limite de tentativas, reaproveitando `account-rate-limit.ts`, com bloqueio temporário por autorizador e por quem executa. A proposta é a mesma política do login. Isso é decisão técnica.
   - Verificar a senha com Argon2id.
   - Se o autorizador não existir, estiver suspenso, for de outro estabelecimento, for quem executa, não tiver permissão ou errar a senha, a resposta é sempre a mesma: 403 `AUTORIZACAO_INVALIDA`, sem dizer qual foi o motivo.
   - A verificação acontece antes das travas, para o Argon2 não segurar linha travada.
2. **Na transação da operação:**
   - travar o registro afetado (seção 4.5);
   - reler o vínculo do autorizador com `FOR SHARE`, e com ele a situação e as concessões efetivas;
   - conferir de novo `canAuthorize`. Se a permissão foi retirada entre o passo 1 e o 2, a operação é recusada.
3. **Conferir quem executa:**
   - com a ação em `APPROVAL`, segue com a autorização;
   - com a ação em GRANTED, segue o caminho atual, com a própria senha recente;
   - com a ação bloqueada, a resposta é 403.
4. **Gravar quem autorizou:**
   - `sale_payments.refund_approved_by_user_id`;
   - `sales.cancel_approved_by_user_id`;
   - `sales.price_approved_by_user_id`;
   - no recebimento de atendimento, a coluna equivalente;
   - `cash_movements.approved_by_membership_id`;
   - em `audit_logs`, o autorizador entra em `new_data`.

   Os gatilhos de imutabilidade de `sales` e `sale_payments` passam a cobrir essas colunas: cada uma só é preenchida junto com a transição correspondente.
5. **Nada de sessão para o autorizador.** Nenhuma sessão é criada e nenhuma senha recente é marcada para ele.

### 3.4 Repetição

- A chave de pedido que a operação já tem continua valendo, e o estorno continua idempotente pelo estado.
- Uma repetição da operação já concluída devolve o resultado gravado, sem conferir a senha de novo e sem efeito duplicado.
- Uma autorização nunca serve para outra operação, porque não existe token separado que possa ser reutilizado.

## 4. Caixas independentes

### 4.1 Implantação separada da migração das permissões

A exigência de caixa aberto não entra junto com a migração das permissões. São três momentos distintos:

| Momento | O que muda | O que não muda |
|---|---|---|
| Publicação das permissões (etapas 1 a 4) | Modelo de acesso, matriz, VENDAS_RECEBER_OUTRAS, três níveis e autorização pontual. | Receber e estornar funcionam como hoje, sem caixa. Nenhuma pessoa ganha CAIXA_*. A comparação de acesso tem diferença zero, sem exceção (seção 5.4). |
| Publicação do caixa (etapa 5) | Tabelas, rotas e telas do caixa passam a existir, desligadas. | Em nenhum estabelecimento muda alguma coisa até o dono ativar. A comparação de acesso continua com diferença zero. |
| Ativação pelo dono (etapa 6, por estabelecimento) | O dono escolhe quem opera caixa. A partir daí, receber e estornar vendas exigem caixa aberto naquele estabelecimento. | Os outros estabelecimentos. Vendas e recebimentos anteriores continuam sem caixa. |

**Estado do estabelecimento:** colunas novas `tenants.cash_control_enabled_at timestamptz NULL` e `tenants.cash_control_enabled_by_user_id NULL`. Sem a ativação, o recebimento grava `cash_session_id` NULL, como hoje, e CAIXA_* não aparecem na matriz.

**Tela de ativação (só o dono, com senha recente):**
- **Pré-requisito:** o adicional Vendas contratado.
- **Lista:** todas as pessoas cujas concessões efetivas, LEGADO ou INDIVIDUAL, incluem receber ou estornar vendas.
- **Escolha por pessoa, sem nenhuma opção pré-marcada:**
  - conceder caixa: CAIXA_ABRIR e, à escolha, CAIXA_FECHAR, CAIXA_ENTRADA e CAIXA_SANGRIA (direto ou com autorização);
  - ou retirar receber e estornar vendas daquela pessoa.
- **Aviso:** a tela diz o que cada escolha faz. Quem fica sem caixa deixa de poder receber e estornar vendas depois da ativação.
- **Resumo antes de confirmar:** quem passa a operar caixa e quem deixa de receber ou estornar.
- **Recusa:** se alguma pessoa da lista ficar sem escolha, a resposta é 409 `ATIVACAO_INCOMPLETA`, com a lista das pendentes. A ativação nunca retira um acesso por omissão.
- **Pessoas LEGADO na lista:** passam a INDIVIDUAL nessa confirmação, com o conjunto efetivo mostrado e confirmado pelo dono (mesma regra da seção 5.2), porque o teto do papel antigo não comporta CAIXA_*. Quem não está na lista continua LEGADO.

**Transação da ativação:**
- trava o estabelecimento com `FOR UPDATE`;
- confere que ainda não está ativado (repetição devolve o estado gravado; chave de pedido com UNIQUE);
- relê as concessões efetivas e recusa com 409 `EQUIPE_ALTERADA` se a lista mudou desde a prévia;
- grava as concessões escolhidas e as remoções;
- preenche `cash_control_enabled_at`;
- registra em `audit_logs` a ativação e, para cada pessoa, o antes e o depois.

**Recebimento durante a ativação:** receber e estornar leem `cash_control_enabled_at` com `FOR SHARE` na linha do estabelecimento, como primeira trava (seção 4.5). Um recebimento que começou antes termina sem caixa; um que começa depois exige caixa aberto.

**Depois da ativação:**
- as dependências condicionais da seção 2.3 passam a valer para aquele estabelecimento;
- "Liberar tudo" passa a incluir CAIXA_*;
- desativar é permitido só com todos os caixas do estabelecimento fechados (escolha 8): a desativação trava o estabelecimento, recusa com 409 `CAIXAS_ABERTOS` se houver caixa aberto, limpa `cash_control_enabled_at` e mantém todo o histórico. As concessões CAIXA_* ficam gravadas, sem efeito, até uma nova ativação.

**Quando a ativação fica disponível:** a opção de ativar só aparece depois que o responsável encerrar a janela de retorno da publicação do caixa (seção 6.2). Até lá, ela fica desligada por configuração da plataforma. Assim, nenhum dono cria dados que impeçam esse retorno.

### 4.2 Tabelas

**`cash_sessions`** guarda um turno por linha.

- **Identificação:** `tenant_id`, `id`, `number` (sequência por estabelecimento) e `membership_id`, que é o dono do caixa.
- **Abertura:** `opened_at`, `opening_cents` (bigint) e `open_request_key`, com UNIQUE `(membership_id, open_request_key)`.
- **Fechamento:** `closed_at`, `closed_by_membership_id`, `close_request_key` e a fotografia da seção 4.4.
- **Um caixa aberto por pessoa:** índice único parcial `(tenant_id, membership_id) WHERE closed_at IS NULL`.
- **Chaves:** estrangeiras compostas com `tenant_id`.
- **Imutável depois de fechado:** um gatilho recusa qualquer UPDATE numa linha com `closed_at` preenchido.
- **Só com controle ativo:** um gatilho de INSERT recusa abrir caixa num estabelecimento com `cash_control_enabled_at` NULL.

**`cash_movements`** guarda os movimentos e nunca é editada.

- **Colunas:**
  - `tenant_id`, `id`, `cash_session_id` e `kind`, que pode ser RECEBIMENTO, ESTORNO, ENTRADA ou SANGRIA;
  - `amount_cents`, sempre positivo (o sentido vem do tipo), e `method`;
  - `sale_payment_id` (e, no futuro, o recebimento de atendimento);
  - `actor_membership_id`, `approved_by_membership_id`, `note`, `request_key` e `created_at`.
- **Sem duplicidade:**
  - UNIQUE `(tenant_id, sale_payment_id, kind)`: um recebimento gera no máximo um movimento de entrada e um de estorno;
  - UNIQUE `(actor_membership_id, request_key)` para entrada e sangria.
- **Gatilho de consistência:** no INSERT, confere que o caixa está aberto e pertence a quem lança. Quando a autorização vem do caixa de outra pessoa, o movimento continua no caixa de quem executa. Essa é a garantia final, junto com a trava da seção 4.5.

### 4.3 Três vínculos distintos

| Vínculo | Coluna | Quando é preenchida |
|---|---|---|
| Caixa em que a venda foi registrada | `sales.cash_session_id NULL` | Na gravação, com o caixa aberto de quem registra, se houver. Registrar uma venda não exige caixa aberto: o barbeiro pode vender e outra pessoa recebe. |
| Caixa em que o recebimento entrou | `sale_payments.cash_session_id NULL` | Na gravação do recebimento, com o caixa aberto de quem recebe. Com o controle ativo, é obrigatória para todo recebimento novo, de qualquer forma de pagamento. |
| Caixa de onde saiu o estorno | `sale_payments.refund_cash_session_id NULL` | Na transição para estornado, com o caixa definido pela escolha 3, se o controle estiver ativo. |

- **Operações antigas não ganham caixa inventado.** Vendas, recebimentos e estornos anteriores à ativação ficam com essas colunas NULL, e a tela mostra "anterior ao caixa".
- **Estorno de um recebimento antigo:** depois da ativação, o estorno é uma operação nova, por isso tem caixa. O recebimento original continua sem caixa.
- **Imutabilidade:** os gatilhos de imutabilidade passam a cobrir as três colunas. `cash_session_id` só é preenchida no INSERT, e `refund_cash_session_id` só junto com `refunded_at`.
- **Obrigatoriedade:** no início, a obrigatoriedade do caixa no recebimento novo, para estabelecimentos ativados, é garantida pelo serviço. Um gatilho de INSERT que exige `cash_session_id` quando o estabelecimento está ativado só entra em migration depois que a janela de retorno estiver fechada (etapa 8).
- **Recebimento de atendimento:** ganha os vínculos de caixa na etapa da seção 4.8 (escolha 1).

### 4.4 Fotografia do fechamento

No fechamento, os valores daquele momento são gravados e não são recalculados depois.

- **Em `cash_sessions`:**
  - `counted_cents`, o valor informado;
  - `expected_cash_cents`, a gaveta esperada;
  - `difference_cents`;
  - `gross_cents`, `refunded_cents` e `net_cents`;
  - `entries_cents` e `withdrawals_cents`;
  - `sales_count` e `receivable_cents` (vendas registradas naquele caixa que ainda estão a receber);
  - `movements_count` e `last_movement_id`;
  - `closing_note`.
- **Por forma de pagamento:** `cash_session_totals (tenant_id, cash_session_id, method, gross_cents, refunded_cents)`, gravada na mesma transação e imutável.
- **Encerramento pelo dono (escolha 4):** com o valor contado, como qualquer fechamento; ou "Encerrado sem conferência", com `counted_cents` e `difference_cents` NULL e `closed_without_count = true`. Um CHECK impede diferença preenchida sem contagem. `closed_by_membership_id` registra quem encerrou.
- **Consulta do dono:** um caixa fechado mostra a fotografia e a lista de movimentos. Um teste confere que a soma dos movimentos bate com a fotografia. Uma divergência é tratada como defeito, não como dado a corrigir.

### 4.5 Concorrência

**Ordem de travas, sempre a mesma, para evitar impasse:**
1. a linha do estabelecimento, com `FOR SHARE`, para ler `cash_control_enabled_at` (só em receber e estornar; a ativação usa `FOR UPDATE`);
2. venda ou recebimento, com `FOR UPDATE`, como hoje;
3. o caixa;
4. o vínculo do autorizador, com `FOR SHARE`.

**Travas por operação (estabelecimento ativado):**

| Operação | Trava no caixa | Efeito |
|---|---|---|
| Receber, estornar, entrada, sangria | `FOR SHARE` na linha do caixa aberto de quem executa (`WHERE tenant_id, membership_id, closed_at IS NULL`) | Movimentos do mesmo caixa podem correr juntos, e o fechamento espera todos eles. Sem caixa aberto, a resposta é 409 `CAIXA_NAO_ABERTO`. |
| Fechar | `FOR UPDATE` na linha do caixa | Espera os movimentos em andamento. Quem chega depois encontra `closed_at` preenchido e recebe 409 `CAIXA_FECHADO`. Não há movimento que fique fora da fotografia nem que entre num caixa fechado. |
| Abrir | Índice único parcial | Uma segunda abertura simultânea recebe 409 `CAIXA_JA_ABERTO`, ou o caixa já aberto, quando a chave de pedido é a mesma. |

**Conferência antes de fechar:**
- A prévia devolve os totais e uma versão: `movements_count` mais `last_movement_id`.
- A confirmação envia essa versão. Se ela mudou, a resposta é 409 `CONFERENCIA_DESATUALIZADA`, com a conferência nova. Assim, o valor contado é sempre comparado com os totais que a pessoa viu.

**Repetição:**
- Receber: a chave de pedido continua em `sale_payments`, e o movimento é gravado na mesma transação, com UNIQUE por recebimento.
- Estornar: idempotente pelo estado, como hoje, com UNIQUE por recebimento e tipo.
- Entrada e sangria: chave de pedido com UNIQUE e impressão digital do corpo. A mesma chave com outro corpo recebe 409 `CHAVE_REUTILIZADA`, como em vendas.
- Fechar: repetir com a mesma `close_request_key` devolve a fotografia gravada. Outra chave num caixa já fechado recebe 409 `CAIXA_FECHADO`.

### 4.6 Acesso

| Rota | Quem pode |
|---|---|
| `GET /cash-sessions/current` | Só o caixa aberto de quem pede. |
| `GET /cash-sessions` e `/cash-sessions/:id` | O dono vê todos, com filtros de pessoa, período e situação. Para qualquer outra pessoa, um caixa fechado ou de outra pessoa responde 404, mesmo com todas as permissões liberadas e mesmo quando o caixa foi dela. |
| Movimentos de um caixa | A mesma regra da linha anterior. |
| Ativação do controle de caixa | Só o dono. |

- As regras ficam em `cash/cash-access.ts`, como funções puras com teste.
- Um teste `db-e2e` cobre o endereço direto e a API depois do fechamento.

### 4.7 Manutenção sem o adicional

Num estabelecimento já ativado, sem o adicional VENDAS, abrir, receber vendas antigas, estornar, entrada, sangria e fechar seguem a regra de manutenção (seção 2.2). Só a nova venda e a ativação exigem o recurso.

### 4.8 Recebimentos da Agenda

Entram no caixa quando o controle estiver ativo (escolha 1), numa etapa própria depois do caixa de vendas:
- coluna de caixa no recebimento de atendimento e no estorno dele, com os mesmos vínculos da seção 4.3;
- `cash_movements` ganha a referência ao recebimento de atendimento, com origem "Atendimento" na tela;
- dependência condicional de RECEBIMENTOS_REGISTRAR e RECEBIMENTOS_ESTORNAR em CAIXA_ABRIR;
- a ativação (seção 4.1) passa a listar também quem recebe atendimentos;
- indicadores separados: a fotografia guarda os totais de vendas e de atendimentos separados, e nenhum ticket médio mistura os dois.

Recebimentos de atendimento antigos ficam sem caixa.

## 5. Migração sem ganho nem perda de acesso

### 5.1 O que cada migration faz

As migrations só acrescentam estruturas e não reescrevem permissões existentes. Nenhum `down` no piloto, e nenhum valor de enum é removido.

**Migration das permissões (etapa 2):**
- enum: os valores novos de `permission` das etapas 1 a 4 (quatro de estoque, VENDAS_RECEBER_OUTRAS e os `*_AUTORIZAR`) e `APPROVAL` em `permission_mode`, numa migration própria, porque valor novo de enum precisa ser confirmado antes de ser usado;
- `memberships.access_model`, com padrão LEGADO, e `memberships.job_title`;
- as colunas de autorizador.

**Migration do caixa (etapa 5):**
- enum: CAIXA_*, também numa migration própria;
- `tenants.cash_control_enabled_at` e `cash_control_enabled_by_user_id`;
- `cash_sessions`, `cash_movements` e `cash_session_totals`;
- as colunas de caixa da seção 4.3 e os gatilhos.

**Migration do PDV:** descrita no plano do PDV. VENDAS_DIGITAR e, se decidido, VENDAS_ESPERA_OUTRAS entram nela.

### 5.2 Modelo LEGADO: o cálculo atual, sem mudança

Para cada linha LEGADO, as concessões efetivas são calculadas pela regra de hoje. Elas viram o conjunto que `staffCan` lê.

- **GERENTE confirmado:** as concessões de gerente e de funcionário que estão GRANTED, com as dependências, sem DENIED. Com profissional ligado e ativo, ganha também a agenda própria.
- **GERENTE não confirmado:** nenhuma concessão. Os GRANTED gravados continuam ignorados, e não ganha agenda própria.
- **RECEPCIONISTA:** só as três de vendas. Os GRANTED fora da lista continuam ignorados.
- **PROFISSIONAL:** só as quatro de funcionário. Com profissional ligado e ativo, ganha a agenda própria mesmo sem confirmação. Os outros GRANTED continuam ignorados.
- **DENIED:** continua vencendo GRANTED.
- **Equivalências do modelo novo que o cálculo LEGADO produz:**
  - `ESTOQUE_GERENCIAR` GRANTED vale como as quatro de estoque;
  - VENDAS_RECEBER e VENDAS_VISUALIZAR efetivas juntas valem também como VENDAS_RECEBER_OUTRAS (seção 2.5);
  - a agenda própria vale como `ATENDIMENTO_PROPRIO_VER` (escolha 7).
- **Nenhuma concessão de caixa é derivada.** Quem recebe ou estorna hoje não ganha CAIXA_* no cálculo LEGADO. As concessões de caixa só existem por escolha do dono na ativação (seção 4.1).
- **Nada é gravado:** a migration não cria GRANTED para refletir isso.

**Ao salvar na tela nova:**
- A tela abre com as concessões efetivas, não com as linhas gravadas.
- O dono vê e confirma esse conjunto.
- O servidor, na mesma transação:
  - grava exatamente o conjunto confirmado;
  - remove as linhas que estavam ignoradas;
  - marca `access_model = INDIVIDUAL` e `permissions_confirmed_at`;
  - registra o antes e o depois em `audit_logs`.
- Qualquer mudança de acesso nesse momento é escolha explícita do dono, não consequência da migração.

### 5.3 Transição de ESTOQUE_GERENCIAR

- **LEGADO:** `ESTOQUE_GERENCIAR` vale como as quatro permissões novas (seção 5.2).
- **INDIVIDUAL:** a política nova lê só os quatro códigos novos. Um teste garante que nenhuma política consulta `ESTOQUE_GERENCIAR` para quem não é DONO. Assim, a permissão antiga nunca libera uma ação que o dono desmarcou na matriz nova.
- **Dono:** o DENIED só restringe. Um DENIED em `ESTOQUE_GERENCIAR` continua bloqueando as quatro ações, e um DENIED num código novo bloqueia só aquela ação.
- **Sincronia para o par anterior:** ao salvar uma pessoa INDIVIDUAL, o servidor mantém `ESTOQUE_GERENCIAR` GRANTED somente se as quatro estiverem concedidas e as remove em qualquer outro caso. No retorno ao par anterior, essa pessoa fica com o mesmo acesso de estoque ou menos, nunca mais.
- **Tela anterior com a API nova (janela de publicação):**
  - Para uma pessoa LEGADO, a gravação continua como hoje.
  - Para uma pessoa INDIVIDUAL, a gravação no formato antigo é recusada com 409 `PERMISSOES_NO_MODELO_NOVO`. A tela anterior não pode apagar as concessões novas que ela não conhece.

### 5.4 Prova de equivalência

A prova compara ações e alcance, não só menus. A diferença precisa ser zero, sem exceção, nas publicações das permissões e do caixa. Mudanças de acesso só acontecem por escolha do dono, ao salvar na tela nova ou na ativação do caixa, e ficam auditadas.

- **Impressão de acesso:** função de teste `accessFingerprint(vinculo, recursos, estabelecimento)`. Ela devolve o conjunto de pares (ação, alcance) para todas as políticas `can*` exportadas pelos `*-access.ts`.
  - Alcance: próprios registros, de outras pessoas, todos ou nenhum. "Próprios" tem três sentidos: venda registrada pela pessoa, atendimento do profissional ligado e comissão do profissional ligado.
  - Receber é registrado com dois alcances: venda própria e venda de outra pessoa. A referência calcula o segundo como VENDAS_RECEBER mais VENDAS_VISUALIZAR, e o código novo como VENDAS_RECEBER_OUTRAS.
  - Pré-condições também entram na impressão. "Receber exige caixa aberto" aparece como diferença, e por isso não pode surgir sem ativação.
  - Uma guarda reprova o teste se aparecer uma política `can*` nova fora do registro da impressão. A lista "A receber" entra registrada como subconjunto da consulta que a pessoa já tem no modelo LEGADO.
- **Referência congelada:** uma cópia das regras atuais (`test/legacy-access-reference.ts`), feita a partir de `4e0d841`, serve de "antes".
- **Casos sintéticos exaustivos:**
  - papéis: DONO, GERENTE, RECEPCIONISTA e PROFISSIONAL;
  - confirmado ou não;
  - sem profissional, com profissional ativo ou com profissional inativo;
  - vínculo ACTIVE ou SUSPENDED;
  - VENDAS e ESTOQUE contratados ou não, separando rota de nova venda e rota de manutenção;
  - estabelecimento com o controle de caixa desligado, que é o único estado possível antes da etapa 6;
  - conjuntos de ajustes:
    - cada permissão sozinha, em GRANTED e em DENIED;
    - GRANTED ignorado pelo papel: recepcionista com estoque, profissional com vendas, gerente não confirmado com tudo;
    - GRANTED e DENIED na mesma permissão;
    - DENIED só numa dependência;
    - `ESTOQUE_GERENCIAR` com e sem `ESTOQUE_VISUALIZAR`;
    - VENDAS_RECEBER com e sem VENDAS_VISUALIZAR, e com DENIED em uma das duas;
  - mais um lote pseudoaleatório com semente fixa.
- **Cópia restaurada do piloto:** para cada vínculo, a impressão antes (código atual sobre a cópia em 28) deve ser igual à impressão depois (código novo sobre a cópia migrada). Diferença vazia é a condição para publicar.
- **Alcance real:** no `db-e2e` sobre a cópia, para cada vínculo, as listas de vendas, agenda própria e comissões próprias devolvem os mesmos IDs antes e depois. A lista "A receber" devolve um subconjunto da lista de vendas que a pessoa já consultava.
- **Ativação:** um teste à parte confere que a ativação muda exatamente o que o dono escolheu, e nada para quem não está na lista.

### 5.5 Ensaio

O ensaio segue o roteiro de Vendas: backup, restauração, janelas com o par anterior e o passo de retorno. Pontos novos:

- O par anterior lê `APPROVAL`, os valores novos de `permission` e `access_model` sem quebrar.
- O caso de estoque: uma pessoa salva como INDIVIDUAL com MOVIMENTAR desmarcado. A API nova recusa movimentar. O par anterior também recusa, porque `ESTOQUE_GERENCIAR` foi removido.
- O caso de recebimento: uma pessoa salva como INDIVIDUAL só com VENDAS_RECEBER e VENDAS_RECEBER_OUTRAS. Ela recebe a venda de outra pessoa pela lista "A receber" e recebe 404 na consulta geral e no detalhe de uma venda já recebida por outra pessoa.
- Na publicação do caixa, sem ativação: receber continua sem caixa, e a impressão de acesso continua igual.
- Na ativação, sobre a cópia: a recusa `ATIVACAO_INCOMPLETA`, uma pessoa com caixa concedido e uma com recebimento retirado. Esse ensaio é feito só na cópia, nunca no piloto.

## 6. Condições de retorno ao par anterior

Cada publicação tem as próprias condições. Se alguma contagem for maior que zero no momento da decisão, a publicação é só para frente. Nunca se usa `down` e nunca se restaura backup antigo sobre o piloto. As consultas dessas contagens entram no runbook de cada publicação.

### 6.1 Publicação das permissões (etapas 1 a 4)

| Contagem | Por quê |
|---|---|
| vínculos com `access_model = INDIVIDUAL` | O par anterior volta ao teto por papel, e a pessoa perderia acessos dados pelo dono. Também ganharia receber de outras pessoas quando tiver a consulta geral sem VENDAS_RECEBER_OUTRAS (seção 2.5). |
| linhas `APPROVAL` | O par anterior trata como bloqueado. |
| linhas com `*_AUTORIZAR`, VENDAS_RECEBER_OUTRAS ou os quatro códigos de estoque | O par anterior não conhece esses valores. |
| colunas de autorizador preenchidas | O par anterior não exibe quem autorizou. |

A sincronia de estoque não muda essa regra: ela garante que o par anterior nunca dá mais acesso de estoque do que a matriz nova, mas o par anterior pode dar menos, e isso também é mudança de acesso.

### 6.2 Publicação do caixa (etapa 5)

Retorno ao par da etapa 4 permitido somente com todas estas contagens em zero:

| Contagem | Por quê |
|---|---|
| estabelecimentos com `cash_control_enabled_at` preenchido | O par anterior recebe sem caixa num estabelecimento que exige caixa. |
| `cash_sessions` e `cash_movements` | O par anterior deixaria um caixa aberto sem fechamento e não mostra os caixas. |
| `sale_payments` com `cash_session_id` ou `refund_cash_session_id` | Movimentos já ligados a um caixa. |
| linhas com CAIXA_* | O par anterior não conhece esses valores. |

Enquanto a ativação estiver desligada pela configuração da plataforma (seção 4.1), essas contagens ficam em zero por construção. O responsável decide quando encerrar essa janela e liberar a ativação.

### 6.3 Depois da primeira ativação

A publicação do caixa passa a ser só para frente. O gatilho de caixa obrigatório no recebimento só entra depois disso (etapa 8).

## 7. Proteções que continuam valendo

- **Isolamento:** todo SQL novo filtra por `tenant_id`, e o autorizador é buscado dentro do estabelecimento da operação. Fora dele, a resposta é 404.
- **Autoampliação:**
  - só o dono ativa o controle de caixa; a equipe pode ser delegada (escolha 2), com as travas abaixo;
  - o servidor recusa alterar o próprio vínculo;
  - ninguém concede o que o próprio dono não pode;
  - quem autoriza é sempre outra pessoa.
  - Quando Equipe e acessos é delegada, o delegado só concede um subconjunto das próprias concessões. Ele nunca concede `*_AUTORIZAR`, gestão de equipe nem o que for exclusivo do dono, e nunca altera o próprio vínculo nem o do dono.
- **Concorrência na equipe:** a troca de permissões mantém `expected` e o estabelecimento travado.
- **Vagas e adicionais:** a contagem de vagas não muda, e `RECURSO_NAO_CONTRATADO` continua valendo. Uma concessão gravada sem o adicional fica guardada, sem efeito, exceto na manutenção, como hoje.
- **Comissões:** o vínculo com profissional e o cálculo das comissões ficam como estão.
- **Histórico:** auditoria do antes e do depois. Movimentos, recebimentos e fechamentos não são editados.
- **Senha recente:** continua exigida para o dono e para quem tem a ação em GRANTED.

## 8. Itens do PDV

Estão no plano complementar `plano-pdv-balcao.md`, com as decisões abertas e as consequências de cada opção. Este plano define só o que eles usam daqui:

| Item | O que vem deste plano |
|---|---|
| Categorias e subcategorias no Balcão | Nada novo: cadastrar continua com ESTOQUE_PRODUTOS. O esquema já existe. |
| Produto disponível no PDV | Nada novo. |
| Venda digitada (aprovada) | VENDAS_DIGITAR, com dependência técnica em VENDAS_REGISTRAR. Com o controle ativo, o caixa recebe a venda digitada como qualquer venda. |
| Venda em espera (aprovada) | A própria espera vem com VENDAS_REGISTRAR. Retomar a de outra pessoa exige VENDAS_ESPERA_OUTRAS; o dono vê todas. A espera não ocupa caixa. |
| Troco | Gravado no recebimento em dinheiro. A gaveta aumenta pelo valor do recebimento (entregue menos troco); o troco nunca é um movimento. |
| Pagamento parcial ou dividido | Fora desta versão. Este plano supõe um recebimento integral por venda. |

## 9. Diferenças do protótipo a ajustar depois

O protótipo ainda mostra a versão anterior destes pontos. Ele não foi alterado nesta revisão.

- "Receber vendas" ainda concede "Balcão" automaticamente. Nesta revisão, isso vira sugestão.
- O caixa ainda é uma permissão única, "abrir, operar e fechar", e aparece sempre ligado. Nesta revisão, são CAIXA_ABRIR e CAIXA_FECHAR, que só aparecem depois da ativação pelo dono.
- Não há tela de ativação do controle de caixa.
- Não há VENDAS_RECEBER_OUTRAS nem a lista "A receber" com alcance próprio ou de outras pessoas.
- Visão geral e configurações aparecem como exclusivas do dono. Agora são concedíveis (escolha 2).
- Não há os três vínculos de caixa por venda, recebimento e estorno, nem a fotografia por forma de pagamento.
- O protótipo não mostra a delegação das áreas administrativas, o encerramento pelo dono (com contagem ou sem conferência) nem os recebimentos de atendimento no caixa.

## 10. Etapas, cada uma com PR próprio

1. **Refatoração sem mudança de comportamento:** criar o cálculo de concessões efetivas (modelo LEGADO) e `staffCan`, e passar as políticas a usá-los. A impressão de acesso e a referência congelada entram aqui, com diferença zero.
2. **Migration das permissões** (seção 5.1), com o ensaio na cópia restaurada. Nenhuma tela muda.
3. **Modelo INDIVIDUAL e tela de Equipe e acessos:** cargo, vínculo, áreas administrativas delegáveis (escolha 2), própria agenda concedível (escolha 7), cancelar a própria venda (escolha 6), matriz com busca, dependências técnicas e sugestões, Liberar tudo e resumo. Inclui VENDAS_RECEBER_OUTRAS, a lista "A receber", a sincronia de estoque e a recusa da tela anterior para pessoas INDIVIDUAL.
4. **Três níveis e autorização pontual** em estorno, cancelamento e preço.
5. **Caixa, desligado:** migration do caixa, tabelas, travas, fotografia, API, "Meu caixa", "Caixas" do dono, sangria com três níveis e ligação dos recebimentos e estornos de vendas. A ativação fica indisponível por configuração da plataforma.
6. **Ativação e desativação do controle de caixa:** tela do dono, transações da seção 4.1 e liberação pela plataforma depois de encerrada a janela de retorno da etapa 5. Em seguida, em PR próprio, os recebimentos da Agenda no caixa (seção 4.8).
7. **Plano do PDV**, nas etapas que ele define. A maioria dos itens não depende do caixa e pode vir depois da etapa 3.
8. **Depois das janelas de retorno:** o gatilho de caixa obrigatório no recebimento para estabelecimentos ativados, e a remoção do cálculo LEGADO quando não restar nenhuma pessoa nesse modelo. A remoção depende de uma decisão de converter as linhas restantes, que nunca acontece por migration silenciosa.

**Testes por etapa:**
- funções puras com spec ao lado (políticas, alcance de receber, `canAuthorize`, `cash-access`, dependências e dependências condicionais);
- `db-e2e` para:
  - travas e fechamento contra movimento simultâneo;
  - ativação contra recebimento simultâneo;
  - repetição e caixa único por pessoa;
  - autorizador e 404 depois do fechamento;
  - alcance da lista "A receber";
- `test/*.e2e-spec.ts` para as rotas;
- suítes de navegador de equipe e de vendas.

## Estado e retomada

Atualizado em 27/11/2026.

A etapa 1 sai em PRs, um por área, sem mudança de comportamento. Cada PR parte da integração depois que o anterior foi mesclado.

| PR | Branch | Situação | Worktree local |
|---|---|---|---|
| #154 Vendas e base comum | `refactor/permissoes-base-vendas` | mesclado em 27/11/2026 como `be267cc` (head `93f7d7b`, CI 45985468550) | `C:/wt/perm-base` |
| #155 Estoque | `refactor/permissoes-base-estoque` | mesclado em 27/11/2026 como `264d31d` (head `0dd86ab`, CI do PR com base na integração 45989781076) | `C:/wt/perm-estoque` |
| #156 Agenda e disponibilidade | `refactor/permissoes-base-agenda` | mesclado em 27/11/2026 como `9c904ea` (head `75eb8fe`, CI 45997938971) | `C:/wt/perm-agenda` |
| #157 Recebimentos | `refactor/permissoes-base-recebimentos` | mesclado em 27/11/2026 como `1a973a9` (head `edd4df4`, CI 46007675376) | `C:/wt/perm-recebimentos` |
| Clientes | `refactor/permissoes-base-clientes` | aberto para revisão, base `integration/nestjs-typeorm-frontend` (`1a973a9`); head e CI no PR | `C:/wt/perm-clientes` |

As worktrees têm `node_modules` como junções para `C:/wt/vendas-pr4`; isso só existe neste computador. As branches dos PRs mesclados continuam no remoto. A referência local `backup/permissoes-base-estoque-450cd2f` (em `C:/wt/perm-estoque`) guarda o head anterior ao rebase do Estoque.

### Mesclados: #154 (base comum e Vendas) e #155 (Estoque)

- `backend/src/common/access-evaluation.ts`: base comum do modelo LEGADO (`effectiveAccess`, `accessCan`, `legacyGrantedPermissions`, `requiredFor`).
- `sales/sales-access.ts` e `stock/stock-access.ts` decidem só pela base comum, com as mesmas assinaturas e mensagens.
- Equivalência: `sales-access.equivalence.spec.ts` (referência congelada de `4e0d841`) e `stock-access.equivalence.spec.ts` (referência de `01a3c86`, igual ao piloto), com casos exaustivos, lote de semente fixa, guarda de política `can*` nova e mutantes.
- A correção do teste lento do lote sorteado (`93f7d7b`) entrou pelo #154; o #155 não a repete.
- O retarget do #155 para a integração não dispara o workflow; o PR foi fechado e reaberto para gerar o run do PR (45989781076) sobre a base nova.

### Mesclado: #156 (Agenda e disponibilidade)

Revisado antes do merge: a separação entre a lista do dono e as dependências do gerente só existe em `accessAllows`; `accessCan`, usada por Vendas e Estoque, não mudou, e `ownerDenials` é obrigatório no tipo (`null` fecha o dono de propósito, nunca por omissão).


- **Feito:**
  - `common/access-evaluation.ts`: `LegacyAction` e `accessAllows`, para ações em que a lista de DENIED do dono difere das dependências exigidas do gerente, ou em que um dos lados não faz a ação. `accessCan` e o resto da base não mudaram;
  - `appointments/appointment-access.ts`: ver, criar, cancelar, remarcar, andamento, ver e tratar solicitações e avisos decidem só por `accessAllows(effectiveAccess(role, overrides), …)`. As listas do dono continuam literais: ver a agenda, cancelar e o andamento não olham `PROFISSIONAIS_VISUALIZAR` no dono, mas o gerente precisa dela concedida. Tratar solicitações continua só do gerente; os avisos, só do dono;
  - `availability/availability-access.ts`: a consulta de horários passa pela base, com as três permissões concedidas para o gerente e nenhuma negada para o dono;
  - o recorte do gerente (contato e preço na agenda, preço na consulta de horários) saiu de `appointments.service.ts` e `availability.service.ts` para `canSeeAppointmentContact`, `canSeeAppointmentPrices` e `canSeeAvailabilityPrices`, pela base. Só o gerente tem recorte; o dono vê tudo, como antes. Na revisão, o cálculo dos preços da consulta de horários saiu do corpo de `consult` para a função pura `precosParaQuemPediu` (`availability.service.ts`), com o mesmo código, para ser testado campo a campo;
  - `appointments/appointment-access.equivalence.spec.ts`: referência congelada das regras em `be267cc` (iguais a `8f71335`, o piloto), só com listas literais. Compara uma impressão de pares (ação, alcance), com alcance "todos", "só solicitações pendentes" (cancelar e confirmar de quem só trata solicitações) e "próprios" (agenda do profissional ligado e as três ações opt-in). Os casos combinam os quatro papéis, o gerente confirmado ou não e o profissional ausente, ativo ou inativo. Há três grupos exaustivos com 4⁶, 4⁶ e 4⁵ combinações, num total de 90.112 casos, e um lote de 10.000 casos de semente fixa com todas as permissões. Uma guarda reprova política `can*` nova sem caso;
  - o mesmo spec roda quinze mutantes, entre eles dono com as dependências do gerente, dono tratando solicitações, gerente com avisos, recepcionista ou funcionário vendo a agenda de todos, gerente não confirmado ou profissional inativo com agenda própria e ação própria sem GRANTED. Também roda a política lida sem `effectiveOverrides`. Todos são apanhados. Uma mutação manual no arquivo real (o dono passa a exigir `PROFISSIONAIS_VISUALIZAR` para ver a agenda) reprovou o spec e foi desfeita;
  - campos devolvidos (acrescentado na revisão): o mesmo spec compara a resposta inteira de `recortarParaQuemPediu` e de `precosParaQuemPediu` com a transformação congelada de `be267cc`, campo a campo (preço total e por serviço, observações, telefone, `hidden`, `totalPriceCents`, `priceHidden`), em todas as combinações de `AGENDA_VISUALIZAR`, `PROFISSIONAIS_VISUALIZAR`, `CONSUMIDORES_VISUALIZAR` e `RECEBIMENTOS_VISUALIZAR` nos quatro papéis, confirmado ou não, com e sem serviço sob consulta. Os quatro desfechos do recorte (nada, só preço, só contato, os dois) aparecem, e a vista original não é alterada. Duas mutações temporárias (preço por serviço sem recorte; `priceHidden` sempre falso) foram apanhadas e desfeitas. Quais registros cada um recebe (só pendentes na lista de solicitações, a agenda do profissional ligado, outro estabelecimento como 404) e os campos com o banco real continuam nos `db-e2e` já existentes (`team-manager-postgres`, `team-access-postgres`, `appointments-postgres`, `isolamento-estabelecimentos-postgres`), que o CI roda.
- **Solicitações, para não confundir os dois acessos:**
  - `canHandleBookingRequests` (`SOLICITACOES_TRATAR`) é só do gerente e dá acesso restrito: em `POST /tenants/:tenantId/appointments/:id/cancel` (`cancel`) recusa, com a reserva travada, qualquer reserva que não esteja `PENDING`; em `POST …/:id/confirm` (`changeStatus`) só confirma, e confirmar só sai de `PENDING` pela tabela de transições. Iniciar, concluir, falta e remarcar continuam fora;
  - o dono não usa essa política. Ele vê a lista por `GET /tenants/:tenantId/booking-requests` (`listPending`, `canViewBookingRequests`, com a lista do dono de ver a agenda), confirma pelo andamento geral (`canManageAppointmentStatus`) e recusa pelo cancelamento geral (`canCancelAppointments`), que valem para qualquer reserva, pendente ou não. O gerente com o andamento ou o cancelamento gerais também age sobre qualquer reserva.
- **Sem mudança:** o motor de horários, as regras de agendamento e as consultas de disponibilidade. Seguem em `resolveAuthorizedTenant`, como antes, o vínculo, a situação do estabelecimento, o acesso comercial, o recurso `AGENDA` e o isolamento por estabelecimento. Nenhuma migration.
- **Não convertido, fica para a etapa de Equipe:** a agenda própria e as permissões de funcionário continuam com as regras antigas, fora da base comum. O spec de Agenda só as congela como guarda (a impressão "próprios" compara o código atual, não convertido, com a referência). São elas:
  - `team/staff-access.ts`: `canViewOwnAgenda` (funcionário sempre, gerente só confirmado), `staffPermissionGranted` e `staffGrantedPermissions` (`ATENDIMENTO_PROPRIO_INICIAR`, `…_CONCLUIR`, `…_FALTA` e `COMISSOES_PROPRIAS_VISUALIZAR`), `canManageTeam`, `grantableStaffPermissions` e `grantableManagerPermissions`;
  - `team/my-agenda.service.ts`: a conferência do profissional ligado e ativo e o filtro da agenda e das ações pelo `professionalId` do vínculo;
  - `auth/session-areas.ts` (área `AGENDA_PROPRIA_VER`) e a linha correspondente de `accounts/tenant-effective-access.ts`.
- **Comportamento antigo questionável, registrado e não corrigido nesta etapa:**
  - a confirmação pelo gerente que só trata solicitações depende só da tabela de transições (confirmar sai apenas de `PENDING`); o cancelamento tem a checagem explícita de `PENDING`, a confirmação não. Se a tabela mudar, esse gerente passaria a confirmar outros estados;
  - o recorte de contato e preço vale só para `GERENTE` (`role !== GERENTE` vê tudo). Hoje recepcionista e funcionário não chegam às rotas da agenda de todos, mas uma etapa que abra a agenda a outros papéis precisa rever o recorte junto;
  - o gerente que só trata solicitações recebe a lista sem o telefone do cliente, salvo com `CONSUMIDORES_VISUALIZAR`;
  - o dono com `AGENDA_GERENCIAR` negada e o cancelamento liberado consegue recusar uma solicitação, mas não confirmá-la, porque não existe caminho de solicitações próprio do dono.
- **Testes executados localmente:**
  - `vitest run` de `src/common`, `appointments`, `availability`, `sales`, `stock`, `team`, `accounts`, `auth`, `payments`, `dashboard` e `push`: 55 arquivos, 770 testes, inclusive as equivalências de Vendas e Estoque;
  - `test:e2e` de agenda, disponibilidade, agendamento público, avisos e equipe: 80 testes;
  - `npm run typecheck`, `tsc -p tsconfig.build.json` e `npm run lint`.

  Tudo passou. Depois da revisão (teste de campos e `precosParaQuemPediu`), a mesma bateria mais `src/public-booking`: 56 arquivos, 777 testes; os 80 e2e, o typecheck, o build e o lint de novo. O `db-e2e` não foi executado localmente, porque nenhum SQL mudou; o CI do PR o roda. O resultado do CI no head fica registrado no PR.

### Mesclado: #157 (Recebimentos)

Revisado antes do merge: a lacuna de registrar e estornar pelo gerente com o banco real foi fechada por `test/payments-manager-postgres.db-e2e-spec.ts`, e o enum `Permission` foi esclarecido (abaixo). Nenhuma regra antiga questionável foi corrigida.


- **Feito:**
  - `payments/payment-access.ts`: `canViewPayments`, `canRecordPayments`, `canRefundPayments` e `canManagePayments` decidem só por `accessAllows(effectiveAccess(role, overrides), …)`, com as mesmas assinaturas e mensagens. A lista do dono é literal e igual à de ver a agenda: só `AGENDA_VISUALIZAR` negada barra o dono, que não confere as permissões de recebimentos nem as dependências do gerente. O gerente precisa da concessão da ação e das dependências (`RECEBIMENTOS_VISUALIZAR`, `AGENDA_VISUALIZAR`, `PROFISSIONAIS_VISUALIZAR`). `canManagePayments` continua só do dono. A base comum não mudou;
  - `payments/payment-access.equivalence.spec.ts`: referência congelada de `264d31d` (igual a `8f71335`, o piloto), com a política de ver a agenda do dono escrita por extenso, só com listas literais. Compara uma impressão de pares (ação, alcance): consultar, registrar, estornar e operar como dono, todos com alcance "todo o estabelecimento". Recebimentos não têm alcance próprio: funcionário e recepcionista não veem nenhum, nem dos próprios atendimentos, mesmo com tudo gravado (teste próprio). Como guarda, entram as decisões não convertidas que dependem de `canViewPayments`: o relatório de comissões e o que o histórico do cliente mostra (preço; recebimentos com o recurso contratado ligado ou não). Os casos combinam os quatro papéis, o gerente confirmado ou não, dois grupos exaustivos (10.240 casos) e 10.000 casos de semente fixa com todas as permissões. Uma guarda reprova política `can*` nova sem caso;
  - treze mutantes apanhados, entre eles dono com as dependências do gerente ou sem a restrição da agenda, gerente registrando sem consultar, estornando com a permissão de registrar ou consultando sem `PROFISSIONAIS_VISUALIZAR`, GRANTED vencendo DENIED, gerente operando como dono, recepcionista ou funcionário com GRANTED, comissões para o gerente e histórico ignorando o recurso. A política lida sem `effectiveOverrides` também é apanhada. O spec passa contra a implementação anterior. Uma mutação manual no arquivo real (o dono passa a ser barrado por `RECEBIMENTOS_VISUALIZAR` negada) reprovou quatro testes e foi desfeita; o `payment-access.spec.ts` antigo não a apanhava;
  - `test/payments-manager-postgres.db-e2e-spec.ts` (acrescentado na revisão): gerente registrando e estornando pela API HTTP real (AppModule inteiro, sessão por cookie) contra PostgreSQL descartável. O acesso é montado só pelo caminho que o sistema oferece: o dono entra, confirma a senha e cria o gerente em "Equipe e acessos" (`POST /tenants/:id/team/staff-accounts`, com a senha escolhida pelo dono, como a tela atual envia) e muda as concessões pela mesma tela (`PUT …/members/:id/permissions`). Nenhuma permissão é gravada direto no banco. Três cenários:
    - com as cinco concessões (`AGENDA_VISUALIZAR`, `PROFISSIONAIS_VISUALIZAR`, `RECEBIMENTOS_VISUALIZAR`, `_REGISTRAR`, `_ESTORNAR`), confirmadas na criação, o gerente registra (linha com estabelecimento, atendimento, valor, forma, data e autor certos; auditoria `PAYMENT_RECORDED` com ele como autor; o mesmo formulário não duplica) e estorna. Sem a senha confirmada na própria sessão, o estorno responde `REAUTENTICACAO_NECESSARIA` sem gravar; depois de `POST /platform/reauth`, estorna (motivo, quem estornou e auditoria `PAYMENT_REFUNDED`), e um segundo estorno responde `JA_ESTORNADO`. A tela recusa conceder registrar sem consultar (`PERMISSOES_INCOMPLETAS`);
    - sem a concessão da ação, 403 com a mensagem de sempre e nada gravado (nenhuma linha, nenhum estorno, nenhuma auditoria): só consultar (vê o recebimento do dono, não registra nem estorna), registrar sem estornar (registra o próprio, não estorna nem o próprio), e só a agenda depois que o dono retira a consulta, na requisição seguinte com a sessão aberta;
    - isolamento: o gerente com tudo de A recebe 404 nas rotas de B (listar, registrar, estornar) e, no caminho de A, com ids de B (estornar o recebimento de B, registrar o atendimento de B); a lista de A não mostra nada de B, e nada muda em B.

    No fim, mesmo com falha, o gerente é suspenso e perde as concessões, e depois todos os dados do spec (estabelecimentos, contas, recebimentos, auditoria e o plano de teste) saem numa transação. Nenhum gerente ativo fica para `pilot-team-manager-check`. Quatro mutações temporárias foram apanhadas e desfeitas: registrar com a concessão de consultar, estornar com a de registrar, gerente sem registrar e o estorno sem o filtro por estabelecimento em `payments.service.ts`.
- **Sem mudança:** `payments.service.ts` inteiro: a senha confirmada há pouco do estorno (`requireRecentReauth`, conferida antes da autorização), as travas, a idempotência, o recurso `PAGAMENTOS` e o isolamento por `tenant_id`. Seguem em `resolveAuthorizedTenant` o vínculo, a situação do estabelecimento e o acesso comercial. Os recebimentos de vendas (`sales/`, com as regras e o recurso deles) não foram tocados. Nenhuma migration.
- **Não convertido, fica para a etapa de cada área:** `commissions/commission-access.ts` (`canViewCommissions` chama `canViewPayments`) e `consumers/consumer-profile.service.ts` (`oQueOHistoricoMostra`: `veDinheiro` por `managerCan` e `veRecebimentos` por `canViewPayments`). O spec só as congela como guarda.
- **Comportamento antigo questionável, registrado e não corrigido nesta etapa:**
  - o dono com `RECEBIMENTOS_VISUALIZAR`, `_REGISTRAR` ou `_ESTORNAR` negada continua consultando, registrando e estornando: só a restrição da agenda conta para ele. Esse estado não é configurável pelo sistema: a restrição do dono pelo portal (`accounts-admin.service.ts`, `setDeniedPermissions`) só aceita a lista `EFFECTIVE_TENANT_PERMISSIONS` (`accounts/tenant-effective-access.ts`), que não tem recebimentos. Só aparece com escrita direta no banco;
  - no estorno, a senha recente é conferida antes da autorização: quem não tem a permissão, ou nem vínculo, e está sem senha recente recebe `REAUTENTICACAO_NECESSARIA` em vez de 403 ou 404;
  - a lista de recebimentos mostra o nome do cliente ao gerente com `RECEBIMENTOS_VISUALIZAR`, mesmo sem `CONSUMIDORES_VISUALIZAR` (na agenda, só o telefone e as observações são recortados);
  - o enum TypeScript `Permission` não descreve todos os valores gravados; ver "`Permission` e as permissões de recebimentos" abaixo;
  - recepcionista e funcionário ficam de fora porque a lista de concessões da recepcionista não tem recebimentos e o funcionário não tem concessões de gerente. A etapa das permissões individuais precisa rever isso junto.
- **Testes executados localmente:**
  - `vitest run` de `src/payments`, `commissions`, `consumers`, `accounts`, `dashboard`, `auth`, `team`, `common`, `appointments`, `sales` e `stock`: 57 arquivos, 845 testes;
  - `test:e2e` de comissões, contas, equipe, agenda e vendas: 90 testes;
  - `npm run typecheck`, `tsc -p tsconfig.build.json` e `npm run lint`.

  Tudo passou. O CI do PR roda o `db-e2e`, inclusive `payments-postgres` (registro, estorno, senha recente, restrição da agenda do dono, isolamento) e `team-manager-postgres` (consulta do gerente concedida e retirada). O resultado do CI no head fica registrado no PR.

  Na revisão: o spec novo `payments-manager-postgres` passou num PostgreSQL 18 descartável com TLS (3 testes), e a bateria `db-e2e` inteira, num banco novo migrado (28 migrations), passou com o spec novo: 48 arquivos, 538 testes, inclusive `pilot-team-manager-check`. O typecheck e o lint passaram de novo.

- **`Permission` e as permissões de recebimentos (esclarecido na revisão):**
  - definição: `backend/src/entities/enums/permission.enum.ts`, `export enum Permission`. Tem os 17 valores originais, comissões, personalização, configurações, estoque e vendas. Não tem os valores que o banco ganhou por TeamAccess (`ATENDIMENTO_PROPRIO_INICIAR`, `…_CONCLUIR`, `…_FALTA`), por TeamManagerAccess (`SOLICITACOES_VISUALIZAR`, `SOLICITACOES_TRATAR`, `RECEBIMENTOS_VISUALIZAR`, `…_REGISTRAR`, `…_ESTORNAR`) e por ProfessionalCommissions (`COMISSOES_PROPRIAS_VISUALIZAR`). Conferido contra o enum `permission` de um banco migrado: são exatamente esses nove;
  - concessão: `team/team.dto.ts` aceita `TEAM_PERMISSIONS` = `STAFF_PERMISSIONS` (`team/staff-access.ts`) + `MANAGER_PERMISSIONS` (`common/manager-permissions.ts`, onde estão os três de recebimentos). O serviço (`team/team-permissions.ts`) confere o papel, o que o dono pode conceder (`grantableManagerPermissions`: para os três de recebimentos, o dono precisa de `canViewPayments`), o adicional contratado e as dependências (`missingManagerRequirements`). Só o dono concede, e só `GRANTED`;
  - gravação: `membership_permission_overrides.permission` é o enum `permission` do PostgreSQL, que tem os valores de recebimentos desde a migration TeamManagerAccess (`MANAGER_NEW_PERMISSIONS`). A equipe grava por SQL com `$4::permission` (`team/team.service.ts` e `team/staff-accounts.service.ts`). O portal só grava `DENIED` no dono, e só da lista `EFFECTIVE_TENANT_PERMISSIONS`;
  - leitura e política: `resolveAuthorizedTenant` lê os ajustes pela entidade `MembershipPermissionOverride`, cuja coluna é tipada `Permission`. O TypeORM não confere o valor lido: `'RECEBIMENTOS_REGISTRAR'` chega como texto, com o tipo `Permission` sem ser membro dele. A política do gerente compara texto com `ManagerPermission` (`managerGranted`, base comum), então funciona. A lista do dono (`algumaNegada`, `ownerDenials`) é tipada `Permission[]` e não pode citar esses valores sem conversão de tipo; hoje nenhuma política do dono precisa deles;
  - web: `src/lib/equipe/contratos.ts` (`PermissaoGerente`) tem os três valores; a sessão traz áreas (`RECEBIMENTOS_VER`, `RECEBIMENTOS_REGISTRAR`, `RECEBIMENTOS_ESTORNAR`, `src/lib/conta/papel.ts`), calculadas no servidor pelas mesmas políticas (`accounts/tenant-effective-access.ts`), não as permissões;
  - conclusão: o gerente com as concessões de recebimentos é um acesso que o sistema atual configura de verdade (o `db-e2e` novo o monta pela tela de equipe). A limitação é só de tipo: `PermissionOverrideLike.permission` declara `Permission`, mais estreito que os valores gravados. Uma referência como `Permission.RECEBIMENTOS_VISUALIZAR` reprova no typecheck, mas no Vitest (sem checagem de tipos) vira `undefined` e passa calada. Não corrigido aqui: ampliar o enum ou o tipo é mudança fora desta etapa.

### PR de Clientes

- **Feito:**
  - `consumers/consumer-access.ts`: `canViewConsumers` e `canManageConsumers` decidem só por `accessCan(effectiveAccess(role, overrides), …)`, porque a lista do dono é igual às dependências do gerente (cadastrar exige `CONSUMIDORES_GERENCIAR` e `CONSUMIDORES_VISUALIZAR`; buscar, só `CONSUMIDORES_VISUALIZAR`). `canMergeConsumers` usa `accessAllows` com a lista literal do dono (`CONSUMIDORES_VISUALIZAR` e `CONSUMIDORES_GERENCIAR`) e nenhuma concessão: unificar continua só do dono. Assinaturas e mensagens iguais. A base comum não mudou;
  - recorte de preço do histórico (`consumers/consumer-profile.service.ts`, `oQueOHistoricoMostra`): o preço passa a vir de `canSeeAppointmentPrices` (convertida no #156), a mesma regra que o código já declarava seguir (o preço na agenda), no lugar da cópia com `managerCan`. O recebimento continua com `canViewPayments` (convertida no #157) e o recurso contratado. A montagem de cada item saiu do corpo de `history` para a função pura `itemDoHistoricoParaQuemPediu`, com o mesmo código, para ser testada campo a campo;
  - `consumers/consumer-access.equivalence.spec.ts`: referência congelada das regras em `9c904ea` (iguais a `8f71335`, o piloto), com a consulta de recebimentos que o histórico chamava escrita por extenso, só com listas literais. Compara uma impressão de pares (ação, alcance): buscar, cadastrar e unificar, todos com alcance "todos os cadastros do estabelecimento", e o preço e o recebimento do histórico, com o recurso contratado ligado ou não. Clientes não têm alcance próprio: funcionário e recepcionista não alcançam cliente algum, mesmo com tudo gravado (teste próprio). Como guarda, entram as decisões de outras áreas que dependem das políticas de Clientes: as compras na ficha (`sales.service.ts`, consulta geral de vendas e de clientes) e o que o dono pode conceder ao gerente em clientes (`grantableManagerPermissions`). Os casos combinam os quatro papéis, o gerente confirmado ou não, dois grupos exaustivos (4.096 casos) e 10.000 casos de semente fixa com todas as permissões. Uma guarda reprova política `can*` nova sem caso;
  - campos devolvidos: o mesmo spec compara cada item do histórico (`priceCents`, `payment` presente ou ausente, `hidden` e o resto do atendimento) com a transformação congelada, em 49.152 combinações (papéis, confirmação, `CONSUMIDORES_VISUALIZAR`, `AGENDA_VISUALIZAR`, `PROFISSIONAIS_VISUALIZAR`, `RECEBIMENTOS_VISUALIZAR`, recurso, quatro formas de preço e três de recebimento), com as entradas congeladas (alterar o item lança erro). Aparecem três desfechos: nada escondido, só o recebimento, ou os dois; "só o preço" não acontece, antes nem depois, porque quem vê recebimentos sempre vê o preço;
  - dezesseis mutantes apanhados, entre eles gerente buscando sem concessão, cadastrando sem a dependência ou só com a consulta, dono cadastrando com a consulta negada ou ignorando a restrição de buscar, GRANTED vencendo DENIED, gerente ou dono com regra errada de unificar, recepcionista ou funcionário com GRANTED, histórico com o preço do gerente sem as dependências ou pela consulta de clientes, preço escondido do dono com a agenda negada, recebimentos sem o recurso, compras na ficha sem a consulta de clientes e concessão indevida. A política lida sem `effectiveOverrides` também é apanhada. O spec passa contra a implementação anterior. Quatro mutações manuais nos arquivos reais foram apanhadas e desfeitas: cadastrar com a regra de buscar, gerente unificando com `CONSUMIDORES_GERENCIAR`, o preço do item sem recorte e o preço do histórico pela consulta de recebimentos (que barraria o dono com a agenda negada).
- **Sem mudança:** o SQL e as consultas de `consumers.service.ts`, `consumer-profile.service.ts` e `consumer-merge.service.ts`, o filtro por `tenant_id`, as travas e a prévia da unificação. A busca limitada de clientes da venda (`sales.service.ts`, `searchConsumers`) continua com a política de registrar vendas e não foi tocada; as compras na ficha continuam com a mesma composição. Seguem em `resolveAuthorizedTenant` o vínculo, a situação do estabelecimento e o acesso comercial. Nenhuma migration.
- **Comportamento antigo questionável, registrado e não corrigido nesta etapa:**
  - o preço do histórico é "visível" para qualquer papel que não seja gerente (`role !== GERENTE`). Hoje recepcionista e funcionário não chegam ao histórico (`canViewConsumers` os barra antes), mas uma etapa que abra clientes a outros papéis precisa rever o recorte junto, como na agenda;
  - o dono com `AGENDA_VISUALIZAR` negada continua vendo o preço no histórico (o recorte de preço não olha restrições do dono), mas não vê o recebimento, que segue a consulta de recebimentos;
  - lista, busca e ficha devolvem telefone e e-mail a quem busca clientes, sem recorte por concessão; só o histórico tem recorte.
- **Testes executados localmente:**
  - `vitest run` de `src/consumers`, `sales`, `team`, `accounts`, `auth`, `payments`, `appointments`, `common`, `commissions`, `dashboard`, `stock` e `availability`: 63 arquivos, 951 testes, inclusive as equivalências de Vendas, Estoque, Agenda e Recebimentos;
  - `test:e2e` de contas, equipe, vendas, agenda e comissões: 90 testes;
  - `db-e2e` num PostgreSQL 18 descartável com TLS: `consumers-identity-postgres` (ficha e histórico do dono com preço e recebimento, recurso desligado), `consumers-merge-postgres`, `team-manager-postgres`, `sales-access-postgres` e `isolamento-estabelecimentos-postgres`;
  - `npm run typecheck`, `tsc -p tsconfig.build.json` e `npm run lint`.

  Tudo passou. Limitação: o recorte do histórico para o gerente não tem `db-e2e` (o spec de identidade evita gerente por causa do banco compartilhado); fica provado campo a campo pela equivalência e pelo SQL inalterado. O resultado do CI no head fica registrado no PR.

### Resto da etapa 1

- **Não feito:**
  - converter serviços (`services/service-access.ts`), profissionais (`professionals/professional-access.ts`), comissões e equipe, incluindo a agenda própria e `staffCan`;
  - a impressão de acesso geral (`accessFingerprint`) para todas as áreas;
  - o `db-e2e` de alcance real sobre a cópia.
- **Próximo passo concreto:** revisar e mesclar o PR de Clientes. Depois, a próxima área num PR próprio, a partir da integração, com spec de equivalência no mesmo molde (`grep -rn "managerCan(\|receptionistCan(" backend/src`).
