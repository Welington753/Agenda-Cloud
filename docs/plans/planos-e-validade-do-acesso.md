# Planos Básico, Pro e Max e validade do acesso

Lote que separa plano, recursos e situação comercial do estabelecimento, e
permite à administração da plataforma registrar à mão o período pago, a
prorrogação do teste e a cortesia, e corrigir um registro feito por engano.
Sem gateway de pagamento, sem cobrança automática e sem relação com os
recebimentos dos atendimentos (módulo `payments`, que é o dinheiro que o
cliente do estabelecimento paga a ele).

Branch `feat/planos-validade-acesso`, a partir da integration em `0c44052`.

## 1. O que existia (investigação)

**Por que a administração mostrava teste, suspender e arquivar, mas não
deixava registrar período pago:**

1. Não existe nenhuma tabela de validade, contrato ou pagamento da
   assinatura. `tenants` só tem `plan_id`, `status` e `restore_status`.
2. O teste é **derivado**: `auth/trial-policy.ts` calcula
   `createdAt + 14 dias` a cada leitura. Nada é gravado e **nada bloqueia**
   depois do fim: um estabelecimento com o teste vencido há meses continua
   operando como `TRIAL`.
3. Nenhuma rota leva um estabelecimento de `TRIAL` para `ACTIVE`. `ACTIVE`
   só aparece se alguém gravou direto no banco. A reativação volta para o
   `restore_status` gravado na suspensão.
4. A ficha (`platform.service.ts`) devolve `billing: { available: false }`
   fixo, e a tela diz "Ainda não há registro financeiro nesta área". Esse
   cartão "Mensalidades e pagamentos" era só esse aviso fixo: não lia nada
   nem gravava nada. Saiu e deu lugar ao cartão "Validade do acesso". Os
   recebimentos dos atendimentos (`payments/`, tela Recebimentos do
   estabelecimento) são outra funcionalidade, real, e não mudaram.
5. `PAST_DUE` e `CANCELED` existem no enum desde a migration inicial e não
   são usados por nenhum código.

Ou seja: não havia um fluxo quebrado, havia a falta do fluxo inteiro. O
`status` do estabelecimento misturava a situação administrativa (suspenso,
arquivado) com a comercial (teste, ativo), e a comercial não tinha datas.

**Plano e recursos:**

- `plans` tem os códigos estáveis `essencial`, `equipe` e `pro` (ids
  `plan_essencial`, `plan_equipe`, `plan_pro`), nomes Essencial, Gestão e
  Rede, `price_cents` NULL (preço não aprovado), limites de 2, 5 e 20
  profissionais e 1, 1 e 5 unidades.
- `plan_features` e `tenant_feature_overrides` existem desde a migration
  inicial, mas **nenhum código de runtime os lê**: hoje todo estabelecimento
  usa todos os módulos implementados, qualquer que seja o plano. O Essencial,
  pelo catálogo, não teria clientes, equipe nem recebimentos, e mesmo assim
  os usa.
- O limite de acessos de equipe é `max_professionals` (`team/seats.ts`). O
  DONO não ocupa vaga.

**Unidades:** cada estabelecimento tem uma única unidade principal, criada no
cadastro (`invites.service.ts`). Não há rota, tela nem regra para criar uma
segunda unidade, e a agenda, a disponibilidade e o agendamento público não
escolhem unidade. **Multiunidade não existe**, apesar de `max_units = 5` no
plano `pro` e de o site prometer "Para negócios com mais de uma unidade".

## 2. Decisões

### 2.1 Nomes e identificadores

| Código (não muda) | Id (não muda) | Nome antigo | Nome novo |
| --- | --- | --- | --- |
| `essencial` | `plan_essencial` | Essencial | **Básico** |
| `equipe` | `plan_equipe` | Gestão | **Pro** |
| `pro` | `plan_pro` | Rede | **Max** |

Só `plans.name` e `plans.short_description` mudam. Códigos, ids, vínculos
dos estabelecimentos, permissões e histórico ficam como estão.

**Armadilha registrada:** o plano de nome **Pro** tem código `equipe`, e o
código `pro` é o plano **Max**. Código nunca deve ser mostrado ao cliente
nem deduzido do nome.

