# Continuidade — StaffLogin e AppointmentPayments no piloto

Nota para retomar em qualquer máquina. Atualizada em 27/10/2026.

**Estado:** `StaffLogin1792972800000` e `AppointmentPayments1793059200000`
**aplicadas no piloto** em 27/10/2026 (COMMIT às 22:41:52.966Z) pelo
procedimento do PR #74, no commit `9e6dd53b8ec3deceef7d3616209dcd020a55fab9`.
**Nunca rode `aplicar` deste lote de novo** (o script para em
`ERR_LOTE_JA_APLICADO`). API e web estavam Live em `0f7bfd3` antes e depois;
nenhum deploy, merge ou rollback foi feito nesta rodada. O login foi
confirmado pelo usuário depois da aplicação. Detalhes em "Aplicação no
piloto (27/10/2026)".

## Onde está

- Branch operacional: `chore/publicacao-staff-pagamentos-piloto`, criada de
  `integration/nestjs-typeorm-frontend` em
  `0f7bfd30a7b9962dac9aba3a24af2aeda8604f0d`. O SHA completo do último
  commit está no PR e em `git log -1 origin/chore/publicacao-staff-pagamentos-piloto`.
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
- Procedimento e publicação: `docs/runbooks/publicacao-acesso-recebimentos-piloto.md`.
- Regras dos lotes: `docs/plans/operacao-diaria-configuracoes.md`.

## Aplicação no piloto (27/10/2026)

Separado por tipo de evidência.

- **Painel do Render (capturas do usuário):** `agenda-cloud-piloto-api` e
  `agenda-cloud-piloto-web` Live em
  `0f7bfd30a7b9962dac9aba3a24af2aeda8604f0d`. O login mostrava "O servidor
  não respondeu a tempo".
- **HTTP público às 22:31 UTC (só GET):** API `GET /` 200 em 0,46 s; web
  `/agenda_api/auth/me` sem cookie 401 JSON em 0,27 s; web `/` 200.
- **Leitura do código do web:** essa mensagem só aparece quando a leitura de
  sessão termina em `network-error` (falha do `fetch`, 502/504 do proxy com o
  marcador de API indisponível, inclusive o limite de 90 s, ou HTML/502–504
  sem JSON da hospedagem). Um 500 JSON da API mostraria outra mensagem. A
  causa do sintoma **não foi comprovada**: nem hibernação, nem a falta das
  migrations. Não houve leitura de logs do Render.
- **Conferências de código:** nada em `backend/` mudou entre `095b2e6` (CI
  verde) e `9e6dd53`; fora de `backend/scripts`, `backend/test` e `docs`, o
  diff entre `0f7bfd3` e `9e6dd53` é vazio (migrations iguais às da versão
  Live).
- **Cópia operacional:** worktree `C:\Projetos\Agenda-Cloud-publicacao-ar`,
  destacada em `9e6dd53`, `node_modules` próprio (`npm ci`), `-PgBin` do
  PostgreSQL 17 (servidor do piloto: 17.11). Mantida sem alteração em todas
  as fases.
- **`conferir` antes:** `ESTADO: before`, 8 migrations, 0/28, nenhuma sessão
  de migration ativa.
- **`preparar`:** `before-staff-payments` SUCCESS; backup
  `acesso-recebimentos-preparar-2026-10-27T22-35-28-162Z`, 145929 bytes, 38
  tabelas, sha256 `eec5232340bd0d24c578d3ecc970f9b7d6f9a64fdf60abbd2bcfdfd05c23763d`;
  manifesto com modo piloto, endpoint do piloto e o commit acima.
- **`restauracao`:** PostgreSQL 17.11 descartável com TLS verificado;
  sha256 confere; 38 tabelas e 243 linhas com contagens e md5 iguais;
  `ENSAIO_BEFORE` ok (3 contas, 15 atendimentos, 17 sessões abertas); as duas
  migrations numa transação; `ENSAIO_AFTER` ok; dados e colunas antigas de
  `users` preservados; dados e tabelas novos vazios; levantamento igual;
  histórico +2; descartável apagado.
- **`aplicar`** (execução `2026-10-27T22-40-32-410Z`): backup novo
  `acesso-recebimentos-aplicar-2026-10-27T22-40-32-410Z`, 145929 bytes,
  sha256 `a74be77baf663a67ce4141078277f07e0e52e2edf8e0c6a6cf709ab4d9703cb8`;
  frase digitada pelo usuário; COMMIT às 22:41:52.966Z; `after-staff-payments`
  SUCCESS (10 migrations, 28/28, `BASELINE_FAILURES: none`); contagens iguais
  ao backup; código 0. `operacoes.jsonl`: `migration_iniciada`, `aplicada`,
  `aplicada_e_conferida` (22:42:03.715Z), sem execução pendente.
- **`conferir` depois:** `ESTADO: after`, 10 migrations, 28/28, nenhuma
  sessão de migration ativa.
- **Login:** o usuário confirmou que entrou no sistema depois da aplicação.
- Backups e registros ficam em `%USERPROFILE%\AgendaCloud-operacoes`, fora do
  Git, neste PC.

## Situação anterior do deploy (histórico)

Separado por tipo de evidência:

- **Relato do usuário:** Auto-Deploy Off nos serviços
  `agenda-cloud-piloto-api` e `agenda-cloud-piloto-web`. `render.yaml` também
  declara `autoDeployTrigger: "off"`.
