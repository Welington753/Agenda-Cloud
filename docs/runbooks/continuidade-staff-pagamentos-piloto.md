# Continuidade — StaffLogin e AppointmentPayments no piloto

Nota para retomar em qualquer máquina. Atualizada em 27/10/2026.

**Estado: CHECKPOINT INCOMPLETO.** O procedimento protegido das duas
migrations e o runbook de publicação ainda não existem. Nada foi aplicado,
publicado ou alterado no piloto ou no Render por esta rodada.

## Onde está

- Branch operacional: `chore/publicacao-staff-pagamentos-piloto`, criada de
  `integration/nestjs-typeorm-frontend` em
  `0f7bfd30a7b9962dac9aba3a24af2aeda8604f0d`. Não mesclar na integration
  enquanto a origem do deploy inesperado (abaixo) não estiver esclarecida.
- Integration contém, nesta ordem:
  - #71 (operação diária e configurações), merge `9ab908f`, head `edc4282`;
  - #72 (acesso de funcionário por usuário, migration
    `StaffLogin1792972800000`), merge
    `824463c07947f1f15af9a7d1527a785b80870603`, head `dfb9228`;
  - #73 (recebimentos manuais e painel, migration
    `AppointmentPayments1793059200000`), merge
    `0f7bfd30a7b9962dac9aba3a24af2aeda8604f0d`, head `3f46cbf`.
  - CI verde nos dois workflows no head de cada PR; a árvore de cada merge é
    igual à árvore do head testado.
- Regras dos lotes: `docs/plans/operacao-diaria-configuracoes.md`.
- Procedimento anterior (TeamAccess), que serve de base:
  `docs/runbooks/publicacao-equipe-piloto.md`.

## Situação do piloto e do deploy

Separado por tipo de evidência:

- **Relato do usuário:** Auto-Deploy Off nos serviços
  `agenda-cloud-piloto-api` e `agenda-cloud-piloto-web`. `render.yaml` também
  declara `autoDeployTrigger: "off"`.
- **Registro do GitHub (deployments):** API e web do piloto com deployment de
  `824463c` em 27/10/2026, 18:19:50–18:21:53 UTC, status `success`. O merge
  de #72 foi às 18:14:50 UTC, com `[skip render]` no título. A origem do
  deploy é desconhecida e contradiz o relato de Auto-Deploy Off.
- **Última referência do schema do piloto (não reinspecionada):** oito
  migrations, até `TeamAccess1792886400000`. `StaffLogin` e
  `AppointmentPayments` não aplicadas.
- **Ensaio (banco descartável `disposable_ensaio8`, oito migrations):** a API
  `824463c` responde `GET /` 200 e **login de dono 500** (coluna de
  `StaffLogin` ausente). Controle com `c77c313` no mesmo banco: login 200.
- **Não conferido:** se o piloto está de fato sem login. Nenhuma consulta ao
  piloto foi feita.
- **Sem confirmação** de retorno da API e do web para `c77c313`.

Decisão pendente do usuário (fora do alcance do agente): republicar
`c77c313` manualmente na API e no web e investigar a origem do deploy, ou
aplicar as migrations pelo procedimento protegido quando ele existir.
**Não publicar `0f7bfd3` antes de `StaffLogin` e `AppointmentPayments`
aplicadas e conferidas.**

## Arquivos desta branch

- `docs/runbooks/continuidade-staff-pagamentos-piloto.md`: esta nota.
- `backend/scripts/ensaios/sonda-login.mjs`: sobe uma API compilada contra
  um banco descartável e tenta o login de um dono fictício. Usada para
  reproduzir o 500 de `824463c` no schema de oito migrations.
- `backend/scripts/ensaios/retorno-api-antiga.mjs`: ensaio de retorno. Com a
  API antiga no ar contra um banco com o schema final, cria dados que só a
  API nova grava (funcionário sem e-mail com troca obrigatória e sessão
  aberta, recebimento ativo, auditoria nova) e confere dono, funcionário e
  administração. Executado; resultados abaixo.

