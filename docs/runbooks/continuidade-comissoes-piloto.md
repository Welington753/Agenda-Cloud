# Continuidade: comissões completas no piloto (migrations 15 e 16)

Estado entre sessões, escrito no PC do trabalho em 05/11/2026 para continuar no
PC de casa. **Nada foi executado no piloto, no Neon ou em `agenda_dev`:**
nenhum backup, restauração, migration ou deploy feito por esta preparação.

Procedimento completo: `publicacao-regra-geral-comissoes-piloto.md` (15 e 16)
e `publicacao-comissoes-profissionais-piloto.md` (kit da 15). Esta nota não
substitui os runbooks; só registra onde o trabalho parou.

## Atualização de 09/11/2026: PRs mesclados, publicação pendente

Feito no PC do trabalho. **Nada foi publicado nem executado no piloto, no Neon
ou em `agenda_dev`:** nenhum deploy, migration, backup ou restauração.

- **Render, só leitura (Render CLI, 09/11/2026):** API
  (`agenda-cloud-piloto-api`) e web (`agenda-cloud-piloto-web`) com
  `autoDeploy=no` e `autoDeployTrigger=off`. Os dois continuam Live em `92cc6ae`,
  por deploys manuais de 05/11 (API `dep-dbmdlttbedkc739pu4mg`, web
  `dep-dbmb658ae00c738sj7eg`). Os merges não dispararam deploy.
- **Merges** (merge commit, preso ao head revisado, `[skip render]` no título;
  branches mantidas):
  - #98 (head `0ff8f46`) → `137d388575e6e2e4fd69deb7472cbb0d755566ce`.
  - #99 (head `7a0ce84`): base trocada para a integração; ficaram só os 5
    commits do kit e da documentação. Merge →
    **C16 = `879cef8f378d1007f606ba67246ae7e5535df905`**.
    - `git diff 7a0ce84 879cef8` vazio (árvore idêntica ao head revisado).
    - `git diff e42fb81 879cef8 -- backend/scripts backend/src` vazio (kit
      ensaiado).
  - #100, Portal AC (head `208f2c8`) →
    **C_final = `8e8577d698fd3d2b9eb2a42b6945fbd3cb3205d2`**. De C16 para
    C_final só mudam os 16 arquivos do Portal; nada em `backend/`.
- **CI no C_final:** `test-frontend-auth` por `workflow_dispatch` na integração,
  run 42611417755, `head_sha` = `8e8577d`, sucesso em 11,7 min. Passaram
  `comissoes-flow` (navegador), `commissions-postgres` (17) e
  `pilot-regra-geral-comissoes-check` (2) no db-e2e, os unitários do kit da 16
  (32 + 8) e `portal-instalavel` (3/3). Esse resultado vale para `8e8577d`;
  para o C16 vale a árvore idêntica a `7a0ce84`, coberta pelos runs listados
  abaixo.
- **SHAs operacionais:**

  | Etapa | SHA |
  | --- | --- |
  | kit da 15, API e web do estado 15 | `92cc6ae99856ce43c019f25125bd4140cb916133` |
  | kit da 16, API e web da 16 | C16 `879cef8f378d1007f606ba67246ae7e5535df905` |
  | Portal AC (deploy separado, depois do estado 16 estável) | C_final `8e8577d698fd3d2b9eb2a42b6945fbd3cb3205d2` |

- **Pendente, em casa:** publicação das migrations 15 e 16 conforme a
  sequência abaixo, com backups e comprovantes reais novos (os ensaios não os
  substituem); depois, publicação do C_final e validação do Portal AC no
  iPhone (`continuidade-portal-instalavel.md`).

## Autorização de 09/11/2026: backups reais no PC do trabalho

O dono autorizou, em 09/11/2026, fazer backups reais do piloto **no PC do
trabalho** e restaurá-los **exclusivamente em PostgreSQL descartável local**,
para conferir e ensaiar. Essa decisão substitui a restrição anterior de
backups e restaurações reais só no PC de casa.

- A restauração nunca é feita sobre o piloto, o Neon ou `agenda_dev`.
- Todos os backups existentes em `%USERPROFILE%\AgendaCloud-operacoes` são
  preservados.
