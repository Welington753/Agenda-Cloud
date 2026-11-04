# Runbook — Publicar as comissões por profissional e serviço no piloto (PR #91)

Este runbook leva o piloto das catorze migrations atuais (até
`AppointmentServiceSnapshots1793404800000`) às quinze, aplicando
`ProfessionalCommissions1793491200000`. Depois publica a API e o web do mesmo
commit, nesta ordem: **migration → API → web**.

- O que a migration muda: uma linha por serviço em `commission_entries`, os
  valores de enum novos e o recurso de comissões no plano Pro. Detalhes em
  `docs/plans/comissoes-profissional-servico.md`.
- Estado entre sessões: `continuidade-portal-multisservicos.md`.
- `docs/runbooks/migrations-production.md` **não** serve para esta migration.

## Estado em 04/11/2026

**Preparação concluída** neste repositório, sem tocar no piloto. O
procedimento está em `backend/scripts/`, no molde do portal e com as mesmas
peças comuns (`operacao-piloto.mjs`, `entrada-oculta.mjs`, `equipe-piloto.mjs`):

| Arquivo | Papel |
| --- | --- |
| `abrir-comissoes-profissionais-piloto.ps1` | lançador (por `-File`) |
| `aplicar-comissoes-profissionais-piloto.mjs` | fases `preparar`, `aplicar` e `conferir` |
| `conferir-restauracao-comissoes-profissionais.mjs` | fase `restauracao` |
| `comissoes-profissionais-piloto.mjs` | estados, comprovante, execução pendente e desfechos |
| `lib/comissoes-profissionais-schema.ts` | conferência dos dois estados, catálogo, levantamento e efeito de uma reversão |
| `lib/pilot-database-check.ts` | expectativas `before-professional-commissions` e `after-professional-commissions` (também pelo `npm run pilot:check-database`) |

- **Consulta só leitura:**
  `consultas/impacto-comissoes-profissionais-somente-leitura.sql` (só ids,
  códigos e contagens, nos dois estados).
- **Ensaio em PostgreSQL 17.11 descartável** com TLS e dados fictícios, pelo
  lançador oficial num console real:
  - o ciclo completo e a restauração;
  - as recusas e as falhas que importam: frase errada, lock, queda da sessão,
    conferência posterior falha, repetição e estados incorretos;
  - a compatibilidade das APIs anterior e nova nos dois schemas;
  - o `down` depois da apuração.

  Ver a seção "Ensaio".

**Operação no piloto: nada executado.** Nenhuma conexão com o piloto, nenhum
backup, migration não aplicada, nada publicado no Render.

**Estado esperado do piloto:**

- catorze migrations;
- API e web publicados em `2656f69`.

**A migration só é aplicada sobre exatamente esse estado.** Com qualquer outro
histórico (nome, ordem ou quantidade) ou objeto fora do lugar, o procedimento
para antes de escrever.

**A partir da publicação da API nova, todo estabelecimento com o recurso
passa a apurar comissão a cada atendimento concluído.** Isso inclui todo
estabelecimento Pro sem exceção desligada, além dos Max e dos Básico com
exceção ligada, que já tinham o recurso. O levantamento mostra quantos são
(`PASSAM_A_APURAR_COMISSOES`). Nada é apurado para atendimentos já
concluídos.

**Pendências antes de publicar** (fora deste kit):

- backup real, restauração conferida e operação no SHA operacional definitivo,
  com autorização expressa;
- confirmar no painel do Render que a versão Live é `2656f69`.

## Os dois estados

| Estado | Migrations | O que tem | API que funciona nele |
| --- | --- | --- | --- |
| `before-professional-commissions` | 14 | o piloto de hoje; comissões só no Max | a anterior (`2656f69`); a nova **não** (ver "Compatibilidade") |
| `after-professional-commissions` | 15 | + coluna por item, colunas anuláveis, constraints, índices, enum e o recurso no Pro | as duas; a nova é o destino |

A fase `conferir` identifica um deles. Exatamente uma das duas conferências
precisa passar; com nenhuma ou com as duas, `ESTADO: divergente`.

**`before-professional-commissions` exige:**

- exatamente as catorze migrations, **na ordem e com os nomes**;
- os objetos das anteriores (a conferência `after-appointment-snapshots`
  reaproveitada, que por sua vez reaproveita as do portal, do comercial e
  anteriores);
- nenhum objeto da nova: valores de enum, coluna `appointment_item_id`,
  colunas já anuláveis, constraints, índices novos;
- `uq_commission_entries_appointment_id` com a definição antiga (não parcial);
- catálogo de antes:
  - recurso `feat_comissoes` existente;
  - plano `plan_equipe` com código `equipe`;
  - comissões **só** no `plan_pro`;
  - nenhuma linha ligando o Pro a comissões, nem com outro id.

