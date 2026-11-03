# Portal da plataforma, acesso e preços

Lote que tira a administração da plataforma de dentro da área da conta e a
transforma num portal próprio dos proprietários da plataforma, separa a
situação operacional (Ativo/Inativo) da validade comercial e dos papéis,
acrescenta o acesso "sem vencimento" e o gerenciamento de preços (catálogo e
valor contratado por cliente).

Branch `feat/portal-plataforma`, a partir da integration em `99242a6` (API e
web publicados nesse SHA; piloto com 12 migrations, CommercialAccess aplicada).

## 1. Decisões

### 1.1 Quem entra no portal

- **Só o proprietário da plataforma**: conta ativa com
  `users.platform_role = MASTER_OWNER`, relida do banco a cada requisição
  (`platform/platform-access.ts`). Para ela, todas as capacidades; para
  qualquer outra conta, nenhuma.
- `MASTER_ADMIN` e `MASTER_SUPPORT` continuam no enum e nas contas que já os
  têm, mas **não abrem nada** (antes, com `ESTABLISHMENTS_MANAGE`, consultavam
  e criavam estabelecimentos). Nenhum papel é alterado por migration.
- Só o papel de proprietário é atribuível (`ASSIGNABLE_PLATFORM_ROLES`),
  conferido no DTO **e** no serviço (`assertAssignablePlatformRole`). Nenhuma
  permissão avulsa é aceita.
- Nada decide acesso por nome, e-mail, plano, estabelecimento ou conta de
  teste. Dono, gerente e profissional de qualquer plano, inclusive Max, são
  recusados (a Membership nunca é lida pela plataforma).
- A proteção do último proprietário ativo continua (`requireAnotherOwner`, com
  trava global) no bloqueio e na retirada do papel.

**Rotas antigas auditadas.** Todas as rotas `/platform/*` passam por
`platformCapabilities` (leituras: `viewDirectory`; escritas: a capacidade
própria). Duas exceções conferidas:

- `GET /platform/requests/:requestKey` só olhava "o que esta conta criou";
  agora exige ser proprietário (uma conta que perdeu o papel não consulta nem
  o que criou antes).
- `POST /platform/reauth` **continua aberta a qualquer sessão**: o dono do
  estabelecimento usa a mesma confirmação de senha antes das ações sensíveis
  da equipe e dos recebimentos. Ela só marca a confirmação na própria sessão e
  não concede nada. (Fechá-la quebrou os testes da equipe; ficou documentado.)

Os endereços antigos da tela (`/administracao/**`, `/conta/administracao/**`)
encaminham para `/plataforma/**`; o endereço não autoriza nada.

### 1.2 Portal

Área `/plataforma/**` com layout próprio (`components/administracao/shell-plataforma.tsx`):
cabeçalho, menu de seções, aparência, "Ir para a operação" (quando a conta tem
estabelecimento) e "Sair". Mesma sessão (`RequireRealSession`), mesma API,
nenhuma autenticação nova. Seções: Estabelecimentos, Responsáveis e acessos,
Convites, Planos e preços, Pagamentos das assinaturas, Proprietários da
plataforma, Histórico administrativo. A área da conta ganha só o atalho
"Portal da plataforma" para quem é proprietário.

### 1.3 Situação, validade e privilégios

| Conceito | Onde fica | Efeito |
| --- | --- | --- |
| Ativo/Inativo | `tenants.status` (suspender/reativar existentes, rotulados Inativar/Ativar) | Inativo prevalece sobre tudo |
| Validade comercial | `tenant_access_periods` + `tenant_no_expiry_grants` | Vencido: `ACESSO_VENCIDO` |
| Recursos | `plan_features` + exceções | Sem vencimento não muda |
| Privilégios da plataforma | `users.platform_role` | Sem relação com plano |

- Ativar de novo devolve a situação anterior e **não** mexe na validade: um
  vencido continua vencido (testado).
- Nada apaga ou cancela agendamento.

### 1.4 Sem vencimento

