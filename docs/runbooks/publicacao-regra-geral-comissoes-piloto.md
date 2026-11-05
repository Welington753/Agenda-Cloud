# Runbook — Publicar as comissões completas no piloto (migrations 15 e 16)

Este runbook leva o piloto do estado atual (14 migrations no banco, API e web
em `92cc6ae`) às comissões completas: regra por serviço, "Recebe comissão" e
regra geral por profissional. São duas migrations, cada uma com o próprio kit,
e um ponto de parada estável entre elas:

1. `ProfessionalCommissions1793491200000` (15ª), com o kit existente
   (`publicacao-comissoes-profissionais-piloto.md`), sem mudança;
2. `ProfessionalCommissionSettings1793577600000` (16ª), com o kit deste
   runbook.

Publicar é sempre **migration → API → web**. Voltar é **web → API**.
`docs/runbooks/migrations-production.md` **não** serve para estas migrations.

**Este documento nunca contém credencial, URL de banco, Endpoint ID ou
endereço real.** `<sha>`, `<ep-...>` e `<web>` são digitados por quem opera.

## Estado em 05/11/2026

**Preparação concluída** neste repositório, sem tocar no piloto: kit da 16,
testes e ensaio completo em PostgreSQL 17.11 descartável com dados fictícios
(ver "Ensaio").

**Operação no piloto: nada executado.** Nenhuma conexão com o piloto, nenhum
backup, nenhuma migration, nada publicado no Render.

**Estado do piloto informado em 05/11/2026:**

- banco com 14 migrations; os logs confirmaram que os objetos da 15 não
  existem;
- API e web publicados manualmente em `92cc6ae`. Auto-Deploy desligado.

**Nesse estado a API publicada está quebrada onde há comissões:** nos
estabelecimentos com o recurso (Max, Básico com exceção ligada), concluir
atendimento responde 500, e o relatório e a gravação de regra também.
Ensaiado em 05/11/2026 e visto nos logs do piloto. A contenção (voltar web e
API para `2656f69`) é decisão do dono e não faz parte deste runbook; ver
"Recuperação", estado 14.

## O kit da 16

Mesmo molde do kit da 15 e das mesmas peças comuns (`operacao-piloto.mjs`,
`entrada-oculta.mjs`, `equipe-piloto.mjs`). **Os executáveis dos kits
anteriores não mudaram**: o da 15 continua recusando um runtime com a 16
compilada (`ERR_MIGRATIONS_COMPILADAS_INESPERADAS`) e só serve no commit
dele.

| Arquivo (`backend/scripts/`) | Papel |
| --- | --- |
| `abrir-regra-geral-comissoes-piloto.ps1` | lançador (por `-File`) |
| `aplicar-regra-geral-comissoes-piloto.mjs` | fases `preparar`, `aplicar` e `conferir` |
| `conferir-restauracao-regra-geral-comissoes.mjs` | fase `restauracao` |
| `regra-geral-comissoes-piloto.mjs` | estados, comprovante, execução pendente, início da janela e desfechos |
| `lib/regra-geral-comissoes-schema.ts` | conferência dos estados, invariantes da transição, janela, levantamento e reversão |
| `lib/pilot-database-check.ts` | expectativas `before-commission-settings` e `after-commission-settings` (também pelo `npm run pilot:check-database`) |

Consultas só leitura, em `docs/runbooks/consultas/`:

- `impacto-regra-geral-comissoes-somente-leitura.sql`: nos dois estados. Mostra
  os totais e os estabelecimentos ativos com quem combinar a janela (só ids);
- `janela-regra-geral-comissoes-somente-leitura.sql`: só no estado 16. Lista o
  que foi criado ou apurado desde o início da janela.

## Os dois estados da 16

| Estado | Migrations | O que exige |
| --- | --- | --- |
| `before-commission-settings` | 15 | o **baseline 15 válido**: exatamente as quinze, na ordem; a conferência `after-professional-commissions` inteira (a mesma função do kit da 15); nenhum objeto da 16 |
| `after-commission-settings` | 16 | as dezesseis, na ordem; a mesma conferência do baseline 15, **sem exigir um histórico de exatamente quinze**; a tabela `professional_commission_settings` com colunas, tipos, nulidade e padrões exatos, só o índice da chave e nenhum gatilho; a coluna `commission_entries.applied_rule_scope` (`varchar(10)`, anulável, sem padrão); as cinco constraints com a **definição exata** (`pg_get_constraintdef`), não só nome e tipo |