### 2.2 Preços (proposta, não aprovada para cobrança)

| Plano | Mensal | Trimestral | Equivalente mensal no trimestral | Profissionais e acessos de equipe |
| --- | --- | --- | --- | --- |
| Básico | R$ 49,90 | R$ 134,90 | R$ 44,97 (−9,9%) | 2 |
| Pro | R$ 89,90 | R$ 242,90 | R$ 80,97 (−9,9%) | 5 |
| Max | R$ 149,90 | R$ 404,90 | R$ 134,97 (−10,0%) | 20 |

- O DONO continua fora da cota de acessos (regra de `team/seats.ts`).
- `plans.price_cents` **continua NULL**: a proposta não está aprovada e
  nenhum código usa o catálogo para cobrar. O valor de cada período pago é
  digitado pela administração no registro e guardado naquele período.
- Mudar o catálogo no futuro não altera o valor de períodos já registrados.

### 2.3 Matriz de recursos (proposta)

**Recursos que já existem no código.** Todos ficam nos três planos; a
diferença entre os planos hoje são os limites. Assim nenhum estabelecimento
perde módulo que usa.

| Recurso (`FeatureKey`) | Módulo real | Básico | Pro | Max |
| --- | --- | --- | --- | --- |
| `AGENDA` | agenda, horários, disponibilidade | sim | sim | sim |
| `AGENDAMENTO_PUBLICO` | `/agendar/<slug>` e sua configuração | sim | sim | sim |
| `PROFISSIONAIS` | cadastro de profissionais | sim | sim | sim |
| `CONSUMIDORES` | clientes | sim (novo no catálogo) | sim | sim |
| `EQUIPE` | acessos de funcionário e gerente, agenda própria | sim (novo no catálogo) | sim | sim |
| `PAGAMENTOS` | recebimentos dos atendimentos | sim (novo no catálogo) | sim (novo no catálogo) | sim |
| (sem chave) | serviços, visão geral, avisos no navegador | núcleo | núcleo | núcleo |

"Novo no catálogo" é a migration acrescentando a linha em `plan_features`
para que o catálogo diga o que o código já fazia. Não concede nada novo.

**Recursos futuros (não implementados).** Ficam no catálogo como proposta;
nenhuma tela os oferece como disponíveis.

| Recurso | Básico | Pro | Max |
| --- | --- | --- | --- |
| `RELATORIOS` (relatórios além da visão geral) | não | sim | sim |
| `COMISSOES` | não | proposta: sim | sim |
| `LISTA_DE_ESPERA` | não | proposta: sim | sim |
| `PERSONALIZACAO_AVANCADA` | não | não | sim |
| `MULTIPLAS_UNIDADES` | não | não | sim, **quando existir** |
| `DOMINIO_PROPRIO` | não | não | sim |
| `ASSINATURAS` (planos do estabelecimento para os clientes dele) | não | não | sim |

`plan_features` dos futuros não muda neste lote (o Pro já tinha
`RELATORIOS`; o Max já tinha todos). A alocação de cada futuro é decidida
quando o módulo existir.

**Max = todos os módulos destinados ao cliente**, nunca as permissões do
sistema. A administração da plataforma não é recurso de plano: não tem
`FeatureKey`, não está em `plan_features` e só é liberada por
`users.platform_role` (seção 2.7).

**Multiunidade:** não prometer. `max_units` fica como está no banco (1, 1,
5), mas a tela da administração e o site deixam de apresentar unidades
extras como recurso disponível. Na revisão, o site ainda listava
"Unidades", "Comissões" e "Personalização" entre as funcionalidades
disponíveis; as três passaram para "em desenvolvimento", com teste.

**Preservação dos recursos existentes: antes e depois.**

Antes deste lote nenhum código lia `plan_features`: todo estabelecimento
usava todos os módulos existentes, qualquer que fosse o plano. Agora a rota
confere o recurso. Isentar da validade não basta, então a comparação é por
plano:

| Recurso existente | Antes (qualquer plano) | Depois: Básico | Depois: Pro | Depois: Max | Depois: plano fora do catálogo |
| --- | --- | --- | --- | --- | --- |
| `AGENDA` | usava | sim | sim | sim | exceção individual ligada |
| `AGENDAMENTO_PUBLICO` | usava | sim | sim | sim | exceção individual ligada |
| `PROFISSIONAIS` | usava | sim | sim | sim | exceção individual ligada |
| `CONSUMIDORES` | usava | sim (linha nova) | sim | sim | exceção individual ligada |
| `EQUIPE` | usava | sim (linha nova) | sim | sim | exceção individual ligada |
| `PAGAMENTOS` | usava | sim (linha nova) | sim (linha nova) | sim | exceção individual ligada |
| serviços, visão geral, avisos | usava | núcleo | núcleo | núcleo | núcleo |

- Nos três planos conhecidos nada é retirado: o catálogo passa a dizer o
  que já era usado.
- Para um estabelecimento existente num plano fora dos três (não há prova
  de que exista no piloto, e o banco real não foi consultado), a migration
  grava a exceção individual ligada (`tenant_feature_overrides`, id
  `tfo_ca_…`) para cada recurso existente que o plano dele não tenha. O
  direito anterior fica até uma mudança individual aprovada; não há tela
  para removê-la neste lote.
- Uma exceção já gravada antes (nenhum código as grava; só à mão) nunca é
  trocada. Uma exceção desligada, que antes não tinha efeito, passa a
  valer. Antes de publicar, conferir que não existe nenhuma:
  `SELECT count(*) FROM tenant_feature_overrides WHERE enabled = false`
  (esperado 0; se houver, decidir caso a caso antes da migration).
- Ensaio no banco descartável: um estabelecimento no Básico não ganhou
  exceção; dois num plano fora do catálogo ganharam as seis (o que tinha a
  exceção manual desligada ficou com ela); o `down()` removeu só as
  exceções da migration.

### 2.4 Separação dos conceitos

| Conceito | Onde fica | Quem muda |
| --- | --- | --- |
| Plano | `tenants.plan_id` | administração (troca de plano, já existia) |
| Recursos | `plan_features` + `tenant_feature_overrides` | catálogo (migration); exceção por estabelecimento sem tela neste lote |
| Validade (teste, pago, cortesia) | `tenant_access_periods` (nova) | administração, por período |
| Ciclo (mensal, trimestral) | coluna do período pago | administração, no registro |
| Início e fim | colunas do período | calculados pelo servidor |
| Suspensão e arquivamento | `tenants.status` + `restore_status` | administração (já existia) |

`tenants.status` continua sendo a situação administrativa. `TRIAL` e
`ACTIVE` passam a significar só "não está suspenso nem arquivado"; o
servidor muda `TRIAL` para `ACTIVE` no primeiro período pago ou cortesia,
para a listagem continuar coerente. `PAST_DUE` e `CANCELED` continuam sem
uso: vencimento é calculado pelas datas, nunca gravado por tarefa.

### 2.5 Regras da validade

**Estabelecimento opera** quando as três coisas valem:

1. `status` é `TRIAL` ou `ACTIVE` (não suspenso, não arquivado);
2. a validade cobre agora: existe período válido (de qualquer tipo, não
   anulado) com `starts_at <= agora < ends_at`, **ou** o estabelecimento não
   tem nenhum período válido **e** tem a marca explícita de anterior ao
   controle (`tenants.access_legacy_since`, seção 2.6). Sem período e sem a
   marca, o acesso fica bloqueado (`MISSING`): a falta do teste nunca vira
   acesso indefinido;
3. o recurso da rota está no plano (seção 2.3).

**Períodos** (`tenant_access_periods`, uma linha por período, nunca
apagada; a única mudança possível é a anulação por correção, seção 2.9):

- `TRIAL`: teste gratuito. Criado no cadastro de um estabelecimento novo,
  na mesma transação do estabelecimento, da unidade, do histórico e do
  convite: se a gravação do teste falhar, nada é criado (provado no teste de
  banco forçando a falha). Vai do instante do cadastro até a meia-noite
  local do dia de cadastro + 15 (vale até o fim do 14º dia depois do
  cadastro).