- Tabela `tenant_no_expiry_grants`: concessão e retirada na mesma linha, com
  quem, quando, motivo e chave do formulário; no máximo uma em vigor por
  estabelecimento (índice único parcial). Nunca apagada.
- Em vigor: situação `NO_EXPIRY`, não bloqueia, sem data de fim. Não cria
  período, não representa pagamento, não libera recurso fora do plano, não
  altera papel. A suspensão continua bloqueando.
- Retirada: vale o que os períodos dizem. **A marca de anterior ao controle
  (`access_legacy_since`) deixa de valer para quem já teve uma concessão**, em
  vigor ou retirada (`ACCESS_LEGACY_SQL`): retirar nunca devolve em silêncio a
  "Validade ainda não definida". A ficha mostra antes a consequência calculada
  no servidor (`noExpiry.revokePreview`): segue até tal dia, vencido desde tal
  dia, ou bloqueado sem período.
- Vale na próxima requisição, com a sessão aberta (a situação é calculada a
  cada requisição). Login, perfil e segurança seguem a política de acesso
  bloqueado já existente.
- Proprietário com senha confirmada, motivo obrigatório e `confirm: true`;
  histórico `ACCESS_NO_EXPIRY_GRANTED` / `ACCESS_NO_EXPIRY_REVOKED`.

### 1.5 Preços

- Mapeamento preservado: Básico=`essencial`, Pro=`equipe`, Max=`pro`.
- `plan_prices`: preço do catálogo por plano e ciclo, uma linha por mudança. O
  em vigor é a mais recente; **sem linha, pendente** (nunca zero). Nenhum preço
  é gravado pela migration: os valores propostos não foram aprovados.
- `tenant_contract_prices`: valor contratado por cliente, plano e ciclo, uma
  linha por mudança; `amount_cents` NULL registra o ciclo seguindo o catálogo.
- Sugestão do "Registrar pagamento": contratado vigente do cliente/ciclo,
  senão catálogo, senão pendente (campo vazio). A tela mostra a origem.
- Origem do valor gravado (`tenant_access_periods.amount_source`): `CONTRACT`,
  `CATALOG` ou `ADJUSTED`, **decidida no servidor**; o navegador não envia
  origem (campo desconhecido é recusado). Períodos anteriores ficam com NULL.
- "Ajustar só este pagamento" é o padrão; `updateContract: true` grava, na
  mesma transação, o novo valor contratado para as próximas renovações (ligado
  ao período por `access_period_id`).
- Criação de estabelecimento aceita `billingCycle` e `contractAmountCents`
  (grava o contrato, nunca pagamento). O estabelecimento começa no teste.
- Mudar catálogo ou contrato nunca recalcula período ou pagamento já
  registrado; a correção por anulação continua igual.
- Repetição idempotente por `requestKey` (por quem registrou); versão
  conferida (`expectedCurrentCents` no catálogo, `expectedUpdatedAt` no
  contrato).
- Pagamentos das assinaturas (`GET /platform/subscription-payments`) listam só
  períodos pagos; recebimentos dos atendimentos nunca aparecem.

## 2. Schema (migration nova `1793318400000-PlatformPortal`)

Só acrescenta; as 12 migrations aplicadas não mudam.

- `audit_action`: `PLAN_PRICE_CHANGED`, `CONTRACT_PRICE_CHANGED`,
  `ACCESS_NO_EXPIRY_GRANTED`, `ACCESS_NO_EXPIRY_REVOKED`;
- tabelas `plan_prices`, `tenant_contract_prices`, `tenant_no_expiry_grants`;
- coluna `tenant_access_periods.amount_source` (anulável, com check só para
  `PAID`).

`down()` remove tabelas e coluna; valores de enum ficam. A conferência de
CommercialAccess (`scripts/lib/acesso-comercial-schema.ts`) passou a aceitar só
a coluna `amount_source` a mais na tabela de períodos, para continuar valendo
num banco já à frente.

## 3. API nova