**`after-professional-commissions` exige:**

- as quinze migrations;
- os quinze objetos com a definição exata (`SCHEMA_OBJECTS_OK: 15/15`):
  - os dois valores de enum;
  - `appointment_item_id varchar(30)`, anulável e sem padrão;
  - as cinco colunas anuláveis;
  - `uq_appointment_items_tenant_id`;
  - a FK composta;
  - `ck_commission_entries_rule_snapshot`;
  - o índice parcial e os dois novos, cada um com a definição exata;
  - a linha `pf_pc_equipe_comissoes` (`plan_equipe` + `feat_comissoes`);
- comissões exatamente no `plan_equipe` e no `plan_pro`.

Um `down` executado deixa os valores de enum, então o banco **não** volta a ser
"antes": fica `divergente`, de propósito.

## O que publicar

Publique o commit de `integration/nestjs-typeorm-frontend` que contiver o #91
**e este kit**. Ele é definido depois da aprovação e do merge deste PR. Use
**o mesmo SHA** em todas as fases e nos dois deploys.

- A fase `restauracao` recusa backup de outro commit.
- A fase `aplicar` recusa backup ou restauração de outro commit ou de outro
  modo.
- Backups e comprovantes feitos em ensaio (`-Ensaio`) **não valem** no modo
  piloto e não provam a operação real.
- Os comprovantes do ensaio de 04/11/2026 são do commit do kit `d3d5ce1` e
  **não valem para o piloto**.

## Pré-requisitos (uma vez)

São os mesmos de `publicacao-portal-multisservicos-piloto.md`:

- Windows Terminal e Node 24;
- PostgreSQL para Windows com `pg_dump`, `pg_restore`, `initdb` e `pg_ctl`,
  em versão **igual ou maior que a do servidor do piloto** (`-PgBin`; a última
  versão conhecida do piloto é 17.11);
- `openssl.exe` do Git;
- a URL direta do piloto, o Endpoint ID do piloto e o Endpoint ID proibido;
- a pasta `%USERPROFILE%\AgendaCloud-operacoes`, fora do repositório. Ela
  guarda dumps completos, com hashes de senha.

## Passo a passo

Qualquer `ERRO:` para o procedimento; vale então "Recuperação". Nos comandos
abaixo:

- `<lancador>` é
  `C:\Projetos\Agenda-Cloud-publicacao-comissoes\backend\scripts\abrir-comissoes-profissionais-piloto.ps1`;
- `<ids>` é `-PilotEndpointId <ep-piloto> -ProductionEndpointId <ep-proibido>`.

```powershell
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File <lancador> -Fase <fase> <ids> -PgBin 'C:\Program Files\PostgreSQL\17\bin'
```

### 0. Pasta limpa do commit

```powershell
git -C C:\Projetos\Agenda-Cloud fetch origin
git -C C:\Projetos\Agenda-Cloud worktree add --detach C:\Projetos\Agenda-Cloud-publicacao-comissoes <sha>
cd C:\Projetos\Agenda-Cloud-publicacao-comissoes\backend
npm ci
```

O `node_modules` é próprio, nunca uma junção para o do clone principal.

### 1. Conferir o ponto de partida

Rode `-Fase conferir`. Esperado:

- `ESTADO: before-professional-commissions`;
- `SESSOES_DA_MIGRATION_ATIVAS: 0`;
- o levantamento. Leia-o antes de seguir (seção "Levantamento").

### 2. Preparar: só leitura

Rode `-Fase preparar`. A fase confere destino, TLS e
`before-professional-commissions`, imprime o levantamento e faz o backup.
Esperado:

```text
--- PILOT_EXPECT=before-professional-commissions
MIGRATIONS_APPLIED: 14
SCHEMA_OBJECTS_OK: 0/15
BASELINE_FAILURES: none
RESULT: SUCCESS
...
PASSAM_A_APURAR_COMISSOES: <n>
...
BACKUP_OK: <bytes> bytes sha256=... tabelas=44
RESULTADO: preparado, nada gravado no banco
```

### 3. Restauração: sem conexão com o piloto

Rode `-Fase restauracao`, sem `<ids>`. A fase:

1. restaura o backup `comissoes-*` mais recente num PostgreSQL descartável
   local (TLS verificado, senha aleatória);
2. compara contagem e md5 de cada tabela com o manifesto;
3. aplica **só** ProfessionalCommissions na cópia, pelo mesmo código da fase
   `aplicar`;
4. confere que só o previsto mudou.

Esperado:

```text
SHA256_CONFERE: true
CONTAGENS_IGUAIS: true
CONTEUDO_IGUAL_MD5: true
ENSAIO_ANTES (before-professional-commissions): ok
APLICADAS: ProfessionalCommissions1793491200000
ENSAIO_DEPOIS (after-professional-commissions): ok
ENSAIO_DADOS_PRESERVADOS: true
ENSAIO_CONTAS_ESTABELECIMENTOS_CATALOGO_RESERVAS_IGUAIS: true (...)
ENSAIO_COLUNAS_ANTIGAS_IGUAIS: true (commission_entries)
ENSAIO_SO_AS_COLUNAS_PREVISTAS: true (commission_entries+appointment_item_id)
ENSAIO_COLUNAS_NOVAS_NULAS: true (commission_entries=0)
ENSAIO_SO_AS_LINHAS_PREVISTAS: true (plan_features+pf_pc_equipe_comissoes)
ENSAIO_CATALOGO_PRECOS_EXCECOES_IGUAIS: true (plans,features,plan_features,tenant_feature_overrides,plan_prices,tenant_contract_prices,tenant_no_expiry_grants)
ENSAIO_REGRAS_APURACOES_RESERVAS_IGUAIS: true (...)
ENSAIO_PREVISAO_DE_QUEM_PASSA_A_APURAR_CONFERE: true (passam=<n>)
ENSAIO_HISTORICO_MAIS_UMA: true
DESCARTAVEL_APAGADO: true
```

| Linha | Mudança permitida | Todo o resto |
| --- | --- | --- |
| `ENSAIO_DADOS_PRESERVADOS` | — | todas as tabelas com contagem e md5 iguais, linha a linha |
| `ENSAIO_COLUNAS_ANTIGAS_IGUAIS` | `commission_entries` ganha `appointment_item_id` | as colunas antigas com md5 igual |
| `ENSAIO_COLUNAS_NOVAS_NULAS` | — | nenhuma apuração antiga ganha item inventado |
| `ENSAIO_SO_AS_LINHAS_PREVISTAS` | `plan_features` + `pf_pc_equipe_comissoes` | a contagem sobe exatamente 1 |
| `ENSAIO_CATALOGO_PRECOS_EXCECOES_IGUAIS` | — | planos (e preços deles), recursos, catálogo sem a linha nova, exceções, preços do catálogo, preços contratados e "sem vencimento" iguais ao backup |
| `ENSAIO_PREVISAO_DE_QUEM_PASSA_A_APURAR_CONFERE` | — | quem o levantamento previu é quem passou a ter o recurso |

### 4. Aplicar: única fase que escreve

Rode `-Fase aplicar`. A migration acrescenta valores de enum, uma constraint
em `appointment_items`, uma coluna, uma FK, índices e uma check em
`commission_entries`, e uma linha em `plan_features`. Por isso precisa de lock
curto nessas tabelas. Se uma requisição segurar uma delas, a migration desiste
em 10 s (`lock_timeout`) e o banco desfaz tudo.

1. **Antes da URL:**
   - recusa execução anterior sem desfecho (`ERR_RESULTADO_ANTERIOR_INCERTO`);
   - exige o backup do passo 2 com a restauração do passo 3 conferida: mesmo
     modo, endpoint e commit, de até 24 h, com manifesto, dump e comprovante
     sem alteração.
2. Repete destino, TLS, `before-professional-commissions` e o levantamento.
3. Faz um **backup novo** e confere que ele vem do mesmo servidor do backup
   conferido.
4. Pede a frase. Antes de digitá-la, confira `RESULT: SUCCESS`, `BACKUP_OK` e
   `MESMO_SERVIDOR_DO_BACKUP_CONFERIDO: sim`. Então digite:

   ```text
   APLICAR ProfessionalCommissions1793491200000
   ```

5. Registra `migration_iniciada` e aplica só ProfessionalCommissions, numa
   transação, com `lock_timeout` de 10 s e `statement_timeout` de 120 s.
6. Roda `after-professional-commissions` e compara o catálogo, os planos, os
   preços e as exceções com o backup novo (`CATALOGO_PRESERVADO`).

**Da frase à conferência, não altere plano, preço, contrato, exceção nem "sem
vencimento" pela administração.** Uma mudança nessa janela faz a conferência
posterior falhar (código 2), embora a migration tenha entrado. Isso foi
ensaiado.

Esperado:

```text
APLICADAS: ProfessionalCommissions1793491200000
SESSAO_DA_MIGRATION: mesma=true lock_timeout=10s
COMMIT: ok
--- PILOT_EXPECT=after-professional-commissions
MIGRATIONS_APPLIED: 15
SCHEMA_OBJECTS_OK: 15/15
RESULT: SUCCESS
CATALOGO_PRESERVADO: sim (...)
CONTAGENS_DESDE_O_BACKUP: iguais (com a linha nova do catálogo)
...
ESTADO: after-professional-commissions
RESULTADO: ProfessionalCommissions1793491200000 aplicada e conferida; ...
```

