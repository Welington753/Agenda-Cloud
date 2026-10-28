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
a senha temporária de antes, com troca obrigatória. Só o campo realmente
AUSENTE tem esse efeito.

- Senha vazia, `null`, número, objeto ou fora da política é recusada com 400,
  sem ecoar o valor.
- A tela nova sempre manda a senha e exige senha e confirmação iguais.
- Enquanto a resposta é incerta (falha de rede), o formulário fica travado.
  "Conferir" repete exatamente o pedido enviado, com a mesma chave e a mesma
  senha.
- Se a repetição só recupera a criação anterior, a tela diz "Este acesso já
  tinha sido criado… a senha dele não mudou". Ela nunca afirma que uma senha
  foi salva.

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

**Editar perfil, vínculo e permissões.** O editor de permissões continua igual.
Os controles respeitam as vagas, o isolamento e a regra de que o dono só
concede o que pode conceder.

O perfil e o profissional ligado agora mudam no mesmo acesso, por
`PUT /tenants/:tenantId/team/members/:membershipId/access`, com o corpo
`{ expected, role, professionalId, granted }`. Na tela, o botão é **Editar
perfil e profissional**.

- **O que fica.** O mesmo vínculo (`memberships.id`), a mesma conta, o mesmo
  login, a mesma senha, as sessões e o histórico. Nada é removido e criado de
  novo.
- **Perfil e profissional.** O perfil Profissional exige profissional ligado.
  O Gerente pode ficar sem profissional.
- **Novo profissional.** Segue as regras da criação: é deste estabelecimento,
  está ativo, não tem outro acesso e não tem convite pendente. Os convites
  vencidos expiram antes da conferência. Um profissional de outro
  estabelecimento recebe 404.
- **Agendamentos.** Nenhum muda de profissional.
- **Vagas.** Não mudam, porque os dois perfis ocupam vaga igual e o estado do
  vínculo não muda.
- **Permissões.** A troca nunca concede nada sozinha. O corpo leva exatamente
  o conjunto que vale depois. A tela mostra o perfil, o profissional, as
  permissões resultantes, o que sai e o que entra. "Salvar alterações" só
  libera depois que o dono marca "Conferi o resultado e quero salvar".
  Qualquer mudança no formulário desmarca. O servidor recusa o que não se
  aplica ao novo perfil (`PERMISSAO_NAO_SE_APLICA`) e o que o dono não pode
  conceder. No gerente, salvar aqui é a confirmação das permissões. No
  profissional, `permissions_confirmed_at` volta a nulo. Os `DENIED` gravados
  ficam.
- **Tela desatualizada.** Se `expected` não bate com o vínculo,
  `ALTERADO_POR_OUTRA_TELA`.
- **Contas fora do alcance.** O perfil só muda na conta que é só deste
  estabelecimento, sem papel na plataforma e sem outro vínculo
  (`canChangeRole`). Para conta compartilhada ou de plataforma, a troca de
  perfil é recusada com `PERFIL_NAO_E_DO_ESTABELECIMENTO`. O profissional
  ligado e as permissões continuam editáveis, porque mexem só neste vínculo.
  Nada aqui toca senha, e-mail, login ou papel de plataforma.
- **Controles.** Reautenticação do dono, transação com o estabelecimento
  travado (a mesma fila da criação e do convite) e histórico
  `USER_PERMISSION_CHANGED` com o antes e o depois.
- **Quando vale.** Na próxima requisição, inclusive com sessão aberta: a
  autorização relê o vínculo do banco a cada requisição.

## Logs sem senha, hash nem token

Antes, dois caminhos podiam escrever esses valores no log:

- o logger padrão do TypeORM imprimia `-- PARAMETERS: [...]` numa query que
  falhava;
- o tratador de exceções do Nest imprimia o `QueryFailedError` inteiro, com
  `parameters` e `driverError.detail`.

Assim, uma falha ao gravar `credentials` ou `sessions` levaria o hash da senha
ou o hash do token para o log.

- `backend/src/database/safe-typeorm-logger.ts` passa a ser o logger do
  DataSource de runtime, o da aplicação, que grava as credenciais. Ele
  escreve:
  - o SQL;
  - o tipo e o tamanho de cada parâmetro;
  - `code`, `constraint`, `table` e `column`;
  - a mensagem, com cada valor de parâmetro e tudo o que parece hash Argon2,
    hex longo ou token base64url trocado por `[omitido]`.

  O `detail` nunca é escrito.
- `backend/src/common/database-error.filter.ts` (`APP_FILTER`) responde ao
  `QueryFailedError` com o mesmo 500 genérico do Nest. O log usa o mesmo
  resumo e a pilha sem a primeira linha.
- O DataSource de migrations continua com o logger padrão. O CLI liga
  `logging: ['schema']` em tempo de execução, e o `migration:show` imprime a
  lista por esse caminho, que o runbook de production lê. Um logger fixo
  esvaziava essa lista: o workflow "migration:show/run" falhou em `4214a65`
  até `4311b12`, e `91868ef` corrigiu. As migrations não gravam senha nem
  token.
- Não é uma reformulação de observabilidade: os outros logs não mudaram.

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

### Segunda rodada: edição, logs e compatibilidade

Commits `4214a65` (logs), `c5b7974` (edição na API) e `2404894` (edição na
tela).

