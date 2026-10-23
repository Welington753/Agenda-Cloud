# Administração real da plataforma e financeiro

## Primeiro lote: consulta real, sem mudança de schema

Base: integration em `20e3fdc3d288b4486e1200da088f0cda868de431`.
Rota real: `/administracao`, com lista em `/administracao/estabelecimentos`
e ficha em `/administracao/estabelecimentos/[id]`.
O `/master` anterior continua identificado como demonstração, sem ligação
com estes dados ou com a autorização real.
O nome `administracao` fica reservado no editor de endereços da demonstração;
o agendamento público real continua em `/agendar/[slug]`.

Públicos distintos:

| Público | Escopo |
| --- | --- |
| Administração do Agenda-Cloud | Estabelecimentos assinantes, responsáveis, plano e uso agregado |
| DONO/equipe de um estabelecimento | A operação do próprio estabelecimento, conforme permissões existentes |
| Consumidor final | Pedido de agendamento público |

### Acesso e contrato

- Usa a sessão HttpOnly real e o mesmo `SessionGuard`.
- `MASTER_OWNER` ativo consulta todos os estabelecimentos.
- `MASTER_ADMIN`/`MASTER_SUPPORT` ativos precisam da permissão explícita
  `ESTABLISHMENTS_MANAGE`, já existente. `SUPPORT_ACCESS` sozinho não libera.
- Sem `platformRole`, até um DONO com permissões de estabelecimento recebe
  403. O papel e as permissões são relidos no banco em toda consulta.
- Não exige Membership para o Master e não cria vínculo de suporte.
- `GET /platform/access`: somente o booleano de acesso do usuário autenticado.
- `GET /platform/establishments`: busca literal por nome/slug/responsável,
  filtros de plano/status, página de 20, teto 100, ordem estável por cadastro/id.
  Retorna totais globais separados do total filtrado e da página atual.
- `GET /platform/establishments/:id`: responsáveis, unidades, plano, situação
  e contagens de profissionais/serviços ativos e consumidores. Nenhum dado
  individual de consumidor, sessão, senha ou histórico de atendimento.
- As duas leituras de dados usam transação READ ONLY / REPEATABLE READ.
  Os nomes seguem a mesma fonte da sessão: unidade principal, ou slug.
- Respostas HTTP com `Cache-Control: private, no-store`. Nada é persistido no
  armazenamento do navegador. Troca de conta/consulta descarta dados antigos.
- Cada tela tem carregamento, falha, falta de permissão e vazio próprios.
  Erro não vira zero, preço nulo não vira gratuito, ACTIVE não vira pago.

Não há rota para alterar planos, suspender usuários, promover administradores,
entrar como o cliente ou registrar pagamentos neste lote. A visualização não
altera reservas, notificações, disponibilidade nem isolamento das rotas locais.

### Entrada e provisionamento

Conta já autorizada: `Minha conta → Administração da plataforma`, ou acesso
direto a `/login?next=/administracao`. Não é preciso entrar pela demonstração.

Não há provisionamento automático no cadastro e não há e-mails de fundadores
hardcoded. Nenhuma conta real foi promovida por este lote.

Antes de habilitar Welington e Leonardo no piloto, identificar os IDs **e os
e-mails exatos** das contas reais escolhidas. O procedimento administrativo
deve confirmar o destino do piloto, fazer backup, conferir usuário ativo e
credencial real, atribuir `MASTER_OWNER` somente a essas contas e registrar a
ação de provisionamento. Não usar `/auth/register` com campos adicionais,
seeds demonstrativos, nome da pessoa ou domínio do e-mail como autorização.
Esse provisionamento é uma operação separada sobre dados reais, não migration
nem efeito colateral do deploy. Ainda depende de identificar as contas.

### Publicação

API e web do mesmo SHA validado, API primeiro. Não há migration nem variável
nova. Não publicar enquanto os testes de PostgreSQL e navegador não tiverem
executado e passado. Preservar VAPID e a correção de hibernação do PR #59.

## Próximo lote: proposta financeira, ainda não implementada

O schema atual só associa `tenants.plan_id` ao catálogo `plans.price_cents`.
Não existe evidência de mensalidade contratada, vencimento ou recebimento
nessa relação. Por isso não se calcula faturamento a partir de tenants ativos.

Propõe-se um registro manual de assinatura/cobrança/recebimento, sem gateway,
serviço pago, envio de cobrança nem alteração automática de acesso:

| Registro proposto | Dados essenciais |
| --- | --- |
| Contrato do estabelecimento | tenant, plano, valor contratado em centavos, moeda BRL, início/fim de vigência e dia de vencimento |
| Cobrança de uma competência | tenant/contrato, competência, vencimento, valor devido congelado, cancelamento e motivo |
| Recebimento | tenant/cobrança, valor em centavos, data, método, responsável pelo registro, chave de idempotência e referência de estorno |

Regras propostas para revisão antes da migration:

1. Preço do catálogo e preço contratado são campos distintos. Alterar catálogo
   não reescreve contrato nem cobrança emitida. Contrato sem valor não é R$ 0.
2. Histórico de vigências preserva descontos e trocas de plano. Definir como
   o `plan_id` operacional será atualizado junto com uma mudança contratual.
3. Cobranças e recebimentos possuem FKs compostas com tenant para impedir
   vínculos entre estabelecimentos. Não duplicar a mesma competência.
4. Pagamento parcial é a soma de recebimentos válidos; "pago" só após cobrir o
   devido. Atraso depende de vencimento e saldo. Isenção é decisão explícita.
5. Corrigir recebimento por estorno auditado, sem apagá-lo. Lock de cobrança e
   chave única impedem gravação duplicada. Todos os valores são inteiros.
6. "Recebido no mês" soma recebimentos, "a receber" soma saldos. Projeção de
   contratos ativos fica rotulada separadamente; nada disso usa status do tenant.
7. Restringir inicialmente a MASTER_OWNER. As permissões existentes de plano
   não devem conceder edição financeira sem uma decisão explícita.
8. Nenhum bloqueio por atraso automático. Avisar o responsável é uma etapa
   separada da mudança de acesso. Não criar dado financeiro para contas atuais.

O desenho detalhado, nomes/colunas/constraints, política de competência,
vencimentos nos dias 29–31 e comportamento de estorno devem ser aprovados antes
da migration. Esta proposta não autoriza escrita no piloto ou produção.

## Verificação reproduzível

- `npm test`, `npm run lint`, `npm run lint:types`, `npx tsc --noEmit` na raiz.
- `npm test`, `npm run test:e2e`, `npm run lint`, `npm run build` em backend.
- PostgreSQL descartável com TLS e as seis migrations existentes:
  `npm run test:db-e2e -- test/platform-postgres.db-e2e-spec.ts` no backend.
- Frontend/backend compilados e `IGNORE_DOTENV_FILE=true`, `CI=true`:
  `npm run test:browser:administracao`. Um cadastro; a fixture promove só esse
  usuário e só aceita conexão a banco local. Capturas em 1280, 390 e 360 px.
- O workflow inclui a suíte e preserva traces separados; unit/HTTP/banco
  existentes continuam nos mesmos comandos. Nunca usar Neon nesses testes.

## Estado desta entrega — 22/10/2026

Implementação preparada em uma cópia isolada a partir de `20e3fdc`. O clone
Windows do usuário, seus stashes, servidores e bancos não foram acessados.

Executado nesta cópia:

- Frontend: 801 testes unitários; typecheck; lint e lint de tipos; build Next.js.
- Backend: 1.376 testes unitários; 120 testes HTTP e2e; lint; build NestJS.
- Navegador com API **simulada**: lista, paginação, ficha, vazio, falha de rede,
  recuperação e acesso recusado. Capturas inspecionadas em desktop e celular;
  larguras de 1280, 390 e 360 px sem rolagem horizontal. Chromium 153.0.8010.0.
- Permanecem dois avisos de lint anteriores ao lote: tamanho em
  `appointments-api.test.ts` e `require-await` em `http-client.test.ts`.

Pendente: execução dos cinco casos novos de PostgreSQL e do spec
`administracao-flow.spec.ts` com API/banco reais, além do CI no SHA final.
Não havia PostgreSQL utilizável nesta cópia. A conferência visual com API
simulada não comprova o SQL nem o fluxo completo.

Não houve push, PR, merge, deploy, migration ou promoção de conta real.
O commit será entregue em bundle Git para importação no clone Windows.

## Validação no clone Windows — 22/10/2026