**Neste estado a API e o web publicados continuam os anteriores e funcionam**
(ensaiado), mas **não apuram comissão**. Publique a API nova logo depois: cada
atendimento concluído antes dela fica sem comissão para sempre.

`CONTAGENS_DESDE_O_BACKUP` é só informativa. A API no ar pode gravar reservas,
recebimentos e sessões durante a operação, e isso não é perda.

Toda fase termina com uma linha `DESFECHO` e o código de saída
correspondente; o lançador repete o significado do código. **O código, sozinho,
não comprova aplicação.** A prova é a linha `ESTADO` conferida, no fim da fase
ou numa `conferir`, e o registro em `operacoes.jsonl`.

| `DESFECHO` | Código | Significado | Ação |
| --- | --- | --- | --- |
| `aplicada_e_conferida` | 0 | gravada, e o estado "depois" e o catálogo ok | publicar a API |
| `preparado_sem_gravacao` / `estado_identificado` | 0 | `preparar` com backup / `conferir` leu um dos dois estados | ler `ESTADO` |
| `abortado_sem_gravacao` | 1 | frase diferente ou mais de uma linha; nada enviado | repetir quando quiser |
| `parado_sem_gravacao` | 1 | parou antes de a migration começar, ou o banco recusou (`55P03`, `ERR_MIGRATION_FALHOU`) e o estado "antes" foi confirmado intacto | ver `ERRO`/`MOTIVO`; repetir a fase `aplicar` em outro momento |
| `conferencia_sem_estado_valido` | 1 | `conferir` achou `divergente` ou sessão da migration ativa | não aplique nem publique |
| `aplicada_conferencia_falhou` | 2 | **gravada** (COMMIT confirmado); só a conferência depois falhou | **não** rode `aplicar`; rode `conferir` e investigue o que mudou |
| `resultado_incerto` | 3 | conexão perdida (ou erro qualquer) depois do início da migration | **não** rode `aplicar`; rode `conferir` |

### 5. Conferir: só leitura, quando quiser

Rode `-Fase conferir`. Saídas:

| Saída | Significado |
| --- | --- |
| `ESTADO: before-professional-commissions` | a migration não entrou |
| `ESTADO: after-professional-commissions` | entrou; mostra `REVERSAO_AFETARIA_*`; a API nova pode ser publicada |
| `ESTADO: divergente` | nenhum dos dois, ou os dois: não aplique nem publique |
| `ERRO: ERR_CONFERENCIA_SEM_LEITURA` / `ERR_SEM_CONEXAO` | o banco não foi lido; repita |
| `SESSOES_DA_MIGRATION_ATIVAS: n>0` | a migration ainda roda; espere e repita |

### 6. Publicar a API

Só com `ESTADO: after-professional-commissions`. No Render, em
`agenda-cloud-piloto-api`: **Manual Deploy → Deploy a specific commit →
`<sha>`**. Espere **Live** e confira:

- `GET $WEB/agenda_api/auth/me` sem cookie responde `401`;
- o dono entra (com o web atual) e a agenda, os serviços, a equipe e os
  recebimentos abrem;
- um funcionário entra e vê a própria agenda.

**Não conclua atendimento só para testar:** num estabelecimento com o
recurso, cada conclusão grava comissão real, que nunca é apagada.

Não há variável nova.

### 7. Publicar o web

Em `agenda-cloud-piloto-web`, publique o mesmo `<sha>`. Testes manuais:

1. `/login` responde `200`.
2. O dono de um Pro vê em Início o link "Ver comissões apuradas", e
   `/conta/comissoes` abre com o aviso de que comissão não é pagamento.
3. Profissionais → Comissões abre a escolha por serviço. **Não grave regra só
   para testar:** cada mudança é real e auditada.
4. O dono de um Básico sem exceção não vê comissões.
5. Um funcionário entra e vê o mesmo que antes. "Minhas comissões" aparece só
   depois de o dono conceder.
6. O link público `/agendar/<slug>` abre.

### 8. Limpeza

1. Feche as janelas.
2. Remova a worktree:
   `git -C C:\Projetos\Agenda-Cloud worktree remove C:\Projetos\Agenda-Cloud-publicacao-comissoes`.
3. Mantenha a pasta de operações.

## Levantamento

As fases `preparar`, `restauracao`, `aplicar` e `conferir` imprimem o
levantamento, e a consulta
`consultas/impacto-comissoes-profissionais-somente-leitura.sql` mostra o
mesmo. É **só leitura**: só ids, códigos e contagens.