- **Registro do GitHub (deployments):** API e web do piloto com deployment de
  `824463c` em 27/10/2026, 18:19:50–18:21:53 UTC, status `success`. O merge
  de #72 foi às 18:14:50 UTC, com `[skip render]` no título. A origem do
  deploy é desconhecida e contradiz o relato de Auto-Deploy Off.
- **Última referência do schema do piloto (não reinspecionada):** oito
  migrations, até `TeamAccess1792886400000`.
- **Ensaio:** `824463c` com oito migrations: `GET /` 200, login de dono 500.
  Com dez migrations: login 200. `c77c313` funciona com oito, nove e dez.
- **Não conferido:** o que está Live hoje e se o login do piloto está fora.
  Nenhuma consulta ao piloto foi feita.
- **Sem confirmação** de retorno da API e do web para `c77c313`.

## Arquivos desta branch

| Arquivo | Finalidade |
| --- | --- |
| `docs/runbooks/publicacao-acesso-recebimentos-piloto.md` | runbook: SHA, sequência, saídas esperadas, recuperação, teste manual, ensaio |
| `docs/runbooks/continuidade-staff-pagamentos-piloto.md` | esta nota |
| `docs/runbooks/publicacao-equipe-piloto.md` | aviso de que o lançador exige `-Lote equipe` |
| `backend/scripts/equipe-piloto.mjs` (+ `.d.mts`, spec) | descritores `LOTES` (`equipe`, `acesso-recebimentos`) e `escolherLote` |
| `backend/scripts/aplicar-equipe-piloto.mjs` | fases `preparar`, `aplicar`, `conferir` guiadas pelo lote |
| `backend/scripts/conferir-restauracao-equipe.mjs` | fase `restauracao` guiada pelo lote |
| `backend/scripts/abrir-equipe-piloto.ps1` | lançador com `-Lote` obrigatório |
| `backend/scripts/operacao-piloto.mjs` (+ `.d.mts`, spec) | aplicar uma lista de pendentes numa transação |
| `backend/scripts/lib/publicacao-lote.ts` | contrato comum de um lote |
| `backend/scripts/lib/acesso-recebimentos-schema.ts` (+ spec) | `before/after-staff-payments`, levantamento, dados novos, reversão |
| `backend/scripts/lib/equipe-acessos-schema.ts` | TeamAccess no contrato comum (mesmas consultas) |
| `backend/scripts/lib/pilot-database-check.ts` | expectativas `before-staff-payments` e `after-staff-payments` |
| `backend/scripts/ensaios/sonda-login.mjs` | ensaio local: login de uma API compilada contra um banco descartável |
| `backend/scripts/ensaios/retorno-api-antiga.mjs` | ensaio local: API antiga contra o schema final com dados novos |

## Testes executados

- Unitários dos scripts: 152 (primeira rodada) e 98 nos três arquivos
  afetados depois da correção das tabelas novas; todos passando. `oxlint
  scripts` sem avisos. `tsc -p tsconfig.scripts.json` sem erro.
- Ensaio completo do procedimento em modo ensaio (tabela no runbook), nos
  commits `a7f7d6d` e `a58d600`.
- Retorno para `c77c313` com dados novos (tabela no runbook).
- `pilot-accounts-check.db-e2e-spec.ts` com o lote novo: 5/5 contra o
  PostgreSQL descartável com dez migrations.
- CI do PR #74 em `095b2e6a636184fc82fb93ffcf3f2927e46fcff7`: migration
  workflow verde; frontend verde na segunda tentativa. A primeira parou por
  tempo em `visao-geral-flow.spec.ts:379` (clique em Serviços em
  Configurações), área que este PR não muda; a mesma árvore da app passou em
  `3f46cbf`. Os commits depois de `095b2e6` mudam só esta nota.

Limitações: ver "Limitações" no runbook.

## Onde parou e próximo passo

1. Banco do piloto concluído: não repetir `preparar`, `aplicar` nem
   `restauracao` deste lote.
2. Pendente: a origem do deploy de `824463c` às 18:19 UTC e de quem levou os
   serviços a `0f7bfd3` (Auto-Deploy declarado Off).
3. Pendente: o teste manual completo do runbook (recebimento, estorno,
   acesso por usuário, troca de senha). Só o login de dono foi confirmado.
4. Revisão e merge normal do PR #74 na integration.

## Fora do Git (necessário só neste PC; recriar em outro)

- Cluster PostgreSQL 18 descartável na porta 55433 (bancos `disposable_*`) e
  o cluster do ensaio do procedimento na porta 55440 (`neondb`, CA
  descartável), ambos na pasta temporária da sessão. Senhas e chaves locais
  de descarte, não registradas aqui.
- Harness do terminal e scripts auxiliares do ensaio, na pasta temporária da
  sessão. O harness é recriável pela descrição no runbook (simula `isTTY` e
  entrega uma entrada por leitura).
- Pasta de operações do ensaio (manifestos e dumps fictícios), na pasta
  temporária da sessão.
- Worktrees de ensaio `C:\Projetos\Agenda-Cloud-ensaio` (`c77c313`) e
  `C:\Projetos\Agenda-Cloud-ensaio-pr2` (`824463c`), compilados.
- Em outro PC: nada disso é necessário para operar o piloto; só para repetir
  o ensaio.