A fase `conferir` identifica um deles. Exatamente uma conferência precisa
passar; com nenhuma ou com as duas, `ESTADO: divergente`. Objeto parcial da 16
(só a tabela, só a coluna) é `divergente`.

**O estado "depois" é permanente e vale para um banco em uso.** Configurações
gravadas e apurações com escopo são uso normal da API nova e nunca o
invalidam.

**Invariantes da transição** (tabela nova vazia, nenhum escopo gravado) são
conferidas **só** em dois momentos:

- logo depois do COMMIT, na fase `aplicar` (`TRANSICAO: ok`). Falha aqui é
  código 2;
- na cópia restaurada (`ENSAIO_TRANSICAO: ok`).

A fase `conferir` mostra as contagens, mas não as exige.

## Commits de cada etapa

| Etapa | Commit | Onde |
| --- | --- | --- |
| kit da 15 (todas as fases) | `92cc6ae` | worktree limpa nesse commit, `npm ci` próprio. É o commit publicado hoje e o único com o kit da 15 e exatamente 15 migrations |
| API e web da 15 | `92cc6ae` | já publicados; republicar só se houve contenção |
| kit da 16 (todas as fases) | **C16** = merge do PR do kit na integração | worktree limpa no C16, `npm ci` próprio |
| API e web da 16 | **C16** | o mesmo SHA nos dois deploys |

- **C16 é definido depois da aprovação e do merge** do PR da funcionalidade
  (`0ff8f46`) e do PR deste kit. Os dois merges levam `[skip render]`.
- A fase `restauracao` recusa backup de outro commit, e a `aplicar` recusa
  backup ou restauração de outro commit ou modo.
- **Comprovantes de ensaio não valem no piloto.** Os de 05/11/2026 são dos
  commits `92cc6ae` e `e42fb81`.
- Para conferir que o C16 tem o kit ensaiado, rode
  `git diff e42fb81 <C16> -- backend/scripts backend/src`. Deve sair vazio.

## Janela de transição

**Por quê.** Entre a frase da fase `aplicar` da 16 e o web novo estar Live,
duas coisas mudam de comportamento sem aviso:

1. **Entre a migration e a API nova Live**, a API no ar é a anterior:
   - Profissional cadastrado nela fica **sem configuração**, e por isso
     recebe comissão (comportamento antigo). Pela API nova, ele nasceria
     desligado.
   - Atendimento concluído por ela é apurado **sem escopo** e ignora
     "Recebe comissão". Ensaiado: com o profissional desligado, a API
     anterior apurou R$ 15,00.
2. **Entre a API nova Live e o web novo Live**, o web é o anterior:
   - Profissional cadastrado nasce **desligado**, e o web anterior não tem
     como ligá-lo.
   - Toda conclusão dele até o dono ligar fica **sem comissão para sempre**:
     não há apuração retroativa.

Publicar rápido não resolve. A troca de instância do Render não foi ensaiada.

**O que fica indisponível na janela:**

- **cadastrar profissional**, em **qualquer** estabelecimento: a API nova grava
  a configuração em todos, com ou sem o recurso;
- **concluir atendimento** nos estabelecimentos **com o recurso de
  comissões**.

O resto continua: agenda, reservas, agendamento público, recebimentos,
equipe, serviços. Isso foi ensaiado nas três APIs.

| | |
| --- | --- |
| **Antes de começar** | Rode a consulta de impacto (seção 2): ela lista os estabelecimentos ativos, quem tem comissões e quantos profissionais ativos. Combine com o dono de cada um que ninguém cadastra profissional e, nos com comissões, ninguém conclui atendimento até o aviso de fim. Escolha um horário fora do expediente deles. **Se não for possível combinar com todos, não comece** |
| **Opção mais forte (não ensaiada)** | Suspender o serviço web no Render antes da frase. O web usa o proxy `/agenda_api`, então o navegador perde o acesso à API. Depois, retomar e publicar o C16. A retomada traz o web anterior por alguns minutos, durante o build do novo, e a janela continua. A API continua acessível pelo endereço próprio. Não ensaiado |
| **Começa** | na fase `aplicar` da 16, antes da frase. Ela imprime `JANELA_DESDE` (relógio do banco, UTC) e grava o instante no registro |
| **Como conferir** | fase `conferir` depois do web novo Live. `JANELA_DE_TRANSICAO: ok` significa nada criado nem apurado pela API anterior desde o início. `VIOLADA` sai com código 1. Profissionais "desligados" criados pela API nova aparecem na contagem e são esperados |
| **Termina** | quando o web novo estiver Live **e** a `conferir` mostrar `JANELA_DE_TRANSICAO: ok`. Avise os donos |