Bundle importado com o SHA original. Node 24.16, `npm ci` na raiz e no
backend. PostgreSQL 18.6 descartável, criado só para esta validação em
diretório temporário, na porta 55433, com TLS (verificação completa do
certificado autoassinado) e as seis migrations aplicadas por
`migration:run:compiled`. `IGNORE_DOTENV_FILE=true` em todos os processos;
nenhum `.env` real, `agenda_dev`, Neon, piloto ou produção foi usado.

- Backend `test:db-e2e`: 145 testes em 10 arquivos, sem skip, incluindo os
  cinco casos de `platform-postgres.db-e2e-spec.ts`.
- `test:browser:administracao` com API e banco reais: falhou na primeira
  execução porque o `__next-route-announcer__` do Next.js também tem
  role="alert". Os estados do portão passaram a ficar num `<main>` e a spec
  restringe alert/status a ele. Depois disso passou, com capturas de
  lista e ficha em 1280, 390 e 360 px, sem rolagem horizontal. O rótulo
  "Total de estabelecimentos" excedia o cartão em 360 px e virou
  "Total cadastrado".
- Também passaram: unit frontend (801), unit backend (1.376), HTTP e2e
  (120), lint, lint de tipos, typecheck, builds, e as suítes de navegador
  `auth` (8), `services` (5) e `visao-geral` (1).
- `test:browser:proxy`: 4 de 5 passam. O caso de cadastro/login pela mesma
  origem para em "Conectando ao servidor…" neste Windows, e falha do mesmo
  jeito no commit base `20e3fdc`. É anterior a este lote; o CI Linux decide.

## Segundo lote: administração dentro do menu principal

Base: integration em `35f4713`. Sem mudança no backend, sem migration e sem
variável nova.

### O que mudou

- A administração passou a morar em `/conta/administracao/**`, dentro do
  mesmo layout da área real: menu, cabeçalho, aparência (claro, escuro ou
  aparelho) e menu da conta são os de sempre. O menu próprio da
  administração deixou de existir.
- `GET /platform/access` é lido uma vez pelo layout de `/conta`
  (`AcessoPlataformaProvider`). Com `canViewEstablishments: true`, o menu
  ganha "Administração" num grupo "Plataforma", depois de "Minha conta".
  No celular o item fica no "Mais": a barra continua com quatro áreas.
  Carregando, falha ou resposta inválida nunca mostram o item.
- Administrador sem vínculo com estabelecimento: o menu mostra só
  "Administração" e "Minha conta" (no celular, as duas na barra, sem "Mais").
  A Visão geral e Minha conta oferecem o atalho para a administração.
- Nas páginas da administração, o cabeçalho mostra "Administração da
  plataforma" e uma faixa diz qual é o estabelecimento ativo, que não muda.
  A ficha de outra empresa usa só a leitura de plataforma: não troca o
  contexto da sessão, não cria Membership e não abre sessão de suporte.
- Endereços antigos: `/administracao` e `/conta/administracao` levam à lista;
  `/administracao/<caminho>` leva a `/conta/administracao/<caminho>`, com a
  busca preservada (307, `next.config.ts`). `/login?next=/administracao`
  continua funcionando.
- O acesso continua decidido no servidor a cada leitura. O item do menu só
  apresenta; um papel revogado vira 403 na próxima leitura, e o item sai na
  próxima carga da área.

### Funções reais disponíveis

| Função | Estado |
| --- | --- |
| Lista de estabelecimentos com busca, filtro de situação e plano, paginação | Real (`GET /platform/establishments`) |
| Indicadores globais: total, ativos, em teste, acesso restrito | Real (mesma resposta, independentes do filtro) |
| Ficha: dados, responsáveis, plano e preço de catálogo, uso, unidades | Real (`GET /platform/establishments/:id`) |
| Editar empresa, responsáveis, plano, configurações, financeiro | Não existe: nenhum botão é exibido |

### O que falta para as próximas funções

Levantado no código em `35f4713`. Nada disto foi implementado neste lote.

1. **Editar dados da empresa.** Não há rota de escrita em `platform/`. O nome
   exibido vem de `units.name` da unidade principal; o slug é único (`citext`)
   e já usado no agendamento público. Falta: `PATCH` com zod, decisão de quem
   edita (só `MASTER_OWNER` ou também `ESTABLISHMENTS_MANAGE`), tratamento de
   slug duplicado e de links públicos antigos, e gravação em `audit_logs`
   (a tabela existe; hoje só o cadastro escreve nela).
