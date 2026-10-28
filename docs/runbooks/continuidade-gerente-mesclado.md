# Continuidade: TeamManagerAccess aplicada no piloto, deploy pendente

## Estado em 28/10/2026 (18:06 UTC)

- **Mesclado:** PR #77 (`feat/equipe-login-interno`) em
  `integration/nestjs-typeorm-frontend`, merge normal com `[skip render]`:
  **`7918ccc36f22a37fc2333be9de8b567a69879f00`** (árvore idêntica à de
  `a2be6db`, cujos dois workflows exigidos passaram).
- **Piloto: `TeamManagerAccess1793145600000` APLICADA e conferida.** **Não a
  repita**, nem StaffLogin ou AppointmentPayments. O piloto tem agora 11
  migrations. Não use `migration:revert` (ver "Recuperação" em
  `publicacao-gerente-piloto.md`).
- **API e web do piloto continuam na versão anterior.** Nenhum deploy foi
  feito; Render e Auto-Deploy não foram tocados; nenhum e-mail enviado.

## Execução no piloto (28/10/2026)

Todas as fases pelo lançador oficial `abrir-gerente-piloto.ps1`, no Windows
Terminal, modo PILOTO, a partir da cópia limpa
`C:\Projetos\Agenda-Cloud-publicacao-gerente` (worktree destacada em
`7918ccc…`, `node_modules` próprio por `npm ci`, sem alterações locais antes de
cada fase). `-PgBin C:\Program Files\PostgreSQL\18\bin`: **`pg_dump`,
`pg_restore`, `initdb` e `pg_ctl` 18.6 para Windows**. Servidor do piloto:
**PostgreSQL 17.11 (11592b3)**, TLSv1.3. O operador colou a URL direta na
entrada oculta e digitou a frase; os Endpoint IDs não foram exibidos.

Pastas em `%USERPROFILE%\AgendaCloud-operacoes` (preservar):

| Fase | Pasta / registro | Resultado |
| --- | --- | --- |
| `preparar` (17:54Z) | `gerente-preparar-2026-10-28T17-54-17-824Z` | `before-team-manager`, 10 migrations, `RESULT: SUCCESS`; dump 158818 bytes, 40 tabelas, sha256 `da783579233d91abfacf01724037d8d4e3804bf55b3a5322ed8de1d1edd2aba8` |
| `restauracao` (17:57Z) | `restauracao-conferida.json` na mesma pasta | `restauracao_e_ensaio_ok` com binários 18.6; 40 tabelas com contagens e md5 iguais; migration ensaiada na cópia; 3 vínculos, 0 gerentes ativos, 0 acima do limite, 0 passam acima |
| `aplicar` (18:01Z) | `gerente-aplicar-2026-10-28T18-01-09-135Z` | backup novo 158818 bytes, sha256 `0ce63eab570df4ca08acb19f0c064a51b45442ae14ab64e6d31b00c4ce886e2d`; migration às 18:02:56.072Z; registro `aplicada_e_conferida` |
| `conferir` (18:05Z) | `operacoes.jsonl` | `estado: after`, `sessoesDaMigration: 0` |

**Conferido nos arquivos** (pelo agente, sem ler a janela): manifestos
(modo piloto, commit, endpoint igual nas fases, estado anterior, servidor),
SHA256 recalculado dos dois dumps, `restauracao-conferida.json` (inclusive o
sha256 do manifesto), registros de `aplicar` e `conferir` acima.

**Confirmado pela saída da janela** (relatado pelo operador): na
`restauracao`, todas as linhas `ENSAIO_*` verdadeiras, inclusive
`ENSAIO_USERS_IGUAL`, `ENSAIO_NADA_CONFIRMADO_NEM_CONCEDIDO` e
`DESCARTAVEL_APAGADO`, código 0; no `aplicar`, `COMMIT: ok`,
`MIGRATIONS_APPLIED: 11`, `SCHEMA_OBJECTS_OK: 9/9`,
`LOGIN_IDENTIFIER_COLLISIONS: 0`, `RESULT: SUCCESS`,
`CONTAGENS_DESDE_O_BACKUP: iguais`, código 0.

**Limitação mantida:** o script de restauração não rodou com binários
PostgreSQL 17 (só com os 18.6, versão maior que a do servidor, como o runbook
admite). A restauração em 17 pelo Docker, dos ensaios, não comprova o lançador.

## Próximos passos (cada um com autorização explícita)

1. Deploy da API: Render, `agenda-cloud-piloto-api`, Manual Deploy → Deploy a
   specific commit → `7918ccc36f22a37fc2333be9de8b567a69879f00`; conferências
   do passo 5 de `publicacao-gerente-piloto.md`.
2. Deploy do web, mesmo SHA; passo 6 do runbook.
3. Limpeza (passo 7): fechar as janelas e remover a worktree
   `C:\Projetos\Agenda-Cloud-publicacao-gerente`; manter a pasta de operações.

Para reconferir o estado a qualquer momento (só leitura), a fase `conferir` do
mesmo lançador. Nunca rode `aplicar` de novo: ela recusa
(`ERR_TEAMMANAGERACCESS_JA_APLICADA`), mas não há motivo para tentar.

## Ambiente local

- O `CLAUDE.md` do clone principal tem alteração do usuário fora do Git:
  preservado.
- PR #74, stashes e worktrees anteriores: preservados.
