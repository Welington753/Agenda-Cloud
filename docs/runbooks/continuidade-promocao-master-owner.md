# Continuidade: promoção de `wwluiz90@gmail.com` a MASTER_OWNER no piloto

Checkpoint de 22/10/2026, para retomar em outro computador.

## Estado

- A administração real da plataforma (`/administracao`) já foi integrada pelo
  PR #60, merge `b5a2c06e87a66a3509b5e6df449511c0e0b9389e` em
  `integration/nestjs-typeorm-frontend`.
- A conta `wwluiz90@gmail.com` **ainda NÃO foi promovida**. Nenhum dado do
  piloto foi lido ou alterado.
- Nenhum banco real foi acessado nesta tarefa (nem piloto, nem production,
  nem `agenda_dev`). Os ensaios usaram só PostgreSQL descartável local.
- Nada foi publicado no Render. Este checkpoint não faz deploy.

Atualização de 23/10/2026 (PC do trabalho):

- `integration/nestjs-typeorm-frontend` está em
  `35f4713f793a9b7f857253a7f662b951034348a2` (PR #62), que contém o PR #60. O
  usuário publicou esse SHA e confirmou que funcionou; `/administracao`
  responde no web do piloto. Não há mudança em `backend/` entre `b5a2c06` e
  `35f4713`, então o schema que o script lê é o mesmo.
- A versão versionada do script foi reensaiada contra banco descartável (ver
  "Ensaio da versão versionada"). Nenhuma mudança no script foi necessária.
- A conta **continua NÃO promovida**: a execução real depende dos Endpoint IDs
  e da URL direta, que só o usuário tem, e de um terminal interativo.

## O que falta

1. Fornecer a conexão autorizada do piloto: a URL **direta** (host sem
   `-pooler`) do banco `neondb`, que fica só no gerenciador de senhas. Ela é
   digitada oculta pelo script; não coloque em `.env`, variável, arquivo ou chat.
2. Executar o procedimento abaixo e conferir o resultado.
3. Entrar em `/administracao` no web publicado e confirmar o acesso.

## Script

`backend/scripts/promover-master-owner.mjs`, executado à mão, uma vez. Não é
migration nem rota da aplicação e não autoriza por e-mail no código: só grava
`users.platform_role = 'MASTER_OWNER'` na conta encontrada pelo e-mail.

Etapas, todas no próprio script:

1. Pré-condições: `PILOT_ENDPOINT_ID` e `PRODUCTION_ENDPOINT_ID` informados e
   diferentes, `pg_dump.exe` presente e pasta de operações fora do repositório.
2. Destino pela URL, antes de qualquer rede: endpoint do piloto em
   `*.neon.tech`, banco `neondb`, sem pooler, sem o endpoint proibido em
   nenhuma parte da URL, sem `sslmode` afrouxado nem `uselibpqcompat`.
3. TLS com cadeia e hostname verificados (independe do `sslmode` da URL),
   conferido em `pg_stat_ssl`, e `current_database() = neondb`.
4. Leitura somente: exatamente uma conta com o e-mail (o `citext` segue a
   normalização do login), ativa e com credencial `argon2id`. Não mostra
   senha nem hash. Se já for MASTER_OWNER, termina sem alteração.
5. Backup: `pg_dump -Fc` no mesmo snapshot das contagens por tabela, com
   `manifesto.json` e sha256.
6. Confirmação digitada: `PROMOVER wwluiz90@gmail.com`. Qualquer outra
   resposta aborta sem gravar.
7. Transação: `SELECT ... FOR UPDATE`, nova conferência, `UPDATE` só de
   `platform_role`, condicionado ao papel lido antes e exigindo 1 linha.
8. Conferência após o commit, em nova conexão: papel final, conta ativa,
   demais campos, permissões, credencial, vínculos, MASTER_OWNER +1 e total
   de usuários iguais.
9. Registro em `operacoes.jsonl` (horário, ID, e-mail, papel anterior/novo,
   backup e resultado), sem credenciais. O operador fica como "conta Windows
   local via script; sem ator autenticado na aplicação". `audit_logs` não é
   usado porque exige um `actor_user_id` autenticado.

### Dependências

- Node 24 e `npm ci` em `backend` (o script usa o `pg` de `backend/node_modules`).
- `pg_dump.exe` do PostgreSQL 18 (cliente; o servidor local não é usado).
- Terminal interativo (PowerShell ou o terminal do VS Code). O modo `!` do
  Claude Code não serve, porque a URL é lida oculta do teclado.

### Caminhos deste Windows a conferir no PC de casa

| Item | Valor no PC do trabalho | Como ajustar |
| --- | --- | --- |
| Clone | `C:\Projetos\Agenda-Cloud` | rodar na pasta `backend` do clone de casa |
| `pg_dump.exe` | `C:\Program Files\PostgreSQL\18\bin` | `PG_BIN=<pasta do pg_dump.exe>` |
| Backup e registro | `%USERPROFILE%\AgendaCloud-operacoes` | `AGENDA_OPS_DIR=<pasta fora do repositório>` |

A pasta de operações vai guardar um dump completo do piloto, com hashes de
senha. Mantenha-a só no seu perfil, fora do Git e de pastas sincronizadas.
No PC do trabalho, `C:\Users\User\AgendaCloud-operacoes` contém só a versão
original do script (com caminhos e Endpoint IDs fixos), sem backup nem registro.

### Execução

Os Endpoint IDs são os informados no pedido de provisionamento. Guarde-os
fora do Git, como nos demais scripts do piloto:

```powershell
cd <clone>\backend
npm ci
$env:PILOT_ENDPOINT_ID = '<ep-... do piloto>'
$env:PRODUCTION_ENDPOINT_ID = '<ep-... proibido>'
node scripts/promover-master-owner.mjs
```

O script só existe nesta branch, não na integration. No clone principal, com a
árvore limpa, troque de branch só para a execução e volte depois. O
`backend/package-lock.json` é o mesmo da integration `35f4713`, então o
`node_modules` já instalado serve (rode `npm ci` em `backend` só se faltar):

```powershell
cd C:\Projetos\Agenda-Cloud
git switch chore/continuidade-promocao-master-owner
cd backend
$env:IGNORE_DOTENV_FILE = 'true'
$env:PILOT_ENDPOINT_ID = Read-Host 'Endpoint ID do piloto (ep-...)'
$env:PRODUCTION_ENDPOINT_ID = Read-Host 'Endpoint ID proibido (ep-...)'
node scripts/promover-master-owner.mjs
# a URL direta é pedida oculta pelo próprio script; depois confira a saída
Remove-Item Env:PILOT_ENDPOINT_ID, Env:PRODUCTION_ENDPOINT_ID
cd ..
git switch integration/nestjs-typeorm-frontend
```

Saída esperada numa promoção: `TLS_VERIFICADO: true`, `CONTAS_COM_O_EMAIL: 1`,
`PAPEL_ATUAL: nenhum` (ou o papel atual), `CREDENCIAL_REAL_ARGON2ID: true`,
`BACKUP_OK`, a frase de confirmação, `COMMIT: ok`, todas as linhas
`CONFERE_*: true` e `RESULTADO: MASTER_OWNER atribuído e conferido`. Qualquer
`ERRO:` antes do `COMMIT` significa que nada foi gravado. Uma segunda execução
deve terminar em `RESULTADO: sem alteração (já é MASTER_OWNER)`.

Depois, sem a credencial do piloto, restaure o dump num PostgreSQL
descartável e compare as contagens por tabela com `manifesto.json`.

## Ensaios executados e limitações

- A versão original foi ensaiada contra um PostgreSQL 18.6 descartável local,
  com TLS (certificado autoassinado verificado), as seis migrations e dados
  fictícios. Os três caminhos foram exercitados: abortar sem confirmação,
  gravar com conferência e repetir (sem alteração). O e-mail com maiúsculas
  foi encontrado, a outra conta ficou intacta e o dump restaurado bateu nas 37
  tabelas.
- Destino: dez URLs proibidas foram recusadas antes de conectar (endpoint
  proibido, inclusive em `options`, pooler, `agenda_dev`, `sslmode=disable`
  e `no-verify`, `uselibpqcompat`, localhost, host fora de `neon.tech`, sem
  credencial). Sem terminal interativo, o script para antes de pedir a URL.
- A versão versionada difere só na configuração: Endpoint IDs, `PG_BIN` e
  pasta de operações vêm do ambiente, e a pasta é recusada dentro do
  repositório. As pré-condições foram testadas offline (IDs ausentes ou
  iguais, `pg_dump` ausente, pasta no repositório). Ela não foi reensaiada
  contra banco até 23/10/2026 (ver abaixo).
- Nada foi testado contra o Neon: TLS da cadeia pública, SNI,
  `channel_binding`, `pg_export_snapshot` e `pg_dump` 18 contra o servidor
  do piloto só serão provados na execução real. Se o backup falhar, o
  script para antes de qualquer escrita.

### Ensaio da versão versionada — 23/10/2026

Arquivo `backend/scripts/promover-master-owner.mjs` do commit `7c07281`, sem
nenhuma alteração. PostgreSQL 18.6 descartável criado só para o ensaio num
diretório temporário (porta 55434, `listen_addresses = 127.0.0.1`,
`pg_hba` só `hostssl` com `scram-sha-256`), certificado do servidor emitido por
uma CA descartável para um host fictício
`ep-ensaio-piloto-111.sa-east-1.aws.neon.tech`. Banco `neondb` com dono não
superusuário, as seis migrations aplicadas por `migration:run:compiled` com
`IGNORE_DOTENV_FILE=true` e TLS verificado. Dados fictícios: a conta-alvo
gravada como `WWLuiz90@Gmail.com` (sem papel, um vínculo DONO, uma sessão,
credencial `argon2id`), outra conta `MASTER_ADMIN` com `PLANS_MANAGE` e uma
terceira sem papel. Nenhum `.env`, Neon, piloto, production ou `agenda_dev` foi
usado.

O que o harness do ensaio fez fora do script (por `--require`, num arquivo
temporário que não foi versionado): resolveu o host fictício para
`127.0.0.1`, passou a CA descartável ao `pg_dump` (`PGHOSTADDR` e
`PGSSLROOTCERT`; `PGSSLMODE=verify-full`, SNI e `channel_binding=require`
continuaram os do script) e simulou o TTY para entregar a URL e a
confirmação por pipe. Para o Node, a CA descartável entrou por
`NODE_EXTRA_CA_CERTS`. As checagens de destino, TLS, banco e conta rodaram
como estão no script.

Resultados:

- Abortar: resposta em minúsculas e Enter vazio terminaram em
  `RESULTADO: abortado, nada gravado`, com backup feito e nenhum papel alterado.
- Promover: `COMMIT: ok`, as oito linhas `CONFERE_*: true` e
  `RESULTADO: MASTER_OWNER atribuído e conferido`.
- Repetir: `RESULTADO: sem alteração (já é MASTER_OWNER)`, sem novo backup.
- Demais contas: `MASTER_ADMIN` com `PLANS_MANAGE` e a conta sem papel ficaram
  iguais. O dump anterior à promoção foi restaurado num segundo banco
  descartável: sha256 igual ao do manifesto, contagens das 37 tabelas iguais ao
  `manifesto.json`, e usuários (sem `platform_role`), credenciais, vínculos e
  sessões idênticos aos do banco promovido. A única diferença foi o
  `platform_role` da conta-alvo.
- Recusas antes de conectar: endpoint proibido em `options`, pooler, outro
  endpoint, `agenda_dev`, `sslmode=disable`, `sslmode=no-verify`,
  `uselibpqcompat`, localhost, host fora de `neon.tech` e URL sem credencial.
  Senha errada parou na autenticação com `ERR_INESPERADO` e
  `password authentication failed`, sem a senha na saída. Sem TTY:
  `ERR_TERMINAL_NAO_INTERATIVO`. Pré-condições: IDs ausentes, IDs iguais,
  `pg_dump` ausente e pasta de operações dentro do repositório (nada foi criado
  nela).
- Nem a senha do banco nem a senha errada aparecem em `operacoes.jsonl` ou nos
  `manifesto.json`.
- No caminho "repetir" com stdin em pipe, o processo ficou aberto depois de
  imprimir o resultado, porque um pipe pausado mantém o loop vivo. Num console
  real do Windows, `stdin.pause()` depois do modo raw deixa o Node sair (teste
  separado). É uma limitação do harness, não do script.

## Publicação

O SHA `35f4713` da integration, que contém o PR #60, foi publicado pelo usuário
em API e web. `https://agenda-cloud-piloto-web.onrender.com/administracao`
responde 200 sem sessão (portão de login). Não há migration nem variável nova
para a promoção.

Depois da promoção, entrar em
`https://agenda-cloud-piloto-web.onrender.com/login?next=/administracao` com
`wwluiz90@gmail.com`, ou Minha conta → Administração da plataforma. O papel é
relido no banco a cada requisição. Só declarar o acesso funcional depois de
verificá-lo no ambiente publicado.