- A autorização cobre as fases `conferir`, `preparar` e `restauracao`. Ela
  **não** cobre `aplicar`, a migration 16, deploy nem rollback: cada um
  continua exigindo autorização expressa no momento.
- Os SHAs operacionais acima não mudaram.

**Feito em 09/11/2026, PC do trabalho, kit da 15 em `92cc6ae`** (worktree
`C:\Projetos\Agenda-Cloud-m15-92cc6ae`, `node_modules` próprio, `pg_dump`
17.11). Render conferido antes: API e web Live em `92cc6ae`, não em
`2656f69` como o runbook da 15 supunha. As guardas do kit leem só o banco e
não foram alteradas.

- `conferir`: `before-professional-commissions`, 14 migrations, nenhuma
  sessão da migration ativa.
- `preparar`: backup `comissoes-preparar-2026-11-09T12-45-44-343Z`, 190.069
  bytes, 44 tabelas, servidor 17.11, sha256 `745344f9…a0b0a2`.
- `restauracao` no PostgreSQL 17.11 descartável local:
  `restauracao_e_ensaio_ok` (contagens e md5 iguais; na cópia, só
  ProfessionalCommissions; estado depois conferido; descartável apagado).
- O comprovante é aceito pela regra da fase `aplicar` até
  **10/11/2026 12:46:38 UTC** (24 h do ponto de recuperação). Depois disso,
  repita `preparar` e `restauracao`.
- O backup de 05/11 (`c7ba858`) foi preservado e não vale para este commit.
- **Não executados:** `aplicar`, migration 16, deploy e rollback.

## Migration 15 aplicada no piloto (09/11/2026)

O dono autorizou expressamente, em 09/11/2026, aplicar **somente**
`ProfessionalCommissions1793491200000` no piloto, pelo kit da 15 na worktree
`C:\Projetos\Agenda-Cloud-m15-92cc6ae` (`92cc6ae`). A URL foi digitada pelo
dono no prompt oculto, e a frase também.

- `aplicar` (execução `2026-11-09T12-52-09-593Z`): comprovante de
  `comissoes-preparar-2026-11-09T12-45-44-343Z` aceito dentro da validade; o
  kit fez o backup novo obrigatório `comissoes-aplicar-2026-11-09T12-52-09-593Z`
  (190.069 bytes, sha256 `9cb36603…6bd9`). Migration aplicada às
  12:53:23 UTC. `DESFECHO: aplicada_e_conferida`, código 0: 15 migrations,
  `15/15`, baseline sem falhas (relatado pelo dono a partir da janela).
- `conferir` (execução `2026-11-09T12-54-54-792Z`, concluída 12:55:33 UTC):
  `after-professional-commissions`, nenhuma sessão da migration ativa
  (registro em `operacoes.jsonl`).
- Render, só leitura, depois da `conferir`: API e web continuam Live em
  `92cc6ae` (deploys de 05/11). Sem deploy nesta etapa.
- **Estado atual: ponto de parada estável do estado 15** com API e web
  `92cc6ae`. As comissões por serviço voltam a apurar.
- **Não executados:** migration 16, deploy e rollback. Todos os backups foram
  preservados.

**Próxima etapa: kit da 16 no C16 `879cef8`**, em outra sessão, com janela de
transição combinada com os donos (ver "Janela de transição" em
`publicacao-regra-geral-comissoes-piloto.md`):

1. Worktree limpa no C16 com `npm ci` próprio em `backend` (nunca junção).
   `git diff e42fb81 879cef8 -- backend/scripts backend/src` foi conferido
   vazio em 09/11/2026.
2. `conferir` do kit da 16. Esperado: `before-commission-settings`,
   `MIGRATIONS_APPLIED: 15`, `SCHEMA_OBJECTS_OK: 0/7`, nenhuma sessão ativa.
3. Consulta de impacto (só leitura, com autorização) e combinação da janela.
4. `preparar` e `restauracao` (backup novo; o comprovante vale 24 h).
5. `aplicar` da 16 (autorização expressa), API C16, web C16 e `conferir` com
   `JANELA_DE_TRANSICAO: ok`.

