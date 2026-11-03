# Continuidade: portal da plataforma (#84), vários serviços (#85) e kit de publicação (#86)

Checkpoint de 2026-11-03 (PC do trabalho), depois dos merges de #84 e #85 e
da abertura do PR do kit protegido. **Nada foi publicado nem aplicado em banco
real.** Nenhuma conexão com o piloto, nenhuma mensagem enviada, nada alterado
no Render, nenhum papel real alterado. Os preços continuam sem aprovação.

## 1. Estado de produção e do piloto (não mudou)

- API e web publicados em `99242a662cfa2a8bb3b144b62c2fe5fe000ee222`
  (registrado; confira o Live no painel do Render antes de publicar).
- Piloto com **12 migrations**, até `CommercialAccess1793232000000`, aplicada
  e conferida. Não repetir nem reverter nenhuma.
- Já existem registros comerciais posteriores à aplicação (um teste até
  06/12/2026, um estabelecimento no Max). Não assumir zero períodos.
- Backup automático continua desativado.

## 2. Merges feitos nesta rodada (autorizados)

| PR | Head mesclado | Merge na integration | Checks no head |
| --- | --- | --- | --- |
| [#84](https://github.com/Welington753/Agenda-Cloud/pull/84) | `58200949f7a3718d116617691b92570d58a48794` | `b0003b77d63c6d04d6e777b1ddd205db20cfe96f` | os dois exigidos verdes; web 883, backend 1.659, e2e 137, db-e2e **235/235** |
| [#85](https://github.com/Welington753/Agenda-Cloud/pull/85) | `96b48ad22bb9e1d50fd3ce60edb5a128fd2a5d0b` | `96415bc4919b712df5fda3b2d4af37de1a934195` | os dois exigidos verdes; web 891, backend 1.665, e2e 137, db-e2e **243/243**, migration e2e 7/7 (14 migrations) |

Merge normal, condicionado ao head exato, com `[skip render]`; sem squash,
rebase, bypass ou force push. Integration atual:
`96415bc4919b712df5fda3b2d4af37de1a934195`.

- **#84, cobertura fechada antes do merge** (`5820094`): caso db-e2e novo em
  `platform-portal-postgres.db-e2e-spec.ts`. `MASTER_ADMIN` e
  `MASTER_SUPPORT` com **todas** as permissões, sessão ativa e senha
  confirmada recebem 403 em **toda** rota registrada sob `/platform` (a lista
  é conferida contra o roteador do Express: rota nova sem caso faz o teste
  falhar), com corpo válido e alvos reais. Banco inteiro igual depois
  (contas, papéis, vínculos, convites, estabelecimentos, períodos, preços,
  sem vencimento, auditoria). `/platform/reauth` continua compartilhada: só
  marca a própria sessão e não libera nada. Liberar `MASTER_ADMIN` em
  `platformCapabilities` faz o caso falhar (conferido). Era lacuna de
  cobertura; nenhum defeito de autorização encontrado.
- **#85, integração:** merge normal da integration na branch. Só os dois
  conflitos ensaiados (listas de migrations em
  `lote6b2-migration.migration-e2e-spec.ts` e
  `migrations-runtime-compiled.spec.ts`), resolvidos mantendo as duas, na
  ordem `CommercialAccess`, `PlatformPortal`, `AppointmentServiceSnapshots`;
  contagem 14 e asserção nova da ordem das três últimas. Diff contra a
  integration: os mesmos 43 arquivos de antes, +6 linhas. Local: db-e2e
  completo 243/243 em banco novo com as 14.

PR #74 continua aberto e intocado.

## 3. Kit de publicação — PR #86, aberto, sem merge

[#86](https://github.com/Welington753/Agenda-Cloud/pull/86), branch
`chore/kit-publicacao-portal-multisservicos`, head
`52524eec6273a8427c13509b3b64b955513dc0bd`, base integration em `96415bc`.
Runbook: `docs/runbooks/publicacao-portal-multisservicos-piloto.md`.

CI no head `52524ee`: os três checks verdes (seção 7).

Desenho: duas **etapas**, uma migration cada, cada uma com preparar, backup,
restauração conferida e aplicar:

| Etapa | De | Para |
| --- | --- | --- |
| `portal` | `before-platform-portal` (12) | `after-platform-portal` (13, intermediário) |
| `multisservicos` | `after-platform-portal` (13) | `after-appointment-snapshots` (14, final) |

- Nenhuma migration é repetida: cada etapa só aceita o seu "antes". `conferir`
  identifica o estado; uma execução incerta de qualquer etapa bloqueia as duas.
- Levantamento só de leitura e só ids (registros comerciais, reservas,
  recebimentos, contas com papel global). Identidades: consulta separada
  `consultas/contas-com-papel-global-somente-leitura.sql`, com nome e e-mail,
  **só com autorização**. A etapa do portal para sem `MASTER_OWNER` ativo.
  Nada altera papel.
- Defeito achado pelo próprio ensaio e corrigido (`e0bdb77`): no commit
  operacional as duas migrations estão compiladas, e a etapa 1 aplicaria as
  duas. `aplicarSomenteAPendente`/`conferirPendentes` ganharam a lista
  opcional de migrations posteriores (conferidas pelo nome e retiradas antes
  de rodar); sem ela, os kits anteriores não mudam.

Ensaio (PostgreSQL **17.11**, TLS com CA descartável, dono não superusuário,
dados fictícios com períodos comerciais existentes e reservas antigas), kit em
`e0bdb77`: as duas etapas completas, restauração da etapa 1 pelo lançador
oficial, lock (`55P03`), frase errada, quedas antes e depois do COMMIT,
repetição recusada, etapa fora de ordem, backup de outro commit, proteções do
modo piloto, nenhuma senha nas saídas. Detalhes e limitações no runbook.

Compatibilidade (ensaiada, detalhes no runbook):
- **Estado 12:** a API nova não sobe utilizável (login 500).
- **Estado 13:** a API anterior funciona inteira; a API nova quebra a agenda.
- **Estado 14:** as duas sobem.
- **Web anterior × API nova:** funciona, menos a ficha de estabelecimento com
  "sem vencimento". É a janela entre os dois deploys e a alternativa "voltar
  só o web".
- **Web nova × API anterior:** não cria reserva. Não usar.
- **API anterior depois de usar a nova:** ignora "sem vencimento", mostra só o
  1º serviço da reserva múltipla e devolve o portal a
  `MASTER_ADMIN`/`MASTER_SUPPORT`. Não apaga dados, mas **não é recuperação
  segura**.
- **`down`:** apaga preços, contratos, "sem vencimento", origem do valor e
  nomes congelados. **Não é retorno padrão.**

Comprovantes do ensaio **não valem** para a operação real (modo e commit
diferentes; o kit recusa).

## 4. Ordem exata da futura publicação

Só com autorização expressa, no SHA operacional definitivo (o merge do #86 na
integration ou posterior, o mesmo em tudo):

1. Worktree limpa do SHA, `npm ci` no backend.
2. `conferir`: `ESTADO: before-platform-portal`.
3. Etapa `portal`: `preparar` → `restauracao` → `aplicar`
   (`APLICAR PlatformPortal1793318400000`) → `after-platform-portal`. A API e o
   web anteriores seguem no ar.
4. Etapa `multisservicos`: `preparar` → `restauracao` → `aplicar`
   (`APLICAR AppointmentServiceSnapshots1793404800000`) →
   `after-appointment-snapshots`.
5. `conferir`: estado final.
6. API no Render (Deploy a specific commit), conferências do runbook.
7. Web no Render, mesmo SHA, testes manuais do runbook.

Antes do passo 1:
- conferência das identidades dos proprietários (abaixo);
- preços aprovados ou não (nada no kit grava preço).

## 5. Pendências

1. **Conferência das identidades dos proprietários:** pendente. Leitura
   autorizada pela consulta com identificação; não presumir quais são as
   contas; nenhum papel alterado.
2. **Preços:** sem aprovação; cadastrar só preço aprovado, depois da
   publicação.
3. **Backup real e restauração operacional:** no SHA operacional, na operação
   autorizada.
4. **Revisão e merge do #86:** não mesclado nesta rodada.
5. Observações sem defeito: convite de plataforma pendente com papel delegado,
   se aceito, grava papel sem efeito; a reescrita do `administracao-flow.spec.ts`
   deixou de conferir a barra do celular no caso "sem estabelecimento".

## 6. O que fica só no PC do trabalho

Nada de código fora do GitHub. Ficam localmente, descartáveis:
- worktrees `C:\Projetos\Agenda-Cloud-pr84` (merge feito; `backend/node_modules`
  removido por falta de espaço), `C:\Projetos\Agenda-Cloud-pr85` (agora na
  branch do kit, com dependências), `C:\Projetos\Agenda-Cloud-continuidade-pm`,
  `C:\Projetos\Agenda-Cloud-combo` (ensaio antigo de merge, superado;
  `backend/node_modules` removido) e
  `C:\Projetos\Agenda-Cloud-anterior-99242a6` (versão publicada, só para o
  ensaio de compatibilidade);
- no scratchpad da sessão: PostgreSQL 18 (porta 55434) e PostgreSQL 17.11
  (porta 55435, bancos do ensaio, pasta de operações do ensaio), harnesses e
  saídas do ensaio. Nada disso é backup do piloto.

**Disco C: quase cheio** (cerca de 1 GB livre nesta sessão; chegou a 0 durante
a extração do PostgreSQL 17, corrigido apagando só o que a sessão extraiu).
Antes de outro `npm ci` ou ensaio grande, liberar espaço.

No repositório principal deste PC continuam, intocados: `CLAUDE.md`
modificado, branch `feat/senha-dono-calendario-profissional` e as demais
worktrees. Este PC não tem stash (o `stash@{0}` é do PC de casa).

## 7. Testes desta rodada

- #84 (`5820094`): caso novo 3× local (7/7 no arquivo); `tsc`, `oxlint`; CI
  verde.
- Merge do #85 (`96b48ad`): backend `tsc`, `oxlint`, 1.665 unitários; web
  891 unitários, lint sem erro; db-e2e completo 243/243 local; CI verde.
- Kit (`52524ee`; `backend/scripts` e `backend/src` iguais a `e0bdb77`, o
  commit ensaiado): `tsc`, `oxlint`, 1.704 unitários; db-e2e da conferência
  2/2 (e o comercial 2/2); ensaio da seção 3.
- CI do #86:
  - primeira rodada em `4d6e02a`: falhou no teste novo (2ª rodada do
    db-e2e, com mais de 50 contas globais criadas pelas suítes de navegador,
    e a listagem corta em 50 por desenho). Teste corrigido em `b6a7ddc`; o
    kit não mudou. O check de backup falhou por infraestrutura (sem acesso a
    `www.postgresql.org`) e passou na reexecução;
  - em `52524ee`: os três verdes. Auth/serviços com web 891, backend 1.704,
    e2e 137 e db-e2e 245/245 nas duas rodadas; migration show/run 520 + 7;
    backup 17/17.
