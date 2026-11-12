# Runbook: verificação em duas etapas das contas administrativas no piloto

Este roteiro publica o lote `docs/plans/2fa-contas-administrativas.md`: a
migration 18 (`AdminSecondFactor1793750400000`), a API e o web. Ele também
cobre a passagem da fase `optional` para `required`, o que fazer se algo der
errado (sem voltar a uma API sem 2FA) e a recuperação de emergência do único
proprietário.

**Este documento nunca contém credencial, chave, URL de banco, Endpoint ID ou
endereço real.** Quem opera digita as variáveis no próprio terminal ou no
painel do Render, como nos outros roteiros (`publicacao-piloto-render.md`).

## 0. Antes de começar

- **Ordem na fila:** a publicação de comissões (`5d74556`) vem antes e é
  separada. Depois, o pacote com a migration 17
  (`publicacao-tenant-teste-slugs.md`). Este lote só começa com o piloto em
  **exatamente 17 migrations** e a API e o web do pacote anterior publicados.
- **Requisitos que só se conferem na hora (não presumir):**
  1. Quantos `MASTER_OWNER` ativos existem no piloto (consulta só leitura do
     roteiro, seção 2). Preferência: dois administradores reais e
     autorizados. Não criar conta privilegiada só para chegar a dois. Com um
     só, a seção 6 (emergência) precisa ter sido ensaiada antes.
  2. Se `EMAIL_PROVIDER` está configurado no serviço da API e se um e-mail de
     teste chega à caixa do proprietário (por exemplo, uma redefinição de
     senha para a própria conta, pedida por outro proprietário). **Sem e-mail
     conferido, a liberação pelo portal fica indisponível** (a API recusa com
     `LIBERACAO_SEM_EMAIL` e nada é criado); a recuperação passa a depender
     da seção 6.
  3. Os e-mails dos proprietários estão verificados (`email_verified`).
- **A chave TOTP precisa existir ANTES da API nova.** Sem as variáveis, a API
  nova não sobe em production (de propósito).

## 1. Chave do segredo TOTP (provisionamento)

1. No PC de operação, gere 32 bytes aleatórios em base64 (por exemplo, com
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).
   Não cole o valor em chat, commit, documento ou ticket.
2. Guarde em **dois lugares fora do banco e fora do Render**: o gerenciador de
   senhas e uma cópia offline (cofre ou papel guardado). O backup do banco
   **não** contém a chave (de propósito).
3. No painel do Render, serviço da API, defina:
   - `PLATFORM_TOTP_KEYS` = `1:<a chave em base64>`
   - `PLATFORM_TOTP_KEY_CURRENT` = `1`
   - `PLATFORM_2FA_ENFORCEMENT` = `optional`
   O web não recebe nenhuma dessas variáveis.

**Perda da chave:** os segredos cadastrados ficam indecifráveis. A verificação
pelo aplicativo responde "indisponível" e **nunca libera** o portal. Cada
proprietário entra com um código de recuperação (não depende da chave) e
cadastra o aplicativo de novo com a chave nova. Quem perdeu também os códigos
segue a seção 6.

**Rotação:** acrescente `2:<nova>` em `PLATFORM_TOTP_KEYS`, mude
`PLATFORM_TOTP_KEY_CURRENT` para `2` e reinicie. Segredos novos são cifrados
com a 2; os antigos continuam decifrando com a 1. Cada proprietário troca o
aplicativo pela Segurança da conta (o novo segredo sai com a 2). Remova a 1 só
quando a consulta por `key_version` (seção 2) mostrar zero linhas com ela.
**Vazamento da chave junto com o banco:** rotacionar não basta; todos os
proprietários precisam trocar o aplicativo (e, havendo suspeita de acesso,
redefinir a senha).

## 2. Migration 18

Mesmo procedimento das migrations anteriores (`migrations-production.md` e o
roteiro do piloto): backup conferido, `pilot:check-database` antes, aplicar
**só** a pendente esperada, `pilot:check-database` depois. A migration só
acrescenta tabelas e colunas; nenhuma linha existente muda e nenhum acesso
muda por ela.

Consultas só leitura úteis depois:

- proprietários ativos e quantos têm fator:
  `SELECT count(*) FILTER (WHERE f.user_id IS NOT NULL) AS com_fator, count(*) AS total FROM users u LEFT JOIN user_second_factors f ON f.user_id = u.id WHERE u.platform_role = 'MASTER_OWNER' AND u.status = 'ACTIVE';`
- segredos por versão de chave:
  `SELECT key_version, count(*) FROM user_second_factors GROUP BY 1;`

**Nunca rode `migration:revert` no piloto.** O `down` apaga todos os fatores e
códigos de recuperação e obriga todos a cadastrar de novo; ele existe só para
ensaio em banco descartável.

