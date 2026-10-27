# Operação diária: navegação, configurações, agenda, clientes, acesso por usuário e recebimentos

Base: integration em `c77c313` (TeamAccess aplicada no piloto: 8 migrations,
19/19 objetos). Nada aqui reaplica ou reverte migration anterior.

## Entregas (PRs encadeados)

1. **Operação e configurações** (`feat/operacao-configuracoes-agenda`), sem
   migration:
   - navegação do dono: Início, Agenda, Clientes, Configurações; a
     administração da plataforma fica num grupo próprio, só com o acesso
     confirmado pelo servidor;
   - Configurações em subpáginas (`/conta/configuracoes/**`): Estabelecimento,
     Serviços, Profissionais, Equipe e acessos, Notificações, Aparência,
     Perfil e segurança. Cada subpágina é a tela que já existia; nada é
     duplicado;
   - "Minha conta" deixa de existir: `/conta` leva ao início do perfil, e a
     identificação, a troca de senha (rota nova `POST /auth/password`) e o
     "Sair" ficam em Perfil e segurança;
   - Solicitações viram a aba da Agenda (`/conta/agendamentos/solicitacoes`),
     com o contador do `SolicitacoesProvider` (a única leitura periódica);
   - Início com indicadores calculados no servidor
     (`GET /tenants/:id/dashboard`);
   - Agenda com a opção Calendário (mês, semana, dia), lida por período
     (`GET /tenants/:id/appointments/range` e `.../my-agenda/range`);
   - Clientes com a primeira página carregada ao abrir
     (`GET /tenants/:id/consumers/page`, paginação por cursor).
2. **Acesso de funcionário por usuário e senha**
   (`feat/acesso-funcionario-usuario`), migration `StaffLogin`.
3. **Recebimentos manuais e indicadores financeiros**
   (`feat/recebimentos-manuais`), migration `AppointmentPayments`.

O PR 2 parte do 1 e o 3 parte do 2 (as migrations ficam em ordem).

## Endereços antigos

Encaminhados no `next.config.ts` (307, a busca da URL é preservada):

| Antigo | Novo |
| --- | --- |
| `/conta/solicitacoes` | `/conta/agendamentos/solicitacoes` |
| `/conta/servicos` | `/conta/configuracoes/servicos` |
| `/conta/profissionais/**` | `/conta/configuracoes/profissionais/**` |
| `/conta/equipe` | `/conta/configuracoes/equipe` |

`/conta` continua existindo, mas só leva ao início do perfil (dono: Início;
funcionário: Minha agenda; administrador sem estabelecimento:
Administração). As notificações já entregues apontam para
`/conta/solicitacoes?estabelecimento=…&solicitacao=…` e continuam abrindo a
solicitação certa pelo encaminhamento.

## Indicadores do Início (servidor)

Todos no fuso do estabelecimento, sobre o período inteiro (nunca sobre uma
página de lista), sempre com `tenant_id` no `WHERE`:

- **Clientes previstos hoje**: clientes distintos com atendimento hoje em
  `CONFIRMED`, `IN_PROGRESS` ou `COMPLETED`.
- **Clientes atendidos no período**: clientes distintos com atendimento
  `COMPLETED` que começou no período.
- **Atendimentos por situação**: quantidade de atendimentos (não de pessoas)
  que começam no período, por situação.
- **Solicitações aguardando resposta**: a mesma regra da aba Solicitações
  (`PENDING` que ainda não começou).
- **Próximos atendimentos**: `PENDING` e `CONFIRMED` que ainda vão começar.
- **Plano e uso**: profissionais ativos, vagas de funcionário (regra de
  `team/seats.ts`) e limite do plano.

Uma pessoa com três atendimentos conta 1 em "clientes" e 3 em
"atendimentos".

Os indicadores financeiros só entram com o PR 3, que cria a fonte real de
recebimentos. Preço de reserva nunca é apresentado como dinheiro recebido.