| Saída | Significado |
| --- | --- |
| `PLANO: ... com_comissoes_agora=... com_comissoes_depois=...` | por plano: quem tem o recurso hoje e quem terá com o catálogo novo. Regra: exceção individual primeiro, senão o plano |
| `PASSAM_A_APURAR_COMISSOES` | estabelecimentos que passam a apurar com a API nova (antes da migration: a previsão; depois: 0) |
| `EXCECOES_DE_COMISSOES` | exceções individuais do recurso. Uma desligada num Pro continua desligando; uma ligada num Básico continua ligando |
| `REGRAS_DE_COMISSAO`, `APURACOES`, `APURACOES_SEM_ITEM` | o que já existe nas tabelas de comissão (nenhum código gravava até a 15ª); iguais antes e depois |
| `APURACOES_POR_ITEM` | "ainda não existe" antes; 0 logo depois da migration |
| `CONCESSOES_DAS_PROPRIAS_COMISSOES` | concessões ao funcionário; 0 até o dono conceder |
| `ATENDIMENTOS_CONCLUIDOS`, `ITENS_DE_RESERVA` | iguais antes e depois; nenhum concluído antes da API nova é apurado |

## Códigos de parada próprios deste kit

| Código | Fase | Significado | Gravou algo no piloto? |
| --- | --- | --- | --- |
| `ERR_MIGRATION_JA_APLICADA` | preparar, aplicar | o banco já está em `after-professional-commissions` | não |
| `ERR_ESTADO_ANTES_DIVERGENTE` | preparar, aplicar | nenhum dos dois estados | não |
| `ERR_MIGRATIONS_COMPILADAS_INESPERADAS` | aplicar, restauracao | o build não tem exatamente as quinze, na ordem (um commit com migration posterior é recusado de propósito) | não |
| `ERR_MIGRATION_FALHOU` | aplicar | o banco recusou e o estado "antes" foi confirmado intacto | não |
| `ERR_RESULTADO_INCERTO` | aplicar | conexão perdida depois do início | **talvez**: rode `conferir` |

Os demais são os de `publicacao-equipe-piloto.md`, por exemplo
`ERR_AJUSTE_DE_ENSAIO_NO_PILOTO`, `ERR_OPCOES_DO_NODE_NO_PILOTO`,
`ERR_CERTIFICADO_NAO_CONFIAVEL`, `ERR_SEM_BACKUP_COM_RESTAURACAO_CONFERIDA`,
`ERR_RESULTADO_ANTERIOR_INCERTO`, `ERR_BACKUP_DE_OUTRO_COMMIT` e
`ERR_BACKEND_COM_ALTERACOES_LOCAIS`.

## Resultado incerto

Funciona igual ao do portal:

- Depois de uma queda, o script nunca conclui "nada aplicado".
- A próxima `aplicar` para antes da URL.
- Só uma `conferir` posterior que identifique um dos dois estados, sem sessão
  da migration ativa, libera o registro.

Ensaiado com a sessão da migration derrubada no servidor durante a espera do
lock (`57P01`), pelo lançador, e com a janela fechada logo depois de
`migration_iniciada`. Nos dois casos a `conferir` leu
`before-professional-commissions`.

## Compatibilidade

Ensaio de 04/11/2026. As duas APIs rodaram em `dist/main.js` contra o mesmo
banco descartável, com dados fictícios e chamadas HTTP reais:

- a API anterior (`2656f69`, a publicada);
- a API nova (integration `9e548a3`, igual à do kit no backend da aplicação).

| Estado | API anterior | API nova |
| --- | --- | --- |
| 14 | tudo 200 (situação de hoje) | **não use.** Num estabelecimento **com** o recurso (Max, Básico com exceção ligada), concluir atendimento responde **500** e a conclusão é desfeita (a reserva continua em andamento); relatório e regras de comissão também respondem **500**. Num Pro, que ainda não tem o recurso, a conclusão passa sem apurar |
| 15 | tudo 200: login do dono e do funcionário, agenda, equipe, recebimentos, concluir; **não apura** (nenhuma linha em `commission_entries`); `/commissions` responde 404 | tudo 200; apura na conclusão; é o destino |

Na API nova, no estado 15, o ensaio conferiu:

- **Pro:** uma linha por item, com a fotografia do preço e da regra.
  - Sem regra, ou serviço sob consulta: valores nulos ("para conferência").
  - Uma regra criada depois não recalcula o que já foi apurado.
- **Max:** a regra que já existia foi aplicada (10% de R$ 50,00 = R$ 5,00).
- **Pro com exceção desligada:** concluir não apura, e a consulta responde
  403 `RECURSO_NAO_CONTRATADO`.
- **Funcionário:**
  - a conclusão da própria agenda apura;
  - "Minhas comissões" responde 403 até a concessão;
  - com a concessão (dada pelo dono depois da reautenticação), responde 200 e
    o funcionário ganha a área `AGENDA_PROPRIA_COMISSOES`.

