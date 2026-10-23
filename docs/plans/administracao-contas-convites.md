# Administração de contas, convites e permissões

Base: integration em `9847c6a` (PR #63). Entrega dividida em PRs encadeados:

1. **Backend** (este registro, parte A): migration, envio de e-mail,
   convites, redefinição de senha, gestão de contas e vínculos, histórico.
   O cadastro público continua aberto neste PR, para o frontend e os testes
   de navegador seguirem funcionando até o PR seguinte.
2. **Frontend e fechamento do cadastro** (parte B): telas da administração,
   páginas públicas de convite e redefinição, `/cadastro` informativo,
   `POST /auth/register` removido e testes de navegador sem cadastro público.

## Conceitos

| Conceito | Onde está | Quem é |
| --- | --- | --- |
| Usuário | `users` (+ `credentials`, `sessions`) | quem entra no sistema |
| Estabelecimento | `tenants` (+ `units`) | a empresa atendida pela plataforma |
| Vínculo | `memberships` (+ `membership_permission_overrides`) | usuário × estabelecimento, com papel |
| Consumidor | `consumers` | cliente da agenda; nunca vira usuário de login |

Nada aqui lê ou escreve `consumers`. O agendamento público continua igual.

## Entrada de contas

O cadastro livre deixa de existir (parte B). A única forma de uma conta nova
passar a entrar é um **convite** criado pela administração:

- **Nova empresa com responsável**: estabelecimento (TRIAL, plano escolhido
  do catálogo), unidade principal e convite de DONO numa transação.
- **Novo vínculo** de DONO numa empresa existente.
- **Administração da plataforma** (só `MASTER_OWNER`): papel e permissões
  pretendidos, só para e-mail sem conta.

E-mail sem conta: cria a conta **pendente** (`INVITED`, sem senha, e-mail não
verificado). E-mail com conta (comparação com a mesma normalização do login,
`citext` no banco): nada da pessoa muda; o vínculo só nasce quando a própria
conta aceita, digitando a senha atual. Conta bloqueada não recebe convite.

Link: 32 bytes aleatórios, só o SHA-256 no banco, 24 horas, uso único, no
fragmento da URL (`/convite#t=…`, não vai para log de acesso). Abrir a página
não consome nada; o aceite é um `POST` explícito, com `FOR UPDATE` no convite
(dois envios simultâneos: um aceita, o outro recebe "já usado"). Reenviar
emite outro link e invalida o anterior; teto de 5 links por convite. Revogar
ou bloquear a conta impede o aceite.

No aceite de conta nova: senha definida pela pessoa (mesma política e
Argon2id do login), `email_verified = true` (o link prova o endereço), conta
`ACTIVE`, vínculo ou papel aplicado, convite `ACCEPTED`, histórico e sessão,
tudo numa transação.

**Contas existentes** continuam entrando como antes. Nenhuma foi marcada como
verificada nem bloqueada. `email_verified` só vira `true` com prova: aceite
de convite ou redefinição de senha pelo link enviado ao endereço.

## Papéis e permissões com efeito real

Plataforma (`platform-access.ts`, relida do banco a cada operação):

| Papel | Consultar | Empresas e contas sem papel de plataforma | Papéis da plataforma |
| --- | --- | --- | --- |
| `MASTER_OWNER` | sim | sim | sim |
| `MASTER_ADMIN` + `ESTABLISHMENTS_MANAGE` | sim | sim | não |
| `MASTER_SUPPORT` + `ESTABLISHMENTS_MANAGE` | sim | não | não |
| sem papel (inclusive DONO) | não | não | não |

`ADMINISTRATORS_MANAGE`, `PLANS_MANAGE` e `SUPPORT_ACCESS` existem no enum mas
não liberam rota nenhuma; a API recusa atribuí-las.

Regras de alvo: ninguém age sobre a própria conta pela administração (nem o
`MASTER_OWNER`); conta com papel de plataforma só é atingida por quem gerencia
a plataforma; um administrador delegado não convida a si mesmo nem toca em
papéis.

Estabelecimento: todas as rotas liberam só **DONO**, e um override só
**restringe** (`DENIED`). Por isso a administração convida só como DONO e
ajusta só as 12 permissões que alguma política consulta. O "acesso efetivo"
de cada vínculo é calculado pelas mesmas funções das rotas
(`tenant-effective-access.ts`); vínculo antigo com outro papel aparece sem
área liberada. Ampliar GERENTE/RECEPCIONISTA/PROFISSIONAL é outro lote.

## Mudanças sensíveis

Bloquear, reativar, papéis de plataforma, desvincular e restringir permissões
exigem a senha confirmada há menos de 10 minutos **na mesma sessão**
(`sessions.reauthenticated_at`). Edição de nome e telefone não exige.

- **Bloqueio**: `SUSPENDED`, todas as sessões revogadas na mesma transação.
  O push já só entrega a usuário `ACTIVE` com sessão viva e vínculo.
- **Desvínculo**: apaga só aquele vínculo (as restrições e inscrições de push
  dele caem em cascata); os demais continuam.
- **Último MASTER_OWNER**: mudanças que podem tirar um dono passam por
  `pg_advisory_xact_lock` e reconferem, já com o lock, que quem age continua
  `MASTER_OWNER` ativo. Duas mudanças cruzadas ficam em fila; a segunda é
  recusada.
- **Duas telas**: a tela manda o `updated_at` (ou as restrições) que leu;
  diferença dá 409 sem gravar.
- **Envio duplicado**: chave de formulário única por quem cria; repetir
  devolve o mesmo resultado. Resposta perdida: `GET
  /platform/requests/:chave` mostra o que foi criado antes de tentar de novo.
- **Histórico**: `audit_logs` na mesma transação, com ator autenticado,
  ação, alvo (`target_user_id`, novo), estabelecimento e dados antes/depois.
  Nunca senha, hash, token ou link.

E-mail de login não é editável nesta entrega (só nome e telefone): trocar
exigiria confirmar o novo endereço por link, fluxo ainda não implementado.

## E-mail

O plano gratuito do Render bloqueia saída para SMTP (25, 465, 587) desde
setembro de 2025 ([changelog](https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports)).
Por isso o envio é por API HTTPS, com dois adaptadores (`src/email/`):

| Provedor | Gratuito (outubro de 2026) | Remetente |
| --- | --- | --- |
| Brevo | 300 e-mails/dia | endereço verificado por código; com domínio gratuito (gmail etc.) o Brevo troca o domínio por `@brevosend.com`, e a entrega cai ([ajuda](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders)) |
| Resend | 100/dia, 3.000/mês | exige domínio próprio verificado; sem ele só entrega ao e-mail da conta Resend ([limites](https://resend.com/docs/knowledge-base/account-quotas-and-limits), [403](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)) |

Recomendação para o piloto: **Brevo** com um domínio próprio autenticado
(DKIM/DMARC). Sem domínio, o Brevo funciona para teste, com entrega incerta.
Nenhum dos dois promete gratuidade ilimitada; os limites podem mudar.

Envio depois do commit, com estado registrado (`PENDING`, `SENT` =
provedor aceitou, `FAILED` com código, `NOT_CONFIGURED`). "Enviado" nunca
significa "recebido". Sem provedor, a conta fica pendente e a tela mostra a
pendência; nenhum sucesso é simulado e nenhum link é mostrado à administração.

Configuração externa (depende de você; nada foi criado):

1. Criar a conta no provedor e verificar o remetente (e o domínio, se houver).
2. No painel do Render, serviço `agenda-cloud-piloto-api`: `EMAIL_PROVIDER`
   (`brevo` ou `resend`), `EMAIL_API_KEY`, `EMAIL_FROM` e, opcional,
   `EMAIL_FROM_NAME`. `EMAIL_API_BASE_URL` é só para teste e é recusado em
   production.
3. `FRONTEND_URL` da API precisa ser a origem pública do web: é a base dos
   links.

## Migration `1792800000000-AccountsAdministration`

Só acrescenta: valores em `audit_action`, `audit_logs.target_user_id`,
`sessions.reauthenticated_at`, colunas de envio/idempotência/alvo em
`invites` (tabela que nenhum código escrevia), um convite pendente por e-mail
e empresa, e a tabela `password_resets`. Sem entidade TypeORM para os
objetos novos (como o push): acesso por SQL explícito.

`down` remove tudo menos os valores de enum (o PostgreSQL não remove). A
reversão perde os convites e redefinições registrados depois da migration.

## Publicação e compatibilidade

Ordem: **backup → conferência antes → migration → conferência depois → API →
web**.

- Migration antes da API: a API atual não lê nem escreve as colunas novas
  (todas nulas ou com padrão), então funciona com o schema novo.
- API nova sem a migration falharia em convites, histórico e
  reautenticação: por isso a migration vem antes.
- Web novo chama rotas que só a API nova tem: web por último.
- Parte B (cadastro fechado): API antes do web. Enquanto o web antigo estiver
  no ar, "Criar conta" passa a falhar com 404, o que já é o comportamento
  desejado.

Roteiro detalhado: `docs/runbooks/publicacao-piloto-render.md`, parte F.

## Verificação da parte A

- Backend: unitários, HTTP e2e (`test/accounts.e2e-spec.ts`), lint e build.
- PostgreSQL 18.6 descartável com TLS verificado, `IGNORE_DOTENV_FILE=true`:
  `test/accounts-postgres.db-e2e-spec.ts` (15 casos: listagem com contas
  antigas e sem empresa, várias páginas e contadores; empresa + convite +
  ativação; conta existente sem duplicação nem troca de senha; convite
  inválido, expirado, revogado, reutilizado, reenviado e aceito em paralelo;
  falha e ausência de provedor; usuário comum, suporte e delegado barrados;
  própria autorização; dois donos se rebaixando ao mesmo tempo; único dono;
  bloqueio com sessão aberta; desvínculo parcial; conflito entre telas;
  rollback sem alteração parcial nem histórico; restrição com efeito;
  redefinição de senha; convite de plataforma) e a suíte de banco inteira.
  A caixa de e-mail é um servidor HTTP local; nada sai da máquina.
- Migration aplicada sobre um banco com dados, revertida e reaplicada.
- Conferência só-leitura do piloto (`before-`/`after-accounts-administration`)
  provada contra o banco descartável migrado.

## Fora do escopo

- Troca do e-mail de login (exige verificação do novo endereço).
- Papéis GERENTE, RECEPCIONISTA e PROFISSIONAL com acesso real.
- `ADMINISTRATORS_MANAGE`, `PLANS_MANAGE`, `SUPPORT_ACCESS` e sessão de suporte.
- Mudar plano ou situação de um estabelecimento, financeiro e cobrança.
- "Esqueci minha senha" iniciado pela própria pessoa.
- Reenvio automático de e-mail com falha (é manual, pela tela).
- Exclusão física de usuários e acesso como outra pessoa: não existem.
