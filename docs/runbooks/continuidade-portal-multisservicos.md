# Continuidade: portal da plataforma (#84), vários serviços (#85) e kit de publicação (#86)

Checkpoint de 2026-11-03 (PC do trabalho), depois dos merges de #84, #85 e
#86 (kit de publicação, revisado na seção 3.1). **Nada foi publicado nem
aplicado em banco real.** Nenhuma conexão com o piloto, nenhuma mensagem
enviada, nada alterado no Render, nenhum papel real alterado. Os preços
continuam sem aprovação.

## 0. SHA operacional da futura publicação

**`8916f180cad7397074e54c25ef237ffc7c797681`**: merge do #86 na integration
(pais `96415bc` e `677b515`). A árvore é idêntica à do head validado
`677b515` (`git diff` vazio, mesma tree). Este é o SHA de toda a operação:
worktree, backups, comprovantes, API e web. Esta nota fica numa branch só de
documentação e **não** muda o SHA operacional.

| PR | Head mesclado | Merge na integration | Validação |
| --- | --- | --- | --- |
| #84 | `58200949f7a3718d116617691b92570d58a48794` | `b0003b77d63c6d04d6e777b1ddd205db20cfe96f` | seção 2 |
| #85 | `96b48ad22bb9e1d50fd3ce60edb5a128fd2a5d0b` | `96415bc4919b712df5fda3b2d4af37de1a934195` | seção 2 |
| #86 | `677b51515778fc00e5e184da64ff010baa227ce5` | `8916f180cad7397074e54c25ef237ffc7c797681` | seções 3, 3.1 e 7; três checks verdes no head |

- Última versão publicada confirmada: `99242a662cfa2a8bb3b144b62c2fe5fe000ee222`.
- Piloto ainda com **12 migrations**; `PlatformPortal1793318400000` e
  `AppointmentServiceSnapshots1793404800000` continuam pendentes.
- Ordem futura: `conferir` → etapa portal completa → etapa multisservicos
  completa → `conferir` do estado final com 14 migrations → API → web
  (detalhes na seção 4).
- Cada etapa exige backup e comprovante próprios, gerados no SHA operacional
  definitivo. Os comprovantes dos ensaios não servem.
- Retorno ao web antigo é parcial; retorno à API antiga e `down` não são
  recuperação padrão.
- Antes do merge: head e base sem avanço, sem conflitos nem pedidos de
  alteração; depois do commit ensaiado `65fa44b` só mudaram o runbook e o
  teste db-e2e da conferência (nenhuma mudança de execução).

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

## 3. Kit de publicação — PR #86, mesclado em `8916f18`