**Com `VIOLADA`:**

- Não reabra o uso.
- Rode a consulta `janela-regra-geral-comissoes-somente-leitura.sql`, com
  autorização para a leitura, trocando `<JANELA_DESDE>` pelo instante impresso.
  Ela lista só ids e datas.
- A regularização é individual e decidida pelo dono, pelo web novo:
  - **profissional `API_ANTERIOR`** (sem configuração, recebe): abrir
    Profissionais → Comissões e decidir ligar ou desligar. Salvar grava a
    linha;
  - **profissional `API_NOVA` desligado**: ligar se deve receber. Conclusões
    feitas antes disso não são apuradas;
  - **apuração da API anterior** (sem escopo, ignorou a configuração): fica
    como está e aparece como "regra por serviço". Não apague: o histórico é
    imutável. Se não devia existir, o dono decide fora do sistema.

Ensaiado em 05/11/2026: profissionais e apurações criados pelas APIs
`2656f69` e `92cc6ae` depois da migration deram `VIOLADA` (6 profissionais
sem configuração, 2 apurações da API anterior, código 1). A consulta listou
os mesmos 9 profissionais (6 da API anterior e 3 da nova) e as 2 apurações.

## Pré-requisitos (uma vez)

Os mesmos de `publicacao-comissoes-profissionais-piloto.md`:

- Windows Terminal e Node 24;
- PostgreSQL para Windows com `pg_dump`, `pg_restore`, `initdb` e `pg_ctl`
  **iguais ou mais novos que o servidor do piloto** (`-PgBin`; o último
  conhecido é 17.11);
- `openssl.exe` do Git;
- a URL direta do piloto, o Endpoint ID do piloto e o Endpoint ID proibido;
- a pasta `%USERPROFILE%\AgendaCloud-operacoes`, fora do repositório. Ela
  guarda dumps completos, com hashes de senha.

**Backups e restaurações reais só no computador de casa.** Nunca neste
computador do trabalho.

## Sequência completa

Qualquer `ERRO:` para a sequência; vale então "Recuperação". Cada `aplicar` e
cada deploy no Render exige autorização expressa do dono naquele momento.

```powershell
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass -File <lancador> -Fase <fase> -PilotEndpointId <ep-piloto> -ProductionEndpointId <ep-proibido> -PgBin 'C:\Program Files\PostgreSQL\17\bin'
```

### 1. Migration 15 (kit existente, commit `92cc6ae`)

1. Crie uma worktree limpa em `92cc6ae`, com `npm ci` próprio em `backend`
   (nunca uma junção):
   ```powershell
   git -C C:\Projetos\Agenda-Cloud worktree add --detach C:\Projetos\Agenda-Cloud-publicacao-15 92cc6ae
   ```
2. Siga os passos 1 a 5 de `publicacao-comissoes-profissionais-piloto.md`
   com o lançador `abrir-comissoes-profissionais-piloto.ps1` dessa worktree.
   As fases são `conferir`, `preparar`, `restauracao`, `aplicar` e
   `conferir`. Esperado no fim: `ESTADO: after-professional-commissions`,
   `SCHEMA_OBJECTS_OK: 15/15`, `CATALOGO_PRESERVADO: sim`.
   - Aquele runbook dizia que o estado esperado era "API e web em
     `2656f69`". Hoje estão em `92cc6ae`; o kit não confere o Render e
     funciona igual (ensaiado).
3. **API e web:** se continuam em `92cc6ae`, não há deploy. Se houve
   contenção (`2656f69`), publique `92cc6ae` na API e depois no web (passos 6
   e 7 daquele runbook).
4. Confira:
   - `GET <web>/agenda_api/auth/me` sem cookie responde `401`;
   - o dono entra;
   - agenda, serviços, equipe e recebimentos abrem;
   - **não conclua atendimento para testar.**

**Ponto de parada estável.** No estado 15 com `92cc6ae`, tudo funciona e
apura (ensaiado). Pode ficar dias aqui. A 16 começa em outra sessão, quando
houver janela combinada.

### 2. Preparar a janela da 16 (só leitura)

1. Crie uma worktree limpa no **C16**, com `npm ci` próprio.
   `<lancador>` é
   `C:\Projetos\Agenda-Cloud-publicacao-16\backend\scripts\abrir-regra-geral-comissoes-piloto.ps1`.
