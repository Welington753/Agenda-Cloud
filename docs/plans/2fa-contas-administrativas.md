# 2FA das contas administrativas (TOTP)

Verificação em duas etapas para quem administra o Agenda Cloud no portal da
plataforma (`/portal`): aplicativo autenticador (TOTP) com QR code e chave
manual, e códigos de recuperação de uso único. Usuários comuns (dono, gerente,
profissional) ficam fora deste lote.

Publicação e emergência: `docs/runbooks/publicacao-2fa-administrativo.md`.

## 1. Quem é administrador (mapeamento)

- Papel de plataforma: `users.platform_role`. **Só `MASTER_OWNER` ativo abre o
  portal** (`platform/platform-access.ts`). `MASTER_ADMIN` e `MASTER_SUPPORT`
  existem em contas antigas, mas não abrem nada.
- Dono, gerente e profissional (`memberships.role`) nunca concedem nada no
  portal. A mesma conta pode ser master e ter vínculos de estabelecimento.
- Sessão: token opaco no cookie `session_token` (HttpOnly, SameSite=Lax), 30
  dias fixos, **sem renovação**. Sessões nascem no login e no aceite de
  convite. A redefinição de senha encerra sessões e não cria nenhuma.
- Não existe troca de e-mail em nenhuma rota (nem pela administração).

## 2. Decisões

- **D1:** o segundo fator é exigido para o **portal**. O uso comum de `/conta`
  segue igual. Operações compartilhadas que mexem na segurança da identidade
  master exigem a mesma proteção em qualquer tela: troca de senha (`POST
  /auth/password`), fatores e recuperação. Não há troca de e-mail.
- **D2:** a verificação vale **12 horas na sessão específica**, sem renovar
  pelo uso e sem passar da validade da sessão. Mudanças de segurança pedem a
  senha confirmada há pouco (10 minutos) e, quando há fator, um código atual.
- **D3:** preferir dois administradores reais e autorizados, sem criar conta
  privilegiada só para chegar a dois. O sistema funciona com um único master,
  com códigos de recuperação guardados e a emergência ensaiada. A quantidade
  atual é conferida antes da publicação.
- **D4:** liberações do fluxo normal vão **só ao e-mail verificado** do
  titular. O link nunca aparece para quem emitiu. Sem envio de e-mail
  configurado, a API recusa (`LIBERACAO_SEM_EMAIL`) e nada é criado. A
  configuração e a entrega do e-mail são conferidas na publicação.
- **D5:** a recuperação do único master sem celular e sem códigos é só do
  operador autorizado, por script e roteiro, com auditoria. Nenhum acesso
  administrativo automático.

## 3. Estados da sessão (servidor)

Uma função pura (`backend/src/second-factor/second-factor-state.ts`) decide, a
cada requisição:

| Estado | Quando | Portal |
|---|---|---|
| `NOT_REQUIRED` | conta sem papel de plataforma | (o serviço recusa pelo papel) |
| `ENROLLMENT_OPTIONAL` | papel, sem fator, fase `optional`, conta não marcada | sim, como antes |
| `ENROLLMENT_REQUIRED` | papel, sem fator, fase `required` **ou** master novo (`second_factor_enrollment_required`) | não |
| `VERIFICATION_REQUIRED` | fator ativo e sessão sem verificação válida | não |
| `VERIFIED` | fator ativo e código aceito nesta sessão há menos de 12 h | sim |

E dois sinais:

- `enrollmentPermitted`: a sessão pode cadastrar sem outro código, porque
  aceitou um convite de plataforma ou usou uma liberação nos últimos 30 min;
- `recoveryPending`: há liberação pendente, ou já usada nesta sessão, com o
  fator antigo ainda ativo.

Regras que as condições pediram:

- conta **com fator ativo exige o código também na fase `optional`**;
- recuperação e troca **nunca** transformam a conta em "só senha": o fator
  antigo vale até um código do novo ser confirmado, e a liberação não remove
  nada;
- convites de plataforma e promoções marcam a conta como master novo, que
  precisa cadastrar antes de usar o portal, em qualquer fase;
- falha ao decifrar ou chave ausente responde `SEGUNDO_FATOR_INDISPONIVEL` e
  nunca libera nada. Códigos de recuperação continuam valendo, porque são hash
  e não dependem da chave.

## 4. Proteção no backend

- **Guard único:** `PlatformSecondFactorGuard` vai na **classe** de todo
  controller `@Controller('platform')`, depois do `SessionGuard`.
  - Exceções: só `GET /platform/access`, que informa o estado e devolve as
    capacidades falsas enquanto o portal não está liberado, e `POST
    /platform/reauth`, compartilhada com o dono.
  - Duas provas garantem isso: um teste de arquitetura e um e2e HTTP que lê
    as rotas da metadata do Nest e espera 403 com `code` em todas.