- `backend/src/database/safe-typeorm-logger.spec.ts` (unitário): o erro de
  uma gravação de credencial com hash e token nos parâmetros, na mensagem e no
  `detail`. A saída efetiva (stdout e stderr capturados) tem SQL, tipos,
  `code` e `table`, e não tem senha, hash, token nem `Failing row`. O mesmo
  vale para o `DatabaseErrorFilter`, que responde 500 genérico.
- `senha-do-dono-postgres.db-e2e-spec.ts`, 3 casos novos (10 no total):
  - edição de profissional para gerente sem profissional e de volta para
    profissional com outro profissional:
    - mesmo vínculo, conta, senha e sessão aberta;
    - reservas sem mudar de profissional;
    - vagas iguais;
    - nada concedido sozinho;
    - histórico sem senha nem hash;
    - a sessão aberta já segue o perfil novo na próxima chamada (agenda do
      estabelecimento e própria agenda);
  - recusas:
    - profissional com acesso, com convite pendente, desativado ou de outro
      estabelecimento;
    - área de gerente em profissional;
    - tela desatualizada;
    - outro dono;
    - vínculo de dono;
    - funcionário;
    - sem reautenticação;
    - perfil de conta compartilhada ou de plataforma;
  - falha REAL de gravação: um gatilho de teste repete o valor na mensagem e
    no `detail`. Cobre `INSERT` em `credentials` (criar acesso), `UPDATE` em
    `credentials` (nova senha) e `INSERT` em `sessions` (login). A saída
    capturada do logger e do filtro não tem senha, `$argon2`, hex de 64
    caracteres nem `DETAIL`.
- `team.e2e-spec.ts`:
  - corpo estrito da edição;
  - senha `''`, `null`, `false` e `{}` recusada sem eco;
  - o corpo sem `password` chega ao serviço sem o campo.
- `src/lib/equipe/edicao-de-acesso.test.ts`: o resultado da edição (o que
  sai, o que entra, sem concessão automática) e o corpo enviado.
- `gerente-acessos-flow`: troca de perfil e profissional pela tela, com
  "Saem" visível, "Salvar alterações" bloqueado até a conferência, sessão
  aberta do gerente seguindo o perfil novo, mesmo vínculo e reservas no
  lugar.

Execuções locais desta rodada (PostgreSQL 18 descartável com TLS, porta
55434):

- backend: `npm test` com 1510 testes; `team.e2e-spec.ts` com 14 casos; lint;
  `tsc` do build; build;
- db-e2e: `senha-do-dono-postgres` (10), `team-access`, `team-manager` e
  `staff-login` (31);
- frontend: testes de `src/lib/equipe` (18); `tsc --noEmit`; `lint` e
  `lint:types` só com os avisos antigos; build;
- navegador: `test:browser:gerente`.

Não foram repetidas localmente nesta rodada as suítes de navegador `auth`,
`services`, `acesso-usuario`, `equipe` e `calendario-funcionario`, que não
tocam o que mudou além do cartão de acesso. O CI do PR roda todas.

## Estado e retomada

Checkpoint de 2026-10-28, no PR #78 (`feat/senha-dono-calendario-profissional`
para `integration/nestjs-typeorm-frontend`).

**Concluído e no remoto**

- `66572f0`: senha definida pelo dono e cobertura do calendário. CI verde:
  https://github.com/Welington753/Agenda-Cloud/actions/runs/40750165285
- `4214a65`: logs sem senha, hash ou token (logger do TypeORM e filtro HTTP).
- `c5b7974`: edição de perfil e profissional na API, com os testes de HTTP e
  de banco.
- `2404894`: tela "Editar perfil e profissional" e a suíte do gerente.
- `ae5a662`: este plano. CI disparado nesse head:
  - https://github.com/Welington753/Agenda-Cloud/actions/runs/40758061114
    (auth e serviços, navegador e API)
  - https://github.com/Welington753/Agenda-Cloud/actions/runs/40758061446
    (migrations, porque `backend/src/database/**` mudou)
- O commit que traz esta seção dispara de novo os dois workflows. O
  resultado fica nos checks do PR #78, para o head mais recente.

**Falta**

- Acompanhar os dois checks no head final do PR. Com os dois verdes: revisão
  final e merge normal na integration com `[skip render]`, sem bypass e sem
  force push.
- Se um check falhar: corrigir, rodar localmente só a suíte afetada, enviar,
  e acompanhar de novo.
- Fora do escopo, e não fazer: deploy, conexão com banco real, migration no
  piloto e envio de mensagens.

**Próximo passo concreto**

Abrir os checks do PR #78 no head mais recente da branch. Se estiverem verdes,
mesclar o PR pela interface ou pela API, com título contendo `[skip render]`.

**Só neste computador (nada disso vai para o Git)**

- O cluster PostgreSQL 18 descartável da sessão, com TLS e certificado
  autoassinado, na porta 55434, no diretório temporário da sessão do Claude
  Code. É desligado ao encerrar a sessão. Em outra máquina, crie outro
  cluster descartável, como descrito em CLAUDE.md.
- As capturas de tela das suítes locais, no mesmo diretório temporário. As do
  CI ficam nos artefatos de cada execução.
- `CLAUDE.md` modificado pelo dono do repositório: fica fora dos commits.