2. Rode `-Fase conferir`. Esperado:
   - `ESTADO: before-commission-settings`;
   - `MIGRATIONS_APPLIED: 15`;
   - `SCHEMA_OBJECTS_OK: 0/7`;
   - `SESSOES_DA_MIGRATION_ATIVAS: 0`.
3. Com autorização para a leitura, rode a consulta de impacto e combine a
   janela (seção "Janela de transição").

### 3. Preparar (só leitura) e restauração (sem conexão com o piloto)

1. Rode `-Fase preparar`. Esperado:
   - `RESULT: SUCCESS` no `before-commission-settings`;
   - o levantamento;
   - `BACKUP_OK: ... tabelas=44`;
   - `RESULTADO: preparado, nada gravado no banco`.
2. Rode `-Fase restauracao`, sem os Endpoint IDs. Esperado:

   ```text
   SHA256_CONFERE: true
   CONTAGENS_IGUAIS: true
   CONTEUDO_IGUAL_MD5: true
   ENSAIO_ANTES (before-commission-settings): ok
   APLICADAS: ProfessionalCommissionSettings1793577600000
   ENSAIO_DEPOIS (after-commission-settings): ok
   ENSAIO_DADOS_PRESERVADOS: true
   ENSAIO_CONTAS_ESTABELECIMENTOS_CATALOGO_RESERVAS_IGUAIS: true (...)
   ENSAIO_COLUNAS_ANTIGAS_IGUAIS: true (commission_entries)
   ENSAIO_SO_AS_COLUNAS_PREVISTAS: true (commission_entries+applied_rule_scope)
   ENSAIO_COLUNAS_NOVAS_NULAS: true (commission_entries=0)
   ENSAIO_SO_AS_TABELAS_PREVISTAS: true (professional_commission_settings)
   ENSAIO_TABELAS_NOVAS_VAZIAS: true (professional_commission_settings=0)
   ENSAIO_TRANSICAO: ok
   ENSAIO_PROFISSIONAIS_REGRAS_APURACOES_IGUAIS: true (...)
   ENSAIO_HISTORICO_MAIS_UMA: true
   DESCARTAVEL_APAGADO: true
   ```

   Todas as tabelas, inclusive catálogo, preços, exceções, profissionais,
   reservas e auditoria, ficam com contagem e md5 iguais. Só podem mudar a
   coluna nova (NULL em todas as linhas) e a tabela nova (vazia).

### 4. Aplicar a 16: única fase que escreve

Rode `-Fase aplicar`. A migration cria a tabela (a FK trava `professionals`
por um instante) e acrescenta a coluna e uma check em `commission_entries`
(trava curta). Com `lock_timeout` de 10 s, se uma requisição segurar uma
delas, a migration desiste e o banco desfaz tudo.

1. **Antes da URL:**
   - recusa execução anterior sem desfecho;
   - exige o backup do passo 3 com a restauração conferida, do mesmo modo,
     endpoint e commit, com até 24 h.
2. Repete destino, TLS, `before-commission-settings` e o levantamento; faz um
   **backup novo** do mesmo servidor.
3. Imprime `JANELA_DESDE` e o aviso da janela. **A janela começa aqui.**
4. Confira `MESMO_SERVIDOR_DO_BACKUP_CONFERIDO: sim` e digite:

   ```text
   APLICAR ProfessionalCommissionSettings1793577600000
   ```

5. Aplica só a 16, numa transação, e confere em seguida. Esperado:

   ```text
   APLICADAS: ProfessionalCommissionSettings1793577600000
   SESSAO_DA_MIGRATION: mesma=true lock_timeout=10s
   COMMIT: ok
   MIGRATIONS_APPLIED: 16
   SCHEMA_OBJECTS_OK: 7/7
   TRANSICAO_CONFIGURACOES: 0
   TRANSICAO_APURACOES_COM_ESCOPO: 0
   TRANSICAO: ok
   ESTADO: after-commission-settings
   DESFECHO: aplicada_e_conferida
   ```

`CONTAGENS_DESDE_O_BACKUP` é só informativa.

| `DESFECHO` | Código | Ação |
| --- | --- | --- |
| `aplicada_e_conferida` | 0 | publicar a API (passo 5) |
| `abortado_sem_gravacao` | 1 | frase diferente; repetir quando quiser |
| `parado_sem_gravacao` | 1 | nada gravado (inclui `55P03` com o estado antes confirmado); repetir em outro momento |
| `aplicada_conferencia_falhou` | 2 | **gravada**; não rode `aplicar`; rode `conferir` e investigue |
| `resultado_incerto` | 3 | não rode `aplicar`; rode `conferir` |

