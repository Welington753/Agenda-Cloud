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