- `PAID`: período pago, com plano, ciclo, valor contratado em centavos e o
  pagamento confirmado manualmente (forma, data do recebimento, referência
  opcional e observação).
- `COURTESY`: cortesia, com motivo obrigatório e sem valor.

**Datas.** Tudo em data local do estabelecimento (`tenants.timezone`).
Cada período cobre de meia-noite local do dia de início até meia-noite local
do dia de fim (fim exclusivo). A tela mostra o último dia coberto.

**Mensal e trimestral não são 30 e 90 dias.** O fim é o mesmo dia do mês,
1 ou 3 meses depois, preso ao último dia do mês quando ele não existe. O dia
de referência (`anchor_day`) é o do primeiro período pago da sequência e é
mantido nas renovações, para o vencimento não escorregar:

| Início | Ciclo | Fim (exclusivo) | Último dia coberto |
| --- | --- | --- | --- |
| 31/01/2027 | mensal | 28/02/2027 | 27/02/2027 |
| 28/02/2027 (renovação, âncora 31) | mensal | 31/03/2027 | 30/03/2027 |
| 31/03/2027 (renovação, âncora 31) | mensal | 30/04/2027 | 29/04/2027 |
| 30/11/2027 | trimestral | 29/02/2028 | 28/02/2028 (bissexto) |
| 15/05/2027 | trimestral | 15/08/2027 | 14/08/2027 |

**Início de um período novo (pago ou cortesia):**

- se há validade em curso ou futura (de qualquer tipo, inclusive o teste),
  começa **no fim dela** (renovação antecipada): nada se perde nem se
  sobrepõe. Pagar durante o teste não encurta o teste;
- se não há (vencido, ou estabelecimento sem registro), começa **hoje**
  (data local). Os dias vencidos não são cobertos retroativamente;
- a âncora é mantida quando o novo pago encosta no fim de um pago anterior;
  senão é o dia do início.

**Prorrogar teste:** só enquanto o estabelecimento nunca teve período pago
nem cortesia (depois disso, o caminho é a cortesia). Acrescenta de 1 a 30
dias a partir do fim do teste em curso, ou de hoje se já venceu. Um
estabelecimento sem registro tem o teste derivado do cadastro: o novo teste
começa hoje e termina no maior entre hoje e o fim derivado, mais os dias
pedidos. Nunca reinicia o teste do zero.

**Cortesia:** de 1 a 180 dias, com o mesmo encadeamento do pago.

**Repetição:** cada formulário tem uma chave (`requestKey`), única por quem
registrou. Repetir a mesma requisição devolve o período já gravado, sem
duplicar pagamento nem estender de novo; a mesma chave com outro conteúdo é
recusada. A linha do estabelecimento é travada (`FOR NO KEY UPDATE`) e a
versão lida pela tela (`expectedUpdatedAt`) é conferida, como nas outras
ações da ficha. No banco, uma exclusion constraint impede dois períodos
pagos ou cortesias sobrepostos no mesmo estabelecimento.

**Suspensão e arquivamento:**

- pagamento, prorrogação e cortesia **nunca** tiram a suspensão nem o
  arquivamento. Num suspenso o período é gravado e o `restore_status` passa
  a `ACTIVE`; o estabelecimento só volta a operar pela reativação, que é
  outra ação, com confirmação própria;
- num arquivado as três ações são recusadas: reativar primeiro.

**Ao vencer:**

- nada é apagado nem cancelado: agenda, clientes, reservas, recebimentos,
  equipe e histórico ficam;
- as rotas do estabelecimento respondem `403` com o código
  `ACESSO_VENCIDO` (o vínculo já está provado, então não há o que esconder);
- a sessão continua listando o estabelecimento, marcado como vencido e sem
  áreas, e o painel mostra ao responsável o motivo (fim do teste ou do
  período, com a data) e o caminho de regularização (falar com a
  administração do Agenda Cloud, que registra o pagamento). Funcionários
  veem que o acesso do estabelecimento está pausado e que o responsável foi
  avisado pelo painel;
