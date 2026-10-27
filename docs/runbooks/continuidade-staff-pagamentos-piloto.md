# Continuidade — StaffLogin e AppointmentPayments no piloto

Nota para retomar em qualquer máquina. Atualizada em 27/10/2026.

**Estado:** procedimento e runbook prontos, ensaiados em banco descartável e
com CI verde (PR #74). O PR aguarda revisão e **não deve ser mesclado**
enquanto a origem do deploy inesperado (abaixo) não estiver esclarecida.
Nada foi aplicado, publicado ou alterado no piloto ou no Render nesta rodada.

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

1. Aguardar o usuário esclarecer, no painel do Render, o commit Live e a
   origem do deploy de 18:19 UTC.
2. Só então: revisão e merge normal do PR na integration, e o runbook no
   SHA do merge.

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
