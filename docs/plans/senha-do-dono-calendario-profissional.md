# Equipe: senha definida pelo dono e calendário individual do funcionário

Evolução de "Equipe e acessos" sobre `StaffLogin`, `TeamAccess` e
`TeamManagerAccess` (ver `equipe-gerente-login-interno.md`). Nenhuma
migration nova: o piloto já tem as 11 migrations, e este lote não repete
nenhuma delas. O histórico reaproveita a ação `STAFF_PASSWORD_RESET`, que já
existe no enum `audit_action`.

## Regras

**Criar acesso.** O formulário passa a pedir **Senha** e **Confirmar senha**,
com mostrar/ocultar. A política é a mesma das outras senhas da plataforma
(`passwordSchema`: de 10 a 128 caracteres), conferida na tela e no servidor.

- A senha escolhida pelo dono é **definitiva**: a conta nasce com
  `must_change_password = false`, e a pessoa entra direto na própria área.
- A senha nunca volta na resposta (`temporaryPassword: null`). Também não vai
  para o histórico, para a chave do formulário (`staff_account_requests`) nem
  para log. O histórico registra só `mustChangePassword: false`.
- O hash continua Argon2id, na tabela `credentials`.
- Repetir o mesmo formulário (mesma chave) devolve o acesso já criado, sem
  conta nova e sem mexer na senha gravada, mesmo que o corpo repetido traga
  outra senha.

**Compatibilidade na publicação.** A API sai antes do web. Durante essa janela,
o web anterior ainda manda o corpo sem `password`. Esse corpo continua gerando
a senha temporária de antes, com troca obrigatória. A tela nova sempre manda a
senha.

**Definir nova senha.** `PUT /tenants/:tenantId/team/members/:membershipId/password`,
com corpo `{ password }`, substitui na tela o botão "Gerar nova senha
temporária":

- exige a senha do dono confirmada há pouco na mesma sessão (reautenticação
  existente);
- numa transação só: hash novo, `must_change_password = false` **só desta
  conta**, todas as sessões dela encerradas e o histórico com autor e
  estabelecimento;
- a resposta traz só `membershipId` e `username`.

O alcance é o mesmo da senha temporária. Só vale para a conta criada pelo dono
com login interno: sem e-mail, sem papel na plataforma, com este único vínculo
e ativa.

- Conta com e-mail real, conta compartilhada com outro estabelecimento e conta
  com papel de plataforma: `SENHA_NAO_E_DO_ESTABELECIMENTO`.
- Vínculo de outro estabelecimento ou o próprio vínculo de dono: 404.
- Conta bloqueada: `CONTA_BLOQUEADA`.
- Funcionário e gerente não definem senha de ninguém (`EQUIPE_GERENCIAR` é só
  do dono).

A rota antiga `POST .../temporary-password` continua para o web anterior e
continua marcando a troca obrigatória.

**Contas antigas.** Quem ainda tem senha temporária pendente continua com a
troca obrigatória e com o guard (`TROCA_DE_SENHA_OBRIGATORIA`). Nada limpa
`must_change_password` em massa. A marca só sai quando a própria pessoa troca
a senha ou quando o dono define uma senha nova para aquela conta.

**Troca voluntária.** Fica no Perfil e segurança (`POST /auth/password`). Exige
a senha atual e encerra as outras sessões. Nada mudou.

**Editar perfil, vínculo e permissões.** Ficam os controles que já existem: o
editor de permissões (com as vagas, o isolamento e a regra de que o dono só
concede o que pode conceder). Trocar o perfil ou o profissional ligado
continua sendo remover e criar de novo.

## Calendário individual

A tela **Minha agenda → Calendário** já tinha Mês, Semana e Dia, montada sobre
os mesmos componentes da agenda do dono (`CalendarioAgenda`). Os dados vêm de
`GET /tenants/:id/my-agenda/range`, e o filtro é feito na API: o profissional
sai do vínculo da sessão, nunca da URL. O fuso é o do estabelecimento.

A reprodução com contas fictícias usou dois profissionais com reservas no mesmo
dia: quatro de um, duas do outro. Ela **não mostrou vazamento**. Cada um vê só
os próprios atendimentos em eventos, contagens, "+N mais", detalhe e lista do
dia. Nas chamadas diretas à API, a agenda do estabelecimento é recusada e um
`professionalId` vindo do navegador também. Por isso o código do calendário
não mudou. Este lote acrescenta a cobertura que faltava, no banco e no
navegador.

O dono continua com a agenda do estabelecimento. O gerente continua seguindo as
permissões concedidas. O link público em Minha agenda é o do estabelecimento
(`/agendar/<slug>`), sem filtrar nem pré-selecionar profissional.

## Validação

Tudo contra PostgreSQL 18 descartável com TLS (certificado autoassinado via
`NODE_EXTRA_CA_CERTS`), com as 11 migrations aplicadas e dados fictícios.

- `backend/test/senha-do-dono-postgres.db-e2e-spec.ts`: criação com senha
  escolhida, login sem troca, idempotência sem nova conta nem nova senha,
  política no servidor, redefinição invalidando senha e sessões, histórico
  sem senha nem hash, troca voluntária, contas temporárias preservadas,
  recusas de alcance, e calendário isolado em mês, semana, dia, lista do dia,
  ações e outro estabelecimento.
- `backend/test/team.e2e-spec.ts`: corpo estrito da rota nova, política de
  senha e senha nunca ecoada no erro 400.
- `tests/browser/acesso-por-usuario-flow.spec.ts`: Criar acesso com senha,
  confirmação e mostrar/ocultar; entrada sem troca; Definir nova senha
  encerrando a sessão e recusando a senha anterior; troca voluntária.
- `tests/browser/calendario-funcionario-flow.spec.ts` (nova suíte,
  `npm run test:browser:calendario-funcionario`): isolamento em Mês, Semana e
  Dia, no computador e no celular, e pelas chamadas diretas à API.
- `equipe-acessos-flow` e `gerente-acessos-flow` passam a criar o acesso com a
  senha do dono.

## Pendência

O logger de erro do TypeORM (`logging: ['error', 'warn']`) imprime os
parâmetros de uma query que falhou. Se a gravação em `credentials` falhasse, o
hash (nunca a senha em claro) iria para o log. Isso já valia para todas as
rotas de senha antes deste lote; tratar exige mexer no logger global.
