# Recuperação de senha ("Esqueci minha senha")

A pessoa recupera o acesso sozinha, pelo login da equipe (`/login`) ou pela entrada do portal (`/portal`). Ela informa o e-mail ou o login. Só uma conta com e-mail **confirmado** recebe um link de 1 hora, sempre em `users.email`. O link abre "Nova senha" e "Confirmar senha". Depois de salvar, a pessoa volta ao login.

A recuperação assistida continua igual:

- a administração manda um link pelo portal;
- o dono define uma senha temporária para o login de equipe sem e-mail.

## Decisões

| Tema | Decisão |
|---|---|
| Validade | 1 hora no autoatendimento (`SELF_SERVICE_LINK_TTL_MS`). O link da administração continua valendo 24 horas. |
| Quem recebe | Conta ativa, com senha e com `email_verified = true`. E-mail preenchido sem confirmação não basta. Um login que só parece e-mail (`maria@salao`) nunca recebe nada. |
| Contas sem e-mail confirmado | Continuam na recuperação assistida. A tela orienta, para todo mundo, a procurar o responsável pelo estabelecimento. |
| Origem | Coluna `password_resets.origin`. `ADMIN` exige `requested_by_user_id`. `SELF_SERVICE` não tem autor: o pedido é anônimo e a conta encontrada é só o alvo. |
| Link pendente | Um pedido público nunca revoga um link pendente ainda válido, nem o da administração. Ele é preservado e nada novo sai. A administração ainda pode reemitir, o que revoga o pendente. |
| Resposta pública | 202 sem corpo, igual para qualquer identificador bem formado. A rota só grava o pedido: não procura a conta nem espera o provedor. O 429 é por IP (5 a cada 15 minutos) e não depende da conta. |
| Limite por conta | 3 links de autoatendimento por hora. Acima disso o pedido é registrado e nada sai; a resposta não muda. |
| Envio | Feito pela fila persistente no PostgreSQL. Nenhum serviço novo. O token é emitido no envio e só o hash é guardado; o texto do token nunca vai para o banco. |
| 2FA e sessões | A conclusão encerra todas as sessões e revoga qualquer outro link pendente. O segundo fator não é tocado. |

## Como funciona

1. `POST /password-resets/request` grava `{identifier}` em `password_reset_requests` e devolve 202.
2. O executor (`PasswordResetRequests`) roda nestes momentos:
   - logo depois de cada pedido;
   - na subida da API;
   - a cada minuto, enquanto a API está acordada.
3. Para cada pedido, uma transação com `SKIP LOCKED`:
   - procura a conta por e-mail OU login e trava a linha dela (`FOR UPDATE`);
   - decide com `decidirPedido`;
   - se for emitir, cria o link com `delivery_due_at = agora`;
   - apaga o identificador do pedido e grava o desfecho: `ISSUED`, `NO_MATCH`, `NOT_ELIGIBLE`, `ACTIVE_LINK_KEPT` ou `ACCOUNT_LIMIT`.
4. Para cada envio devido:
   - numa transação curta, confere a conta de novo, emite um token novo, grava o hash e uma concessão de 2 minutos;
   - depois do commit, envia.
5. Se o provedor recusa, o envio volta para a fila: nova tentativa depois de 1 minuto e depois de 5, no máximo 3 tentativas, nunca depois de o link vencer. Se as 3 falharem, o link é revogado para não segurar a vaga de pendente.
6. Se o processo morrer entre a reserva e o envio, outro processo assume quando a concessão de 2 minutos vencer. Entrega exatamente uma vez não é prometida: no pior caso chegam dois e-mails e só o último link vale.
7. Pedidos já resolvidos, sem o identificador, são apagados depois de 30 dias.

## Publicação

- **Migration 26 (`SelfServicePasswordReset`)**
  - Só acrescenta, e as linhas existentes viram `ADMIN`.
  - A API anterior continua gravando, porque o DEFAULT supre a origem.
  - Ordem: migration (pelo runbook) → API → web, as duas no mesmo SHA.
  - A ficha do usuário no web anterior lê `latestPasswordReset.requestedBy.name` sem checar `null`. Por isso esse campo continua só com links da administração, e o autoatendimento vai em `latestSelfServicePasswordReset`: a API nova funciona com navegadores que ainda tenham o web anterior aberto.
