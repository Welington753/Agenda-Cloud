# Planos Básico, Pro e Max e validade do acesso

Lote que separa plano, recursos e situação comercial do estabelecimento, e
permite à administração da plataforma registrar à mão o período pago, a
prorrogação do teste e a cortesia. Sem gateway de pagamento, sem cobrança
automática e sem relação com os recebimentos dos atendimentos (módulo
`payments`, que é o dinheiro que o cliente do estabelecimento paga a ele).

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
   fixo, e a tela diz "Ainda não há registro financeiro nesta área".
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
extras como recurso disponível.

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
2. a validade cobre agora: existe período (de qualquer tipo) com
   `starts_at <= agora < ends_at`, **ou** o estabelecimento não tem nenhum
   período registrado (seção 2.6);
3. o recurso da rota está no plano (seção 2.3).

**Períodos** (`tenant_access_periods`, uma linha por período, nunca
editada nem apagada):

- `TRIAL`: teste gratuito. Criado no cadastro de um estabelecimento novo:
  do instante do cadastro até a meia-noite local do dia de cadastro + 15
  (vale até o fim do 14º dia depois do cadastro).
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
- o agendamento público deixa de aceitar reservas novas, com a mesma
  resposta de um estabelecimento indisponível. As reservas já feitas
  continuam valendo.

### 2.6 Estabelecimentos existentes

**Nenhum período é criado para quem já existe.** Sem nenhum período
registrado, a validade não é conferida: o estabelecimento continua operando
como hoje, e a ficha mostra "Sem validade registrada". O controle passa a
valer para ele quando a administração registra o primeiro período
(pagamento, prorrogação ou cortesia), sempre por ação individual e
auditada.

Por quê: o teste derivado de todos os estabelecimentos do piloto já venceu.
Aplicar a validade a eles bloquearia o piloto inteiro na publicação, e
criar períodos para todos seria conceder teste ou cortesia em massa.

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
- nenhum papel global é criado, promovido ou alterado neste lote.

### 2.8 O que o registro manual afirma

O registro diz "pagamento confirmado manualmente pela administração". A
coluna `confirmation_source` só aceita `MANUAL` e a tela diz que não houve
confirmação automática por banco ou operadora. Não há conciliação, nota
fiscal nem boleto.

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
  no Básico, `PAGAMENTOS` no Pro (seção 2.3).

`down()` remove a tabela e as linhas de `plan_features` que criou e volta
os nomes antigos. Valores de enum ficam (o PostgreSQL não os remove).

## 4. API

Plataforma (`MASTER_OWNER`, reautenticação recente, `expectedUpdatedAt` e
`requestKey`):

| Rota | Efeito |
| --- | --- |
| `POST /platform/establishments/:id/access/paid` | pagamento confirmado manualmente: ciclo, valor, forma, data do recebimento, referência e observação opcionais |
| `POST /platform/establishments/:id/access/trial-extension` | prorroga o teste em `days` (1 a 30), com motivo |
| `POST /platform/establishments/:id/access/courtesy` | cortesia de `days` (1 a 180), com motivo |

A ficha (`GET /platform/establishments/:id`) passa a trazer `access`
(situação comercial, validade, início e fim, ciclo e plano do período em
curso) e `accessPeriods` (histórico), e `allowedActions` ganha
`recordPayment`, `extendTrial` e `grantCourtesy`.

Sessão (`/auth/me` e login): cada contexto ganha `access`
(`state`, `validUntil`, `blocked`). Um estabelecimento vencido continua na
lista, com `blocked: true` e sem áreas.

## 5. Testes

- Unitários: cálculo de datas (fim de mês, bissexto, âncora, fuso,
  renovação antecipada, vencido, sem registro), situação comercial e
  política de recurso.
- Banco descartável (`commercial-access-postgres.db-e2e-spec.ts`):
  migration, registro e repetição, concorrência, suspensão, arquivado,
  bloqueio e sessão aberta, isolamento entre estabelecimentos, recurso fora
  do plano com concessão do dono, e dono e gerente de um Max sem acesso à
  plataforma.
- Navegador: os specs que citam os nomes antigos dos planos.

## 6. Fora deste lote

- Gateway, cobrança automática, boleto, nota fiscal, conciliação.
- Estorno ou correção de um período registrado por engano (fica como
  próximo passo; até lá, a correção é um novo registro com observação, e o
  erro fica no histórico).
- Tela de exceções de recurso por estabelecimento.
- Aviso de vencimento próximo (e-mail ou WhatsApp).
- Aprovação dos preços e gravação deles no catálogo.

## 7. Estado e retomada

**Checkpoint de 2026-10-29, branch `feat/planos-validade-acesso`.**

Commits, em ordem: `30f960c` (plano e merge do O1), `8d88229` (backend),
`c3e0211` (teste pela API), `acf564d` (frontend), `e704052` (correção
de sobreposição, sem promessa de multiunidade, fluxo no navegador).

**Testes neste PC** (PostgreSQL 18.6 descartável com TLS, porta 55434,
`IGNORE_DOTENV_FILE=true`; nenhum banco real):

- backend: 1.618 unitários, 137 e2e HTTP, `tsc`, `oxlint`, `nest build`;
- banco: as 20 suítes `db-e2e` (224 testes) num banco novo com as 12
  migrations, inclusive `commercial-access-postgres` pela API HTTP real;
- migration: `up`, `down` e `up` de novo no descartável;
- frontend: 865 unitários, `tsc`, `eslint`, `lint:types`, `next build`;
- navegador: `test:browser:equipe` (com o fluxo novo de validade, telas
  em claro e escuro, 1280, 390 e 360 px) e `test:browser:auth`.

Num banco reaproveitado por várias rodadas, o teste do levantamento de
gerentes (`pilot-team-manager-check`) bate no teto de detalhes e falha;
num banco novo, como no CI, passa. Não tem relação com este lote.

**Decisões tomadas na implementação:**

- estabelecimentos existentes ficam sem período (`UNTRACKED`) e não
  vencem; o controle começa no primeiro registro individual;
- a conta de teste dos specs de navegador grava o estabelecimento direto no
  banco, então também nasce sem período;
- um período novo nunca começa antes do fim do último do mesmo grupo, mesmo
  que esse fim não seja meia-noite (troca de fuso); a sobreposição que
  escapar vira 409 `PERIODO_SOBREPOSTO`;
- planos criados por testes de banco recebem todos os recursos
  (`test/support/plano-de-teste.ts`): um plano sem linhas em
  `plan_features` não tem recurso nenhum.

**Publicação (quando aprovada):** migration nova `CommercialAccess` pelo
fluxo protegido; API antes do web (o web novo exige `access` na ficha).
Nada foi publicado, nenhum banco real foi tocado.

**Próximo passo exato:** aguardar os checks do PR; depois, revisão e decisão
de merge pelo dono. Pendências de produto: aprovar preços, decidir a
correção de um período registrado por engano e o aviso de vencimento
próximo.