- a pessoa continua entrando, saindo e cuidando da própria conta: Perfil e
  segurança (troca de senha e saída), a escolha de estabelecimento e a
  administração da plataforma ficam abertas, e o aviso tem o atalho para
  Perfil e segurança. `/conta` mostra o aviso no lugar, sem encaminhar
  (sem ciclo de redirecionamento);
- se o acesso vence com a página aberta, a próxima leitura recebe
  `ACESSO_VENCIDO`; o cliente HTTP avisa a sessão, que é relida, e a tela
  troca a página pelo aviso em vez de ficar com erro;
- o agendamento público deixa de aceitar reservas novas, com a mesma
  resposta de um estabelecimento indisponível. As reservas já feitas
  continuam valendo; nenhum atendimento é cancelado (não existe tarefa de
  vencimento: a situação é calculada pelas datas a cada requisição).

**Aviso antes de vencer (só dentro do aplicativo):** o DONO vê uma faixa
nas faixas de 7, 3 e 1 dia antes do fim da validade **efetiva**
(`validUntil`, o fim da validade contínua com as renovações já
registradas). Um teste que acaba amanhã, seguido de um período pago já
registrado, não gera aviso. Sem e-mail, WhatsApp ou push neste lote.

**O que cada papel recebe na sessão:** só o DONO recebe a situação
comercial (tipo, até quando, o que venceu). Gerente, recepção e
profissional recebem `state`, datas e tipo `null`, e só `blocked`. Ninguém
do estabelecimento recebe valor ou histórico da assinatura: isso só existe
na ficha da administração da plataforma.

### 2.6 Estabelecimentos existentes

**Correção do relatório anterior.** O relatório de entrega anterior e a
versão anterior desta seção afirmaram que "o teste derivado de todos os
estabelecimentos do piloto já venceu". Essa afirmação **não tinha base**:
foi uma suposição de quem escreveu, sem consulta ao banco do piloto (que
não foi e não será consultado neste lote) e sem vir de dados fictícios do
seed ou dos testes. A única evidência disponível a contradiz: a captura da
ficha antiga, que mostrava "Teste previsto até" 06/11/2026, ou seja, um
estabelecimento cadastrado em 23/10/2026 com o teste derivado ainda em
curso. O estado real do piloto **não está confirmado**.

**Decisão.** A regra não depende da suposição:

- a migration marca **explicitamente** todo estabelecimento que já existe
  (`tenants.access_legacy_since = now()`). Nenhum período é criado para
  eles: não há teste nem cortesia em massa;
- só essa marca dispensa a validade enquanto não houver período. Um
  estabelecimento criado depois da migration nasce sem a marca e com o
  teste gravado na mesma transação; sem período e sem a marca, fica
  bloqueado (`MISSING`, "Sem validade registrada");
- na ficha e nas configurações do dono, o anterior ao controle aparece
  como **"Validade ainda não definida"**: nem pago, nem teste renovado. A
  data do teste derivado aparece só como referência do cadastro, dizendo
  que não foi aplicada;
- continua operando como antes, com os mesmos recursos (seção 2.3), até a
  administração regularizar **individualmente** (pagamento, prorrogação ou
  cortesia), sempre auditada. Daí em diante vale a validade pelos períodos.

Por quê: aplicar a validade derivada na publicação bloquearia de surpresa
quem tem teste vencido pelo cálculo, e quem tem teste em curso (como o de
06/11/2026) passaria a vencer sem nenhuma decisão registrada. Criar
períodos para todos seria conceder teste ou cortesia em massa.

### 2.7 Autorização

A cada requisição de estabelecimento, `resolveAuthorizedTenant` confere,
nesta ordem: vínculo (`Membership`) e situação do vínculo; situação
administrativa; validade; recurso contratado; permissão pessoal (papel e
ajustes). Uma concessão do dono a um gerente (`GRANTED`) só é lida depois
do recurso: nunca libera módulo fora do plano.

A administração da plataforma continua separada:

- só `users.platform_role` dá acesso a `/platform/*`, relido do banco a
  cada requisição. Ser DONO ou GERENTE de um estabelecimento Max não
  concede nada ali;
- registrar pagamento, prorrogar teste e conceder cortesia exigem a mesma
  capacidade da suspensão e da troca de plano
  (`manageEstablishmentLifecycle`, só `MASTER_OWNER`) e senha confirmada
  há pouco na sessão;