[#86](https://github.com/Welington753/Agenda-Cloud/pull/86), branch
`chore/kit-publicacao-portal-multisservicos`, head
`677b51515778fc00e5e184da64ff010baa227ce5` (depois da revisão, seção 3.1;
antes era `52524ee`), base integration em `96415bc`. Commit do kit ensaiado
pelo lançador: `65fa44b`; depois dele só documentação e um teste db-e2e
(`29bfaf4`). Runbook:
`docs/runbooks/publicacao-portal-multisservicos-piloto.md`.

CI no head `677b515`: os três checks verdes (seção 7).

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
  "sem vencimento" (confirmado no navegador). Serve para a janela entre os
  dois deploys. "Voltar só o web" é recuperação **parcial** (seção 3.1).
- **Web nova × API anterior:** não cria reserva. Não usar.
- **API anterior depois de usar a nova:** ignora "sem vencimento", mostra só o
  1º serviço da reserva múltipla e devolve o portal a
  `MASTER_ADMIN`/`MASTER_SUPPORT`. Não apaga dados, mas **não é recuperação
  segura**.
- **`down`:** apaga preços, contratos, "sem vencimento", origem do valor e
  nomes congelados. **Não é retorno padrão.**

Comprovantes do ensaio **não valem** para a operação real (modo e commit
diferentes; o kit recusa).

### 3.1 Revisão do kit (mesma data, sem merge)

Defeitos comprovados e corrigidos:

- **Listagem de contas** (`03557e7`): com mais de 50 contas globais, a ordem
  alfabética do papel deixava todos os `MASTER_OWNER` fora da listagem.
  Agora os proprietários vêm primeiro, e a saída sinaliza o corte
  (`CONTAS_LISTADAS: n de total (LISTAGEM_TRUNCADA ...)`). As contagens e a
  proteção `ERR_SEM_PROPRIETARIO_ATIVO` sempre usaram `count(*)` sem limite
  (agora com teste).
- **Código de saída** (`03557e7`, `65fa44b`): a frase errada saía com 0. Agora
  toda fase imprime `DESFECHO` e sai com:
  - 0: fase concluída;
  - 1: parou sem gravar;
  - 2: aplicada, mas a conferência falhou;
  - 3: incerto.

  Um erro qualquer depois do início da migration nunca vira "nada gravado".
  O lançador explica o código. O código sozinho não prova nada: vale o
  `ESTADO` conferido.

Revisão da seleção das migrations, sem defeito: nome e ordem conferidos, nunca
só a contagem. As exclusões são só as `posteriores` declaradas, conferidas
pelo nome no fim da lista; histórico com migration desconhecida para antes.
Sem o parâmetro, os kits anteriores não mudam. Prova nova: db-e2e
`aplicar-somente-a-pendente`, que aplica as duas etapas de verdade num banco
temporário com o runtime compilado e cobre as recusas. Tirar a retirada das
posteriores faz o teste falhar.

Segunda rodada do ensaio (PostgreSQL 17.11, TLS, dados fictícios com
períodos comerciais e reservas antigas), kit `65fa44b`:

- **Lançador oficial** (num pseudoconsole real, ConPTY, sem harness): as duas
  etapas inteiras, inclusive a **restauração da etapa 2**.
  - Fases: conferir, preparar, restauração, aplicar e conferir.
  - Recusas: frase errada (código 1) e repetição das duas etapas.
- **Harness**: só a queda antes do COMMIT, para provar o código 3; o
  `conferir` depois dela, pelo lançador, deu o estado antes.

Navegador (Chromium, `next start`, API nova, estado final com "sem
vencimento", preço contratado e reserva de dois serviços):

- **Web novo × API nova:** tudo ok, inclusive criar reserva de dois serviços
  pela tela.
- **Web anterior × API nova:** agenda, reserva de um serviço, recebimentos e
  fichas comuns ok. A reserva de dois serviços aparece com o nome combinado e
  o total, sem o detalhe por serviço.
  - A ficha de estabelecimento com "sem vencimento" **não abre**:
    `NO_EXPIRY` é desconhecido para o validador antigo.
  - Para esse estabelecimento ficam sem consulta nem ação: validade,
    situação, plano, dados cadastrais e pessoas.
  - Sem correção que preserve o significado. **Voltar só o web é recuperação
    parcial**; a alternativa é corrigir o web novo para frente.

Binários do 17.11: zip da EDB por HTTPS. O sha256 foi calculado localmente,
sem comparação com checksum do fornecedor. Os executáveis não têm assinatura.

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
5. `conferir`: estado final (`after-appointment-snapshots`, 14 migrations,
   36/36). **Só com as duas etapas concluídas e essa conferência** a
   publicação avança para a API nova.
6. API no Render (Deploy a specific commit), conferências do runbook.
7. Web no Render, mesmo SHA, testes manuais do runbook.

Antes do passo 1:
- conferência das identidades dos proprietários (abaixo);
- preços aprovados ou não (nada no kit grava preço).

## 5. Pendências

1. **Conferência das identidades dos proprietários:** pendente. Leitura
   autorizada pela consulta com identificação; não presumir quais são as
   contas; nenhum papel alterado. Ter um `MASTER_OWNER` ativo (a proteção do
   kit) não substitui essa conferência.
2. **Preços:** sem aprovação; cadastrar só preço aprovado, depois da
   publicação.
3. **Backup real e restauração operacional:** no SHA operacional, na operação
   autorizada.
4. **Merge do #86:** feito com autorização, merge normal condicionado ao head
   `677b515`, `[skip render]`: `8916f180cad7397074e54c25ef237ffc7c797681`.
   Nenhuma operação no piloto nem publicação.
7. **Espaço em disco para a operação:** insuficiente neste PC (seção 6).
5. **Limitações que continuam:**
   - as quedas de conexão foram simuladas no cliente;
   - o lançador rodou num pseudoconsole com entrada digitada pelo driver, não
     por uma pessoa;
   - no navegador só as duas combinações com a API nova; sem gerente,
     profissional, link público e celular;
   - a troca de API e a suspensão no Render não foram ensaiadas;
   - o sha256 do PostgreSQL 17.11 não foi comparado com checksum do
     fornecedor.
6. Observações sem defeito: convite de plataforma pendente com papel delegado,
   se aceito, grava papel sem efeito; a reescrita do `administracao-flow.spec.ts`
   deixou de conferir a barra do celular no caso "sem estabelecimento".

## 6. O que fica só no PC do trabalho

Nada de código fora do GitHub. Ficam localmente, descartáveis:
- worktrees:
  - `C:\Projetos\Agenda-Cloud-pr84`: merge feito; sem `backend/node_modules`
    nem `backend/dist`;
  - `C:\Projetos\Agenda-Cloud-pr85`: na branch do kit, com dependências; sem
    `.next`;
  - `C:\Projetos\Agenda-Cloud-continuidade-pm`;
  - `C:\Projetos\Agenda-Cloud-combo`: ensaio antigo de merge, superado, com
    conflitos não resolvidos de propósito; sem `backend/node_modules`,
    `dist` nem `dist-migrations`;
  - `C:\Projetos\Agenda-Cloud-anterior-99242a6`: versão publicada, só para os
    ensaios de compatibilidade; sem nenhum `node_modules` nem `.next`. Para
    rodar de novo, `npm ci` nos dois projetos;
- no scratchpad da sessão:
  - PostgreSQL 18 (porta 55434, parado);
  - PostgreSQL 17.11: binários, mais o cluster na porta 55435, parado. O
    cluster guarda os bancos dos ensaios: `neondb_rodada1`, `neondb_rodada2`,
    `neondb` (doze, depois da queda), `base12`, `compat12/13/14`, `revert14`,
    `nav14` e `dbe2e_revisao`;
  - pastas de operações das duas rodadas;
  - harness, driver ConPTY (`pty/`, com `@lydell/node-pty`), roteiro do
    navegador, transcrições `r01`–`r25` e `o01`–`o14`, capturas de tela.

  Nada disso é backup do piloto.

**Disco C: quase cheio.** No início desta revisão estavam livres 762 MB.

| Item | Efeito |
| --- | --- |
| removidos: `backend/node_modules` e `backend/dist` da worktree `-anterior-99242a6`; `dist`/`dist-migrations` de `-combo` e `-pr84` | liberou cerca de 183 MB |
| criados e apagados depois de usados: builds `.next` do web novo e do anterior | 110 MB + 108 MB |
| o `node_modules` da raiz de `-pr85` | foi **movido** (renomeado, mesmo disco) para `-anterior-99242a6` durante o build e o teste do web anterior, e devolvido em seguida |

No fim, ficaram livres cerca de 860 MB. Antes de outro `npm ci`, build do web
ou ensaio grande, confira `df -h /c`. O `.next/cache` do repositório principal
(264 MB) e o cache do npm não são desta tarefa e ficaram intocados.

**Espaço para a operação (estimativa de 2026-11-03, depois do merge do #86).**
Livres em C: cerca de 1,05 GB (`G:` mostra o mesmo espaço; não é disco
separado). Estimativa para a operação no SHA operacional:

| Item | Estimativa |
| --- | --- |
| worktree limpa do SHA (arquivos versionados) | ~10 MB |
| `npm ci` no backend | ~190 MB (+ crescimento do cache do npm, se frio) |
| binários do PostgreSQL 17 para dump/restauração | já presentes no scratchpad; ~0,3 GB se baixados de novo |
| backups (um por etapa) e cópias de conferência | tamanho do banco do piloto, ainda não medido; ensaio: 0,2 MB por dump |
| cluster local da restauração conferida (duas etapas) | ~170 MB no ensaio + o banco restaurado |
| margem para sistema, WAL e logs | ≥ 1 GB |

Total recomendado livre antes de começar: **≥ 2 GB**, mais duas vezes o
tamanho do dump do piloto. Hoje **não há espaço suficiente com margem**: não
instalar dependências nem iniciar restauração neste estado.

Opções viáveis, sem apagar arquivos pessoais, backups ou evidências (decisão
do dono do PC):
- disco externo ou outro PC (o de casa) para a worktree operacional, os
  backups e a restauração;
- apagar itens recriáveis que não são desta tarefa: `.next/cache` do
  repositório principal (264 MB) e o cache do npm (`npm cache clean`);
- apagar `node_modules`/`.next` de worktrees já mescladas (`-pr84`,
  `-combo`, `-anterior-99242a6`), conferindo antes que nenhum processo os usa;
- limpar a Lixeira e arquivos temporários do Windows, se o dono autorizar.

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
- Revisão do kit (seção 3.1):
  - local: backend `tsc`, `oxlint`, **1.714** unitários; db-e2e
    `aplicar-somente-a-pendente` 3/3 e `pilot-portal-multisservicos-check`
    2/2 em PostgreSQL 17.11 com TLS, também com 50 proprietários suspensos a
    mais; mutações conferidas (retirada das posteriores e ordem da listagem);
  - ensaio pelo lançador: 14 transcrições `o01`–`o14`; navegador: as duas
    combinações com a API nova;
  - CI em `506c0f2`: backup e migrations verdes. O check de navegador e API
    falhou só no teste novo da listagem, na 2ª rodada do db-e2e (247/248):
    contava só os proprietários ativos, e as suítes de navegador deixam
    proprietários suspensos. Teste corrigido em `29bfaf4`; o kit não mudou;
  - CI em `677b515`: os três verdes. Web 891, backend 1.714, e2e 137,
    db-e2e **248/248** nas duas rodadas; migration show/run 530 + 7; backup
    verde.