O código, sozinho, não comprova aplicação. A prova é o `ESTADO` conferido e o
registro em `operacoes.jsonl`.

### 5. Publicar a API C16

Só com `ESTADO: after-commission-settings`. Em `agenda-cloud-piloto-api`:
**Manual Deploy → Deploy a specific commit → `<C16>`**. Espere **Live** e
confira:

- `GET <web>/agenda_api/auth/me` sem cookie responde `401`;
- o dono entra pelo web atual e a agenda abre;
- a fase `conferir` continua `after-commission-settings`.

Não crie profissional nem conclua atendimento para testar: a janela continua.

### 6. Publicar o web C16

Em `agenda-cloud-piloto-web`, publique o mesmo `<C16>`. Depois de **Live**:

1. Rode `-Fase conferir`. Esperado:
   - `ESTADO: after-commission-settings`;
   - `JANELA_DE_TRANSICAO: ok`;
   - `DESFECHO: estado_identificado`.

   Com `VIOLADA`, ver "Janela de transição".
2. **Fim da janela:** avise os donos.
3. Testes manuais:
   - `/login` responde 200;
   - em Profissionais, cada profissional existente mostra "Recebe comissão"
     (sem configuração = recebe);
   - em Profissionais → Comissões, o cartão "Recebe comissão" e a regra geral
     aparecem, e cada serviço mostra a regra que vale e a origem;
   - o relatório de comissões abre, e as apurações antigas aparecem como
     "regra por serviço";
   - **não grave configuração nem regra só para testar:** cada mudança é real
     e auditada.

### 7. Limpeza

Feche as janelas. As worktrees de publicação e a pasta de operações ficam;
remova-as só quando o dono decidir.

## Compatibilidade

Ensaio de 05/11/2026, com HTTP real contra o mesmo banco descartável e dados
fictícios. Para cada estado, nos estabelecimentos Max e Pro: cadastrar
profissional, concluir atendimento, regras, configurações e relatório.

| Estado | API `2656f69` | API `92cc6ae` (C15) | API C16 (`0ff8f46` + kit) |
| --- | --- | --- | --- |
| 14 | tudo 201/200; comissões 404; sem apuração | **não use**: no Max, concluir responde **500** (a reserva fica `CONFIRMED`) e o relatório também; o Pro conclui sem apurar | **não use**: cadastrar profissional responde **500** no Max e no Pro; no Max, concluir e as leituras também |
| 15 | funciona; não apura | **destino da 15**: apura (Max: regra fixa R$ 15,00; Pro: item "não configurado") | **não use**: cadastrar profissional (Max), concluir (Max e Pro) e as leituras de comissões respondem **500** |
| 16 | funciona; não apura; profissional novo fica sem configuração | funciona; apura **sem escopo**; profissional novo sem configuração; **ignora "Recebe comissão" desligado** (apurou R$ 15,00 de profissional desligado) | **destino**: profissional novo nasce desligado; apuração com escopo `SERVICE`; com o profissional desligado, conclui sem apurar; configurações 200 |

O 409 no cadastro de profissional do Pro em uma rodada foi o limite de vagas
do plano, não o schema. Os extras fictícios foram desativados antes das
rodadas seguintes.

> **Resultado comprovado: a API `92cc6ae` sobre o schema 16 ignora "Recebe
> comissão" desligado.** No ensaio, o dono desligou o profissional do Max pela
> API C16 (`PUT .../commissions/settings/<profissional>` → 200). Depois, com a
> API `92cc6ae` no ar, a conclusão de um atendimento desse profissional
> **apurou R$ 15,00** (regra fixa do serviço, sem escopo). Com a API C16, a
> mesma conclusão não apurou nada.
>
> - A `92cc6ae` não lê `professional_commission_settings`. Pela leitura do
>   código, ela também ignora a regra geral do profissional; isso não foi
>   ensaiado por HTTP.
> - Profissional cadastrado por ela fica sem configuração e, por isso, recebe.
>
> Por isso, voltar a API para `92cc6ae` depois da 16 **não é uma recuperação
> equivalente**. Ver "Recuperação".