**Volta à API anterior com comissões já apuradas e a concessão gravada:**

- Funciona: login do dono e do funcionário, equipe, agenda, recebimentos e
  conclusão.
- **Não apura:** a conclusão feita por ela ficou sem linha.
- Com a API nova de volta, essa conclusão continua sem comissão (não há
  preenchimento retroativo).
- As quatro apurações, as regras e a concessão continuaram intactas.

### Web

O web anterior foi conferido pelas funções reais dele (`buscarSessaoAtual`,
`ehVisaoDaEquipe`, `ehMinhaAgenda`), com as respostas reais da API nova:

- `/auth/me` do dono e do funcionário, com as áreas novas `COMISSOES_VER`,
  `COMISSOES_CONFIGURAR` e `AGENDA_PROPRIA_COMISSOES`: aceito;
- a equipe com a concessão `COMISSOES_PROPRIAS_VISUALIZAR`: aceita;
- a própria agenda: aceita.

O web anterior trata áreas e permissões como texto e só abre o que conhece.
As áreas novas não aparecem nele. Não houve ensaio no navegador.

| Combinação | Resultado |
| --- | --- |
| web anterior × API anterior, estado 15 | igual a hoje, sem apuração |
| web anterior × API nova (entre os dois deploys) | funciona, sem as telas de comissões; a apuração já acontece |
| web novo × API nova | destino |
| web novo × API anterior | as áreas de comissões não vêm da API anterior, então os links ficam escondidos (leitura do código, não ensaiado); sem apuração |

## Recuperação

**Regra geral:**

- não apague apurações, regras nem concessões;
- não use `migration:revert`;
- nunca restaure o backup por cima do piloto.

**Nenhuma dessas é recuperação padrão.** O backup serve para restaurar numa
cópia e consultar, ou para uma decisão excepcional e explícita do dono,
sabendo que tudo gravado depois dele se perde.

**Ordem:** publicar é sempre **migration → API → web**.

| Sintoma | Ação | Pare e não siga se |
| --- | --- | --- |
| falha na migration, nada gravado (`ERR_MIGRATION_FALHOU`) | repetir a fase `aplicar` em outro momento | — |
| resultado incerto | rodar `conferir` e seguir a partir do estado lido | `divergente` |
| conferência posterior falhou (código 2) | rodar `conferir`; comparar o catálogo com o backup numa cópia restaurada | o catálogo, os preços ou as exceções mudaram sem explicação |
| defeito de tela do web novo, API nova sã | **voltar só o web** para `2656f69`. A apuração continua; somem só as telas de comissões | — |
| defeito da API nova | **corrigir para frente** (commit novo, revisado, com checks; API e depois web) | — |
| defeito grave da API nova e o dono decide voltar a API anterior | só com decisão explícita, sabendo que **não é recuperação completa** (abaixo); registrar o período | — |
| problema de dados depois da migration | **parar** e investigar numa cópia restaurada | sempre |

**Voltar a API não é recuperação completa.** A API anterior aceita o schema
novo (ensaiado), mas, enquanto ela estiver no ar:

- as conclusões **não geram comissão**, e essas conclusões **nunca são
  apuradas depois**;
- a tela de comissões, as regras e a visão do funcionário param;
- o que já foi gravado fica intacto.

Use só para conter um defeito grave e registre o período em que ela ficou no
ar.

### Migration

**`migration:revert` é proibido depois da primeira apuração.** Ensaiado numa
cópia do estado 15 com quatro apurações por item, duas regras e uma concessão:

- o `down` recusou com "commission_entries tem apurações por item; o down
  apagaria histórico e foi recusado.";
- a transação foi desfeita (`ROLLBACK`): continuaram 15 migrations, 4
  apurações, 2 regras, a linha `pf_pc_equipe_comissoes` e a concessão.

Forçá-lo, apagando apurações para ele passar, apagaria histórico. Mesmo sem
apuração, o `down` deixa os valores de enum: o banco fica `divergente`, e
este kit não volta a aplicar sobre ele. A fase `conferir` mostra
`REVERSAO_AFETARIA_*` com as contagens reais.

## Ensaio (04/11/2026)

Nada foi executado contra o Neon, o piloto ou `agenda_dev`.
`IGNORE_DOTENV_FILE=true` e só dados fictícios.

### Ambiente

**Destino:** PostgreSQL **17.11** local.

- **Binários:** do zip
  `https://get.enterprisedb.com/postgresql/postgresql-17.11-1-windows-x64-binaries.zip`,
  baixado por HTTPS. Só `bin`, `lib` e `share` foram extraídos, e o zip foi
  apagado.
