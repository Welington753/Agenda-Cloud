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
  - A tela de administração antiga lê `requestedBy` sem checar `null`. Um link de autoatendimento visto por ela entre a publicação da API e a do web quebraria essa ficha. Por isso, publique o web logo depois da API.
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

**Não feito**

- Merge e publicação.
- Conferência da configuração real de e-mail no Render.
- Teste com teclado real no celular.

**Próximo passo**

1. Revisão visual e do texto.
2. Merge do #143.
3. Base deste PR na integração, com CI verde no head final.
4. Conferir a configuração de e-mail.
5. Publicar pelo runbook: migration 26, depois API, depois web.