| Rota | Efeito |
| --- | --- |
| `GET /platform/prices` | catálogo com preço em vigor por ciclo e histórico |
| `PUT /platform/plans/:planId/prices/:cycle` | novo preço do catálogo |
| `PUT /platform/establishments/:id/contract-price` | valor contratado (ou volta ao catálogo) |
| `POST /platform/establishments/:id/access/no-expiry` | concede sem vencimento |
| `POST /platform/establishments/:id/access/no-expiry/revoke` | retira |
| `GET /platform/subscription-payments` | pagamentos das assinaturas |

A ficha ganha `operational`, `noExpiry`, `pricing`, `access.noExpiry` e
`allowedActions.{grantNoExpiry, revokeNoExpiry, changeContract}`; o período
ganha `amountSource`; `GET /platform/plans` ganha `cyclePrices`; a sessão do
dono pode trazer `state: NO_EXPIRY`.

## 4. Compatibilidade e publicação

- **API nova com web anterior:** a ficha antiga continua abrindo (campos novos
  são extras). `NO_EXPIRY` só aparece depois de uma concessão, que só existe
  pelo web novo; a sessão do web anterior aceita qualquer `state` em texto.
  Contas `MASTER_ADMIN`/`MASTER_SUPPORT` perdem o acesso já com a API nova.
- **Web novo com API anterior:** não suportado (o portal espera as rotas
  novas). Ordem: migration, API, web, do mesmo SHA.
- **Requisito antes de publicar (sem alterar papéis no piloto):** conferir,
  só com leitura, as contas com `platform_role` não nulo. O levantamento
  anterior achou 3 contas capazes de criar estabelecimento; isso não prova que
  são 3 pessoas. Confirmar quais são `MASTER_OWNER` e que pertencem a
  Welington e Leonardo; qualquer `MASTER_ADMIN`/`MASTER_SUPPORT` deixará de
  entrar no portal. Se uma das contas dos proprietários não for `MASTER_OWNER`,
  a promoção é decisão separada, pela tela, por outro proprietário.
- **Procedimento protegido ainda não escrito.** Antes de publicar é preciso um
  kit próprio no padrão dos anteriores (`backend/scripts/`, runbook em
  `docs/runbooks/`): backup, `pilot:check-database` antes e depois, aplicar só
  `PlatformPortal1793318400000`, conferir os objetos novos, depois API e web.
  Não usar `migrations-production.md`.
- Preços: depois de publicar, cadastrar pelo portal somente valores aprovados.

## 5. Testes

- Unitários do backend: capacidades (delegados não abrem nada), `NO_EXPIRY`,
  preço e origem do valor, contagem de migrations.
- Banco descartável, pela API HTTP real
  (`test/platform-portal-postgres.db-e2e-spec.ts`): recusa de dono, gerente e
  profissional de Básico, Pro e Max e de papéis delegados em todas as rotas do
  portal (sem mudar período, papel ou ficha); papel dado/retirado com a sessão
  aberta; pendente, catálogo, contrato na criação, origem no pagamento, ajuste
  só do pagamento, alteração do contrato, sem efeito retroativo, idempotência,
  versão, reautenticação, correção; sem vencimento (próxima requisição, recurso
  fora do plano, isolamento, inativo prevalece, retirada com consequência,
  reservas preservadas, histórico); retirada de legado vira `MISSING`; ativar
  não perdoa vencido.
- Ajustes nas suítes existentes à regra nova (`accounts`, `platform`,
  `pilot-commercial-access-check`).
- Web: rotas e encaminhamentos, contratos novos, origem do valor, consequência
  da retirada.
- Navegador: `administracao` (reescrita para o portal, mantendo os cenários
  anteriores), `contas` e `equipe` (rotas e rótulos novos).

## 6. Estado e retomada

Ver a descrição do PR para os resultados de cada rodada e o SHA final.
Pendências fora deste PR: kit protegido de publicação da migration; conferência
das contas proprietárias no piloto; aprovação dos preços.