O runbook da 16 ainda diz "backups e restaurações reais só no computador de
casa". A autorização de 09/11/2026 acima substitui essa restrição.

## Migration 16 preparada no piloto (09/11/2026)

O dono confirmou a conferência independente da 15 (`after-professional-commissions`,
15 migrations, `15/15`, `BASELINE_FAILURES: none`) e autorizou a preparação da
16 neste PC: conferir, backup novo e restauração no PostgreSQL descartável
local. O comprovante da 15 não foi reutilizado.

- Worktree limpa `C:\Projetos\Agenda-Cloud-m16-879cef8`, destacada em
  `879cef8f378d1007f606ba67246ae7e5535df905`, com `npm ci` próprio em
  `backend`. `backend/package-lock.json` igual ao de `92cc6ae`. PostgreSQL
  17.11 em `C:\Projetos\pg17x\pgsql\bin`.
- `conferir` (execução `2026-11-09T12-59-36-743Z`):
  `before-commission-settings`, nenhuma sessão da migration ativa, janela ok.
- `preparar` (execução `2026-11-09T13-00-39-755Z`): `backup_feito`, pasta
  `regra-geral-comissoes-preparar-2026-11-09T13-00-39-755Z`, 192.088 bytes,
  sha256 `8037285d…9466`. Ponto de recuperação 13:01:21 UTC.
- `restauracao` (concluída 13:02:12 UTC, PostgreSQL 17.11 local):
  `restauracao_e_ensaio_ok`, 44 tabelas, contagens e md5 iguais, migration
  ensaiada na cópia com estado depois `after-commission-settings`.
- **Validade do comprovante:** 24 h a partir do ponto de recuperação, ou seja,
  até **10/11/2026 13:01 UTC (10:01 em Brasília)**. Depois disso, repetir
  `preparar` e `restauracao`.
- **Não executados:** consulta de impacto, `aplicar` da 16, suspensão de
  serviço e deploy. Todos os backups anteriores foram preservados.

**Falta, nesta ordem:** consulta de impacto e janela combinada com todos os
donos; `aplicar` (autorização expressa; a janela começa em `JANELA_DESDE`);
API C16; web C16; `conferir` com `JANELA_DE_TRANSICAO: ok`; avisar os donos.

## Migration 16 aplicada, API e web C16 publicados (09/11/2026)

O dono autorizou expressamente, em 09/11/2026, aplicar **somente**
`ProfessionalCommissionSettings1793577600000` pelo kit da 16 na worktree
`C:\Projetos\Agenda-Cloud-m16-879cef8` (C16), publicar a API e depois o web
no C16 e rodar a `conferir` final. A URL e a frase foram digitadas pelo dono.

- **Janela combinada:** todos os estabelecimentos do piloto são testes do
  dono; não há clientes. O dono manteve, durante toda a transição, a pausa de
  cadastro de profissionais e de conclusão de atendimentos. A consulta de
  impacto **não** foi rodada. Nenhum serviço foi suspenso no Render.
- **Antes do `aplicar`:** worktree limpa em `879cef8`,
  `git diff e42fb81 879cef8 -- backend/scripts backend/src` vazio; Render com
  API e web Live em `92cc6ae`; comprovante
  `regra-geral-comissoes-preparar-2026-11-09T13-00-39-755Z` dentro da validade
  (até 10/11/2026 13:01 UTC).
- **`aplicar`** (execução `2026-11-09T13-09-24-558Z`): backup novo obrigatório
  `regra-geral-comissoes-aplicar-2026-11-09T13-09-24-558Z` (192.088 bytes,
  sha256 `26042d11…0242`). `JANELA_DESDE` = `2026-11-09T13:10:09.918993Z`.
  Migration aplicada às 13:10:24 UTC; registro `aplicada_e_conferida`
  (13:10:42 UTC), que o kit só grava com o estado
  `after-commission-settings` conferido (16 migrations, `7/7`) e
  `TRANSICAO: ok`.