## 3. API e web (fase `optional`)

1. API no SHA do lote, com as variáveis da seção 1 (`optional`).
2. Web no **mesmo SHA**, logo em seguida.
3. Ninguém cadastra o aplicativo antes do web novo estar no ar (com a API nova
   e o web antigo, uma conta que já tem fator vê só um erro genérico no
   portal: fica bloqueada, nunca liberada).

| API | Web | Resultado |
|---|---|---|
| antiga | nova | o portal funciona como antes; a tela não afirma proteção |
| nova `optional` | antiga | quem não tem fator usa o portal como antes; quem tem fica bloqueado (não liberado) |
| nova `required` | antiga | ninguém administra (bloqueio seguro). **Nunca** ligar `required` com web antigo |
| nova | nova | fluxo completo |

Sessões abertas antes da publicação: na fase `optional`, quem não tem fator
segue normalmente; quem cadastrar o fator encerra as outras sessões dele.

## 4. Cadastro de cada proprietário

Para cada proprietário, no próprio celular e computador:

1. Portal, faixa "Ative a verificação em duas etapas" (ou **Segurança da
   conta**). Confirmar a senha, ler o QR (ou digitar a chave), confirmar com o
   código.
2. Guardar os 10 códigos de recuperação fora do celular (gerenciador de senhas
   ou papel). Eles aparecem uma única vez.
3. Em outro navegador (janela anônima): entrar no portal e confirmar com o
   código do aplicativo. Depois, entrar de novo e confirmar com **um** código
   de recuperação (ele é consumido). Em seguida, na Segurança da conta, gerar
   novos códigos e guardar.
4. Conferir que o e-mail de aviso chegou (se o e-mail estiver configurado).

## 5. Passar para `required`

Só quando:

- a consulta da seção 2 mostra **todos** os proprietários ativos com fator;
- cada um fez o passo 4.3;
- o web novo está no ar;
- com um único proprietário: a seção 6 foi ensaiada em banco descartável e o
  proprietário confirmou que guardou os códigos.

Então mude `PLATFORM_2FA_ENFORCEMENT` para `required` no painel do Render
(reinício da API, sem deploy de código) e confira:

- uma sessão sem código recebe 403 no portal e a tela mostra a etapa do
  código;
- um login novo pede o código e, com ele, abre o portal.

Voltar para `optional` só deixa entrar quem **não tem** fator; quem tem
continua precisando dele.

## 6. Emergência: único proprietário sem celular e sem códigos

Só o operador autorizado (o proprietário titular), pelo terminal de operação.
Não existe rota da API para isso, e o script **não** dá acesso: ele grava uma
liberação de uso único (60 minutos) e encerra as sessões da conta. A pessoa
ainda precisa da senha.

1. Backup conferido e `pilot:check-database` (como numa migration).
2. No PC de operação, com `PILOT_ENDPOINT_ID`, `PRODUCTION_ENDPOINT_ID` e
   `AGENDA_OPS_DIR` definidos como nos outros lançadores, em `backend/`:
   `node scripts/liberar-2fa-emergencia.mjs --email=<e-mail da conta> --motivo="<motivo>"`
3. Cole a URL direta do piloto quando pedida (entrada oculta) e digite a frase
   de confirmação mostrada.
4. O script recusa se houver **outro** proprietário ativo com fator (aí a
   recuperação é pelo portal, por ele). Se aceitar, mostra uma vez o caminho
   `/portal/liberacao-2fa#t=…`.
5. Entre no portal com a senha, abra o endereço do portal seguido desse
   caminho e cadastre o novo aplicativo. Guarde os novos códigos.
6. A auditoria registra `SECOND_FACTOR_GRANT_ISSUED` (via `SCRIPT`, com o
   motivo) e, depois, `SECOND_FACTOR_GRANT_USED` e `SECOND_FACTOR_REPLACED`. O
   registro de operações (`AGENDA_OPS_DIR/operacoes.jsonl`) guarda só a conta,
   o id da liberação e o horário, nunca o token.

## 7. Se algo der errado depois da ativação

**Voltar a API para um SHA sem 2FA não é um retorno seguro:** o código antigo
ignora as tabelas novas e o portal volta a abrir **só com a senha**. Prefira,
nesta ordem:

1. **Correção para a frente**, mantendo a proteção (novo SHA com o conserto,
   mesma migration).
2. **Bloqueio administrativo temporário:** manter a API nova com
   `required` (ninguém sem fator entra) enquanto a correção sai; o uso comum de
   `/conta` não depende do segundo fator e continua funcionando.
3. Só em último caso, e registrado, voltar o código da API sabendo que o portal
   ficará protegido só pela senha até a correção. Nunca rodar o `down` da
   migration.
