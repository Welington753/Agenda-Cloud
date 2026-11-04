# Continuidade: portal da plataforma (#84), vários serviços (#85) e kit de publicação (#86)

Checkpoint de 2026-11-03 (PC do trabalho). **Publicação feita** (seção 8):
as duas migrations aplicadas e conferidas no piloto (14 migrations, 36/36) e
API e web Live em `8916f18` segundo as capturas do Render (seção 8.2).
Validação manual pós-publicação sem alterar reserva, configuração comercial,
preço ou papel (seção 8.3). Os preços continuam sem aprovação. As seções 0 a 7
abaixo são o registro de antes da operação e ficam como histórico.

**Atualização de 2026-11-03 (PC de casa):** o lote do portal independente
(#87) foi mesclado na integration em `d2a4479`, **sem publicação**. Esse SHA é
o candidato à próxima publicação; o publicado continua `8916f18` (seção 10).

**Atualização de 2026-11-04 (PC de casa):** a visão geral e a listagem
comercial do portal (#88) foram mescladas em `2656f69`, **sem publicação**,
depois de um ensaio local de compatibilidade. Esse SHA, que já contém o #87,
passa a ser o candidato à próxima publicação; o publicado continua `8916f18`
(seção 11).

**Atualização de 2026-11-04 (PC de casa, depois):** API e web observados Live
em `2656f69` nas capturas do Render fornecidas pelo usuário. Validação
pós-publicação só de leitura, sem defeito encontrado; a recusa de quem não é
proprietário e os pagamentos com dados reais ficam pendentes (seção 12).

**Atualização de 2026-11-04 (PC de casa, depois da publicação):** revisão de
autorização e isolamento no PR #89 (`3fe529f`), só testes e plano, CI verde,
**sem merge**. Nenhum defeito de isolamento no escopo revisado; validação no
piloto com cliente sem papel global pendente (seção 13).

**Atualização de 2026-11-04 (PC do trabalho):** o #89 foi reforçado
(`ed82260`, verificação de contas, credenciais e sessões, CI verde) e
mesclado na integration em `6fac73c`, **sem publicação**. API e web continuam
em `2656f69`; nenhuma migration nova (seção 14).

**Atualização de 2026-11-04 (PC do trabalho, depois):** o #92 (CLAUDE.md e
guardas contra imports da demonstração, só documentação e testes) foi
mesclado na integration em `05dd605`, **sem publicação**. API e web continuam
em `2656f69`; as 14 migrations aplicadas não mudam; #90 e #91 continuam
abertos (seção 16).

**Atualização de 2026-11-04 (PC do trabalho, revisão de #90 e #91):** o #90
(contas só de funcionário fora da lista global do portal) foi corrigido e
mesclado na integration em `c40a91b`, **sem publicação**. O #91 (comissões)
segue aberto, no head `d1e3519`. A publicação dele depende de um kit protegido
para a 15ª migration, que ainda não existe. API e web continuam em `2656f69`;
o banco real continua com 14 migrations (seção 17).

**Atualização de 2026-11-04 (PC do trabalho, merge do #91):** o #91
(comissões) foi mesclado na integration em `9e548a3`, **sem publicação**. A
integration passa a ter 15 migrations; o banco real continua com 14. A
publicação desse SHA fica **bloqueada** até existir e ser ensaiado o kit
protegido da 15ª migration (seções 17.3 e 18).

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

## 1. Estado de produção e do piloto antes da operação (superado pela seção 8)

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

1. **Conferência das identidades dos proprietários:** concluída depois
   (seção 8.5). Registro original: Leitura
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
7. **Espaço em disco para a operação:** ~3,2 GB livres depois da limpeza (seção 6); medir o banco do piloto antes do backup.
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
- worktrees (limpeza autorizada em 2026-11-03, `git worktree remove` sem
  `--force`; removidas `-anterior-99242a6`, `-pr84`, `-ensaio`,
  `-ensaio-pr2`, `-o1`, `-planos`, `-publicacao`, `-publicacao-gerente`,
  todas com o HEAD contido na integration e só arquivos ignorados
  recriáveis; liberaram ~2,2 GB). Ficaram:
  - `C:\Projetos\Agenda-Cloud-pr85`: na branch do kit (`677b515`, mesma
    árvore do SHA operacional), com dependências;
  - `C:\Projetos\Agenda-Cloud-continuidade-pm`: esta nota;
  - `C:\Projetos\Agenda-Cloud-recebimentos` (PR #74) e
    `C:\Projetos\Agenda-Cloud-reserva`: protegidas;
  - `C:\Projetos\Agenda-Cloud-combo`: ensaio antigo de merge, com conflitos
    não resolvidos e HEAD local `5237ecb` fora do remoto; preservada;
  - `C:\Projetos\Agenda-Cloud-promocao`: branch sem PR e fora da
    integration; preservada (só os builds recriáveis foram apagados). O
    `backend/node_modules` dela é junction para o do repositório principal;
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
tamanho do dump do piloto. Depois da limpeza das worktrees ficaram livres
**~3,2 GB**: comporta a operação com a margem, desde que o dump do piloto
fique abaixo de ~0,5 GB. Medir o tamanho do banco antes do backup real.

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

## 8. Publicação no piloto (2026-11-03)

Operação autorizada, toda no SHA operacional
**`8916f180cad7397074e54c25ef237ffc7c797681`** (não mudou). Nenhum
rollback, nenhum `down`, nenhuma outra publicação.

### 8.1 Migrations aplicadas e conferidas

Registro em `%USERPROFILE%\AgendaCloud-operacoes\operacoes.jsonl` (horários
em UTC; endpoint `ep-orange-bread-b7f8iike`, banco `neondb`, modo `piloto`,
commit `8916f18` em todas as linhas):

| Horário | Fase | Resultado |
| --- | --- | --- |
| 18:17 | `conferir` | `before-platform-portal` (12) |
| 18:27 | portal, `preparar` | `backup_feito` |
| 18:30 | portal, `restauracao` | falhou com `ERR_INITDB` (local, antes de qualquer escrita no piloto); repetida em seguida |
| 18:31 | portal, `restauracao` | `restauracao_e_ensaio_ok`: 41 tabelas, contagens e md5 iguais, ensaio da migration ok, 3 estabelecimentos, 1 período, 19 reservas |
| 18:57 | portal, `aplicar` | `PlatformPortal1793318400000` `aplicada_e_conferida` |
| 18:58 | `conferir` | `after-platform-portal` (13), 0 sessões da migration |
| 19:07 | multisservicos, `preparar` | `backup_feito` |
| 19:09 | multisservicos, `restauracao` | `restauracao_e_ensaio_ok`: 44 tabelas, contagens e md5 iguais, ensaio ok, mesmas contagens |
| 19:13 | multisservicos, `aplicar` | `AppointmentServiceSnapshots1793404800000` `aplicada_e_conferida` |
| 19:17 | `conferir` | **`after-appointment-snapshots`**: 14 migrations, 36/36 objetos, 0 sessões da migration |

### 8.2 Versões publicadas

- Duas capturas do painel do Render, fornecidas pelo operador, mostram
  deploys **Live no SHA `8916f18`**. Os recortes não exibem os nomes dos
  serviços, então a associação de cada captura a
  `agenda-cloud-piloto-api` ou `agenda-cloud-piloto-web` não é observação
  direta (nem foi deduzida pelos horários). As capturas não estão no
  repositório.
- Verificações públicas (sem sessão): API `/` 200; web `/login` 200;
  `/agenda_api/auth/me` 401.
- Sinais de que API e web servem código das funcionalidades novas (só GET
  sem sessão). Não comprovam sozinhos o SHA publicado:
  - API: `GET /platform/prices` (rota nova do #84/#85) devolve 401, enquanto
    uma rota inexistente sob `/platform` devolve 404; o mesmo 401 pelo proxy
    do web;
  - web: `/plataforma/planos` (página nova) 200; `/conta/administracao`
    redireciona (307) para `/plataforma/estabelecimentos`.
- Nenhum endpoint expõe o SHA. A evidência do commit são só as capturas
  (Live em `8916f18`).

### 8.3 Validação manual (runbook, passo 8)

Chrome instalado, perfil temporário, controlado por Playwright só para
navegar e ler; o operador digitou as credenciais na própria janela.
Durante a validação nenhuma reserva, configuração comercial, preço ou papel
foi alterado: nenhum formulário salvo, nenhuma suíte executada contra o
piloto. Login e logout envolveram as operações normais de autenticação e
sessão (criação e encerramento de sessões). Histórico administrativo sem
registro novo depois de 02/11/2026.

| Item | Resultado |
| --- | --- |
| Login (`MASTER_OWNER`, que também é dono de um estabelecimento) | **passou**: `POST /auth/login` 200, entrada em `/conta/visao-geral` |
| Navegação | **passou**: visão geral, agenda, clientes, equipe, recebimentos, portal e as abas do portal |
| Logout | **passou**: "Sair" no portal, `POST /auth/logout` 204; depois `auth/me` 401 e `/plataforma` e `/conta/*` levam a `/login?next=...` |
| Portal: lista | **passou**: 3 estabelecimentos, contadores, filtros, preço do catálogo "Não definido" |
| Portal: ficha | **passou**: situação operacional, validade ("ainda não definida" no estabelecimento anterior ao controle), sem vencimento "Não concedido", preço mensal e trimestral **Pendente**, plano e uso, troca de plano, dados cadastrais, pessoas |
| Formulários abertos e cancelados, sem salvar | **passou**: Conceder sem vencimento, Registrar pagamento, Prorrogar teste, Conceder cortesia, Alterar contratado; botões de confirmar desabilitados até preencher; nenhuma chamada de escrita |
| Planos e preços | **passou**: os 3 planos × 2 ciclos "Pendente"; "Nenhum preço foi definido ainda" |
| Pagamentos das assinaturas | **passou**: nenhum registrado |
| Histórico administrativo | **passou**: 26 registros, últimos de 02/11/2026 |
| Recusa a conta sem papel global (URL e API) | **pendente**: não havia conta disponível; nenhuma conta criada ou alterada |
| Agenda (lista, por profissional, calendário mensal) | **passou**; o calendário mensal mostra um bloco de carregamento por alguns segundos antes da grade (lento, sem erro; `appointments/range` 200) |
| Reservas antigas | **passou**: reservas anteriores à migration (ex.: 30/10, 26–28/10, 16/10) abrem com nome do serviço, duração, valor, profissional e situação |
| Clientes | **passou**: 9 clientes |
| Equipe e acessos | **passou**: 1 de 5 acessos, profissionais sem acesso listados |
| Recebimentos | **passou**: período sem recebimentos (R$ 0,00) |
| Link público, dois serviços | **passou**: Barba (30 min, R$ 25,00) + Corte (30 min, R$ 42,50) = "60 min no total · R$ 67,50"; profissionais oferecidos só Ana luiza e Divanei, os únicos que fazem os dois (conferido contra `public/<slug>`); disponibilidade pedida com os dois `serviceIds`; horários listados |
| Link público em celular (390 px) | **passou**: etapas de serviço, dia/horário e dados sem rolagem horizontal |
| Criação real de reserva no piloto | **não testada**: parou na etapa "Seus dados", sem preencher nem enviar |
| Gerente e profissional | **pendente**: sem credenciais nesta validação |

Nenhum erro encontrado. Capturas de tela ficaram só no scratchpad da sessão
(contêm dados pessoais; não vão para o repositório).

### 8.4 Backups preservados

Em `%USERPROFILE%\AgendaCloud-operacoes\`, conferidos pelo sha256 nesta
validação (iguais ao registro):

| Pasta | Bytes | sha256 |
| --- | --- | --- |
| `portal-preparar-2026-11-03T18-26-28-520Z` (+ `restauracao-conferida.json`) | 174.327 | `cb9e0b42797c335a4ad16d29a9b133a449750bfaa45d77e3b037b48a8e16da44` |
| `portal-aplicar-2026-11-03T18-56-44-988Z` | 174.327 | `ceadf0e15593873790f6dc9d88bd130d87575aad0a7c3cb4900ca1edd81323a0` |
| `multisservicos-preparar-2026-11-03T19-05-31-675Z` (+ `restauracao-conferida.json`) | 187.504 | `5a5cc4e70f6e5698c4de0335c02a087129a9ef2ce44aaeccea62ea7ff0615361` |
| `multisservicos-aplicar-2026-11-03T19-12-11-305Z` | 187.504 | `96ffd59f57bb99a6eb1a87ae057309728eff7348e63d0773932c8e5956c7cd24` |

Cada pasta tem `manifesto.json` e `raizes-tls-node.pem`. Manter a pasta de
operações e os backups anteriores. Ficam só neste PC: copiar para outro
lugar é decisão do operador.

**Backup automático do piloto continua desativado.**

### 8.5 Pendências depois da publicação

**Identidades dos proprietários: confirmadas pelo usuário** (2026-11-03): as
três contas `MASTER_OWNER` pertencem aos dois proprietários (duas a um, uma
ao outro). Nomes, e-mails e credenciais não são registrados aqui. Nenhum
papel alterado.

Pendências reais:

1. Validação no piloto com conta de cliente sem papel global (recusa ao
   portal pela URL e pela API): precisa de uma conta existente; não criar
   conta para isso.
2. Acessos de gerente e profissional (runbook, passo 8.4).
3. Criação real de reserva no piloto (só no ensaio local).
4. Aprovação e cadastro dos preços; cadastrar só preço aprovado.
5. Ativação do backup automático do piloto (continua desativado).

Outros registros (não são pendências da publicação):

- cópia dos backups fora deste PC: decisão do operador;
- limpeza do runbook (passo 9): a worktree `C:\Projetos\Agenda-Cloud-pr85`
  (HEAD destacado em `8916f18`) fica até decisão do operador; a pasta de
  operações fica.

Preservados: `CLAUDE.md` modificado no repositório principal, PR #74,
worktree `-reserva` e o trabalho local de `-combo`. Nenhum merge desta
documentação.

## 9. Próximo lote (novo pedido, ainda NÃO implementado)

> Registro original do pedido, mantido como histórico. Ele foi implementado
> no PR #87 e mesclado sem publicação; o estado atual está na seção 10.

**Já publicado (não repetir):** SHA operacional
`8916f180cad7397074e54c25ef237ffc7c797681`, API e web; as 14 migrations
aplicadas e conferidas. Não repetir migrations nem deploys.

**Novo pedido (2026-11-03), só registrado:** separar completamente o portal
da plataforma da operação dos estabelecimentos. Requisitos e testes em
`docs/plans/portal-independente-da-operacao.md`. Resumo:

- `/conta` só com funções operacionais; sem grupo "PLATAFORMA" nem atalho
  "Portal da plataforma", inclusive para proprietários (desktop, celular,
  menu de perfil);
- portal com endereço próprio (preferência `/portal`), entrada, layout e
  navegação independentes, sem exigir vínculo com estabelecimento nem
  depender de plano ou validade;
- só `MASTER_OWNER` ativo, recusa no servidor para todos os demais (inclusive
  Max), sem regra por nome, e-mail ou plano;
- preservar as três contas proprietárias, a proteção do último proprietário
  e a reautenticação das ações de equipe e recebimentos (`/platform/reauth`).

Nenhuma implementação, merge, deploy, consulta ao banco real ou alteração de
contas nesta rodada. A implementação parte da integration conferida
(`8916f18` em 2026-11-03), em branch própria.

### Para retomar em outro PC

- Este PC guarda só: pasta de operações com os backups e `operacoes.jsonl`
  (`%USERPROFILE%\AgendaCloud-operacoes`), capturas da validação no
  scratchpad da sessão (dados pessoais), worktrees locais (`-pr85`,
  `-combo` com conflitos, `-promocao` com junction, `-recebimentos`,
  `-reserva`) e o `CLAUDE.md` modificado no repositório principal.
- Nenhum processo temporário desta tarefa ficou ativo.

## 10. Portal independente (#87): mesclado, NÃO publicado

> Candidato superado: `2656f69` (seção 11) contém este merge e é o SHA a
> publicar.

**Candidato à publicação (ainda não publicado):**
**`d2a447998d06dbb4807521c1f570de7171128372`**, merge do #87 na integration
em 2026-11-03 22:38 UTC (merge normal, condicionado ao head, com
`[skip render]`).

- Pais: `8916f180cad7397074e54c25ef237ffc7c797681` (integration) e
  `58be19d1290f4430e7f52345bbf16762f04a0472` (head validado do #87).
- A árvore do merge é idêntica à do head validado (tree `02e50ba`).
- Antes do merge: head e base sem avanço, `MERGEABLE`/`CLEAN`, sem pedidos de
  alteração. O check obrigatório "auth real e serviços reais (navegador + API)
  contra PostgreSQL descartável" estava verde no head (10m49s), incluindo as
  suítes `portal-entrada`, `portal-senha-temporaria` e `portal-recusas`. O
  check de migrations não foi disparado porque o lote não toca em
  `backend/src/database/**` nem em migrations.
- Diff: 46 arquivos, só frontend, testes, workflow e o plano. Sem mudança no
  backend.

**Publicado (sem mudança):** API e web em
`8916f180cad7397074e54c25ef237ffc7c797681`. As **14 migrations** continuam
aplicadas e conferidas no piloto. **Este lote não acrescenta nenhuma
migration**, então a publicação não tem etapa de banco.

O que o lote entrega está em `docs/plans/portal-independente-da-operacao.md`
(na integration), seção "Estado e retomada":

- `/conta` sem grupo "PLATAFORMA" nem atalhos para o portal;
- portal com entrada própria em `/portal`;
- troca de senha temporária pelo portal;
- endereços antigos redirecionam para `/portal`;
- autorização do servidor inalterada (só `MASTER_OWNER` ativo).

### Pendências

- Publicação, numa etapa separada e com autorização: API e depois web, os
  dois em `d2a4479`, sem migration. Até lá, não registrar este SHA como
  publicado.
- Validação no ambiente publicado depois do deploy:
  - entrada do portal e redirecionamentos dos endereços antigos;
  - operação sem atalhos;
  - recusa de quem não é proprietário.
- Nenhum deploy, operação no Render, conexão com banco real, migration ou
  alteração de contas foi feito nesta etapa.

## 11. Visão geral e listagem comercial do portal (#88): mesclado, NÃO publicado

> Publicado depois deste registro: API e web Live em `2656f69` (seção 12). O
> texto abaixo fica como histórico de antes da publicação.

**Candidato à publicação (ainda não publicado):**
**`2656f691bbd43123d49b48e65b8edb08c1061d68`**, merge do #88 na integration
em 2026-11-04 01:08 UTC (merge normal, condicionado ao head, com
`[skip render]`). Contém o #87 (`d2a4479`), que nunca foi publicado sozinho.

- Pais: `d2a447998d06dbb4807521c1f570de7171128372` (integration) e
  `4bf4331fe51a1897bb7b486251d4925a1a425008` (head validado do #88).
- A árvore do merge é idêntica à do head validado (tree `79358f8`).
- Antes do merge: head e base nos SHAs esperados, `MERGEABLE`/`CLEAN`, sem
  revisões nem pedidos de alteração. O check obrigatório "auth real e serviços
  reais (navegador + API) contra PostgreSQL descartável" estava verde no head
  (10m32s), incluindo a suíte nova `portal-visao-geral`. O check de migrations
  não foi disparado: o lote não toca em `backend/src/database/**` nem em
  migrations.
- Diff: 30 arquivos. No backend, só acréscimos: `GET /platform/overview` e os
  campos e o filtro novos em `GET /platform/establishments`. Nenhuma
  migration, preço ou condição comercial gravada.

O que o lote entrega está em `docs/plans/portal-visao-geral-e-listagem.md`
(na integration):

- Visão geral como destino padrão do portal;
- menu lateral no computador e recolhível no celular;
- Aparência e "Sair" no menu do usuário;
- totais pela regra central de acesso;
- pagamentos de assinatura do mês;
- lista "Precisa de atenção";
- listagem com plano, condição contratada por ciclo, situação, modalidade e
  validade, com filtros na URL.

### 11.1 Ensaio local de compatibilidade (antes do merge)

Ensaio feito só em máquina local, com PostgreSQL 17.11 descartável com TLS,
banco recriado do zero, as 14 migrations aplicadas e dados fictícios criados
pelas próprias suítes. Node 24.19.0, Chromium do Playwright. **Ele comprova a
compatibilidade local entre as versões; não é um teste da troca de versões no
Render.**

Cada invocação subiu uma API nova, como o CI, para respeitar o limite de 5
logins por IP em 15 minutos.

1. **Janela entre os deploys:** API compilada de `4bf4331`, web compilado de
   `d2a4479` (worktree descartável, suítes do próprio `d2a4479`):
   - `portal-entrada`: 1/1. Cobre login do portal, celular, sessão expirada e
     "Sair".
   - `administracao`: 2/2. Cobre lista e ficha do estabelecimento, preços,
     sem vencimento, revogação e recusas por URL e pela API.
   - `pilot-navigation`: 3/3. Cobre a navegação básica da operação com
     sessão.
2. **Depois do web:** web e API de `4bf4331`:
   - `portal-visao-geral`: 1/1, com 3 logins. Cobre Visão geral, listagem,
     filtros, menu do celular e sessão expirada.
3. **Sonda da API nova, sem sessão:**
   - `GET /platform/overview`: 401;
   - `GET /platform/establishments`: 401;
   - rota inexistente: 404.

   A rota nova existe e exige sessão.

Nenhum código mudou por causa do ensaio.

### Pendências

- **Publicação**, numa etapa separada e com autorização:
  - API e depois web, os dois em `2656f69`;
  - sem migration: as 14 do piloto não se repetem.
  - Até lá, não registrar este SHA como publicado. O publicado continua
    `8916f18`.
- **Validação no ambiente publicado**, depois do deploy:
  - entrada do portal levando à Visão geral;
  - totais e pagamentos do mês com os dados reais;
  - listagem e filtros;
  - endereços antigos;
  - operação sem atalhos;
  - recusa de quem não é proprietário.
- **Limitações conhecidas**, descritas no plano:
  - os totais incluem contas de teste e da equipe, porque ainda não existe
    classificação de uso interno;
  - "Precisa de atenção" mostra no máximo 20 itens;
  - os pagamentos são sempre os do mês corrente, no horário de Brasília.
- Nenhum deploy, operação no Render, conexão com banco real, migration,
  alteração de contas ou de preços foi feito nesta etapa.

## 12. Publicação do #88 no piloto e validação (2026-11-04)

### 12.1 Versões publicadas

Evidência: capturas do painel do Render fornecidas pelo usuário, com os nomes
dos dois serviços. O deploy foi feito pelo usuário; nenhuma operação no Render
partiu desta sessão.

- `agenda-cloud-piloto-api`: Live em `2656f69`;
- `agenda-cloud-piloto-web`: Live em `2656f69`;
- `2656f69` = `2656f691bbd43123d49b48e65b8edb08c1061d68`, merge do #88
  (seção 11), que já contém o #87.

Banco: as 14 migrations do piloto já estavam aplicadas (seção 8.1). Este lote
não tem migration; nada foi aplicado nem repetido, e não houve conexão direta
com o banco.

### 12.2 Validação pós-publicação

Feita em 2026-11-04 por volta de 01:30–01:55 UTC, no navegador local
(Chromium do Playwright 1.63.0, com janela, fuso America/Sao_Paulo). O
usuário digitou o login direto no navegador; a senha não passou pelo chat. O
roteiro só fez leituras: telas do portal e as APIs `GET` pelo proxy da mesma
origem (`/agenda_api/platform/...`). Nenhuma reserva, pagamento, contrato,
cortesia, concessão, preço, conta ou configuração comercial foi criada ou
alterada. A Aparência foi trocada para Escuro e voltou à escolha anterior
("Seguir aparelho"); é uma preferência só deste navegador. Capturas e respostas
brutas ficaram só na máquina local, fora do repositório, porque têm nomes e
e-mails reais.

Os números abaixo valem para esse momento. Não comparar com contagens
antigas.

1. **Entrada, navegação e saída:** OK.
   - O login pelo `/portal` levou a `/portal/visao-geral`.
   - Menu lateral com as 8 seções, "Visão geral" com `aria-current=page`.
   - Celular (390 e 360 px): seções recolhidas, abrem pelo botão "Menu",
     fecham ao navegar para Estabelecimentos, sem rolagem horizontal.
   - Aparência no menu do usuário com Claro / Escuro / Seguir aparelho;
     Escuro aplicou `data-tema="escuro"`.
   - "Sair" voltou para `/portal`. Depois disso, `GET /platform/overview`
     respondeu 401 e `/portal/visao-geral` levou a
     `/portal?next=%2Fportal%2Fvisao-geral`.
2. **Totais e "Precisa de atenção":** batem com a listagem e com os filtros
   da API.
   - Tela e `GET /platform/overview`: 3 cadastrados, 3 com acesso liberado,
     0 bloqueados (0 pela situação, 0 pela validade), 0 terminando em até 7
     dias, 0 suspensos, 3 com condição contratada pendente.
   - Modalidades: sem vencimento 1, validade ainda não definida 2, demais 0.
   - Recontagem pelos itens de `GET /platform/establishments` (todas as
     páginas): os mesmos números em cada campo.
   - Totais da API por filtro: `ACCESS_ALLOWED` 3, `ACCESS_BLOCKED` 0,
     `EXPIRING_SOON` 0, `VALIDITY_BLOCKED` 0, `CONTRACT_PENDING` 3,
     `status=SUSPENDED` 0.
   - "Precisa de atenção" vazia (total 0), coerente com 0 vencidos, ausentes
     ou terminando. O limite de 20 itens não pôde ser exercitado.
   - Os 3 cadastrados têm situação "Em teste" (`TRIAL`), mas nenhum está na
     modalidade "Teste gratuito": situação e modalidade são separadas por
     regra.
3. **Pagamentos do mês:** critério confere; não há dado real para exercitá-lo.
   - Texto da tela: confirmados manualmente no portal, não anulados, com data
     de recebimento entre 01/11/2026 e 30/11/2026, no horário de Brasília
     (America/Sao_Paulo). Soma os valores registrados, sem recalcular pelo
     catálogo ou contrato.
   - API: mês `2026-11`, `from` 2026-11-01, `to` 2026-11-30, BRL, 0
     pagamentos, R$ 0,00, 0 anulados.
   - `GET /platform/subscription-payments`: 0 registros em todos os meses.
     Por isso data de recebimento, fuso e anulações foram conferidos só pelo
     critério e pelo código, não por um pagamento real. A listagem não expõe
     a origem da confirmação (`MANUAL`); esse recorte só aparece na soma da
     Visão geral.
4. **Listagem:** OK.
   - Plano por estabelecimento (Max, Max e o terceiro com outro plano).
   - "Condição contratada: Pendente: sem valor contratado" nos 3, sem zero
     nem "grátis".
   - Catálogo em linha separada, por ciclo, com o trimestral como total de 3
     meses (por exemplo, "mensal R$ 119,90 · trimestral R$ 323,90 por 3
     meses").
   - Situação "Em operação" e "Acesso liberado"; validade em texto próprio,
     sem data inventada ("Opera como antes até a regularização" e "Não vence
     enquanto a concessão estiver em vigor").
5. **Filtros e links:** OK.
   - Abrir a listagem com `filtro=` ou `situacao=` na URL e recarregar a
     página manteve a URL, o valor do campo e o resultado.
   - Escolher o filtro no formulário e pesquisar levou o filtro para a URL;
     "Limpar filtros" removeu a busca.
   - Os 6 links dos indicadores (`ACCESS_ALLOWED`, `ACCESS_BLOCKED`,
     `EXPIRING_SOON`, `VALIDITY_BLOCKED`, `CONTRACT_PENDING` e
     `situacao=SUSPENDED`) abriram a listagem filtrada.
   - Contagem lida na tela: 3, 0, 0 e 0 para liberado, bloqueado, terminando
     e suspensos, iguais à API. Para `CONTRACT_PENDING` e `VALIDITY_BLOCKED` o
     roteiro não capturou a frase de contagem (leu o texto de ajuda do
     filtro); os totais da API são 3 e 0, e campo e URL se mantiveram depois
     de recarregar.
6. **Endereços antigos e operação:** OK.
   - Respostas 307: `/plataforma` e `/administracao` e
     `/conta/administracao` para `/portal`; `/plataforma/estabelecimentos?filtro=EXPIRING_SOON`
     para `/portal/estabelecimentos?filtro=EXPIRING_SOON`;
     `/administracao/planos` para `/portal/planos`;
     `/conta/administracao/usuarios` para `/portal/usuarios`.
   - Operação (`/conta/visao-geral`), com a mesma sessão: nenhum link para
     `/portal` no computador nem no menu do celular.
7. **Recusa de quem não é proprietário:** **pendente.** Não havia conta não
   proprietária disponível e autorizada nesta sessão; nenhuma conta foi criada
   e nenhum papel foi alterado para testar.
   - Só sem sessão: `GET /platform/overview`, `/platform/establishments` e
     `/platform/subscription-payments`, direto na API pública, responderam 401.

Nenhum defeito encontrado.

### 12.3 Pendências reais

- Recusa pela interface e pela API com uma conta não proprietária já
  existente e autorizada.
- Pagamentos do mês com dados reais, quando houver o primeiro pagamento
  confirmado: data de recebimento, fuso e anulado fora da soma.
- "Precisa de atenção" com itens reais e o limite de 20.
- Limitações que continuam:
  - os totais incluem contas de teste e da equipe, porque ainda não há
    classificação de uso interno;
  - pagamentos só do mês corrente, no horário de Brasília.
- Nenhum novo deploy, migration, conexão direta com banco, nem alteração de
  conta, preço ou configuração comercial foi feito nesta etapa.

## 13. Revisão de autorização e isolamento (#89): aberto, NÃO mesclado

Registro de 2026-11-04 (PC de casa). Nada foi publicado; o piloto continua
com API e web Live em `2656f69` (seção 12.1) e as 14 migrations já
aplicadas (seção 8.1), que não devem ser repetidas.

- PR #89, branch `test/isolamento-estabelecimentos`, head
  **`3fe529f061c7c6f740a4a8d396b2ecd4a8759b48`**, base na integration em
  `2656f691bbd43123d49b48e65b8edb08c1061d68`. CI verde (check exigido
  "auth real e serviços reais", 13m35s). Sem merge.
- Só testes e plano: `backend/test/isolamento-estabelecimentos-postgres.db-e2e-spec.ts`
  (novo), `backend/test/platform-portal-postgres.db-e2e-spec.ts` (estendido)
  e `docs/plans/revisao-isolamento-estabelecimentos.md`. Nenhum código de
  produção, nenhuma migration.
- Local, PostgreSQL 17 descartável com TLS: `test:db-e2e` com 27 arquivos e
  252 testes passando; `lint` e `tsc --noEmit` limpos.

### 13.1 Distinção usada

- **Dono da plataforma**: conta ativa com `MASTER_OWNER`. Único papel que
  abre o portal.
- **Dono do estabelecimento**: cliente da plataforma, limitado ao próprio
  estabelecimento e aos recursos do plano. Gerente e profissional ficam nas
  permissões do estabelecimento. Plano Max, teste, cortesia ou "sem
  vencimento" não concedem nada no portal; `MASTER_ADMIN` e
  `MASTER_SUPPORT` também não.

### 13.2 Resultado

Conclusão limitada ao escopo revisado: **nenhum defeito de isolamento
encontrado**.

- As 55 rotas `/tenants/:tenantId` (lista conferida contra o roteador): o
  dono do estabelecimento A recebe o mesmo 404 de inexistente em cada rota
  de B, sem dado de B; ids de B no caminho, corpo ou busca de A são
  recusados; nenhuma linha de A ou B muda; a conta de B faz a mesma chamada
  e consegue (controle positivo). Uma mutação proposital (vínculo buscado
  sem o tenant) fez 45 rotas falharem.
- Portal: dono do estabelecimento, gerente e profissional de um Max, com a
  senha confirmada, recebem 403 só com a mensagem em toda rota `/platform`.
- Dono da plataforma com o próprio estabelecimento vencido ou inativo: o
  portal funciona e a operação daquele estabelecimento continua recusada.
- Dono da plataforma **sem estabelecimento**: comprovado em testes locais e
  no CI (`portal-entrada-flow`, `platform-postgres`), **não** no piloto. A
  validação da seção 12.2 usou uma conta de dono da plataforma, sem registro
  de que ela não tenha estabelecimento.

### 13.3 Ponto registrado para análise própria

`PUT /tenants/:tenantId/push-subscription` com um endpoint que já pertence a
outra conta transfere o aparelho para quem chamou e revoga a inscrição
anterior, em qualquer estabelecimento (regra "um aparelho avisa uma pessoa
só", `push/push-subscriptions.repository.ts`). Não entrou na conclusão desta
revisão; fica para uma análise separada.

### 13.4 Pendências

- Piloto: validação com um cliente autenticado, sem papel global, numa conta
  já existente e autorizada (o próprio estabelecimento abre; `/platform/*`
  responde 403 só com a mensagem). Não criar contas, não mudar papéis e não
  testar escritas no piloto. Contas de dono da plataforma e respostas 401 sem
  sessão não substituem essa validação.
- Revisar o #89 e decidir o merge. Sem publicação nem operação no piloto
  nessa rodada.

## 14. Revisão de isolamento (#89): mesclado, NÃO publicado

Registro de 2026-11-04 (PC do trabalho). A seção 13 fica como o registro de
antes do merge.

- **Head validado:** `ed82260ad3310881df3a9236e37653139614ebf4`, um commit
  sobre `3fe529f`. Diff contra a integration restrito aos três arquivos de
  testes e plano da seção 13; nenhum código de produção, nenhuma migration.
- **Merge:** `6fac73c52f99db0979b28ced446a07322a93c862`, merge normal
  (sem squash nem rebase) condicionado ao head exato, título com
  `[skip render]`. Pais `2656f69` (integration anterior) e `ed82260`; árvore
  igual à do head validado. PR #89 MERGED; a branch
  `test/isolamento-estabelecimentos` e a worktree local foram preservadas.
- **Integration avançou para `6fac73c`, sem publicação.** API e web
  continuam publicados em `2656f69` (seção 12.1). Como o lote só tem testes e
  documentação, não há motivo de publicação por ele.
- **Banco:** as 14 migrations já aplicadas no piloto (seção 8.1) continuam
  as mesmas; este lote não traz nenhuma.

### 14.1 Reforço antes do merge (`ed82260`)

- No teste de isolamento, rota por rota e antes do controle positivo, as
  linhas de `users`, `credentials` e `sessions` de todas as contas de A e de
  B são comparadas em memória. A troca de senha do funcionário de B tentada
  por A não altera a credencial, a troca obrigatória, o papel, a situação
  nem a validade ou revogação das sessões dele. Só a confirmação de senha da
  sessão de quem chama é tolerada.
- Pré-condição conferida (o alvo tem credencial e sessão aberta) e prova de
  que a comparação enxerga a mudança: depois do controle positivo, a senha do
  alvo aparece trocada e a sessão encerrada.
- Falhas apontam só conta e campo; corpos de resposta relatados omitem
  senha, token, segredo e hash.
- Local: os dois arquivos afetados em PostgreSQL descartável com TLS (9
  testes), `lint` e `tsc --noEmit`; uma mutação temporária no filtro de
  estabelecimento da troca de senha foi detectada pela nova comparação. CI
  obrigatório verde no head `ed82260`.
- O plano (`docs/plans/revisao-isolamento-estabelecimentos.md`) foi alinhado
  à seção 13.3.

### 14.2 Distinção mantida

Dono da plataforma é só a conta ativa com `MASTER_OWNER`. Dono do
estabelecimento é cliente da plataforma, limitado ao próprio estabelecimento
e aos recursos do plano; nunca recebe acesso ao portal.

### 14.3 Pendências

- Piloto: validação com um cliente autenticado, sem papel global, numa conta
  já existente e autorizada, só leituras (o próprio estabelecimento abre;
  `/platform/*` responde 403 só com a mensagem). Continua pendente.
- `PUT /tenants/:tenantId/push-subscription`: a transferência do aparelho
  entre contas (seção 13.3) é comportamento observado; a análise de
  segurança fica separada e não entrou na conclusão desta revisão.

## 15. Contas do portal e comissões: dois PRs abertos, NÃO mesclados

Registro de 2026-11-04 (PC do trabalho). Integration conferida em `6fac73c`;
API e web continuam publicados em `2656f69`. Nada foi mesclado, publicado nem
aplicado no piloto, e nenhum banco real foi acessado.

### 15.1 PR #90: contas só de funcionário fora da lista global do portal

- **Branch e worktree:** `feat/portal-contas-sem-funcionarios`, em
  `C:\Projetos\Agenda-Cloud-contas-master`.
- **Commits:** `87da5d7` e `877de2b`. Sem migration.
- **Comportamento:** a lista do portal (`GET /platform/users`) deixa de mostrar
  contas sem papel de plataforma, sem vínculo nem convite pendente de DONO, e
  com vínculo ou convite pendente de funcionário.
- **Onde o critério entra:** na mesma cláusula da busca, antes da paginação e
  dos contadores.
- **Quem continua na lista:** dono de um negócio que também é funcionário de
  outro, responsável ainda sem estabelecimento, `MASTER_OWNER` sem
  estabelecimento e conta com papel de plataforma.
- **O que não muda:** a equipe do estabelecimento, a ficha da conta e a lista
  de convites.
- **Plano:** `docs/plans/portal-contas-de-funcionarios.md`.
- **CI no head anterior:** o primeiro CI falhou em
  `pilot-team-manager-check`. O teste novo criava vínculos GERENTE, e o
  levantamento de vagas só lista os primeiros estabelecimentos com gerente no
  mesmo banco. Corrigido em `877de2b`. A suíte db-e2e inteira passou local em
  banco novo (27 arquivos, 253 testes).
- **CI no head `877de2b`:** verde. A primeira execução caiu em
  `acesso-por-usuario-flow`, com `ECONNRESET` no `GET /auth/me`. É um fluxo
  que este lote não toca, e o job reexecutado passou.

### 15.2 PR #91: comissão por profissional e serviço

- **Branch e worktree:** `feat/comissoes-profissional-servico`, em
  `C:\Projetos\Agenda-Cloud-comissoes`.
- **Commits:** `3177866` e `bbbcef4`. O segundo tira o gerente criado no teste
  depois da recusa, pelo mesmo teto do `pilot-team-manager-check`.
- **Migration:** a 15ª, `ProfessionalCommissions1793491200000`. Foi ensaiada só
  em PostgreSQL 18 descartável com TLS, em três ensaios: do zero, só a 15ª
  sobre base com 14 e dados, e `revert` e reaplicação.
- **Reaproveitado:** `commission_rules`, `commission_entries` e o recurso
  `COMISSOES` do catálogo, que só está no plano Rede (`pro`).
- **Apuração:** na conclusão do atendimento, uma linha por serviço da reserva.
- **Relatório:** `/conta/comissoes`, por profissional e período, sem
  apresentar comissão como pagamento.
- **Visão do funcionário:** só as próprias comissões, com a concessão
  `COMISSOES_PROPRIAS_VISUALIZAR` dada pelo dono.
- **Suíte nova de navegador:** `test:browser:comissoes`, com passo próprio no
  workflow.
- **Plano e decisões em aberto:** `docs/plans/comissoes-profissional-servico.md`.
- **CI no head `bbbcef4`:** verde, inclusive o passo novo de navegador de
  comissões. Local: db-e2e inteira em banco novo (28 arquivos, 259 testes).

### 15.3 Itens só neste PC

- **node_modules emprestados:** os `node_modules` (raiz e backend) das
  worktrees `Agenda-Cloud-pr85` e `Agenda-Cloud-recebimentos` foram movidos
  para as duas worktrees novas. Os lockfiles são idênticos. Devolver antes de
  usar as worktrees de origem.
- **Merge em andamento:** a worktree `Agenda-Cloud-combo` está com um merge em
  andamento (conflitos em `lote6b2-migration...` e
  `migrations-runtime-compiled.spec.ts`), que é anterior a esta rodada. Ela
  não foi tocada.
- **Cluster PostgreSQL descartável:** está no scratchpad da sessão, na porta
  55434, e some com ele.

### 15.4 Próximo passo

- Revisar #90 e #91. Antes de publicar o #91 no piloto, é preciso um roteiro de
  publicação próprio para a 15ª migration, porque os kits anteriores recusam
  migration posterior de propósito.
- As decisões comerciais do #91 estão no fim do plano: planos, período do
  relatório, arredondamento, fixo acima do preço, gerente e repasses.

## 16. CLAUDE.md e guardas da demonstração (#92): mesclado, NÃO publicado

Registro de 2026-11-04 (PC do trabalho).

- **Head mesclado:** `09fd93e14920ced1dc68a10a92474448939bcec2`, um commit
  sobre `6fac73c`. Diff restrito a `CLAUDE.md`,
  `src/lib/servicos/excecoes-demonstracao.ts` e às duas guardas
  `sem-dados-demo*.test.ts`. Nenhum código de produção, nenhuma migration.
  CI obrigatório verde nesse head; sem pedidos de alteração.
- **Merge:** `05dd605bc247635c6a078dfa1cf22d17997480e5`, merge normal (sem
  squash nem rebase) condicionado ao head exato, título com `[skip render]`.
  Pais `6fac73c` (integration anterior) e `09fd93e`; árvore igual à do head.
  A branch `docs/claude-md-rotas-guarda-demo` e a worktree
  `C:\Projetos\Agenda-Cloud-guarda-demo` foram preservadas.
- **Conteúdo:** o CLAUDE.md lista as rotas reais (`/conta`, `/portal`,
  `/login`, `/cadastro`, `/convite`, `/redefinir-senha`, `/agendar/[slug]`)
  e descreve `backend/src/commercial/`. As guardas direta e transitiva cobrem
  todas as áreas reais; a única exceção são os dois imports dos botões de
  demonstração em `src/app/login/page.tsx`, por arquivo e especificador.
- **Integration avançou para `05dd605`, sem publicação.** API e web
  continuam publicados em `2656f69` (seção 12.1). O lote não traz motivo de
  publicação.
- **Banco:** as 14 migrations aplicadas no piloto (seção 8.1) continuam as
  mesmas.

### 16.1 PRs abertos

- **#90** (seção 15.1): aberto, head `877de2b`, sem mudança.
- **#91** (seção 15.2): aberto. O head passou a `67d04c2`: `d02ec86` liga
  comissões também ao Pro (`equipe`) dentro da 15ª migration, ainda não
  aplicada em banco real, e `67d04c2` ajusta a contagem do catálogo no spec
  de migration (26 para 27). O Básico (`essencial`) fica sem comissões por
  padrão; o Max (`pro`, antigo "Rede") mantém. CI verde no `67d04c2`.

### 16.2 Itens só neste PC

- A worktree `Agenda-Cloud-guarda-demo` usa um junction de `node_modules`
  apontando para o da worktree `Agenda-Cloud-comissoes`. Remover o junction
  antes de apagar a worktree, para não apagar o `node_modules` de destino.
- O CLAUDE.md da pasta principal tem alterações locais não versionadas,
  preservadas.

### 16.3 Próximo passo

- Revisar #90 e #91. A publicação do #91 continua dependendo de um roteiro
  próprio para a 15ª migration (seção 15.4).

## 17. #90 mesclado e #91 revisado: nada publicado

Registro de 2026-11-04 (PC do trabalho). Nada foi publicado, nenhuma migration
foi aplicada em banco real e nenhum banco real foi acessado.

- **Publicado:** API e web continuam em `2656f69` (seção 12.1).
- **Banco real:** continua com as 14 migrations da seção 8.1.

### 17.1 PR #90: mesclado

- **Defeito corrigido na revisão:** a lista global tratava convite vencido como
  pendente. Uma conta cujo único convite de funcionário tinha vencido sumia da
  lista global, e a equipe do estabelecimento também não a mostrava.
- **Correção:** `a286d8876e05e9dd3980e461f80b91dca1cd1fee`. Agora vale o mesmo
  critério de `INVITE_STATUS_SQL`: convite pendente é o que ainda não venceu.
  - O teste de regressão falha sem a correção.
  - O plano `docs/plans/portal-contas-de-funcionarios.md` registra o critério.
  - CI verde nesse head.
- **Merge:** `c40a91bd48de31c15e654cee7c09accdc241c564`.
  - Merge normal, condicionado ao head exato, com `[skip render]` no título.
  - Pais: `05dd605` e `a286d88`.
  - A árvore é igual à do merge local dos dois pais.
  - Sem migration.
- **Integration:** avançou para `c40a91b`, sem publicação. O #90 pode ser
  publicado sozinho, com API e web do mesmo SHA, sem migration.

### 17.2 PR #91: aberto, head `d1e3519`

- **Head:** `d1e3519b213f67b2c6c76e2e6c31c0cafb36eb56`, um commit sobre
  `67d04c2`:
  - **Apuração:** a subconsulta que evita apurar o mesmo item duas vezes
    (`commission-accrual.ts`) passou a filtrar pelo `tenant_id` autorizado. O
    resultado é o mesmo, porque a FK composta já prende cada linha ao tenant
    do item.
  - **Plano:** ganhou a seção "Recuperação depois da publicação".
- **Testes:** db-e2e de comissões, isolamento e agendamentos rodaram em banco
  descartável novo, com as 15 migrations: 49/49.
- **CI no head `d1e3519`:** verde nos dois workflows. O de migration terminou
  às 17:13 UTC. O de auth e serviços reais teve as etapas concluídas às 17:26,
  mas o GitHub só marcou o check como concluído (success) às 17:43. Não foi
  preciso cancelar nem reexecutar.
- **Conflitos:** o head entra sem conflito sobre `c40a91b`.
- **Combinação revisada:** `05dd605` + #90 + #91 juntos, sem conflito.
  - Guardas do #92: 51/51.
  - Unitários: frontend 912, backend 1747.
  - db-e2e inteira em banco novo: 15 migrations, 262/262.
- **Revisão sem defeito comprovado:**
  - A apuração roda na mesma transação da conclusão, com a reserva travada.
  - Repetir não grava de novo: índice único por item e `ON CONFLICT DO
    NOTHING`.
  - Cada linha é uma fotografia imutável, sem retroatividade.
  - O plano é conferido na conclusão.
  - O funcionário só vê as próprias comissões, com concessão.
- **Recuperação:**
  - **`down` proibido depois da primeira apuração.** Ele recusa, e forçá-lo
    apagaria histórico.
  - **Voltar a API não é recuperação completa.** A API anterior aceita o schema
    novo. Mas, enquanto ela estiver no ar, as conclusões não geram comissão,
    e essas conclusões nunca são apuradas depois. A tela, as regras e a visão
    do funcionário também param.
  - **Ordem obrigatória:** migration, depois API, depois web.
  - **API nova no schema de 14:** num estabelecimento que já tem o recurso de
    comissões (Max, ou Básico com exceção ligada), concluir atendimento
    responde 500 e a conclusão é desfeita; relatório e regras também
    respondem 500. Nos demais (o Pro, que ainda não tem o recurso no catálogo
    antigo), ela conclui sem apurar. Ensaiado em 04/11/2026 (seção 19).

### 17.3 Pendência: kit protegido da 15ª migration

Os kits atuais recusam migration posterior de propósito. Antes de publicar o
#91, criar um kit no padrão dos anteriores (`aplicar-*-piloto.mjs`,
`conferir-restauracao-*`, `abrir-*.ps1`). O kit precisa de:

- **Backup e checagem:** backup e `pilot:check-database` antes e depois.
- **Estado de partida:** exatamente 14 migrations aplicadas e só
  `ProfessionalCommissions1793491200000` pendente.
- **Aplicação:** pela forma compilada.
- **Conferência do schema:**
  - coluna `appointment_item_id`;
  - índices parcial e por item;
  - `ck_commission_entries_rule_snapshot` e `uq_appointment_items_tenant_id`;
  - os valores novos de enum;
  - a linha `pf_pc_equipe_comissoes`, com planos, preços e exceções intactos.
- **Restauração:** ensaio da restauração.
- **Roteiro de volta:** as regras da seção 17.2.
- **Aviso:** a partir da publicação, todo estabelecimento Pro passa a apurar
  comissões.

### 17.4 Itens só neste PC

- **Worktree temporária `C:\Projetos\Agenda-Cloud-rev-combo`:** fica para
  inspeção.
  - Os `node_modules` dela, na raiz e em `backend`, são junctions para os de
    `Agenda-Cloud-comissoes`.
  - Remova os junctions com `cmd /c rmdir` antes de apagar a worktree.
    Remoção recursiva apagaria os `node_modules` de destino.
- **Cluster PostgreSQL descartável:** fica no scratchpad da sessão e está
  parado.
- **CLAUDE.md local:** as alterações na pasta principal continuam preservadas.

### 17.5 Próximo passo

- Decidir o merge do #91 (feito; seção 18).
- Criar e ensaiar o kit da 15ª migration (seção 17.3) só em banco descartável.
- Publicar seguindo o runbook.

## 18. #91 mesclado: publicação bloqueada pela 15ª migration

Registro de 2026-11-04 (PC do trabalho). Nada foi publicado, nenhuma migration
foi aplicada em banco real e nenhum banco real foi acessado.

- **Conferência antes do merge:**
  - head `d1e3519b213f67b2c6c76e2e6c31c0cafb36eb56`;
  - integration em `c40a91b`;
  - os dois workflows verdes;
  - sem pedidos de alteração.
- **Divergência avaliada:** a branch saiu de `6fac73c`, então não continha o #90
  nem o #92. Mesmo assim, o merge era seguro:
  - nenhum arquivo é alterado pelos dois lados;
  - o merge local não teve conflito;
  - a combinação dos três já tinha sido validada (seção 17.2).
- **Merge:** `9e548a332321bbd714c614dafcd0c75a83c61107`.
  - Merge normal, condicionado ao head exato, com `[skip render]` no título.
  - Pais: `c40a91b` e `d1e3519`.
  - A árvore é igual à do merge local.
  - O #90 (`a286d88`) e o #92 (`09fd93e`) continuam contidos.
  - Os arquivos deles não mudaram.
- **Integration:** `9e548a3`, com 15 migrations.
- **Publicado:** API e web continuam em `2656f69` (seção 12.1).
- **Banco real:** continua com 14 migrations (seção 8.1). A 15ª,
  `ProfessionalCommissions1793491200000`, está pendente.
- **Publicação bloqueada:** nenhum SHA a partir de `9e548a3` pode ser publicado
  antes de existir e ser ensaiado o kit protegido da 15ª migration (requisitos
  na seção 17.3).
  - A ordem é migration, depois API, depois web.
  - Para recuperar, vale a seção 17.2: sem `down` depois da primeira apuração,
    e voltar a API não é recuperação completa.
- **Mesmo bloqueio para o #90:** a integration já contém o #91. Publicar o #90
  sozinho exigiria um SHA anterior ao merge do #91 (`c40a91b`). Isso fica fora
  do fluxo padrão e precisa de decisão explícita.
- **Preservados:** a branch e a worktree `Agenda-Cloud-comissoes`; os itens da
  seção 17.4.

### 18.1 Próximo passo

- Criar e ensaiar o kit protegido da 15ª migration, só em banco descartável.
- Depois, publicar seguindo o runbook: migration, API e web do mesmo SHA.

## 19. Kit protegido da 15ª migration: PR #93 aberto

Registro de 2026-11-04 (PC do trabalho). Nada foi publicado, nenhuma migration
foi aplicada em banco real e nenhum banco real foi acessado.

- **Integration:** `9e548a3` (15 migrations).
- **Publicado:** API e web continuam em `2656f69`.
- **Banco real:** continua com 14 migrations. A 15ª,
  `ProfessionalCommissions1793491200000`, está pendente.
- **PR #93:** `ops/kit-comissoes-profissionais` → integration, aberto, sem
  conflito.
  - Head: `3aa3442fb87c97e0ad189a6b1007e7f886581c26`.
  - CI verde nos dois workflows nesse head.
  - Commit ensaiado do kit: `d3d5ce19d74c9b3e23a1c7a205bbcc163d7b6adf`.
    Depois dele mudaram só a documentação e o teste db-e2e da conferência
    (`git diff d3d5ce1 3aa3442 -- backend/scripts backend/src` vazio).
  - Runbook: `docs/runbooks/publicacao-comissoes-profissionais-piloto.md`.

### 19.1 O que o kit faz

- Fases `conferir`, `preparar`, `restauracao` e `aplicar`, no padrão dos
  kits anteriores, com os códigos de saída 0 (sucesso), 1 (parou sem gravar),
  2 (aplicada, conferência posterior falhou) e 3 (incerto).
- Estados exatos `before-professional-commissions` (14) e
  `after-professional-commissions` (15, 15/15 objetos com a definição exata e
  a linha `pf_pc_equipe_comissoes`).
- Depois do COMMIT, confere catálogo, planos, preços, exceções e "sem
  vencimento" contra o backup novo.
- O levantamento mostra quantos estabelecimentos passam a apurar comissões.

### 19.2 Ensaio (PostgreSQL 17.11 descartável, TLS, dados fictícios)

- **Lançador oficial num console real (ConPTY):**
  - ciclo completo 14→15 e restauração conferida (só as mudanças previstas);
  - frase errada, lock (`55P03`), repetição e estados divergentes: código 1,
    nada gravado;
  - sessão da migration derrubada no servidor (`57P01`): código 3; a
    aplicação seguinte fica bloqueada até um `conferir`;
  - catálogo alterado durante a frase: código 2;
  - backup de outro commit, proteções do modo piloto, da URL e da CA:
    recusados antes da escrita.
- **Compatibilidade (HTTP real):**
  - API anterior no schema 15: funciona e não apura; a volta com apurações
    gravadas não perde nada;
  - API nova no schema 15: apura por item;
  - API nova no schema 14: ver a seção 17.2;
  - web anterior: as funções de validação dele aceitam as respostas da API
    nova.
- **`down` depois da apuração:** recusado e desfeito; dados intactos.
- **Testes locais:** unitários do backend 1790/1790; db-e2e completo em banco
  novo 265/265.

### 19.3 Limitações

- Sem ensaio no navegador e sem a troca de API no Render.
- O banco do ensaio é PostgreSQL local, não o Neon.
- O sha256 do zip do PostgreSQL 17.11 só foi calculado localmente.
- Os comprovantes do ensaio não valem para o piloto.

### 19.4 Itens só neste PC

- **Worktrees:**
  - `C:ProjetosAgenda-Cloud-kit-comissoes` (branch do #93);
  - `C:ProjetosAgenda-Cloud-publicado-2656f69` (versão publicada,
    destacada, usada para a API anterior);
  - as da seção 17.4.
  - Os `node_modules` delas são junctions para os de
    `Agenda-Cloud-comissoes`. Remova-os com `cmd /c rmdir` antes de apagar
    a worktree.
- **Scratchpad da sessão** (pode ser apagado pelo sistema):
  - cluster PostgreSQL 17 do ensaio (`ens17`, parado) e os binários 17.11;
  - pasta de operações do ensaio (`ops-ensaio`), transcrições, roteiros de
    compatibilidade e o driver ConPTY.
- **CLAUDE.md local:** preservado.

### 19.5 Próximo passo

1. Revisar e decidir o merge do #93.
2. No SHA definitivo da integration, com autorização expressa: `preparar`,
   `restauracao` e `aplicar` no piloto.
3. Publicar a API e depois o web, do mesmo SHA.