| Web × API | Resultado | Como foi visto |
| --- | --- | --- |
| web `92cc6ae` × API C16 (entre os deploys) | funciona sem o cartão; o validador antigo aceita a resposta nova (só confere campos que já existiam); profissional cadastrado nasce desligado sem como ligar | leitura do código: `ehRegrasDoProfissional` de `92cc6ae` |
| web C16 × API `92cc6ae` | a tela de comissões do profissional mostra "Não foi possível carregar as comissões" (o validador novo exige `settings` e `effective`); a lista de profissionais fica sem o selo; o resto funciona | leitura do código |
| web C16 × API C16 | destino | ensaio de 0ff8f46 (navegador) |

## Recuperação

**Regra geral:**

- não apague configurações, apurações, regras nem concessões;
- não use `migration:revert`;
- nunca restaure backup por cima do piloto. O backup serve para restaurar
  numa cópia e consultar.

| Estado | Situação | Ação | Não faça |
| --- | --- | --- | --- |
| 14 (hoje) | API e web `92cc6ae` quebram onde há comissões | contenção, se o dono decidir: web e depois API para `2656f69` (ensaiado: tudo funciona, sem comissões). Volta a tirar do ar as correções dos PRs #94 e #90 | publicar a API C16 |
| durante o kit da 15 ou da 16 | `ERRO` antes da frase, frase errada, `55P03` | nada gravado; repetir em outro momento | — |
| durante o kit | código 3 ou janela fechada | rodar `conferir` e seguir o estado lido (ensaiado: leu "antes") | repetir `aplicar` antes da `conferir` |
| durante o kit | código 2 | rodar `conferir`; comparar numa cópia restaurada | repetir `aplicar` |
| 15 | defeito da API `92cc6ae` | corrigir para frente; ou web e depois API para `2656f69`, que **não equivale**: não apura, e conclusões feitas nela nunca são apuradas. Combine com os donos não concluir atendimento nos estabelecimentos com comissões enquanto ela estiver no ar, e registre o período | `migration:revert` (recusa com apuração por item) |
| 16, API anterior no ar | migration aplicada, API C16 ainda não publicada | publicar a API C16; a janela continua valendo | reabrir cadastro e conclusão |
| 16, API C16 no ar | defeito de tela do web novo | voltar **só o web** para `92cc6ae`. A apuração continua certa; o cartão some e profissional novo nasce desligado sem como ligar (não cadastre até corrigir) | — |
| 16, API C16 no ar | defeito da API nova | corrigir para frente (commit novo, revisado, com checks; API e depois web) | — |
| 16, API C16 no ar | defeito grave e o dono decide voltar a API | **não é recuperação equivalente**; siga "Voltar a API com o schema 16" abaixo | voltar só a API e deixar o web C16 (a tela de comissões não carrega); reabrir conclusões nos estabelecimentos com comissões enquanto a API anterior estiver no ar |
| 16 | problema de dados | parar; investigar numa cópia restaurada | — |

### Voltar a API com o schema 16

Voltar a API depois da 16 tira o sistema do ar parcialmente: nenhuma API
anterior respeita as configurações gravadas.

| API de volta | O que acontece com o schema 16 |
| --- | --- |
| `92cc6ae` | Apura **ignorando "Recebe comissão" desligado** (ensaiado: R$ 15,00 de profissional desligado). Apura sem escopo e ignora a regra geral (leitura do código). Profissional cadastrado fica sem configuração e recebe |
| `2656f69` | Não apura nada. Conclusão feita nela **nunca** é apurada: não há apuração retroativa |

As duas apurações erradas são permanentes. O histórico de apurações é
imutável, e a `92cc6ae` grava valores que a configuração do dono recusaria.

**Antes de voltar a API (decisão do dono):**

1. Combine com os donos a mesma indisponibilidade da janela de transição:
   - ninguém conclui atendimento nos estabelecimentos com o recurso de
     comissões;
   - ninguém cadastra profissional em nenhum estabelecimento.

   **Sem esse bloqueio combinado, não volte a API.** A opção mais forte
   (suspender o web) vale também aqui, com as mesmas ressalvas e sem ensaio.
2. Publique web e depois API para `92cc6ae`. Anote o instante em que a API
   anterior ficou **Live** (UTC, do painel do Render).
3. O bloqueio dura até a API C16 corrigida e o web C16 voltarem a ficar
   **Live**, nessa ordem.
4. Antes de reabrir o uso, rode a consulta
   `janela-regra-geral-comissoes-somente-leitura.sql`, com autorização para a
   leitura, usando o instante do passo 2 no lugar de `<JANELA_DESDE>`.
   - Se ela listar profissionais `API_ANTERIOR` ou apurações sem escopo, o
     bloqueio falhou. Regularize como em "Com `VIOLADA`".
   - A linha `JANELA_DE_TRANSICAO` da fase `conferir` **não** cobre este
     período: ela usa o início da janela da migration.

