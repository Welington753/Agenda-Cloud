# Backup automático e monitoramento do piloto (lotes O1 e O2)

Proposta para as decisões 7.1 e 7.2 de `plano-de-expansao.md`. O código
do O1 está pronto e testado com dados fictícios (PR #81; ver a seção 7).
Nada foi contratado, configurado ou conectado. Os preços e limites foram
consultados nas páginas oficiais em **2026-10-28** (links na seção 6);
confira de novo antes de executar, porque mudam.

## 1. Ponto de partida

**O que já existe e serve:**

- `backend/scripts/operacao-piloto.mjs`:
  - `conferirDestino` confere a URL antes da rede (endpoint do piloto, sem
    pooler, banco `neondb`, sem TLS afrouxado);
  - `ambienteLibpq` passa a conexão a `pg_dump`/`pg_restore` sempre com
    `verify-full`;
  - `fotografar` e `compararFotografias` tiram a contagem e o md5 de cada
    tabela;
  - `sha256DoArquivo` calcula o hash do dump.
- Os aplicadores (`aplicar-*-piloto.mjs`) já tiram o `pg_dump -Fc` no mesmo
  snapshot das contagens (`pg_export_snapshot` + `--snapshot`).
- `conferir-restauracao-piloto.mjs` cria um PostgreSQL descartável local
  com TLS e confere o dump: sha256, `pg_restore` numa transação e a mesma
  fotografia.
- Os health checks do Render: `/` na API e `/login` no web (`render.yaml`).

**O que falta:**

- O backup é manual. Só roda no PC de quem opera e fica nele
  (`~/AgendaCloud-backups`, hoje cerca de 216 KB).
- O plano gratuito do Neon só volta **6 horas** no histórico (limite de
  1 GB). Fora disso, não há cópia nenhuma fora deste computador.
- Ninguém é avisado de deploy com falha, de serviço fora do ar ou de erro
  500.

**Dois fatos que mudam a solução:**

- **O repositório `Agenda-Cloud` é público.** Logs e artifacts de workflow
  dele podem ser lidos e baixados por qualquer pessoa logada no GitHub.
  Nenhum backup, nem criptografado, pode passar por ele.
- Workflow agendado (`schedule`) só roda na **branch padrão**, que é `main`,
  parada desde 2026-09-10. Em repositório público, o agendamento ainda é
  desligado depois de 60 dias sem atividade. O agendador precisa morar fora
  deste repositório.

## 2. As duas alternativas

Nas duas, o backup roda num **repositório privado novo** da mesma conta
GitHub (por exemplo `agenda-cloud-operacao`), num runner hospedado pelo
GitHub. O computador pode estar desligado. O dump é criptografado com
[age](https://github.com/FiloSottile/age): o workflow recebe só a chave
**pública**; a privada nunca entra no GitHub, no Neon, no Render nem no
armazenamento.

### Alternativa 1 (recomendada): GitHub privado + Backblaze B2 + Sentry

| Item | Proposta |
|---|---|
| Serviços | GitHub (já existe; repositório privado novo, sem custo), Backblaze B2 (conta nova, gratuita), Sentry Developer (conta nova, gratuita), Render e Neon (já existem) |
| Custo mensal estimado | **US$ 0** no tamanho atual. Acima da cota, B2 cobra a partir de US$ 6,95/TB/mês e US$ 0,01/GB de download além de 3× o armazenado |
| Limites gratuitos | B2: 10 GB sempre grátis. Sentry Developer: 1 usuário, 5 mil erros/mês, 30 dias de histórico, alerta por e-mail, 1 monitor de cron e 1 de uptime. GitHub privado: US$ 12/mês de computação incluída (cerca de 2.000 min em Linux) e 500 MB de artifacts |
| Onde fica o backup | Bucket privado no B2, com Object Lock ligado na criação, em modo compliance: cada arquivo fica imutável até a data de retenção, nem a chave do workflow apaga |
| Chave de criptografia | Par age gerado offline pelo dono. Privada no gerenciador de senhas do dono, com uma cópia offline (papel ou pendrive) guardada em outro local físico. A pública vai como variável do repositório privado |
| Recuperação sem a conta do banco | Dump no B2 (conta Backblaze) + chave com o dono: restaura em qualquer PostgreSQL (outro projeto Neon ou outro provedor) sem depender do Neon. A conta Backblaze tem 2FA e códigos de recuperação offline |
| Agendamento | `schedule` diário no repositório privado (que não sofre o desligamento de 60 dias) e `workflow_dispatch` para rodar à mão. O GitHub pode atrasar o horário em carga alta; o monitor de cron do Sentry avisa se o backup não chegar |
| Retenção | Diários por 35 dias. Mensais (o do dia 1) por 13 meses. A data de retenção vai em cada arquivo, e uma regra de ciclo de vida apaga depois que o bloqueio vence |
| Verificação | A cada execução, no mesmo job e antes de criptografar: restauração num PostgreSQL descartável do runner e fotografia igual à do snapshot do dump. Manifesto com sha256 do dump claro e do criptografado, contagens por tabela, versão do `pg_dump` e SHA do código |
| Teste periódico de restauração | Mensal, manual, cerca de 15 min: baixar o `.age` mais recente do B2, decifrar com a chave offline e rodar a conferência de restauração local. É o que prova a chave e o arquivo criptografado, que o job não consegue provar sem a chave privada |
| Monitoramento | Render: e-mail de falha de build/deploy, serviço sem saúde e suspensão (já disponível). Sentry na API: só erros 5xx, sem PII, alerta por e-mail para erro novo e para pico (mais de N eventos em 1 h). Sentry cron: avisa se o backup diário não fizer check-in. Health check: uma vez por dia, no fim do job, `GET /` da API e `GET /login` do web |
| Destino dos alertas | E-mail do dono (Render, Sentry e falha do workflow, que vai para quem editou o cron por último) |
| Impacto nos gratuitos | Render: 750 h por workspace por mês somadas entre API e web; o check diário acorda os dois uma vez (até cerca de 15 h/mês). Neon: o dump acorda a computação por alguns minutos (cerca de 1 a 2 das 100 CU-h/mês). Sentry: o SDK roda dentro da API de 512 MB; medir a memória no primeiro deploy |

### Alternativa 2: tudo no GitHub privado, sem conta nova

| Item | Proposta |
|---|---|
| Serviços | Só GitHub (repositório privado novo), Render e Neon. Nada a contratar |
| Custo mensal estimado | **US$ 0** |
| Limites gratuitos | US$ 12/mês de computação (cerca de 2.000 min) e 500 MB de artifacts no repositório privado; retenção configurável até 400 dias |
| Onde fica o backup | Artifact criptografado do próprio workflow privado |
| Chave e recuperação | Iguais à alternativa 1. Não depende do Neon, mas o backup e o agendador ficam na mesma conta GitHub |
| Agendamento e retenção | Iguais. A retenção é por artifact, sem imutabilidade: quem tiver escrita no repositório apaga |
| Verificação e teste | Iguais |
| Monitoramento | Render por e-mail e e-mail de falha do workflow. **Sem** registro de erros, alerta de pico de 5xx ou aviso de "o backup não rodou" (um agendamento que não dispara não manda e-mail) |
| Impacto nos gratuitos | Igual ao da alternativa 1, sem o SDK do Sentry |

**Por que a 1:** é a única que cumpre o O2 inteiro (erros e picos de 5xx)
e a única com cópia imutável fora do GitHub. Perder ou comprometer a conta
GitHub não leva o backup. O custo é o mesmo (zero); a diferença são duas
contas gratuitas a criar.

**O que não fazer em nenhuma das duas:**

- **Monitor de uptime frequente nos serviços do Render.** Um ping a cada
  poucos minutos mantém API e web acordados 24 h. São cerca de 1.488 h/mês
  contra as 750 do workspace, e os serviços seriam suspensos até o mês
  seguinte. Por isso o monitor de uptime incluído no Sentry fica sem uso.
- **Guardar dump, log com dado ou chave no repositório público.**

## 3. Como o backup diário funciona (alternativa 1)

1. O runner sobe um PostgreSQL 17 descartável como serviço do job, com TLS
   e certificado gerado na hora (como o CI atual).
2. O script confere o destino pela URL com `conferirDestino`, sem
   imprimi-la.
3. Abre a transação `REPEATABLE READ READ ONLY` e exporta o snapshot.
4. Na mesma transação: `fotografar` e `pg_dump -Fc --snapshot`, como os
   aplicadores já fazem.
5. Restaura o dump no PostgreSQL descartável com `pg_restore` numa
   transação e compara as fotografias. Se divergirem, o job falha e nada é
   enviado.
6. Criptografa o dump com `age -r <chave pública>` e grava o manifesto.
7. Envia os dois ao B2 com uma chave de aplicação limitada ao bucket, com
   permissão de listar e gravar, sem apagar.
8. Faz o check-in no monitor de cron do Sentry e o health check diário.
9. Apaga a pasta temporária. O log nunca mostra URL, senha, conteúdo de
   linha ou nome de tabela com dado.

A conexão usa um papel **só de leitura** no Neon (`agenda_backup`, com
`SELECT` em `public` e privilégio padrão para as tabelas que migrations
futuras criarem), nunca o papel dono do banco.

## 4. Passos para implementar depois da escolha

Os segredos são digitados só nas telas dos serviços ou em `gh secret set`
lendo do teclado. Nunca no chat, em arquivo do repositório ou em log.

**A. Feito pelo dono, fora do código (cerca de 1 h)**

1. Instalar o age e gerar o par offline: `age-keygen -o backup-piloto.key`.
2. Anotar a linha `# public key: age1...`.
3. Guardar o arquivo no gerenciador de senhas e fazer a cópia offline em
   outro local.
4. Apagar o arquivo do disco.
5. Backblaze: criar a conta com 2FA e guardar os códigos de recuperação
   offline.
6. Criar o bucket privado com **Object Lock ligado na criação**,
   retenção padrão compliance de 35 dias, e uma regra de ciclo de vida que
   apaga versões antigas.
7. Criar uma chave de aplicação restrita a esse bucket com `listFiles`,
   `readFiles`, `writeFiles`, `readFileRetentions` e
   `writeFileRetentions`, sem `deleteFiles` nem `bypassGovernance`.
   A implementação (seção 7) mostrou que as três a mais são necessárias:
   gravar a retenção de cada arquivo (o mensal dura mais que o padrão do
   bucket) e conferir o objeto e a retenção depois do envio. Em compliance,
   `writeFileRetentions` só estende a data.
8. Sentry: criar a conta e um projeto Node.js.
9. Criar o monitor de cron `backup-piloto`, diário, com 2 h de tolerância.
10. Criar as regras de alerta por e-mail: erro novo, e mais de N eventos em
    1 h.
11. Render: em *Workspace Settings > Notifications*, escolher e-mail e
    "Only failure notifications".
12. Criar o repositório privado `agenda-cloud-operacao` no GitHub.

**B. Lote O1 no repositório público (PR com testes, sem banco real)**

1. Novo `backend/scripts/backup-agendado.mjs`. Reaproveita
   `conferirDestino`, `ambienteLibpq`, `fotografar`, `compararFotografias`
   e `sha256DoArquivo`. As entradas vêm de variáveis de ambiente, não de
   digitação oculta.
2. Testes unitários com binários falsos.
3. Teste com banco no CI: dump, restauração e comparação contra o próprio
   PostgreSQL descartável no papel do piloto. Prova também que nada sensível
   aparece na saída.
4. Modelo do workflow (`docs/runbooks/modelos/backup-piloto.yml`): actions
   fixadas por SHA, como os workflows atuais, e checkout deste repositório
   num SHA fixo.
5. Roteiro `docs/runbooks/backup-piloto-automatico.md`: restauração de
   emergência (baixar do B2, `age -d -i`, `pg_restore` num banco novo,
   `pilot:check-database`), teste mensal, troca de chave e o que fazer se
   o backup falhar.

**C. Lote O2 no repositório público**

1. Sentry na API (`@sentry/nestjs`), ligado só com `SENTRY_DSN`, como o
   e-mail hoje.
2. Só erros 5xx, com `sendDefaultPii: false`.
3. `beforeSend` remove corpo, cookies, `Authorization`,
   `X-Agenda-Proxy-Secret`, `X-Agenda-Client-IP` e a query string, e
   mascara e-mail e telefone.
4. Testes provam que token, senha, e-mail e telefone não chegam ao evento.
5. O health check diário fica no mesmo job do O1.

**D. Configuração e primeira execução (com autorização explícita, por
roteiro)**

1. No Neon: criar o papel `agenda_backup` só de leitura, seguindo o
   roteiro. É uma escrita de configuração no banco do piloto, não migration.
2. No repositório privado:
   - segredos `PILOTO_BACKUP_URL` (endpoint direto, `sslmode=verify-full`),
     `B2_KEY_ID`, `B2_APP_KEY` e `SENTRY_CRON_URL`;
   - variáveis `AGE_RECIPIENT`, `B2_BUCKET` e `B2_ENDPOINT`;
   - copiar o modelo do workflow.
3. No Render: `SENTRY_DSN` na API e publicar o lote O2 pelo roteiro de
   publicação (API, depois web, mesmo SHA).
4. Rodar o workflow à mão uma vez.
5. Conferir no B2 que o arquivo está bloqueado e fazer o primeiro teste de
   restauração com a chave offline.
6. Registrar o resultado em "Estado e retomada".

## 5. Limites da proposta

- O teste de restauração automático prova o dump, não a chave nem o
  arquivo criptografado. Isso fica com o teste mensal manual.
- A retenção da alternativa 1 é imutável por 35 dias. Um backup gravado
  por engano também fica lá até vencer; o custo é desprezível.
- O papel de leitura vê os hashes de senha e os contatos dos clientes, como
  o dump de hoje. A proteção está na criptografia e no acesso ao bucket.
- O primeiro deploy com Sentry precisa conferir a memória da API no plano
  gratuito.

## 6. Fontes (consultadas em 2026-10-28)

- Neon, planos e preços (Free: 1 GB/projeto, 100 CU-h/projeto, histórico
  de 6 h; Launch: até 7 dias, US$ 0,106/CU-h e US$ 0,35/GB-mês, sem
  mínimo): <https://neon.com/pricing>
- GitHub Actions, cobrança (gratuito em repositório público; no privado do
  GitHub Free, US$ 12 de computação e 500 MB; US$ 0,006/min Linux 2-core e
  US$ 0,25/GB-mês de armazenamento além disso):
  <https://docs.github.com/en/billing/concepts/product-billing/github-actions>
- GitHub Actions, evento `schedule` (mínimo de 5 min, atraso em carga, só a
  branch padrão, desligado após 60 dias sem atividade em repositório
  público, aviso para quem editou o cron):
  <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows>
- GitHub, retenção de artifacts e logs (padrão 90 dias; até 90 no público e
  400 no privado):
  <https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization>
- Backblaze B2, preços (10 GB grátis, a partir de US$ 6,95/TB/mês,
  download grátis até 3× o armazenado):
  <https://www.backblaze.com/cloud-storage/pricing>
- Backblaze B2, Object Lock (governance e compliance; retenção padrão exige
  ligar na criação do bucket):
  <https://www.backblaze.com/docs/cloud-storage-object-lock>
- Render, plano gratuito (750 h por workspace/mês, dorme após 15 min sem
  tráfego, acorda em cerca de 1 min com qualquer requisição):
  <https://render.com/docs/free>
- Render, notificações (falha de build/deploy, serviço sem saúde,
  suspensão; e-mail ou Slack; sem exigência de plano pago):
  <https://render.com/docs/notifications>
- Sentry, preços (Developer gratuito: 1 usuário, 5 mil erros, 30 dias,
  alerta por e-mail, 1 monitor de cron e 1 de uptime; Team a partir de
  US$ 26/mês no anual): <https://sentry.io/pricing/>
- age (ferramenta de criptografia, sem serviço nem custo):
  <https://github.com/FiloSottile/age>

**Não confirmado nas páginas consultadas:**

- se o B2 exige cartão para a cota gratuita;
- se o Sentry Developer permite a regra de frequência (mais de N eventos em
  1 h).

**Confirmado em 2026-10-29:** o Neon Free inclui **5 GB de transferência
pública (saída) por projeto por mês**, somando Postgres, Object Storage e
Functions. Passou disso, a computação fica suspensa até o próximo ciclo ou
até mudar de plano. Fontes: <https://neon.com/docs/introduction/plans>
("Free: 5 GB per project per month") e <https://neon.com/pricing>
("5 GB per project included").

Conferir cada um no cadastro. Nada disso muda a recomendação: o dump atual
tem menos de 1 MB.

## 7. Estado e retomada

**Checkpoint de 2026-10-29, branch `feat/o1-backup-agendado` (PR #81).**
O O1 (seção 4B) está implementado e testado com dados fictícios. A
alternativa 1 foi preparada no código, mas não foi aprovada formalmente,
contratada nem configurada.

### 7.1 Implementação

- `backend/scripts/backup-agendado-lib.mjs`: o fluxo e as travas.
  - Reaproveita de `operacao-piloto.mjs`: `conferirDestino`,
    `conectar`/`conferirTransporte`, `fotografar`, `compararFotografias` e
    `sha256DoArquivo`. O ambiente do libpq segue o de `ambienteLibpq`,
    sempre com `verify-full`.
  - Faz a restauração e a conferência em `restaurarEConferir`, usada pelo
    job e pela recuperação.
  - Envia ao B2 por S3 com assinatura SigV4 própria, sem SDK e sem
    dependência nova.
- `backend/scripts/backup-agendado.mjs`: execução sem terminal; sai com 0
  só no backup completo.
- `backend/scripts/recuperar-backup-piloto.mjs`: recuperação e teste
  mensal com a chave offline.
- `docs/runbooks/modelos/backup-piloto.yml`: modelo do workflow
  operacional, fora de `.github/workflows/`.
- `docs/runbooks/backup-piloto-automatico.md`: roteiro com a configuração
  pelo dono, a primeira execução, a recuperação de emergência, o teste
  mensal, a troca de chave e os códigos de falha.
- `.github/workflows/test-backup-agendado.yml`: CI do caminho completo com
  dados fictícios.

**Travas da execução operacional:**

- `if` do job no repositório de operação;
- o script recusa o modo `piloto` fora do GitHub Actions, no repositório
  público ou em outro repositório, e confere pela API do GitHub que o
  repositório é privado;
- destino do banco só pela URL direta do endpoint do piloto, sem pooler e
  sem TLS afrouxado;
- papel `agenda_backup`, conferido no banco como somente leitura;
- B2 e Sentry nos domínios esperados;
- para se houver uma chave privada age no ambiente;
- o modo `ensaio` aceita só destinos em 127.0.0.1.

**Sinal de conclusão:** check-in `in_progress` no início, `ok` só depois de
tudo e `error` em qualquer falha. O `resumo.json` vai por último e marca a
pasta como completa. Um `ok` recusado pelo monitor faz o job falhar.

### 7.2 Testes

- **Unitários** (`backup-agendado-lib.spec.ts` e
  `backup-piloto-modelo.spec.ts`, no CI principal):
  - cada trava;
  - visibilidade do repositório;
  - avaliação do papel;
  - plano de retenção diário e mensal;
  - SigV4 contra três vetores públicos da AWS;
  - cabeçalhos do envio e conferência do objeto;
  - limpeza de segredos nos detalhes;
  - check-in do cron;
  - conteúdo do modelo do workflow: só no repositório de operação, sem
    artifact nem cache, actions por SHA, segredos só por `secrets`.
- **Caminho completo** (`test/backup-agendado.backup-e2e-spec.ts`, workflow
  `test-backup-agendado.yml`):
  - PostgreSQL 17 descartável com TLS;
  - `pg_dump`, `pg_restore` e age reais;
  - simulador S3 que confere a assinatura, o Content-MD5 e o sha256 do
    corpo;
  - simulador de cron.
- **O que o caminho completo cobre:**
  - backup, restauração, criptografia, envio, conferência e download;
  - recuperação com a chave pelo script, num banco vazio, e recusa de banco
    não vazio;
  - escrita concorrente depois do snapshot;
  - papel que pode escrever;
  - falha do `pg_dump` (o detalhe sai sem a senha) e do `pg_restore`;
  - restauração divergente;
  - falha do age e age que não cifrou;
  - envio recusado, objeto sem retenção e download divergente;
  - check-in `ok` recusado;
  - a linha de comando, inclusive a recusa do modo piloto no repositório
    público.
- **Em todo caso de falha, o teste confere:**
  - nenhum `resumo.json` no simulador;
  - check-in `error` e nenhum `ok`;
  - nada na pasta temporária;
  - nenhum banco de conferência sobrando;
  - nenhum segredo, dado fictício de cliente ou nome de tabela no log.
- **Neste PC** (PostgreSQL 18 local, age simulado porque o binário não pôde
  ser baixado nesta sessão): 11 casos passaram; os 2 que exigem age real
  ficaram para o CI. No CI, com age real: 13 de 13.

### 7.3 Limitações dos ensaios

- **Simulado, não o serviço:** o simulador S3 prova o que o script pede e
  confere, não o B2. A primeira execução real precisa confirmar:
  - Object Lock em compliance de verdade;
  - as capacidades da chave de aplicação;
  - os cabeçalhos `x-amz-object-lock-*` devolvidos no HEAD;
  - o formato da data;
  - que `Content-MD5` é aceito.
- **Monitor de cron:** a URL e o aceite do check-in pelo Sentry não foram
  testados.
- **Agendamento:** o `schedule` e as travas de visibilidade só rodam no
  repositório de operação, que não existe. Aqui elas foram testadas como
  funções e pela linha de comando.
- **Neon:** nada foi conectado. O tempo do `pg_dump` contra o Neon (e o
  despertar da computação) não foi medido.
- **Chave privada:** o job não consegue provar a chave e o arquivo cifrado
  (não tem a chave privada). Isso fica com o teste mensal.

### 7.4 Medidas e revisão do custo

**Medido no CI** (run 40868344890, head `ba7cf1c`, `ubuntu-24.04`):

- **Base fictícia:** PostgreSQL 17, `pg_dump` 17.11, 3 tabelas e cerca de
  2.500 linhas.

| Medida | Valor |
|---|---|
| Job inteiro | 41 s |
| Instalar `postgresql-client-17` e age | 11 s |
| Subir o PostgreSQL descartável com TLS | 12 s |
| Suíte de backup (13 casos) | 4 s |
| Backup completo (um caso) | 0,4 s: dump 84 ms, restauração 247 ms, age 9 ms, envio e conferência 16 ms |
| Dump claro / cifrado | 36.033 B / 36.233 B (age soma cerca de 200 B) |
| Manifesto cifrado / resumo | 1.163 B / 932 B |

- **Neste PC** (PostgreSQL 18, age simulado): o backup completo levou
  cerca de 3,5 s, quase todo na restauração.
- **O que a medida não inclui:**
  - o despertar do Neon e a latência até ele;
  - o `npm ci` de produção do modelo (com `argon2` sem build);
  - o download da imagem `postgres:17`;
  - um banco do tamanho real.

**Estimativa revisada para o piloto.** O dump real de hoje tem cerca de
216 KB e os demais números saem da medida acima.

- **GitHub privado:**
  - estimativa de 2 a 4 min por execução, contando o despertar do Neon e
    o arredondamento por job;
  - 60 a 120 min/mês, de 2.000 incluídos;
  - US$ 0.
- **B2:**
  - 35 diários e 13 mensais, cerca de 48 cópias de 0,22 MB, ou cerca de
    11 MB guardados, de 10 GB grátis;
  - o download de conferência, cerca de 6,5 MB/mês, fica abaixo de 3 vezes
    o armazenado;
  - US$ 0.
- **Neon Free:**
  - a saída por execução é o conteúdo das tabelas sem compressão (a
    fotografia só traz agregados): menos de 2 MB/dia hoje, ou menos de
    60 MB/mês, cerca de 1% dos 5 GB;
  - computação: alguns minutos por dia, de 1 a 2 das 100 CU-h/mês;
  - US$ 0.
- **Sentry Developer:** 2 check-ins por dia num único monitor de cron
  (incluído). US$ 0.

**Condições:** a estimativa vale enquanto o dump estiver na casa dos
megabytes e os planos gratuitos mantiverem os limites consultados. Ela deve
ser refeita com o tempo e o tamanho da primeira execução real (roteiro,
seção 4).

### 7.5 Decisões e autorizações ainda necessárias

1. **Aprovar a alternativa 1**, com as cinco capacidades da chave do B2
   (seção 4A, passo 7).
2. **Chave age:** quem guarda a privada no gerenciador de senhas e onde fica
   a cópia offline, em outro local físico. Os códigos de recuperação da
   Backblaze ficam junto.
3. **Alertas:** o e-mail que recebe os avisos do monitor de cron, do Render
   e de falha do workflow. O GitHub manda para quem editou o agendamento por
   último.
4. **Autorizar a criação do papel `agenda_backup` no piloto** (roteiro,
   seção 3.4). É uma escrita de configuração no banco real, não migration.
5. **Autorizar a primeira execução manual** e o primeiro teste de
   restauração com a chave offline (roteiro, seções 4 e 6).
6. **Confirmar o SHA Live no Render**, que continua pendente (PR #78), antes
   de fixar `CODIGO_SHA` no modelo. O backup não depende do deploy, mas o
   SHA fixado deve ser um commit revisado da integration.

**Próximo passo concreto:**

1. Revisar o PR #81 e fazer o merge normal, com `[skip render]`.
2. O dono faz a seção 3 do roteiro, na ordem, com as autorizações 4 e 5.
3. Depois, o lote O2 (Sentry na API e health check diário), em PR próprio.
