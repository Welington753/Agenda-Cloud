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

## PR 2 — acesso de funcionário por usuário e senha

### Regras

- O dono cria, em Configurações → Equipe e acessos, o acesso de um
  profissional existente: nome, nome de usuário, permissões permitidas.
  Sem e-mail, sem convite, sem código.
- **Nome de usuário**: minúsculo, 3 a 40 caracteres (`a-z`, `0-9`, `.`, `-`,
  `_`, começando por letra ou número), **único na plataforma inteira** (índice
  `uq_users_username`). Nunca tem `@`: o login decide pela presença do `@`
  se o identificador é e-mail ou usuário, sem ambiguidade entre
  estabelecimentos.
- **Senha temporária**: gerada no servidor (12 caracteres sorteados de um
  alfabeto sem 0/O/1/l/I), gravada só como hash Argon2id, devolvida uma vez
  na resposta da criação. Não vai para log, histórico nem consulta
  posterior. Repetir o mesmo formulário (mesma chave) devolve o acesso já
  criado, sem senha.
- **Troca obrigatória**: `users.must_change_password`. Enquanto estiver
  ligada, o `SessionGuard` só deixa passar `GET /auth/me` e
  `POST /auth/password`; o resto responde 403 `TROCA_DE_SENHA_OBRIGATORIA`,
  relido a cada requisição. A tela leva a pessoa para Perfil e segurança.
- **Criação atômica**: conta, credencial, vínculo `PROFISSIONAL`,
  permissões, a chave do formulário e o histórico na mesma transação, com o
  estabelecimento travado (`FOR NO KEY UPDATE`, a mesma fila das vagas).
  Vaga, profissional livre, convite pendente, permissão indevida, usuário em
  uso e reautenticação recusam sem deixar conta para trás.
- **Nova senha temporária** (dono): só para a conta sem e-mail, sem papel na
  plataforma e com um único vínculo (o deste estabelecimento). Encerra todas
  as sessões da pessoa e liga a troca obrigatória. Contas com e-mail, com
  outros vínculos ou com papel administrativo continuam com a redefinição por
  link da administração, que agora recusa conta sem e-mail
  (`CONTA_SEM_EMAIL`).
- **Troca da própria senha** (`POST /auth/password`, qualquer conta): confere
  a atual, grava a nova, encerra as outras sessões, desliga a troca
  obrigatória e registra `PASSWORD_CHANGED`. Limite de 5 tentativas a cada
  15 minutos por IP.
- Contas e convites antigos não mudam. O login antigo (`{ email }`) continua
  aceito; o web novo manda `{ email }` quando há `@` e `{ login }` só para
  nome de usuário.

### Migration `StaffLogin1792972800000`

- `audit_action` + `STAFF_ACCESS_CREATED`, `STAFF_PASSWORD_RESET`,
  `PASSWORD_CHANGED`;
- `users.email` deixa de ser obrigatório (o índice único continua);
- `users.username citext` (único, formato conferido no banco) e
  `users.must_change_password boolean NOT NULL DEFAULT false`;
- `ck_users_login_identifier`: e-mail ou usuário, pelo menos um;
- tabela `staff_account_requests` (chave do formulário por quem criou).

Nenhuma linha existente é reescrita.

### Compatibilidade e ordem de publicação

1. Backup e conferência, como nas migrations anteriores (o procedimento
   protegido de aplicação precisa ser preparado para esta migration antes de
   rodar no piloto: ver `docs/runbooks/migrations-production.md` e o modelo
   de `publicacao-equipe-piloto.md`).
2. Aplicar `StaffLogin`. A API em produção (anterior) continua funcionando:
   ela não lê as colunas novas, e nenhuma conta sem e-mail existe ainda.
3. Publicar a API nova.
4. Publicar o web novo.

**Reversão.** Antes de existir conta sem e-mail, a API pode voltar à versão
anterior e o `down` desfaz a migration. Depois, voltar a API anterior deixa
essas contas sem como entrar e telas da administração recebem o nome de
usuário no lugar do e-mail; o `down` recusa voltar `email` a obrigatório
enquanto houver conta sem e-mail (nada é apagado nem inventado).

## PR 3 — recebimentos manuais e indicadores financeiros

### Fonte

Antes deste PR não havia fonte confiável de pagamentos: só
`appointment_items.price_cents_snapshot` (preço da reserva) e as tabelas de
comissão sem uso. Preço de reserva não é dinheiro recebido; por isso o
dinheiro do Início vem só de `appointment_payments`.

### Regras

- **Quitação integral**, registrada pelo dono em Recebimentos (aberta pelo
  Início): valor efetivamente pago (centavos inteiros, sem ponto flutuante),
  forma (Pix, dinheiro, débito, crédito, transferência, outra), data do
  recebimento (data local do estabelecimento, nunca no futuro) e quem
  registrou. O preço da reserva só aparece como sugestão.
- Só atendimentos confirmados, em andamento, concluídos ou com falta; nunca
  aguardando confirmação ou cancelados.
- **Sem duplicidade**: índice único parcial
  `uq_appointment_payments_active` (um recebimento não estornado por
  atendimento) e atendimento travado na transação; a chave do formulário é
  única por quem registrou, então repetir o envio devolve o mesmo registro.
- **Estorno integral**, com motivo e senha do dono confirmada há pouco. A
  linha original continua (valor e data intactos), marcada com data,
  motivo e autor do estorno; o histórico registra as duas ações. Depois do
  estorno, o atendimento volta a aguardar quitação.
- Concluir ou cancelar um atendimento não registra nem estorna nada.
- Mudar o preço do serviço não altera recebimento registrado.
- Separado das mensalidades da plataforma. Sem cobrança automática, nota
  fiscal, integração bancária ou estoque. Sem pagamento parcial nesta
  versão (a tela diz isso).
- Só o dono (o funcionário não vê dinheiro: 403 na API, e a tela leva à
  agenda dele).

### Cálculos (servidor, `resumoFinanceiro`, iguais no Início e em Recebimentos)

- **Recebido no período**: soma dos recebimentos com data de recebimento no
  período, estornados ou não (o dinheiro entrou naquele dia).
- **Estornado no período**: soma dos estornos com data de estorno no
  período, mesmo de recebimento antigo (o dinheiro saiu naquele dia).
- **Líquido**: recebido − estornado.
- **Ticket médio**: soma dos recebimentos do período que NÃO foram
  estornados ÷ quantidade desses atendimentos. Um estorno só tira o
  recebimento da média do período dele; estornar algo antigo não mexe na
  média de outro período. Sem atendimento pago, o ticket é `null` ("—").

### Migration `AppointmentPayments1793059200000`

- `audit_action` + `PAYMENT_RECORDED`, `PAYMENT_REFUNDED`;
- tabela `appointment_payments` com FK composta (`tenant_id`,
  `appointment_id`), checagens de valor, forma e estorno tudo-ou-nada,
  índices de recebimento ativo, de chave do formulário e por data.

Só acrescenta. Ordem: depois de `StaffLogin`; backup e conferência; aplicar
a migration; publicar a API; publicar o web. A API anterior ignora a tabela
nova. Reverter: `down` apaga a tabela (e os registros feitos nela), então
só antes de registrar recebimentos reais ou com backup.