- não existe rota de estabelecimento que altere a própria validade,
  registre o próprio pagamento ou mexa em papel de plataforma. As
  permissões de equipe aceitas pela API são só as do enum `Permission`;
- nenhum papel global é criado, promovido ou alterado neste lote. O teste
  de banco compara `platform_role` e `platform_permissions` de todas as
  contas antes e depois de corrigir, repetir a correção, registrar de novo
  e trocar o plano: nada muda.

**Plano por código, nunca por nome.** O mapeamento fica em um lugar só,
`backend/src/commercial/plan-catalog.ts`, com teste: Básico = `essencial`
(`plan_essencial`), Pro = `equipe` (`plan_equipe`), Max = `pro`
(`plan_pro`). O teste também confere que a migration grava os mesmos nomes
e que nenhum código de runtime compara nome ou código de plano. No site, o
teste de `PLANOS_COMERCIAIS` confere o mesmo mapeamento. Max libera só os
recursos do catálogo (`plan_features`), sempre depois do vínculo e antes da
permissão pessoal; o nome comercial não dá privilégio nenhum.

### 2.8 O que o registro manual afirma

O registro diz "pagamento confirmado manualmente pela administração". A
coluna `confirmation_source` só aceita `MANUAL` e a tela diz que não houve
confirmação automática por banco ou operadora. Não há conciliação, nota
fiscal nem boleto.

### 2.9 Correção de um registro feito por engano

`POST /platform/establishments/:id/access/periods/:periodId/correction`,
com `expectedUpdatedAt`, `requestKey` e `reason` (obrigatório).

- **Quem:** só `MASTER_OWNER` (`manageEstablishmentLifecycle`), com senha
  confirmada há pouco na sessão. Dono, gerente e um `MASTER_OWNER` sem a
  senha confirmada recebem 403.
- **O que faz:** anula o registro. A linha original fica intacta (tipo,
  datas, plano, valor, forma de pagamento, quem registrou) e ganha
  `canceled_at`, `canceled_by_user_id`, `cancel_reason` e
  `cancel_request_key`: a relação entre o registro e a correção é a própria
  linha. Nada é apagado. O período anulado deixa de contar para a validade
  e para as constraints de sobreposição, então o registro certo pode ser
  feito em seguida pelas ações normais.
- **Antes de confirmar:** a ficha traz, em cada registro, a prévia
  calculada no servidor (`correction`): se pode ser anulado e como fica a
  validade depois. A tela mostra "Validade agora" e "Depois de anular".
- **Cadeia:** só o último registro da cadeia é anulado. Se houver outro
  registro válido começando no mesmo instante ou depois, anular este
  deixaria uma lacuna ou exigiria mover os seguintes: a API recusa com
  `CORRECAO_EM_CADEIA` e diz qual corrigir antes. Outros períodos nunca são
  alterados. Anular nunca acrescenta validade.
- **Transação e repetição:** a linha do estabelecimento é travada e a
  versão conferida, como nas outras ações. A mesma chave devolve a mesma
  correção (`created: false`); um registro já anulado recusa outra
  correção (`PERIODO_JA_CORRIGIDO`); a mesma chave em outro registro é
  recusada (`CHAVE_REUTILIZADA`).
- **Correção não é estorno:** o sistema não devolve nem movimenta dinheiro.
  O histórico (`ACCESS_PERIOD_CORRECTED`) diz isso no resumo e grava
  `moneyMoved: false`, o registro original e a validade antes e depois.
  Um estorno, se houver, acontece fora do Agenda Cloud.
- Situação administrativa (suspensão, arquivamento) não muda. Num
  arquivado a correção é recusada, como as outras ações.

## 3. Schema (migration nova `1793232000000-CommercialAccess`)

As 11 migrations do piloto não mudam. A nova só acrescenta:

- tipos `access_period_kind` (`TRIAL`, `PAID`, `COURTESY`) e
  `billing_cycle` (`MONTHLY`, `QUARTERLY`);