- **E-mail real**
  - Com `EMAIL_PROVIDER=none` (o padrão), a recuperação **não entrega**: o link fica registrado como "envio não configurado".
  - Antes de publicar, confira no Render: `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM` e `FRONTEND_URL`.
  - Depois, faça um teste com uma conta real de e-mail confirmado.
- **Dependência**
  - Este PR está empilhado sobre o #143 (`feat/login-limpo-celular`, `4b5912d`).
  - Mescle o #143 antes, ou mude a base deste PR para a integração depois dele.

## Testes

- **Backend, unitários**
  - `password-reset-requests.spec.ts`: decisão, nova tentativa e DTO.
  - `account-emails.spec.ts`: e-mail de "Esqueci minha senha".
  - Spec da migration.
- **HTTP**
  - `test/accounts.e2e-spec.ts`: 202 igual, 400 com forma inválida ou destinatário extra, 429 por IP.
- **PostgreSQL**
  - `test/password-recovery-postgres.db-e2e-spec.ts`. Cobre:
    - quem recebe;
    - link da administração preservado e reemissão;
    - pedidos simultâneos em três executores;
    - conclusões simultâneas (uma vence, a outra recebe 410);
    - limite por conta;
    - recusa do provedor e reinício;
    - concessão vencida;
    - conta bloqueada depois do pedido;
    - link vencido;
    - API anterior no schema novo;
    - retenção.
- **Web**
  - `src/lib/auth/recuperacao-senha.test.ts` e `src/lib/api/recuperacao-senha-api.test.ts`.
  - Guardas `sem-dados-demo*` e `cadastro-sem-persistencia` com `esqueci-senha`.
  - `noindex` e slug reservado.
- **Navegador**
  - `npm run test:browser:recuperacao-senha`: login → pedido → e-mail na caixa local → nova senha → sessão antiga encerrada → login; portal; capturas nos quatro temas.
  - O teste "Azul e branco" de `test:browser:aparencia` passa por `/esqueci-senha`.

## Estado e retomada

**Feito (24/11/2026, PC do trabalho)**

- Branch `feat/recuperacao-senha`, worktree `C:\wt\recuperacao`, empilhada sobre o #143.
- Backend, web e testes acima. Rodaram localmente contra o PostgreSQL descartável com TLS (porta 55441, no scratchpad da sessão):
  - unitários e HTTP do backend;
  - db-e2e de recuperação, contas, portal, schema, migrations de clientes e kits do piloto;
  - web unitários, typecheck e lint;
  - navegador: recuperação, entrada do portal e aparência.
- No navegador, a única falha local foi o menu de push do teste de aparência, que depende das chaves VAPID que só o CI define.
- Capturas em `C:\Users\User\AgendaCloud-operacoes\capturas-recuperacao-senha-2026-11-24`. Ficam só neste computador.

**Integração e compatibilidade (24/11/2026)**