- **API C16:** `agenda-cloud-piloto-api`, deploy `dep-dboscs6417fc7398vef0`
  (Render CLI, commit específico), Live às 13:12:07 UTC, SHA
  `879cef8f378d1007f606ba67246ae7e5535df905`. `auth/me` sem cookie: 401 pelo
  web e direto na API.
- **Web C16:** `agenda-cloud-piloto-web`, deploy `dep-dbosds6c6qcc738k3llg`,
  Live às 13:16:04 UTC, mesmo SHA. `/login` 200; `/agenda_api/auth/me` 401.
- **`conferir`** (execução `2026-11-09T13-16-38-431Z`, concluída 13:17:04 UTC):
  `after-commission-settings`, nenhuma sessão da migration ativa,
  `JANELA_DE_TRANSICAO: ok`. **Fim da janela:** o uso foi liberado ao dono.
- **Estado atual: estado 16 estável**, com API e web em C16 `879cef8`.
- **Não executados:** rollback, suspensão de serviço e testes manuais de tela
  (ficam com o dono, sem gravar configuração ou regra só para testar). Todos os
  backups foram preservados.
- **Próximo passo, em outra sessão e com autorização:** publicar o C_final
  `8e8577d` (Portal AC) e validar no iPhone
  (`continuidade-portal-instalavel.md`). Ainda **não** publicado.

As seções seguintes são o registro de 05/11/2026. Os itens 1 a 3 de "Falta"
já foram feitos; a worktree de revisão do #99 não é mais necessária.

## Último estado relatado do piloto (não reconferido)

Este é o último estado **visto em 05/11/2026**, pelos logs e pelo Render CLI,
durante o diagnóstico da falha em "Comissões de Luiza". **Não é uma
conferência nova:** confira de novo em casa antes de qualquer passo.

- API e web publicados manualmente em `92cc6ae99856ce43c019f25125bd4140cb916133`.
  Auto-Deploy desligado nos dois serviços.
- Banco com **14 migrations**: os objetos da 15 não existiam. Os logs
  mostravam:
  - `column ce.appointment_item_id does not exist` no relatório;
  - `invalid input value for enum audit_action` ao gravar regra (500).
- **Combinação incompatível:** a API `92cc6ae` exige a migration 15. Onde há
  comissões (Max, Básico com exceção ligada), concluir atendimento, o
  relatório e a gravação de regra respondem 500.
- A contenção (voltar web e API para `2656f691bbd43123d49b48e65b8edb08c1061d68`)
  é decisão do dono e **não** foi feita.

## Branches, PRs e commits

| PR | Branch (head) | Base | Estado |
| --- | --- | --- | --- |
| #98 funcionalidade (migration 16 e telas) | `feat/comissoes-recebe-regra-geral` em `0ff8f46f3ad84c848a176d97729585decf1629f1` | `integration/nestjs-typeorm-frontend` em `92cc6ae99856ce43c019f25125bd4140cb916133` | aberto, sem merge, sem auto-merge |
| #99 kit da 16 e runbook | `ops/kit-regra-geral-comissoes` (head: o commit desta nota) | `feat/comissoes-recebe-regra-geral` (**empilhado sobre o #98**) | aberto, sem merge, sem auto-merge |

Commits do #99, em ordem:

| SHA | Conteúdo |
| --- | --- |
| `78d37027baca24b20af05f4ace87df76a27f7a3d` | kit da 16 (lançador, fases, conferência, consultas, testes) |
| `e42fb815e16924161813dead93b0b24f714b3be3` | correção da fixture do db-e2e. **Commit do ensaio do kit da 16** |
| `c8fa3fde586aa39ed1d05bac86cf22c1c423b491` | runbook (só `docs/`) |
| `653b75f5fd7e118ec173a81d53e6bfad592d3752` | runbook: rollback sobre o schema 16 não é recuperação equivalente (só `docs/`) |
| commit desta nota | esta nota (só `docs/`) |

De `e42fb81` em diante só mudou `docs/`. Backend, frontend, scripts e
workflows são idênticos aos ensaiados.

## CI e o que foi testado em cada commit