- tabela `tenant_access_periods` com FKs para tenant, plano e usuário,
  checks por tipo (pago exige ciclo, valor e pagamento; cortesia exige
  motivo; teste não tem valor), `ends_at > starts_at`, chave única por
  quem registrou, e exclusion constraint (`btree_gist`) contra sobreposição
  de pagos e cortesias no mesmo estabelecimento;
- valores novos em `audit_action`: `ACCESS_PAID_PERIOD_RECORDED`,
  `ACCESS_TRIAL_EXTENDED`, `ACCESS_COURTESY_GRANTED`;
- nomes e descrições novos dos três planos, só nas linhas com os ids
  conhecidos;
- linhas novas em `plan_features`: `CONSUMIDORES`, `EQUIPE` e `PAGAMENTOS`
  no Básico, `PAGAMENTOS` no Pro (seção 2.3);
- coluna `tenants.access_legacy_since`, preenchida com `now()` em todos os
  estabelecimentos que existem na hora da migration (seção 2.6);
- exceções individuais ligadas (`tenant_feature_overrides`, id `tfo_ca_…`)
  só para estabelecimento existente cujo plano não tenha um recurso
  existente no catálogo (seção 2.3). Nos três planos conhecidos, nenhuma;
- colunas de anulação no período (`canceled_at`, `canceled_by_user_id`,
  `cancel_reason`, `cancel_request_key`), com check de tudo-ou-nada, chave
  única por quem anulou, e as exclusion constraints passando a olhar só os
  períodos não anulados;
- valor novo em `audit_action`: `ACCESS_PERIOD_CORRECTED`.

`down()` remove as exceções `tfo_ca_…`, a coluna `access_legacy_since`, a
tabela e as linhas de `plan_features` que criou, e volta os nomes antigos.
Valores de enum ficam (o PostgreSQL não os remove). Como a migration ainda
não saiu desta branch, as mudanças da revisão entraram nela mesma; as 11
migrations do piloto continuam intactas.

## 4. API

Plataforma (`MASTER_OWNER`, reautenticação recente, `expectedUpdatedAt` e
`requestKey`):

| Rota | Efeito |
| --- | --- |
| `POST /platform/establishments/:id/access/paid` | pagamento confirmado manualmente: ciclo, valor, forma, data do recebimento, referência e observação opcionais |
| `POST /platform/establishments/:id/access/trial-extension` | prorroga o teste em `days` (1 a 30), com motivo |
| `POST /platform/establishments/:id/access/courtesy` | cortesia de `days` (1 a 180), com motivo |
| `POST /platform/establishments/:id/access/periods/:periodId/correction` | anula um registro feito por engano, com motivo (seção 2.9) |

A ficha (`GET /platform/establishments/:id`) traz `access` (situação
comercial, `legacy`, validade, último dia, o que venceu) e `accessPeriods`
(histórico, com `canceled` e a prévia `correction` de cada registro), e
`allowedActions` ganha `recordPayment`, `extendTrial`, `grantCourtesy` e
`correctPeriod`.

Sessão (`/auth/me` e login): cada contexto ganha `access`. O DONO recebe
`state`, `validUntil`, `blocked`, `expiredAt` e `expiredKind`; os outros
papéis, só `blocked` (o resto `null`). Um estabelecimento bloqueado continua
na lista, com `blocked: true` e sem áreas.

Situações (`state`): `UNTRACKED` (anterior ao controle, sem período:
"Validade ainda não definida"), `MISSING` (sem período e sem a marca:
bloqueado), `TRIAL`, `PAID`, `COURTESY` e `EXPIRED`.

## 5. Testes

- Unitários: cálculo de datas (fim de mês, bissexto, âncora, fuso,
  renovação antecipada, vencido, sem registro), situação comercial com e sem
  a marca de anterior, impacto da correção (último da cadeia, recusa no
  meio, nunca acrescenta), mapeamento dos planos e varredura contra decisão
  por nome de plano.