- **Hash:** sha256
  `6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3`,
  calculado localmente. É igual ao do ensaio do portal e **não foi comparado**
  com um checksum do fornecedor.
- **TLS:** só `hostssl` com `scram-sha-256`. O certificado é de uma CA
  descartável, para o host fictício
  `ep-ensaio-piloto-555.c-2.us-east-1.aws.neon.tech`; o modo ensaio desvia a
  conexão para 127.0.0.1.
- **Banco:** `neondb`, com dono **não superusuário**. As catorze migrations
  foram aplicadas pelo runtime compilado da versão publicada (`2656f69`).

**Dados**, criados pela API publicada no que tem rota e por SQL no resto:

- cinco estabelecimentos:
  - Pro;
  - Pro com exceção de comissões desligada;
  - Básico com exceção ligada;
  - Max;
  - Básico;
- em três deles:
  - dono;
  - serviço com preço e serviço sob consulta;
  - profissional com horário e cliente;
  - reservas concluída (com recebimento), em andamento e futura;
- no Pro, um funcionário com login e a própria agenda;
- uma regra de comissão antiga no Max;
- um preço do catálogo;
- um "sem vencimento";
- um `MASTER_OWNER`.

**Commit do kit ensaiado:** `d3d5ce19d74c9b3e23a1c7a205bbcc163d7b6adf`.
Depois dele mudaram só a documentação. Para conferir, rode
`git diff d3d5ce1 <sha> -- backend/scripts backend/src backend/test`, que deve
sair vazio.

### Rodadas pelo lançador oficial

**Como:** `abrir-comissoes-profissionais-piloto.ps1 -Ensaio` rodou por
`powershell.exe -File` dentro de um **pseudoconsole real do Windows** (ConPTY,
pelo pacote `@lydell/node-pty`, fora do repositório). A URL foi digitada no
prompt oculto e a frase no de confirmação, como um operador. Não houve
`node --import`, harness nem alteração do kit.

| # | Fase | Resultado |
| --- | --- | --- |
| 1 | `conferir` | `ESTADO: before-professional-commissions`, 14, 0/15; `PASSAM_A_APURAR_COMISSOES: 1` (o Pro; o Pro com exceção desligada não); código 0 |
| 2 | `preparar` | backup de 171.965 bytes, 44 tabelas; código 0 |
| 3 | `aplicar` sem restauração conferida | `BACKUP_CONFERIDO: nenhum`, `ERR_SEM_BACKUP_COM_RESTAURACAO_CONFERIDA`, antes da URL; código 1 |
| 4 | `restauracao` | 44 tabelas com contagens e md5 iguais; na cópia, só ProfessionalCommissions; todas as linhas `ENSAIO_*` `true`, inclusive catálogo, preços e exceções iguais, só a linha nova, e a previsão de quem passa a apurar conferida; código 0 |
| 5 | `aplicar`, frase errada | backup novo, `MESMO_SERVIDOR_DO_BACKUP_CONFERIDO: sim`, `abortado_sem_gravacao`; código 1; banco com 14 |
| 6 | `aplicar` com outra sessão segurando `commission_entries` | `55P03` em ~10 s; `before-professional-commissions` intacto (nenhum valor de enum, nenhuma linha no catálogo); `ERR_MIGRATION_FALHOU`; código 1 |
| 7 | `aplicar` com a janela fechada logo depois de `migration_iniciada` | registro sem desfecho |
| 8 | `aplicar` em seguida | `ERR_RESULTADO_ANTERIOR_INCERTO`, antes da URL; código 1 |
| 9 | `conferir` | `before-professional-commissions`; código 0 (libera) |
| 10 | `aplicar` com a sessão da migration derrubada no servidor (`pg_terminate_backend`) durante a espera do lock | `57P01`, `ERR_RESULTADO_INCERTO`, `DESFECHO: resultado_incerto`; **código 3** |
| 11 | `aplicar` em seguida | `ERR_RESULTADO_ANTERIOR_INCERTO`; código 1 |
| 12 | `conferir` | `before-professional-commissions`; código 0 |
| 13 | `aplicar` | `TLS_MIGRATION: TLSv1.3`, `SESSAO_DA_MIGRATION: mesma=true lock_timeout=10s`; só ProfessionalCommissions; 15, 15/15; `CATALOGO_PRESERVADO: sim`; `CONTAGENS_DESDE_O_BACKUP: iguais`; `PASSAM_A_APURAR_COMISSOES: 0`; `ESTADO: after-professional-commissions`; código 0 |
| 14 | `conferir` | `after-professional-commissions`, "a API nova pode ser publicada"; código 0 |
| 15 | `aplicar` de novo | `ERR_MIGRATION_JA_APLICADA`; código 1 |
| 16 | `preparar` de novo | `ERR_MIGRATION_JA_APLICADA`; código 1 |
| 17 | `aplicar` numa cópia do estado 14, com um preço do catálogo gravado por fora enquanto o prompt da frase estava aberto | a migration entrou; `CATALOGO_PRESERVADO: NÃO (plan_prices)`; `aplicada_conferencia_falhou`, `NAO_REPITA`; **código 2** |
| 18 | `conferir` | `after-professional-commissions`; código 0 |
| 19–20 | `conferir` e `aplicar` num estado 14 com o Pro já ligado a comissões por outra linha | `divergente` (`pro_plan_already_has_commissions`); `ERR_ESTADO_ANTES_DIVERGENTE`; código 1 |
| 21–22 | `conferir` e `preparar` num banco com 13 migrations | `divergente`; `ERR_ESTADO_ANTES_DIVERGENTE`, antes do backup; código 1 |
| 23 | lançador em modo piloto com Endpoint ID de ensaio | `ERR_ENDPOINT_DE_ENSAIO_NO_PILOTO`, antes da URL; código 1 |
| 24–28 | URL com outro endpoint, com o endpoint proibido, com pooler, com `sslmode=no-verify` e com outro banco | `ERR_ENDPOINT_DIFERENTE_DO_PILOTO`, `ERR_ENDPOINT_PROIBIDO`, `ERR_POOLER`, `ERR_TLS_AFROUXADO`, `ERR_BANCO_DIFERENTE_DE_NEONDB`; código 1, sem conexão |
| 29 | `-EnsaioCa` com outra CA | `ERR_CERTIFICADO_NAO_CONFIAVEL`; código 1 |

