# Equipe: gerente com permissões do dono e login interno

Evolução de "Equipe e acessos" sobre `StaffLogin` e `TeamAccess` (ver
`operacao-diaria-configuracoes.md`, PR 2). A autenticação não foi refeita: a
criação direta de conta, a senha temporária exibida uma vez, a troca
obrigatória, a reautenticação do dono, a idempotência por chave de formulário,
o histórico e a trava das vagas são os mesmos.

## Regras

**Responsável pela empresa.** Continua com e-mail real, comprovado pelo fluxo
de convite e aceite da administração. Nada mudou nesse caminho.

**Equipe.** O dono cria o acesso em "Criar acesso", sem convite, sem e-mail e
sem código:

- perfil **Profissional** (sempre com profissional ligado) ou **Gerente** (com
  ou sem profissional);
- nome, login e as permissões, por área e ação.

Gerente sem profissional ocupa vaga de acesso, mas não cria profissional nem
conta no limite de profissionais.

**Login interno.** Rótulo "Login". Pode ter a aparência de e-mail (`maria@salao`,
`recepcao@barbearia.com`), mas não é e-mail:

- vai para `users.username`, nunca para `users.email`;
- não é marcado como verificado e não recebe mensagem, convite nem
  recuperação;
- formato: minúsculo, 3 a 80 caracteres, parte local com letras sem acento,
  números, `.`, `_`, `-` e `+`, e opcionalmente uma `@` seguida de um domínio
  que começa e termina por letra ou número;
- todo login sem `@` que o formato anterior aceitava continua aceito.

**Unicidade cruzada.** O mesmo texto nunca é o e-mail de uma conta e o login de
outra. Um gatilho no banco confere toda gravação que muda e-mail ou login, com
trava consultiva por identificador. Duas gravações simultâneas do mesmo texto
ficam em fila, e a segunda é recusada (`uq_users_login_identifier`).

O login procura o identificador normalizado nos dois campos. Se, ainda assim,
aparecerem duas contas, a entrada é recusada como credencial inválida, sem
escolher uma delas.

Criar um login nunca liga nem assume uma conta existente: login em uso,
inclusive igual ao e-mail de outra conta, é recusado com "Este login já está
em uso na plataforma". Um convite por e-mail para um endereço que já é login
interno também é recusado (`IDENTIFICADOR_EM_USO`).