- Banco descartável (`commercial-access-postgres.db-e2e-spec.ts`, pela API
  HTTP real): migration, registro e repetição, concorrência, suspensão,
  arquivado, bloqueio e sessão aberta, isolamento entre estabelecimentos,
  recurso fora do plano com concessão do dono, dono e gerente de um Max sem
  acesso à plataforma (inclusive à correção), sessão do gerente sem a
  situação comercial, legado só pela marca, criação transacional com falha
  forçada no teste, e a correção completa (prévia, cadeia, reautenticação,
  motivo, repetição, já anulado, nada apagado, histórico, registro certo
  depois e papéis globais intactos depois de trocar o plano).
- Ensaio da migration com dados anteriores (seção 2.3).
- Frontend: contratos novos, impacto da correção em texto, faixas do aviso
  de vencimento, evento do `ACESSO_VENCIDO` no cliente HTTP, site sem
  recurso futuro como disponível.
- Navegador: `equipe` (validade ainda não definida, pagamento, correção com
  impacto e motivo, aviso de 3 dias, vencimento com a página aberta, Perfil
  e segurança acessível com o acesso pausado, regularização) e
  `administracao` (rótulo do anterior ao controle).

## 6. Fora deste lote

- Gateway, cobrança automática, boleto, nota fiscal, conciliação, estorno
  (a correção só anula o registro; seção 2.9).
- Tela de exceções de recurso por estabelecimento.
- Aviso de vencimento por e-mail, WhatsApp ou push.
- Aprovação dos preços e gravação deles no catálogo.
- Correção que reorganize uma cadeia de renovações (mover períodos
  seguintes): recusada de propósito; anula-se do mais recente para trás.

## 7. Estado e retomada

**Checkpoint de 2026-10-29, branch `feat/planos-validade-acesso`, revisão
final do PR #82.**

Commits até a entrega anterior: `30f960c` (plano e merge do O1), `8d88229`
(backend), `c3e0211` (teste pela API), `acf564d` (frontend), `e704052`
(correção de sobreposição, sem promessa de multiunidade, fluxo no
navegador), `4268ad1`, `65d7cd5` e `e07cb45` (checkpoint e ajustes do CI).
A revisão final entra nos commits seguintes (ver o PR).

**Testes da revisão neste PC** (PostgreSQL 18.6 descartável com TLS, porta
55434, `IGNORE_DOTENV_FILE=true`; nenhum banco real):

- backend: 1.627 unitários, 137 e2e HTTP, `tsc`, `oxlint`, `nest build`;
- banco: as 20 suítes `db-e2e` (226 testes) num banco novo com as 12
  migrations;
- migration: ensaio com estabelecimentos anteriores, `down` e `up` de novo;
- frontend: 876 unitários, `tsc`, `eslint`, `lint:types`, `next build`
  (os dois avisos de lint são de arquivos fora deste lote);
- navegador: `equipe` (fluxo completo, inclusive correção, aviso de 3 dias, vencimento com a página aberta e Perfil e segurança com o acesso pausado), `administracao`, `auth`, `gerente`, `recebimentos` e `recuperacao`, todos passando. A primeira rodada de `equipe` pegou um defeito real: a verificação da sessão mantinha o estado antigo da mesma pessoa, e o vencimento com a página aberta não aparecia; corrigido em `aplicarVerificacao`, com teste.

**Decisões tomadas na revisão:**

- a afirmação sobre os testes do piloto foi retirada (seção 2.6): era
  suposição; o estado real do piloto não foi consultado;
- legado só pela marca explícita da migration; sem período e sem marca,
  bloqueado;
- correção = anulação do último registro da cadeia, nunca exclusão nem
  estorno;
- só o DONO recebe a situação comercial na sessão;
- o site deixou de listar multiunidade, comissões e personalização como
  disponíveis.

**Publicação (quando aprovada):** antes, conferir
`SELECT count(*) FROM tenant_feature_overrides WHERE enabled = false`
(esperado 0). Migration nova `CommercialAccess` pelo fluxo protegido; API
antes do web (o web novo exige `access` na ficha). Nada foi publicado,
nenhum banco real foi tocado, nenhuma mensagem foi enviada.

**Próximo passo exato:** revisão e decisão de merge do PR #82 pelo dono.
Pendências de produto: aprovar os preços; decidir, um a um, a
regularização dos estabelecimentos com "Validade ainda não definida".