**Script direto, modo piloto:** cada caso parou antes da URL, com
`parado_sem_gravacao`:

| Situação | Código |
| --- | --- |
| CA do ensaio definida | `ERR_AJUSTE_DE_ENSAIO_NO_PILOTO` |
| `NODE_OPTIONS` definida | `ERR_OPCOES_DO_NODE_NO_PILOTO` |
| `NODE_EXTRA_CA_CERTS` definida | `ERR_CA_EXTRA_NO_PILOTO` |
| endpoint do piloto igual ao proibido | `ERR_PILOTO_IGUAL_AO_PROIBIDO` |
| modo desconhecido | `ERR_MODO_INVALIDO` |
| ensaio fora do loopback | `ERR_ENSAIO_FORA_DO_LOOPBACK` |

**Senha nas transcrições:** nenhuma das transcrições contém a senha do banco.
O próprio driver conferiu cada uma.

**Preservação no banco aplicado pelo lançador** (rodada 13), comparando a
fotografia do modelo de 14 com a do resultado:

- todas as tabelas com contagem e md5 iguais, menos `commission_entries`
  (coluna nova, 0 linhas por item), `plan_features` (26 para 27 linhas) e o
  histórico de migrations;
- a primeira tentativa da rodada 17 caiu no próprio driver (erro no gancho do
  ensaio) antes de a frase ser digitada, e nada foi enviado; foi repetida.

### Testes automáticos

- **`comissoes-profissionais-piloto.spec.ts`:** identidade da operação,
  estados, comprovante, execução pendente, contagens esperadas e desfechos.
- **`lib/comissoes-profissionais-schema.spec.ts`:** nomes e definições
  conferidos contra o texto da migration, e as falhas de cada estado.
- **`test/pilot-comissoes-profissionais-check.db-e2e-spec.ts`:**
  - a conferência e o levantamento no banco compartilhado;
  - a consulta do runbook, com escrita nenhuma;
  - a aplicação real 14 → 15 por `aplicarSomenteAPendente` num banco
    temporário: catálogo preservado além da linha nova, e repetição recusada
    antes de qualquer comando.

### Limitações

- **O banco não é o Neon:** o banco descartável é PostgreSQL local no Windows.
  Os binários 17.11 têm só o sha256 calculado localmente (ver "Ambiente").
- **Quedas:** foram provocadas no servidor local (`pg_terminate_backend`) e
  pelo fechamento do processo, não por falha de rede do Neon.
- **Entrada digitada pelo driver:** o lançador rodou num pseudoconsole com a
  entrada digitada pelo driver do ensaio, não por uma pessoa no Windows
  Terminal. A colagem real com Ctrl+V é a ensaiada nas publicações
  anteriores.
- **Navegador:** não houve ensaio no navegador. O web anterior foi conferido
  pelas funções de validação dele com as respostas reais da API nova; o web
  novo × API anterior, só pela leitura do código.
- **Render:** a troca de API no Render não foi ensaiada.
- **Dados reais:** não foram lidos. Quantos estabelecimentos passam a apurar,
  só o `preparar` dirá.