Corrigir para frente continua sendo o caminho preferido.

**`migration:revert` da 16:** o `down` recusa quando há configuração gravada
ou apuração com escopo ("o down apagaria histórico e foi recusado"). Sem
dados novos ele desfaz tudo, mas não é recuperação padrão: a API C16 no ar
quebraria de novo. A fase `conferir` mostra `REVERSAO_AFETARIA_*`.

## Códigos de parada próprios do kit da 16

| Código | Fase | Significado | Gravou algo? |
| --- | --- | --- | --- |
| `ERR_MIGRATION_JA_APLICADA` | preparar, aplicar | o banco já está em `after-commission-settings` | não |
| `ERR_ESTADO_ANTES_DIVERGENTE` | preparar, aplicar | nenhum dos dois estados (14, objeto parcial, histórico diferente) | não |
| `ERR_MIGRATIONS_COMPILADAS_INESPERADAS` | aplicar, restauracao | o build não tem exatamente as dezesseis, na ordem | não |
| `ERR_MIGRATION_FALHOU` | aplicar | o banco recusou e o estado "antes" foi confirmado intacto | não |
| `ERR_RESULTADO_INCERTO` | aplicar | conexão perdida depois do início | **talvez**: rode `conferir` |
| `janela_de_transicao_violada` (desfecho, código 1) | conferir | algo criado ou apurado pela API anterior desde o início da janela | não (só leitura) |

Os demais são os de `publicacao-equipe-piloto.md`, por exemplo
`ERR_SEM_BACKUP_COM_RESTAURACAO_CONFERIDA`, `ERR_RESULTADO_ANTERIOR_INCERTO`,
`ERR_BACKUP_DE_OUTRO_COMMIT` e `ERR_BACKEND_COM_ALTERACOES_LOCAIS`.

## Ensaio (05/11/2026)

Nada foi executado contra o Neon, o piloto ou `agenda_dev`. Só dados
fictícios, `IGNORE_DOTENV_FILE=true`.

### Ambiente

- **PostgreSQL 17.11** local:
  - binários do zip oficial da EDB, sha256
    `6eabdf00d2893713b75db4336a23c3fdf505f056e217ec6e2e95d901750cfea3`
    (igual ao dos ensaios anteriores; não comparado com checksum do
    fornecedor);
  - extraídos só `bin`, `lib` e `share`.
- **TLS:** só `hostssl` com `scram-sha-256`. Certificado de uma CA descartável
  para `localhost` e para o host fictício
  `ep-ensaio-piloto-555.c-2.us-east-1.aws.neon.tech`.
- **Banco:** `neondb`, com dono **não superusuário** (`neondb_owner`).
- **Estado 14:** criado pelo runtime compilado de `2656f69`.
- **Dados:** três estabelecimentos (Pro, Max, Básico), criados por convite e
  pela API `2656f69`. Cada um com dono, serviço de R$ 25,00, profissional com
  jornada e atendimentos. Uma regra fixa de R$ 15,00 no Max.
- **Kits:** rodados pelo lançador oficial (`powershell.exe -File`, `-Ensaio`)
  num pseudoconsole real do Windows (ConPTY, `@lydell/node-pty`, fora do
  repositório). A URL foi digitada no prompt oculto e a frase no de
  confirmação. Nenhuma transcrição contém a senha (o driver conferiu).
- **Builds:** as três APIs foram compiladas do próprio commit
  (`npm run build`).

### Kit da 15 em `92cc6ae` (a sequência real 14 → 15)

| # | Fase | Resultado |
| --- | --- | --- |
| 1 | `conferir` | `before-professional-commissions`, 14, 0/15, `PASSAM_A_APURAR_COMISSOES: 1` |
| 2 | `preparar` | backup de 170.874 bytes, 44 tabelas |
| 3 | `restauracao` | 44 tabelas iguais; todas as linhas `ENSAIO_*` `true`, previsão conferida |
| 4 | `aplicar` | `BACKUP_CONFERIDO ... ok`, mesmo servidor, `COMMIT: ok`, 15/15, `CATALOGO_PRESERVADO: sim`; código 0 |
| 5 | `conferir` | `after-professional-commissions` |
| 6 | `conferir` no estado 16 | `divergente` (o "depois" da 15 exige quinze); código 1 |
| 7 | `aplicar` no estado 16 | `ERR_ESTADO_ANTES_DIVERGENTE`; código 1 |

