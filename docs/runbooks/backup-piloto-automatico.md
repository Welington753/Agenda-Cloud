# Backup automático do piloto (lote O1)

Roteiro do backup diário do banco do piloto: configuração pelo dono, primeira
execução, recuperação de emergência, teste mensal e o que fazer quando falha.
A escolha e os custos estão em `docs/plans/backup-e-monitoramento.md`
(alternativa 1: repositório privado + Backblaze B2 + monitor de cron do
Sentry).

**Estado:** código e testes prontos (PR #81). Nada configurado: não existem
ainda o repositório de operação, o bucket, a chave age, o papel
`agenda_backup` nem o monitor de cron.

## 1. Como funciona

Um workflow agendado no repositório **privado** `agenda-cloud-operacao` faz
checkout deste repositório num SHA fixo e roda
`backend/scripts/backup-agendado.mjs`. Cada execução:

1. avisa o monitor de cron que começou (`in_progress`);
2. confere a configuração antes de qualquer rede:
   - repositório de operação, dentro do GitHub Actions, privado segundo a
     API do GitHub;
   - URL direta do endpoint do piloto, sem pooler e sem TLS afrouxado;
   - papel `agenda_backup`;
   - B2 e Sentry nos domínios esperados;
   - destinatário age válido e nenhuma chave privada no ambiente;
3. confere no banco que o papel só lê: não é superusuário, não cria
   objetos, não é dono de nada, não escreve em nenhuma tabela e lê todas;
4. abre `REPEATABLE READ READ ONLY`, exporta o snapshot, tira a fotografia
   (contagem e md5 de cada tabela) e roda `pg_dump -Fc --snapshot`;
5. restaura o dump num PostgreSQL descartável do runner, numa transação, e
   exige a mesma fotografia;
6. criptografa o dump e o manifesto completo com `age -r <chave pública>`;
7. envia ao B2 com retenção COMPLIANCE e confere cada objeto:
   - tamanho, sha256 e modo e data da retenção;
   - download do dump com o hash conferido;
8. envia o `resumo.json` por último;
9. avisa o monitor que terminou (`ok`).

Se qualquer passo falha, o monitor recebe `error`, o job sai com código 1 e o
GitHub manda e-mail.

**O que fica no B2**, em `piloto/<diario|mensal>/AAAA/MM/DD/HHMMSSZ-<execução>/`:

| Arquivo | Conteúdo | Claro? |
|---|---|---|
| `piloto-neondb.dump.age` | o `pg_dump -Fc` | cifrado |
| `manifesto.json.age` | contagem e md5 por tabela, migrations, sha256 do dump claro | cifrado |
| `resumo.json` | ponto de recuperação, retenção, tamanhos, hashes dos cifrados, versões, commit, durações | claro, sem nome de tabela nem dado |

**Uma pasta sem `resumo.json` é um backup incompleto:** a execução falhou
depois de enviar parte dos arquivos. Ela não serve para recuperação e expira
sozinha.

## 2. Quanto histórico pode ser perdido e como saber que o backup não rodou

- **Agendamento:** diário às 06:17 UTC (03:17 em Brasília). O GitHub pode
  atrasar ou, em carga alta, pular uma execução agendada.
- **Perda máxima com o backup em dia:** cerca de 24 h, mais o atraso do
  GitHub, em geral minutos. Um dia de falha soma mais 24 h.
- **O que o Neon cobre:** enquanto o Neon do piloto existir e estiver
  acessível, o histórico de 6 h do plano Free cobre as últimas horas. Ele
  não serve se o projeto se perder ou ficar inacessível.
- **Execução ausente ou atrasada:** o monitor de cron `backup-piloto` do
  Sentry é configurado com o mesmo horário e 2 h de tolerância. Sem o
  check-in `in_progress` até 08:17 UTC, manda o alerta de "missed".
- **Execução travada:** tempo máximo de 30 min no monitor. Passou disso
  sem `ok` ou `error`, alerta de timeout. O job também tem
  `timeout-minutes: 30`.
- **Execução com erro:** check-in `error` (alerta no Sentry) e e-mail do
  GitHub para quem editou o agendamento por último.
- **Conferência manual:** a pasta mais recente com `resumo.json` no B2 e o
  `pontoDeRecuperacao` dela.

**Limite conhecido:** uma falha na leitura da configuração acontece antes do
check-in `in_progress`. Nesse caso, o aviso vem do "missed" do monitor e do
e-mail do GitHub, não de um `error`.

## 3. Configuração pelo dono (feita uma vez, fora do código)

Os segredos são digitados só nas telas dos serviços ou no `psql` com
`\password`. Nunca no chat, em arquivo do repositório ou em log.

### 3.1 Chave age (offline)

1. Instalar o age (<https://github.com/FiloSottile/age>, release oficial)
   num computador de confiança.
2. Gerar o par: `age-keygen -o backup-piloto.key`.
3. Anotar a linha `# public key: age1...`: é o `AGE_RECIPIENT`, que não é
   segredo.
4. Guardar o arquivo `backup-piloto.key` inteiro no gerenciador de senhas
   do dono.
5. Fazer uma cópia offline (papel ou pendrive) em **outro local físico**.
6. Apagar o arquivo do disco.

Sem a chave privada, nenhum backup pode ser lido, nem pelo dono. Perder as
duas cópias é perder todos os backups.

### 3.2 Backblaze B2

1. Criar a conta com 2FA. Guardar os códigos de recuperação junto da cópia
   offline da chave.
2. Criar o bucket **privado** `agenda-cloud-backup-piloto` com **Object Lock
   ligado na criação**, que não dá para ligar depois.
   - Retenção padrão: **compliance, 35 dias**. Vale se um envio vier sem
     retenção própria.
3. Criar as regras de ciclo de vida, que só agem depois que a retenção vence:
   - prefixo `piloto/diario/`: esconder após 36 dias, apagar 1 dia depois de
     escondido;
   - prefixo `piloto/mensal/`: esconder após 400 dias, apagar 1 dia depois.
4. Criar uma chave de aplicação **restrita a esse bucket**.
   - Com `listFiles`, `readFiles`, `writeFiles`, `readFileRetentions` e
     `writeFileRetentions`.
   - Sem `deleteFiles`, `bypassGovernance`, `writeBucketRetentions` ou
     qualquer capacidade de outra conta ou bucket.
   - `writeFileRetentions` é necessária para gravar a retenção de cada
     arquivo. Em compliance, ela só consegue estender a data, nunca
     encurtar.
   - `readFiles` e `readFileRetentions` são necessárias para a conferência
     depois do envio.
5. Anotar o `keyID` e a `applicationKey`, que só aparece uma vez. Ir direto
   para o passo 3.5 sem salvar em arquivo.
6. Anotar o endpoint S3 do bucket (`https://s3.<região>.backblazeb2.com`).

### 3.3 Sentry (monitor de cron)

1. Criar a conta (plano Developer) e um projeto. O SDK na API é do lote O2,
   não deste.
2. Criar o monitor de cron `backup-piloto`:
   - agenda `17 6 * * *` (UTC);
   - tolerância de check-in de 120 min;
   - tempo máximo de 30 min;
   - alerta por e-mail ao destinatário escolhido.
3. Copiar a URL de check-in por HTTP do monitor, no formato
   `https://<org>.ingest.<região>.sentry.io/api/<projeto>/cron/backup-piloto/<chave>/`,
   sem `?status`. Ela vai como segredo `SENTRY_CRON_URL`.

### 3.4 Papel `agenda_backup` no Neon (escrita de configuração no piloto)

**Exige autorização explícita do dono para esta etapa.** Não é migration.

Pelo `psql` com a URL **direta** do dono do banco e `sslmode=verify-full`,
nunca pelo editor SQL do console, que guarda a senha no histórico:

```sql
CREATE ROLE agenda_backup WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
\password agenda_backup
GRANT CONNECT ON DATABASE neondb TO agenda_backup;
GRANT USAGE ON SCHEMA public TO agenda_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO agenda_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO agenda_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT SELECT ON TABLES TO agenda_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT SELECT ON SEQUENCES TO agenda_backup;
ALTER ROLE agenda_backup SET default_transaction_read_only = on;
```

- **Não criar o papel pela tela "Roles" do console do Neon.** Papéis criados
  por lá entram em `neon_superuser`, e o script recusa o papel com
  `ERR_PAPEL_COM_ATRIBUTO_DE_ADMINISTRACAO` ou `ERR_PAPEL_PODE_CRIAR_OBJETOS`.
- **`FOR ROLE neondb_owner` precisa ser o papel que roda as migrations.**
  Se for outro, troque o nome. Uma tabela nova sem `SELECT` para o backup
  faz o script parar com `ERR_PAPEL_NAO_LE_TUDO`, nunca gerar um backup
  incompleto.
- **Antes e depois:** `npm run pilot:check-database`, pelo roteiro de
  sempre.

### 3.5 Repositório privado de operação

1. Criar `Welington753/agenda-cloud-operacao` como **privado**, vazio.
2. Em *Settings > Actions > General*:
   - permitir só as actions `actions/checkout` e `actions/setup-node`;
   - *Workflow permissions* em "Read repository contents".
3. Em *Settings > Secrets and variables > Actions*, criar os **secrets**:
   - `PILOTO_BACKUP_URL`: URL direta do endpoint do piloto, com o papel
     `agenda_backup` e `sslmode=verify-full`;
   - `B2_KEY_ID` e `B2_APP_KEY`;
   - `SENTRY_CRON_URL`.
4. No mesmo lugar, criar as **variables**:
   - `AGE_RECIPIENT` (a chave pública);
   - `B2_BUCKET` e `B2_ENDPOINT`;
   - `PILOT_ENDPOINT_ID` e `PRODUCTION_ENDPOINT_ID`, os mesmos IDs dos
     roteiros de publicação.
5. Copiar `docs/runbooks/modelos/backup-piloto.yml` deste repositório para
   `.github/workflows/backup-piloto.yml` do repositório de operação.
   - Trocar `SUBSTITUIR_PELO_SHA_REVISADO_DO_AGENDA_CLOUD` pelo SHA completo
     do merge revisado.
   - Conferir `PG_MAJOR` contra a versão do Neon (`SHOW server_version`).
     O script recusa `pg_dump` mais antigo que o servidor.

### 3.6 Render (notificações)

Em *Workspace Settings > Notifications*: e-mail, "Only failure
notifications". Não faz parte do backup, mas é do mesmo pacote de avisos.

## 4. Primeira execução (com autorização explícita)

1. No repositório de operação: *Actions > Backup diário do piloto > Run
   workflow*.
2. No log, conferir:
   - `MODO: piloto`, `PAPEL: somente leitura` e `RESTAURACAO_IGUAL: true`;
   - `CRIPTOGRAFIA_OK`, `OBJETOS: diario retencaoAte=...` e
     `RESULTADO: backup_ok`.
3. No resumo do job, anotar a duração e os tamanhos.
4. No B2, abrir a pasta. Os três arquivos devem estar lá, cada um com
   *File Lock* "Compliance" até a data do resumo. Tentar apagar um deles
   pela interface: o B2 deve recusar.
5. No Sentry, o monitor deve mostrar o check-in `ok`.
6. Fazer o primeiro teste de restauração (seção 6) com a chave offline.
7. Registrar o resultado em "Estado e retomada" de
   `docs/plans/backup-e-monitoramento.md`.

**O que só esta execução prova:**

- o Object Lock real do B2;
- as permissões da chave de aplicação;
- os cabeçalhos de retenção que o B2 devolve no HEAD;
- o aceite do check-in pelo Sentry;
- o tempo real contra o Neon.

O CI deste repositório prova o resto com simuladores e dados fictícios.

## 5. Recuperação de emergência (sem GitHub e sem Neon)

Precisa de:

- acesso à conta Backblaze;
- a chave age (gerenciador de senhas ou cópia offline);
- `age`, `pg_restore` e `psql` da mesma versão maior do backup, ou mais
  nova, instalados de fontes oficiais;
- um PostgreSQL novo e vazio: outro projeto Neon, outro provedor ou um
  servidor próprio.

1. No B2, escolher a pasta mais recente **com `resumo.json`**.
   - Abrir o resumo e conferir o `pontoDeRecuperacao`.
   - Baixar `piloto-neondb.dump.age` e `manifesto.json.age` para uma pasta
     fora de qualquer repositório.
2. Salvar a chave como arquivo temporário (por exemplo,
   `backup-piloto.key`) e decifrar os dois arquivos:

   ```bash
   age -d -i backup-piloto.key -o manifesto.json manifesto.json.age
   age -d -i backup-piloto.key -o piloto-neondb.dump piloto-neondb.dump.age
   ```
3. Conferir o hash. O valor tem que ser igual a `dump.sha256` do
   `manifesto.json`:

   ```bash
   sha256sum piloto-neondb.dump   # PowerShell: Get-FileHash piloto-neondb.dump
   ```
4. Restaurar no banco novo e vazio:

   ```bash
   pg_restore -d "<url do banco novo, sslmode=verify-full>" --no-owner --no-privileges --exit-on-error --single-transaction piloto-neondb.dump
   ```
5. Conferir o resultado:
   - **Com este repositório disponível:** os passos 2 a 4 e a conferência
     da fotografia saem num comando só (seção 6, com `RECUPERACAO_URL`
     apontando para o banco novo). Depois, rodar `npm run pilot:check-database`
     contra ele.
   - **Sem o repositório:** comparar a contagem de cada tabela
     (`SELECT count(*) FROM <tabela>`) com `contagens` do manifesto.
6. Apagar o dump e o manifesto decifrados e o arquivo temporário da chave.
7. Apontar a API para o banco novo (`DATABASE_URL` e `DIRECT_URL` no
   Render) é uma decisão à parte, que segue o roteiro de publicação.

## 6. Teste mensal de restauração (cerca de 15 min)

Prova o que o job não consegue provar sem a chave privada: que a chave
offline abre o arquivo cifrado e que esse arquivo restaura.

1. Baixar do B2 o `.age` e o `manifesto.json.age` da pasta mais recente com
   `resumo.json`.
2. Subir um PostgreSQL descartável local com TLS (como em
   `docs/runbooks/diagnostico-testes-navegador.md`) e criar um banco vazio.
3. Em `backend/`, rodar:

   ```bash
   RECUPERACAO_DUMP=<pasta>/piloto-neondb.dump.age \
   RECUPERACAO_MANIFESTO=<pasta>/manifesto.json.age \
   RECUPERACAO_IDENTIDADE=<arquivo temporário da chave> \
   RECUPERACAO_URL="postgresql://<usuário>:<senha>@127.0.0.1:<porta>/<banco vazio>?sslmode=verify-full" \
   RECUPERACAO_CA=<certificado do descartável> \
   RECUPERACAO_PASTA=<pasta fora do repositório> \
   AGE_BIN=<age> PG_BIN=<pasta do pg_restore> \
   node scripts/recuperar-backup-piloto.mjs
   ```
4. Esperar `SHA256_CONFERE: true`, `RESULTADO: recuperacao_conferida (...)`
   e `DECIFRADOS_APAGADOS: true`.
5. Apagar o arquivo temporário da chave e o banco descartável.
6. Anotar a data e o resultado em "Estado e retomada".

## 7. Troca da chave age

1. Gerar um par novo (seção 3.1) e trocar a variable `AGE_RECIPIENT`.
2. **Guardar a chave antiga** até o último backup cifrado com ela expirar.
   Os mensais duram 13 meses.
3. Fazer o teste mensal com a chave nova logo após a primeira execução com
   ela.

Se a chave privada vazar: trocar o par na hora e tratar todos os backups
cifrados com a chave antiga como expostos. Eles contêm hashes de senha e
contatos de clientes.

## 8. Quando o backup falha

O log mostra `ERRO: <código>` e `RESULTADO: backup_falhou`. Nenhum código
traz URL, senha, nome de tabela ou dado.

| Código | O que fazer |
|---|---|
| `ERR_REPOSITORIO_*`, `ERR_PILOTO_FORA_DO_GITHUB_ACTIONS`, `ERR_VISIBILIDADE_NAO_CONFERIDA` | O workflow está no lugar errado ou o repositório deixou de ser privado. Não contornar: conferir o repositório |
| `ERR_VARIAVEL_AUSENTE_*`, `ERR_*_INVALIDO`, `ERR_*_INESPERAD*` | Secret ou variable ausente ou fora do formato. Corrigir na tela do repositório |
| `ERR_ENDPOINT_*`, `ERR_POOLER`, `ERR_TLS_AFROUXADO`, `ERR_PAPEL_DIFERENTE_DE_AGENDA_BACKUP` | `PILOTO_BACKUP_URL` não é a URL direta do piloto com o papel de backup |
| `ERR_PAPEL_*` | O papel ganhou permissão demais ou deixou de ler uma tabela (migration nova). Corrigir os `GRANT` da seção 3.4, nunca usar o dono |
| `ERR_PG_DUMP_MAIS_ANTIGO_QUE_O_SERVIDOR` | O Neon subiu de versão: ajustar `PG_MAJOR` no workflow |
| `ERR_PG_DUMP`, `ERR_DUMP_VAZIO` | Neon fora do ar, suspenso (cota do Free) ou senha trocada. Ver o `DETALHE` |
| `ERR_PG_RESTORE`, `ERR_RESTAURACAO_DIFERENTE_DO_SNAPSHOT` | O dump não restaura igual. Não enviar nada à mão; investigar antes da próxima execução |
| `ERR_CRIPTOGRAFIA*`, `ERR_AGE_AUSENTE` | Pacote age do runner. Rodar de novo; se repetir, conferir o passo de instalação |
| `ERR_ENVIO`, `ERR_OBJETO_*`, `ERR_DOWNLOAD_DIFERENTE_DO_ENVIADO` | Chave do B2 sem a capacidade certa, bucket sem Object Lock ou B2 fora do ar |
| `ERR_CHECKIN_OK_NAO_CONFIRMADO` | O backup foi feito e conferido, mas o Sentry não aceitou o `ok`. Conferir `SENTRY_CRON_URL`. A pasta com `resumo.json` vale |

Uma execução manual (*Run workflow*) depois da correção refaz tudo do
zero. Uma pasta incompleta no B2 não atrapalha: ela expira sozinha.