Os dois scripts são de ensaio local: leem `DB_URL` do ambiente, exigem TLS
verificado (`rejectUnauthorized: true`) e só criam dados fictícios.

## Testes e resultados até aqui

- c77c313 (publicada antes do incidente), db-e2e: 175/175 com oito
  migrations; 173/175 com nove e com dez. As duas falhas são testes de guarda
  do piloto (`pilot-accounts-check`) que esperam exatamente sete/oito
  migrations; não indicam defeito de runtime.
- Código final (`3f46cbf`), db-e2e sobre o banco com dados mistos: 192/192.
- Aplicar migrations no ensaio (8 → 9 → 10) só executou as pendentes.
- `824463c` contra o schema final (dez migrations): `GET /` 200, login de
  dono 200, sem erro no log (`sonda-login.mjs`).
- Retorno para a API antiga com dados novos (`retorno-api-antiga.mjs`,
  API `c77c313` contra `disposable_ensaio`, dez migrations):
  - dono: login, `me`, equipe (lista o funcionário sem e-mail), agenda: 200;
  - cancelar atendimento já quitado: 201, recebimento intacto (a API nova
    faz o mesmo: cancelar nunca mexe no recebimento);
  - administração: login, usuários, ficha do funcionário sem e-mail
    (`email=null`), histórico com as ações novas, membros, ficha do
    estabelecimento, reautenticação: 200/204;
  - **funcionário sem e-mail não consegue entrar** (400: a API antiga só
    aceita e-mail). Perde o acesso até a API nova voltar; nada se perde;
  - **sessão já aberta com senha temporária continua válida e com acesso
    total** (`me` e `my-agenda` 200). A API antiga não conhece
    `must_change_password`. Na recuperação, revogar essas sessões antes de
    voltar a API;
  - redefinição de senha pela administração para conta sem e-mail: 200 e
    um link gravado que não tem para onde ir (`NOT_CONFIGURED` no ensaio;
    com e-mail configurado, falha de entrega). Não usar durante o retorno.
- `StaffLogin.down` recoloca `email NOT NULL`: falha assim que existir conta
  sem e-mail. Recuperação é voltar o código, nunca reverter a migration.
- Limitação: o web antigo (`c77c313`) com conta sem e-mail foi avaliado só
  por leitura de código (nenhuma operação de texto sobre `email` nas telas
  de equipe e administração), não em navegador.

## Onde parou e próximo passo

1. ~~Ensaio de retorno~~ feito (acima).
2. Escrever o procedimento protegido das duas migrations, reaproveitando
   `entrada-oculta.mjs`, `operacao-piloto.mjs`, `equipe-piloto.mjs` e o
   lançador `abrir-equipe-piloto.ps1`: fases `preparar`, `restauracao`,
   `aplicar`, `conferir`; frase de confirmação própria; sem reaplicar após
   resultado incerto. PR separado, com testes e CI verde.
3. Runbook de publicação com o SHA exato, a sequência e a recuperação.

## Fora do Git (necessário para retomar neste PC; recriar em outro)

- Cluster PostgreSQL 18 descartável na porta 55433, com certificado próprio
  na pasta temporária da sessão. Bancos: `disposable_ensaio`,
  `disposable_ensaio8`, `disposable_pr1..3`. Usuário e senha locais de
  descarte, não registrados aqui.
- Worktrees de ensaio `C:\Projetos\Agenda-Cloud-ensaio` (`c77c313`) e
  `C:\Projetos\Agenda-Cloud-ensaio-pr2` (`824463c`), compilados.
- Em outro PC: criar um cluster descartável com TLS, aplicar as migrations
  com `IGNORE_DOTENV_FILE=true` e recriar os worktrees nos mesmos SHAs.