- #143 mesclado na integração como `8093875`. Este PR passou a ter a integração como base.
- Incompatibilidade encontrada antes do merge: com a API nova, o web publicado (`63f1cd6`, igual ao #143 no portal) não abria a ficha de um usuário cujo último link veio de "Esqueci minha senha". O web lê `latestPasswordReset.requestedBy.name` sem conferir, e o link de autoatendimento não tem autor. Reproduzido no banco descartável com o web do #143.
- Correção: `latestPasswordReset` só traz links da administração (contrato anterior). O autoatendimento vai em `latestSelfServicePasswordReset`, que o web anterior ignora, e o web novo mostra o mais recente dos dois. Coberto pelo db-e2e da recuperação (reprova sem a correção) e por `src/lib/administracao/contas.test.ts`.
- Ensaio de retorno com envios pendentes (API nova, depois `63f1cd6`, depois a nova): resultado e limites na seção P3 do runbook.
- Runbook: `docs/runbooks/publicacao-recuperacao-senha.md`, com as combinações testadas e a configuração de e-mail conferida no Render (só leitura).

**Merge:** #144 mesclado na integração como `59df5ba` (SHA_R do runbook), com CI verde em `5cb43b6`.

**Publicação no piloto (24/11/2026, PC do trabalho, UTC), autorizada pelo responsável**

- **Antes de começar:** às 16:59 houve deploys manuais de `59df5ba` na API e no web, fora deste roteiro e de autoria não confirmada.
  - A API recusou subir, porque o banco não tinha a migration 26 (`SchemaReadiness`), e o Render manteve a API `63f1cd6`.
  - O web `59df5ba` ficou no ar com a API `63f1cd6` de 17:02:48 a 17:08:16. A pedido do responsável, voltou para `63f1cd6` (`dep-dc2s7t97lnhs73fbdfi0`). Nesse intervalo o login funcionava e só "Esqueci minha senha" falhava.
- **Configuração de e-mail:** conferida só em leitura e mantida como está, por decisão do responsável:
  - `brevo`, com a chave presente;
  - o remetente atual, o mesmo da confirmação de e-mail, com o nome "Agenda-Cloud";
  - `FRONTEND_URL` no endereço público.
- **Backup:** `%USERPROFILE%\AgendaCloud-operacoes\pre-mig26-25-backup-2026-11-24T17-34-18Z` (PG 17.12, 25 migrations, 62 tabelas).
  - Restaurado num PostgreSQL 17 descartável com TLS, com contagem e md5 iguais em todas as tabelas (`restauracao-conferida.json` na mesma pasta).
- **Passo 5, só agregados:** 1 link `USED` e 0 pendentes válidos.
- **Ensaio na cópia restaurada:** todas as etapas OK, com a caixa de e-mail local no lugar do provedor e contas de ensaio `@example.test`.
  - migration 26 aplicada com a API atual no ar;
  - janelas 1, 2 e 3, pela API e pela tela;
  - na janela 2, as 15 fichas do portal (7 reais e 8 de ensaio) no contrato do web anterior;
  - o roteiro curto completo pela tela;
  - o retorno da seção P3, com os casos X, Y, Z, a reemissão pela administração e W (nova tentativa que sai na volta).
- **Piloto:**
  1. Migration 26 aplicada com o kit de `59df5ba` (`aplicarSomenteAPendente`, 25 antes, nenhuma posterior).
     - P2 depois: 26 migrations, `ADMIN/USED=1` (totais iguais ao passo 5), 0 envios agendados, 0 pedidos e as 4 constraints.
     - Janela 1: `/health` e `/login` 200, sem erro no log.
  2. API `59df5ba`: deploy `dep-dc2so3lg1s2s739pvi4g`, live às 17:41:43.
     - `POST /password-resets/request` com corpo inválido respondeu 400.
     - Com um endereço `@example.test` inexistente, respondeu 202 com `Cache-Control: private, no-store`. O pedido foi processado como `NO_MATCH`, sem e-mail.
  3. Web `59df5ba`: deploy `dep-dc2sou8m7kps73er32e0`, live às 17:44:49.
     - Login, portal, "Recuperar senha" (ida e volta pelo login e pelo portal) e `/redefinir-senha` sem link ("Link indisponível") conferidos pela tela, sem sessão.
     - O proxy `/agenda_api/health` respondeu 200.
- **Estado final:** API e web em `59df5ba`, banco com 26 migrations, fila vazia e 0 erros nos logs depois dos deploys. Auto-Deploy `off` nos dois serviços.

**Limites do retorno** (seção P3 do runbook, ensaiada de novo na cópia de 24/11):

- O banco fica em 26, e nunca se roda o `down` no piloto. A API `63f1cd6` roda no schema 26, e a API `15e2790` continua sendo o piso.
- Voltar a API para `63f1cd6` não quebra telas nem dados, mas:
  - para "Esqueci minha senha";
  - deixa os pedidos e as novas tentativas parados até a `59df5ba` voltar, e então os e-mails saem atrasados.
- Antes de voltar, rodar as consultas de fila da seção P2 e registrar os números.
- O web volta junto com a API.

**Teste real de e-mail (24/11, confirmado pelo responsável)**

- Pedido feito com a própria conta. A Brevo registrou o envio às 18:11:08 UTC e `delivered` às 18:11:10 UTC.
- O e-mail chegou na pasta de **spam** do Gmail. O remetente aparece reescrito pela Brevo para um endereço `brevosend.com`, porque o remetente configurado é um endereço gratuito.
- Com o link, o responsável redefiniu a senha e entrou com a senha nova.

**Não feito**

- Teste com teclado real no celular, ainda não confirmado pelo responsável.
- Remetente de domínio próprio autenticado (seção E do runbook), para o e-mail não cair no spam. Decisão futura do responsável.

**Próximo passo**

1. O responsável faz o teste no celular e informa o resultado.
2. Até haver domínio próprio, orientar quem pedir recuperação a procurar o e-mail no spam.

**Só neste computador:** o backup acima, que deve ser guardado.