- **Rotas do próprio fator** (`/auth/second-factor/*`):
  - pedem só a sessão (são o caminho até o portal) e não concedem ação
    administrativa;
  - escritas passam por `TrustedOriginGuard` (origem e JSON) e por um limite
    por IP, contando só recusas;
  - respostas sem cache.
  - Rotas: `GET /` (estado); `POST verify`; `POST recovery`; `POST grant`
    (usa a liberação); `POST enrollment`; `POST enrollment/confirm`; `POST
    recovery-codes`.
- **Liberação por outro master:** `POST
  /platform/users/:userId/second-factor/grants`, atrás do guard do portal.
  - Ordem das checagens: senha recente, permissão `managePlatformAccess`,
    segundo fator confirmado há até 10 min, motivo, alvo de plataforma ativo
    com e-mail verificado, e-mail configurado.
  - Nunca vale para a própria conta. A `requestKey` torna a emissão
    idempotente.
- **Troca de senha:** conta de plataforma precisa do estado que libera o
  portal (`SEGUNDO_FATOR_NECESSARIO` / `SEGUNDO_FATOR_CADASTRO_NECESSARIO`).
- **Tentativas:**
  - Cinco falhas em 15 minutos travam **só as tentativas de segundo fator**
    por 15 minutos (`second_factor_attempts`, linha travada).
  - Durante a trava, a tentativa é recusada **sem contar**, então insistir não
    prolonga. A falha é gravada antes da resposta de erro.
  - O login e `/conta` não passam por essa trava.
- **Reutilização:** a biblioteca só diz se o código vale na janela de ±1
  período. A aplicação só aceita um código cujo contador seja **maior** que
  `last_used_counter`, com a linha do fator em `FOR UPDATE`.
  - Códigos de recuperação são consumidos por `UPDATE ... WHERE used_at IS NULL
    RETURNING`.
  - A confirmação do cadastro trava a linha pendente.
- **Quando algo é revogado:**

  | Evento | O que acontece |
  |---|---|
  | Ativar ou trocar o fator | encerra as outras sessões, troca os códigos de recuperação, revoga liberações pendentes e marca esta sessão como verificada |
  | Novos códigos | encerra as outras sessões |
  | Liberação emitida | encerra todas as sessões do titular e revoga liberações anteriores, sem tocar no fator |
  | Promoção | encerra as sessões do promovido |
  | Redefinição de senha | encerra sessões como antes, sem tocar no fator |
  | Troca de senha | encerra as outras sessões, sem tocar no fator |

- **Avisos ao titular:** e-mail (se configurado e verificado) em ativação,
  troca, novos códigos, código de recuperação usado e trava. A auditoria é o
  registro durável.
  - Ações auditadas: `SECOND_FACTOR_ENABLED`, `_REPLACED`, `_LOCKED`,
    `_GRANT_ISSUED`, `_GRANT_USED`, `RECOVERY_CODE_USED` e
    `RECOVERY_CODES_REGENERATED`.
  - Nenhum segredo, código, URI, QR ou token vai para log, auditoria ou
    e-mail; um teste confere.
- **Convite como prova do e-mail (conferido):** o link do convite vai só no
  e-mail da conta. Ele nunca volta para quem convidou e não é simulado sem
  provedor (`NOT_CONFIGURED`). Por isso o aceite de um convite de plataforma
  permite cadastrar nos 30 minutos seguintes.

## 5. Segredos

- **Biblioteca `otpauth` 9.5.2**, fixa no `package.json`. Critérios:
  - mesma dependência de runtime da 9.6.0 (`@noble/hashes` 2.4.0);
  - nenhum aviso de segurança na linha 9.x (o único publicado, GHSA-rmmc,
    afeta < 3.2.8);
  - a 9.6.0 só trouxe a opção `afterCounter`, que não usamos (a regra de
    reutilização é da aplicação, explícita e testada).
- **Parâmetros:** SHA1, 6 dígitos, 30 s, segredo de 20 bytes. QR em SVG pelo
  `qrcode` 1.5.4 no servidor; o web mostra o SVG como imagem.
- **Cifra:** AES-256-GCM, nonce de 12 bytes por gravação, dados associados
  presos à conta. Chaves versionadas só no ambiente da API
  (`PLATFORM_TOTP_KEYS`, `PLATFORM_TOTP_KEY_CURRENT`). Provisionamento,
  rotação e perda: runbook, seção 1.
