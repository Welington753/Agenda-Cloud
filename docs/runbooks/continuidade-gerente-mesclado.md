# Continuidade: PR #77 mesclado, TeamManagerAccess pendente no piloto

## Estado em 28/10/2026

- **Mesclado:** PR #77 (`feat/equipe-login-interno`) em
  `integration/nestjs-typeorm-frontend`, merge normal com `[skip render]`:
  **`7918ccc36f22a37fc2333be9de8b567a69879f00`** (pais `96f5417785a3cfe12c4befba746fec1623713e9d`
  e `a2be6db36c386bc4f56fa1a87a027f147137fbe0`). A árvore do merge é idêntica
  à de `a2be6db`.
- **CI em `a2be6db`:** os dois workflows exigidos passaram (navegador e API,
  inclusive `proxy` e as suítes `gerente`, `equipe` e `acesso-usuario`;
  `migration:show/run`). O merge não disparou deployment.
- **Piloto:** nada executado. Dez migrations (StaffLogin e AppointmentPayments
  já aplicadas: **não repetir**). **TeamManagerAccess1793145600000 continua
  pendente.** API e web do piloto continuam na versão anterior. Auto-Deploy
  não foi alterado nesta tarefa.

## Comprovado (dados fictícios, bancos descartáveis com TLS)

Detalhes em `docs/runbooks/publicacao-gerente-piloto.md` ("Ensaio" e
"Recuperação") e no PR #77.

- **Revisão final:** autorização relida a cada requisição; recorte de contato
  e preço também nas solicitações; suspensão e retirada valem na requisição
  seguinte; gatilho e conferência nos dois caminhos que criam usuário;
  recusas de criação e convite limitadas por IP; criação idempotente sem
  devolver senha no replay; disputa pela última vaga.
- **PostgreSQL 17.11:** ciclo completo do procedimento em `ad8e409` (preparar,
  restauração, aplicar, conferir) e casos de falha em `98c0d96`; o dump do
  `preparar` foi restaurado e migrado com o `pg_restore` 17.11 da imagem oficial
  `postgres:17`, com todas as conferências do procedimento.
- **Lançador:** aberto no Windows Terminal em modo ENSAIO; URL sem eco, IDs
  não exibidos, execução registrada, janela aberta no fim e ambiente limpo;
  recusas de parâmetros antes de rodar.
- **Recuperação** (versão publicada `96f5417`): voltar só o web não revoga
  permissões e não dá ao dono como suspender gerente; voltar a API deixa
  gerentes sem área, logins com `@` sem entrar e **deixa de contar gerentes nas
  vagas**. Web novo com API antiga não validado.

## Pendências operacionais (antes ou durante a publicação)

1. **Restauração com binários 17:** `conferir-restauracao-gerente.mjs` só
   chama binários Windows e rodou aqui com os do 18.6. Com binários 17 ele
   roda pela primeira vez na operação real (`-PgBin` do PC do operador). Se
   falhar, nada foi gravado no piloto: corrija e repita a fase.
2. Ler, no `preparar`, a versão do servidor, o levantamento de vagas
   (`PASSAM_ACIMA_DO_LIMITE`, `PASSAM_AO_LIMITE`) e as colisões. Com colisão, a
   decisão de cada caso é humana.
3. Aplicar, conferir, publicar a API e depois o web: só com autorização
   explícita.

## Próximos comandos

A operação usa **uma cópia limpa deste SHA** e comprovantes gerados para ele.
Backups e restaurações de outros commits (inclusive dos ensaios) são
recusados pelo procedimento.

```powershell
git -C C:\Projetos\Agenda-Cloud fetch origin
git -C C:\Projetos\Agenda-Cloud worktree add --detach C:\Projetos\Agenda-Cloud-publicacao-gerente 7918ccc36f22a37fc2333be9de8b567a69879f00
cd C:\Projetos\Agenda-Cloud-publicacao-gerente\backend
npm ci

# 1. preparar (só leitura no piloto)
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File C:\Projetos\Agenda-Cloud-publicacao-gerente\backend\scripts\abrir-gerente-piloto.ps1 -Fase preparar -PilotEndpointId <ep-piloto> -ProductionEndpointId <ep-proibido> -PgBin <bin do PostgreSQL 17 ou maior>

# 2. restauracao (sem conexão com o piloto)
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File C:\Projetos\Agenda-Cloud-publicacao-gerente\backend\scripts\abrir-gerente-piloto.ps1 -Fase restauracao -PgBin <mesmo bin>

# 3. aplicar e 4. conferir: só com autorização, conforme o runbook
```

Depois: deploy da API e depois do web, ambos em
`7918ccc36f22a37fc2333be9de8b567a69879f00` (Manual Deploy → Deploy a specific
commit), seguindo `publicacao-gerente-piloto.md`.

## Ambiente local desta tarefa

- O `CLAUDE.md` do clone tem alteração do usuário fora do Git: preservado.
- PR #74, stashes e worktrees existentes: preservados.
- Contêineres e worktrees temporários do ensaio: removidos. O PostgreSQL 18
  descartável da pasta de rascunho da sessão pode ser apagado.