**Recuperação.** A conta de login interno é recuperada pelo dono ("Gerar nova
senha temporária"), com os limites de antes: sem e-mail, sem papel na
plataforma e só com este vínculo. As outras contas são recuperadas pela
administração.

## Matriz de permissões

O nome do papel não libera nada. GERENTE só faz o que tem `GRANTED`
**confirmado** pelo dono, e um `DENIED` sempre vence. Cada política
(`*-access.ts`) pede ao gerente as mesmas permissões que já exige do dono.

| Área | Ação | Dono | Gerente | Profissional |
| --- | --- | --- | --- | --- |
| Agenda própria | ver | — | se tiver profissional ligado | sempre |
| Agenda própria | iniciar, concluir, marcar falta | — | `ATENDIMENTO_PROPRIO_*`, com profissional ligado | `ATENDIMENTO_PROPRIO_*` |
| Agenda do estabelecimento | consultar | sim | `AGENDA_VISUALIZAR` (+ profissionais) | não |
| Agenda do estabelecimento | confirmar, iniciar, concluir, falta | sim | `AGENDA_GERENCIAR` | não |
| Agenda do estabelecimento | criar | sim | `AGENDAMENTO_CRIAR` (+ agenda, profissionais, serviços, clientes) | não |
| Agenda do estabelecimento | remarcar | sim | `AGENDAMENTO_EDITAR` (+ agenda, profissionais, serviços) | não |
| Agenda do estabelecimento | cancelar | sim | `AGENDAMENTO_CANCELAR` (+ agenda) | não |
| Solicitações | consultar | sim | `SOLICITACOES_VISUALIZAR` | não |
| Solicitações | confirmar e recusar pedido `PENDING` | sim | `SOLICITACOES_TRATAR` | não |
| Clientes | consultar (inclui telefone e observações nos atendimentos) | sim | `CONSUMIDORES_VISUALIZAR` | não |
| Clientes | cadastrar | sim | `CONSUMIDORES_GERENCIAR` | não |
| Serviços | consultar / gerenciar | sim | `SERVICOS_VISUALIZAR` / `SERVICOS_GERENCIAR` | não |
| Profissionais e horários | consultar / gerenciar | sim | `PROFISSIONAIS_VISUALIZAR` / `PROFISSIONAIS_GERENCIAR` | não |
| Recebimentos | consultar (inclui preço nos atendimentos) | sim | `RECEBIMENTOS_VISUALIZAR` (+ agenda) | não |
| Recebimentos | registrar | sim | `RECEBIMENTOS_REGISTRAR` | não |
| Recebimentos | estornar | sim | `RECEBIMENTOS_ESTORNAR` | não |
| Início (plano, vagas, dinheiro) | ver | sim | não | não |
| Configurações do estabelecimento, agendamento online, avisos no aparelho | — | sim | não | não |
| Equipe, permissões e credenciais de terceiros | — | sim | não | não |
| Perfil e segurança, Aparência | — | sim | sim | sim |
| Link público de agendamento | copiar e abrir | sim | sim, na agenda própria | sim |
| Administração da plataforma | — | só por `platform_role` | nunca pelo papel | nunca pelo papel |

Regras da matriz:

- **Dependências.** As que estão entre parênteses entram junto ao marcar uma
  ação. A tela mostra o resumo exato do que será concedido. O servidor
  recusa um conjunto que não feche (`PERMISSOES_INCOMPLETAS`).
- **Limite do dono.** O dono só concede o que a própria política dele permite
  (`PERMISSAO_NAO_DISPONIVEL`).
- **Cadastro de clientes.** "Clientes" não tem edição: só a rota de cadastro
  existe.
- **Respostas.** As respostas também recortam. Para o gerente, a agenda e as
  solicitações escondem o telefone e as observações sem
  `CONSUMIDORES_VISUALIZAR` e o preço sem `RECEBIMENTOS_VISUALIZAR`
  (`hidden: ["price", "contact"]`).
- **Agenda do funcionário.** Continua sem telefone, observações, preço e
  colegas.
- **Revogação.** Retirar uma permissão ou suspender o acesso vale na
  requisição seguinte. O vínculo, os ajustes e a confirmação são relidos a
  cada requisição.
- **Link público.** É o mesmo `/agendar/[slug]`. Não existe parâmetro de
  profissional pré-selecionado, então nenhum foi inventado. Compartilhar o
  link não dá permissão nenhuma no painel.

## Compatibilidade

- **Gerentes antigos.** Vínculos GERENTE de antes desta tela, com ou sem
  `GRANTED` gravado, continuam sem área: a confirmação
  (`permissions_confirmed_at`) é NULL. A tela os mostra como "Permissões a
  confirmar". Ao confirmar, o que o dono não marcou é apagado.
- **Vagas.** Gerentes antigos passam a ocupar vaga de equipe, como qualquer
  gerente. Se um estabelecimento já tiver mais acessos do que vagas, nada é
  cortado: só novas criações e reativações são recusadas até sobrar vaga.
- **Convites pendentes.** Os convites de funcionário por e-mail não são
  apagados. Aparecem em "Convites por e-mail ainda pendentes", continuam
  ocupando vaga e reservando o profissional, e o dono reenvia ou revoga. A
  rota de convite continua na API, para a tela anterior durante a publicação.
- **Telas anteriores.** A tela anterior continua funcionando com a API nova:
  sem `role`, a criação é `PROFISSIONAL`, e `members` continua na resposta.
  O web novo manda o login sempre no corpo `login`, que as duas versões da
  API aceitam.
- **Usuários antigos.** E-mails, vínculos e credenciais de contas existentes
  não foram alterados.

## Migration `TeamManagerAccess1793145600000`

Incremental. `StaffLogin`, `TeamAccess` e `AppointmentPayments` não foram
editadas nem repetidas.

1. Confere antes que não há colisão cruzada (login igual ao e-mail de outra
   conta). Se houver, para com a lista de contas, sem alterar nada.
2. `permission` ganha `SOLICITACOES_VISUALIZAR`, `SOLICITACOES_TRATAR`,
   `RECEBIMENTOS_VISUALIZAR`, `RECEBIMENTOS_REGISTRAR` e
   `RECEBIMENTOS_ESTORNAR`.
3. `memberships.permissions_confirmed_at timestamptz(3) NULL`.
4. `ck_users_username_format` passa ao formato novo, que contém o antigo.
5. Função `users_login_identifier_guard()` e gatilho
   `trg_users_login_identifier`.

O `down` remove o gatilho e a coluna e volta o formato antigo. Se existir
login novo fora do formato antigo, o banco recusa e a reversão para, sem
reescrever logins. Os valores de enum ficam.

## Ordem segura de publicação

Nada disto foi executado no piloto. Cada passo precisa de autorização
explícita.

1. **Conferir o piloto** (só leitura, pelo procedimento protegido de
   `docs/runbooks/migrations-production.md`):
   - `migration:show` com as 10 migrations até `AppointmentPayments`
     aplicadas;
   - nenhuma colisão cruzada (a consulta do passo 1 da migration);
   - quantos vínculos `GERENTE` existem (efeito nas vagas, acima).
2. **Backup** e conferência.
3. **Aplicar a migration** `TeamManagerAccess` (11ª). A API em produção
   continua funcionando: não lê a coluna nova, trata GERENTE como papel sem
   área e só cria logins sem `@`.
4. **Publicar a API** do mesmo commit (Manual Deploy → Deploy a specific
   commit).
5. **Publicar o web** do mesmo commit.
6. **Conferir no piloto:**
   - login do dono por e-mail;
   - tela de Equipe com os acessos e os convites que já existiam.

   Não criar contas reais sem autorização.

**Recuperação.**

- **Web.** O web pode voltar à versão anterior a qualquer momento. Logins com
  `@` criados nesse meio-tempo não entram pela tela anterior, que os manda
  como e-mail; os demais entram.
- **API.** A API pode voltar à anterior com o banco migrado. Gerentes ficam
  sem área (falha fechada), e logins com `@` não entram até a API nova
  voltar. Nada é apagado.
- **Migration.** Desfazer (`down`) só depois de trocar ou remover os logins
  novos fora do formato antigo e, antes, de voltar a API.

## Validação local

Banco descartável exclusivo `disposable_equipe`: PostgreSQL 18, TLS com
certificado autoassinado via `NODE_EXTRA_CA_CERTS`, `IGNORE_DOTENV_FILE=true`.

- **Ensaio da migration.**
  1. Aplicadas as 10 migrations até `AppointmentPayments`.
  2. Inseridos dados antigos fictícios: dono por e-mail, gerente antigo com
     `GRANTED` gravado, funcionária com login sem `@` e convite de funcionário
     pendente.
  3. Aplicada `TeamManagerAccess`. As impressões digitais (md5) de `users`,
     `memberships`, `membership_permission_overrides` e `invites` ficaram
     idênticas, e nenhum vínculo ficou confirmado.
  4. Revertida, aplicada de novo, e conferido que ela para sem alterar nada
     quando há colisão cruzada.
- **Backend.**
  - Unitários: 1482.
  - e2e HTTP: 132.
  - `test:db-e2e`: 17 arquivos, 204 testes, entre eles
    `test/team-manager-postgres.db-e2e-spec.ts`, novo:
    - criação e login sem e-mail;
    - troca obrigatória;
    - colisões;
    - corrida de e-mail × login;
    - disputa pela última vaga entre profissional e gerente;
    - concessões e dependências;
    - áreas por API direta e recorte de contato e preço;
    - retirada e suspensão na requisição seguinte;
    - solicitações;
    - isolamento entre estabelecimentos;
    - agenda própria do gerente;
    - gerente antigo e confirmação.
- **Frontend.** Unitários: 848.
- **Navegador.** Ver o PR (suítes `gerente`, `equipe`, `acesso-usuario` e as
  demais afetadas), com capturas em claro e escuro, 1280, 390 e 360 px.