2. **Mudar a situação do acesso** (ativo, suspenso, cancelado). `tenants.status`
   já decide se o vínculo vale na sessão (`isTenantUsableForSession`). Falta
   a rota, a política de efeitos (sessões abertas, agendamento público,
   notificações) e a auditoria. Hoje a ficha só mostra a situação.
3. **Responsáveis.** Usuários são globais (uma conta pode ter vários
   estabelecimentos) e o e-mail é a credencial de login. Falta convite ou
   transferência de responsável com criação/remoção de Membership auditada.
   A tabela `invites` existe, mas não tem rota.
4. **Mudar o plano.** `tenants.plan_id` e o catálogo `plans` existem. Falta a
   rota com a permissão `PLANS_MANAGE` decidida, conferência de limites
   (`max_professionals`, `max_units`) contra o uso atual, histórico de troca
   e auditoria. Trocar só o `plan_id` hoje apagaria o histórico.
5. **Configurações por estabelecimento.** `plan_features` e
   `tenant_feature_overrides` existem no schema, mas nenhum código de runtime
   lê ou grava essas tabelas. Antes da tela, falta definir quais recursos
   elas controlam de fato.
6. **Valores contratados e pagamentos.** Não há tabela. Depende da proposta
   financeira acima (contrato, cobrança por competência, recebimento),
   da migration aprovada e das rotas. Até lá, a tela só mostra preço de
   catálogo, rotulado como tal, e não calcula faturamento.
7. **Administradores da plataforma.** `ADMINISTRATORS_MANAGE` existe no enum,
   sem rota. A promoção continua manual, por script operacional.

Cada item acima precisa de backend, testes de banco e revisão próprios.
Nenhum deles deve aparecer como botão antes de funcionar.

### Verificação

- PostgreSQL 18.6 descartável, criado só para esta validação, na porta
  55433, com TLS e verificação completa do certificado autoassinado;
  as migrations aplicadas por `migration:run:compiled`.
  `IGNORE_DOTENV_FILE=true` em todos os processos; nenhum `.env` real,
  `agenda_dev`, Neon, piloto ou produção.
- `test:browser:administracao`, agora com dois casos:
  - usuário comum sem item no menu e recusado por URL direta (nova e antiga);
    `MASTER_OWNER` com o item no menu, lista, filtros, paginação, ficha de
    outra empresa sem trocar o estabelecimento ativo nem criar vínculo
    (conferido em `memberships` e em `/auth/me`), ida para a Agenda, ficha
    pelo endereço antigo, "Mais" no celular, falha de rede, revogação e
    nenhuma escrita na API;
  - `MASTER_ADMIN` com `ESTABLISHMENTS_MANAGE` sem estabelecimento usando
    a administração; `MASTER_SUPPORT` só com `SUPPORT_ACCESS` sem item e
    recusado.
  - Capturas de lista, ficha e administrador sem estabelecimento em claro
    e escuro, 1280, 390 e 360 px, sem rolagem horizontal.
- Correção junto: `selecionarTenantAtivo` decidia a troca de dentro do
  updater do `setEstado`. Com outra atualização pendente, o React adia o
  updater e a função devolvia `false`: a escolha valia, mas a tela de
  seleção não navegava. O novo provider de acesso tornou isso visível em
  `clients-flow` (a mesma suíte passa na base `35f4713`). A decisão agora
  vem do estado já renderizado.
- Executado no clone Windows (Node 24, Chromium do Playwright):
  frontend `npm test` (73 arquivos, 836 testes), `lint` e `lint:types`
  sem erros (avisos antigos de `appointments-api.test.ts` e
  `http-client.test.ts`), `tsc --noEmit`, build Next.js; build NestJS e
  migrations no banco descartável. Suítes de navegador com API e banco
  reais: `administracao` (2), `auth` (8), `services` (5), `clients` (3),
  `avisos-solicitacoes` (1), `aparencia` (2), `push` (1), `recuperacao` (12),
  `visao-geral` (1), `agenda-view` (1), `agenda-profissional` (1),
  `professionals` (3), `appointments` (4), `agendamento-publico` (1).
  O backend não mudou; as suítes de backend ficam com o CI.

### Publicação

Só o serviço web (`agenda-cloud-piloto-web`) muda. A API não muda, não há
migration nem variável nova. Nenhuma publicação foi feita neste lote.