| Commit | Teste | Resultado |
| --- | --- | --- |
| `0ff8f46` | `test-frontend-auth` (PR #98) | sucesso, run 42070458612 |
| `0ff8f46` | `test-migration-lote6b2` (PR #98) | sucesso |
| `c8fa3fd` | `test-migration-lote6b2` (dispatch) | sucesso, run 42078040203 |
| `c8fa3fd` | `test-frontend-auth` (dispatch) | **cancelado**, run 42078035802. A instalação do Playwright levou 647 s e estourou o limite de 20 min (infraestrutura) |
| `653b75f` | `test-frontend-auth` (dispatch) | sucesso, run 42081376696 |
| commit desta nota | nenhum | só `docs/`; nenhum workflow rodado |
| `92cc6ae` | kit da 15, ensaio 14 → 15 completo | passou |
| `e42fb81` | kit da 16, ensaio 15 → 16 completo e 17 rodadas de recusa e falha | passou |
| `e42fb81` | db-e2e completo local, PostgreSQL 17.11 | 30 arquivos, 283 testes |
| `2656f69`, `92cc6ae`, `0ff8f46` + kit | matriz de compatibilidade por HTTP real nos estados 14, 15 e 16 | ver runbook, "Compatibilidade" |

PR empilhado não dispara os workflows (eles só rodam em PR para a
integração). No #99 foram disparados por `workflow_dispatch`, com bancos
descartáveis e dados fictícios.

## Feito e falta

**Feito:**

- funcionalidade (#98): "Recebe comissão" por profissional e regra geral
  opcional, migration 16;
- kit protegido da 16, consultas só leitura, testes e ensaio completo;
- runbook da sequência 14 → 15 → 16, com janela de transição, compatibilidade
  e recuperação.

**Falta, nesta ordem:**

1. Revisar o #98 e o #99.
2. Mesclar o #98 na integração, com `[skip render]`.
3. Trocar a base do #99 para a integração, se o GitHub não trocar sozinho, e
   mesclá-lo com `[skip render]`. O merge do #99 é o **C16**.
4. Publicar no piloto, em casa, conforme a sequência abaixo.

**Merge não publica:** Auto-Deploy desligado; todo deploy é manual.

## Kits: cada um no seu SHA

| Kit | SHA operacional | Por quê |
| --- | --- | --- |
| da 15 | `92cc6ae99856ce43c019f25125bd4140cb916133` | único commit com o kit da 15 **e exatamente 15 migrations** |
| da 16 | **C16** (merge do #99) | kit ensaiado em `e42fb81`; confira `git diff e42fb81 <C16> -- backend/scripts backend/src` vazio |

- **Nunca execute o kit da 15 a partir de código com 16 migrations.** Ele
  recusa (`ERR_MIGRATIONS_COMPILADAS_INESPERADAS`), mas a regra vale por
  princípio: a 15 roda só na worktree em `92cc6ae`.
- Use uma worktree limpa por kit, com `npm ci` próprio em `backend`. No ensaio,
  `node_modules` foi junção por falta de disco; na operação real, não.
- Se a integração receber outro merge antes do C16 e o diff acima não sair
  vazio, pare e reavalie antes de usar o kit.

## Sequência em casa (resumo dos runbooks)

Cada `aplicar` e cada deploy exige autorização expressa do dono naquele
momento. Qualquer `ERRO:` para a sequência.

1. **Conferir o estado real, só leitura.**
   - Render: SHA Live da API e do web.
   - Fase `conferir` do kit da 15, na worktree em `92cc6ae`. Esperado:
     `before-professional-commissions`, 14 migrations.
   - Se divergir do último estado relatado, pare e reavalie.
2. **Definir os SHAs operacionais:** `92cc6ae` para o kit da 15 e para a API e o
   web do estado 15; C16 para o kit da 16 e para a API e o web finais.
3. **Migration 15** (kit da 15, `92cc6ae`): `conferir` → `preparar` (backup) →
   `restauracao` (restauração conferida, sem conexão com o piloto) → `aplicar`
   → `conferir`. Esperado: `after-professional-commissions`, `15/15`.
   - API e web já estão em `92cc6ae`: sem deploy. Se houve contenção para
     `2656f69`, publique `92cc6ae`, API e depois web.
   - **Ponto de parada estável.** Pode ficar dias aqui.
4. **Migration 16** (kit da 16, C16), em outra sessão, com janela combinada:
   1. `conferir` (`before-commission-settings`).
   2. Consulta de impacto e combinação da janela com os donos.
   3. `preparar` (backup) → `restauracao` (conferida).
   4. `aplicar`; a janela começa aqui (`JANELA_DESDE`).
   5. Deploy da API C16, depois do web C16.
   6. `conferir` com `JANELA_DE_TRANSICAO: ok`; fim da janela.
5. **Publicação sempre migration → API → web.** Voltar é web → API.

**Backups e restaurações reais** ficam na pasta
`%USERPROFILE%\AgendaCloud-operacoes`, fora do repositório. Desde 09/11/2026
podem ser feitos também no PC do trabalho, com restauração só em PostgreSQL
descartável local (ver "Autorização de 09/11/2026").

## Janela de manutenção e limites do rollback

- **Na janela da 16** (da frase do `aplicar` até o web C16 Live e
  `JANELA_DE_TRANSICAO: ok`):
  - ninguém cadastra profissional em **nenhum** estabelecimento;
  - ninguém conclui atendimento nos estabelecimentos **com comissões**.
  - Combine com cada dono antes. **Sem acordo com todos, não comece.**
- **Rollback não é recuperação equivalente:**
  - a API `92cc6ae` sobre o schema 16 **ignora "Recebe comissão" desligado**:
    ensaiado, apurou R$ 15,00 de profissional desligado;
  - a `2656f69` não apura nada, e conclusões feitas nela nunca são apuradas.
- **Se for preciso voltar a API,** combine o mesmo bloqueio de conclusões e
  cadastros enquanto a API anterior estiver no ar. Depois, audite o período
  com a consulta da janela. Ver "Voltar a API com o schema 16" no runbook.
- **Nunca:**
  - `migration:revert`;
  - restaurar backup por cima do piloto;
  - apagar apurações, configurações ou regras.
- **Corrigir para frente** é o caminho preferido.

## Comandos para retomar em casa (sem credenciais, sem operação real)

```powershell
# Buscar as branches
git -C C:\Projetos\Agenda-Cloud fetch origin

# Revisão: worktree do #99 (inclui o #98 por baixo)
git -C C:\Projetos\Agenda-Cloud worktree add C:\Projetos\Agenda-Cloud-revisao-99 origin/ops/kit-regra-geral-comissoes --detach
git -C C:\Projetos\Agenda-Cloud-revisao-99 log --oneline origin/integration/nestjs-typeorm-frontend..HEAD

# Kit da 15: worktree limpa no SHA próprio, com dependências próprias
git -C C:\Projetos\Agenda-Cloud worktree add --detach C:\Projetos\Agenda-Cloud-publicacao-15 92cc6ae99856ce43c019f25125bd4140cb916133
cd C:\Projetos\Agenda-Cloud-publicacao-15\backend
npm ci
```

A worktree do kit da 16 só é criada depois do merge do #99 (C16), como diz o
runbook. Os lançadores pedem a URL do piloto num prompt oculto; ela nunca vai
para arquivo, histórico ou comando.

## Melhoria futura em standby (não implementar agora)

**Chat de ajuda no canto do Agenda-Cloud:**

- inicialmente só para o DONO do estabelecimento;
- apenas explicativo: não executa ações;
- quando não resolver, oferece contato por e-mail ou celular;
- antes de escolher fornecedor, avaliar opção gratuita e limites.

Começa em Planejamento quando for retomado.

## Preferências de trabalho combinadas

- **Regra de negócio vaga:** perguntar antes, com exemplos concretos.
- **Tarefas novas relevantes:** começam em Planejamento e só são implementadas
  depois do alinhamento.
- **Esforço e `/fast`:** sempre informar o esforço recomendado e se `/fast`
  deve ser usado. Normalmente OFF.
- **Comissão fixa:** é por serviço realizado (cada item concluído), não por
  atendimento.
- **Backups:** reais podem ser feitos no PC de casa ou, desde 09/11/2026, no
  PC do trabalho; restauração só em PostgreSQL descartável local.