- **Códigos de recuperação:** 10 códigos de 80 bits, guardados como SHA-256 e
  mostrados uma vez.
- **Liberação:** token de 32 bytes, só o hash no banco, uso único, 60 minutos,
  presa ao titular. Ela só permite cadastrar, depois da senha.

## 6. Recuperação

| Situação | Caminho |
|---|---|
| Perdeu o celular, tem códigos | entra com um código de recuperação; na Segurança da conta, troca o aplicativo (senha e outro código) |
| Perdeu os dois e existe outro master | o outro master envia a liberação pela ficha; o titular entra com a senha, abre o link e cadastra |
| Único master sem os dois | script `backend/scripts/liberar-2fa-emergencia.mjs`, pelo runbook (seção 6) |

Sobre o script:

- recusa se houver **outro** master ativo com fator;
- grava a liberação (via `SCRIPT`) e encerra as sessões, sem remover o fator e
  sem criar sessão;
- audita com a própria conta como ator e o resumo "por script".

## 7. Publicação

- Migration 18 `AdminSecondFactor1793750400000`, só com acréscimos:
  - tabelas `user_second_factors`, `second_factor_enrollments`,
    `second_factor_recovery_codes`, `second_factor_grants` e
    `second_factor_attempts`;
  - colunas novas em `sessions` e em `users`;
  - valores novos de `audit_action`.
- Variáveis da API são obrigatórias em production, sem padrão, e não existe
  fase que desligue o segundo fator.
- Ordem: comissões, depois o pacote da migration 17, depois este lote.
  - Chave primeiro, depois migration, API `optional`, web no mesmo SHA,
    cadastro de cada master e conferência.
  - Só então `required`, trocando a variável no Render.
- Combinações de versão de API e web, sessões antigas e por que o rollback
  habitual não é seguro: runbook, seções 3 e 7. **Nunca `migration:revert` no
  piloto.**

## 8. Testes

- **Unitários (backend):**
  - chaves, cifra, TOTP pela biblioteca, códigos e estados
    (`second-factor-core.spec.ts`);
  - arquitetura do guard (`second-factor-architecture.spec.ts`);
  - migration com runner falso;
  - variáveis de ambiente em production.
- **HTTP sem banco:** `test/second-factor.e2e-spec.ts` (todas as rotas
  `/platform`, corpo estrito, origem, JSON).
- **PostgreSQL descartável:** `test/second-factor-postgres.db-e2e-spec.ts`:
  - cadastro, fase `optional` com fator e sessões antigas;
  - código errado, fora da janela e reutilizado;
  - concorrência (TOTP, recuperação, confirmação) e trava;
  - fase `required`, promoção e liberação, recuperação sem remover o fator;
  - troca de senha, conta master com vínculo e chave ausente;
  - script de emergência;
  - auditoria e e-mails sem segredos.
- **Web:** `src/lib/administracao/segundo-fator.test.ts` e
  `src/lib/api/segundo-fator-api.test.ts`.
- **Navegador:** `tests/browser/portal-segundo-fator-flow.spec.ts`:
  - ativação com o código colado;
  - entrada só com o código;
  - código de recuperação colado no celular (390 px);
  - liberação por e-mail e cadastro do master novo.

  As outras suítes rodam na fase `optional` com chave fictícia. Quem não tem
  fator não muda, e a fase `required` é provada no db-e2e. Isso desvia do
  primeiro rascunho, que previa o CI inteiro em `required`.

## Estado e retomada

- Branch `feat/2fa-contas-administrativas`, a partir de
  `integration/nestjs-typeorm-frontend` em `08b38ff`.
- **Feito:** backend (migration, módulo `second-factor/`, guard, convite,
  promoção, troca de senha, ambiente), telas (portão, Segurança da conta,
  liberação, ficha), script de emergência, runbook e testes. Verificado
  localmente:
  - migration em banco descartável com TLS;
  - db-e2e completo;
  - unitários e HTTP do backend;
  - unitários, lint e tipos do web;
  - suítes de navegador do portal.
- **Não feito (de propósito):** publicação, variáveis no Render, backup e
  qualquer acesso ao banco real.
- **Requisitos da publicação (conferir antes):**
  - quantidade de `MASTER_OWNER` ativos;
  - `EMAIL_PROVIDER` e entrega real de um e-mail;
  - e-mails verificados dos proprietários;
  - a chave gerada e guardada em dois lugares;
  - a emergência ensaiada em banco descartável, se houver um único
    proprietário.
- **Próximo passo:** acompanhar o CI do PR; merge só com pedido explícito.
  Publicar depois de comissões e do pacote da migration 17, pelo runbook.