### Kit da 16 em `e42fb81`

| # | Fase | Resultado |
| --- | --- | --- |
| 1 | `conferir` | `before-commission-settings`, 15, 0/7; código 0 |
| 2 | `aplicar` sem restauração | `BACKUP_CONFERIDO: nenhum`, `ERR_SEM_BACKUP_COM_RESTAURACAO_CONFERIDA`, antes da URL; código 1 |
| 3 | `preparar` | backup de 175.364 bytes, 44 tabelas; levantamento |
| 4 | `restauracao` | todas as linhas `ENSAIO_*` `true`, inclusive `ENSAIO_TRANSICAO: ok` e a tabela nova vazia; código 0 |
| 5 | `aplicar`, frase errada | `abortado_sem_gravacao`; 15 migrations |
| 6 | `aplicar` com outra sessão segurando `commission_entries` | `55P03` em ~10 s; `before-commission-settings` intacto; `ERR_MIGRATION_FALHOU`; código 1 |
| 7 | `aplicar` com a janela fechada logo depois do início | registro `migration_iniciada` sem desfecho; o processo não sobreviveu |
| 8 | `aplicar` em seguida | `ERR_RESULTADO_ANTERIOR_INCERTO`, antes da URL |
| 9 | `conferir` | `before-commission-settings` (libera) |
| 10 | `aplicar` com a sessão da migration derrubada (`pg_terminate_backend`) durante a espera do lock | `57P01`, `ERR_RESULTADO_INCERTO`; **código 3** |
| 11–12 | `aplicar`, depois `conferir` | `ERR_RESULTADO_ANTERIOR_INCERTO`; depois `before-commission-settings` |
| 13 | `aplicar` | `JANELA_DESDE`, `COMMIT: ok`, 16, 7/7, `TRANSICAO: ok`, `CONTAGENS_DESDE_O_BACKUP: iguais`; código 0 |
| 14 | `conferir` | `after-commission-settings`, `JANELA_DE_TRANSICAO: ok` |
| 15 | `aplicar` de novo | `ERR_MIGRATION_JA_APLICADA` |
| 16 | `conferir` depois das APIs anteriores criarem e apurarem | `JANELA_DE_TRANSICAO: VIOLADA` (6 e 2); código 1 |
| 17 | `restauracao` no commit do runbook, com o backup de `e42fb81` | `ERR_BACKUP_DE_OUTRO_COMMIT` |

### Testes automáticos

- **`scripts/regra-geral-comissoes-piloto.spec.ts`:**
  - identidade própria, diferente de todos os kits, inclusive o da 15;
  - backup e execução pendente do kit da 15 não servem nem bloqueiam;
  - início da janela;
  - desfechos.
- **`scripts/lib/regra-geral-comissoes-schema.spec.ts`:**
  - nomes e definições contra o texto da migration;
  - o "antes" exige o baseline 15 inteiro;
  - o "depois" reaproveita a conferência da 15 sem exigir quinze migrations
    (sozinha, ela recusaria) e confere definições, não só nomes;
  - transição e janela à parte.
- **`test/pilot-regra-geral-comissoes-check.db-e2e-spec.ts`:**
  - o banco compartilhado, com dados da API nova e da anterior, continua
    `after-commission-settings`;
  - as invariantes da transição acusam os dados;
  - a janela e a consulta da janela concordam;
  - a consulta de impacto é só leitura;
  - num banco temporário, a aplicação 15 → 16 por `aplicarSomenteAPendente`
    funciona, e a repetição é recusada antes de qualquer comando.
- **Locais:**
  - typecheck, lint e os unitários afetados;
  - o db-e2e novo e o **db-e2e completo** em banco novo PostgreSQL 17.11
    (30 arquivos, 283 testes).

### Limitações

- O banco não é o Neon. As quedas foram provocadas no servidor local, não por
  rede.
- A entrada foi digitada pelo driver no pseudoconsole, não por uma pessoa no
  Windows Terminal.
- No ensaio, o `node_modules` do backend das worktrees foi uma junção para o
  do clone principal, por falta de disco. O `package-lock.json` é idêntico. Na
  operação real, use `npm ci` próprio.
- As combinações de web foram vistas pela leitura dos validadores, sem
  navegador. O web C16 × API C16 foi visto no navegador no ensaio de
  `0ff8f46`.
- A troca de instância e a suspensão de serviço no Render não foram
  ensaiadas.
- Dados reais não foram lidos. Quantos estabelecimentos e profissionais há, só
  o `preparar` dirá.
