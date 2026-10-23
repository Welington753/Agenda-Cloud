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
  "Ensaio da versão versionada"). Naquele ensaio nenhuma mudança pareceu
  necessária; a execução real mostrou que era (ver abaixo).
- A conta **continua NÃO promovida**: a execução real depende dos Endpoint IDs
  e da URL direta, que só o usuário tem, e de um terminal interativo.
- Primeira execução real (em `a70c279`) parou em `ERR_CONEXAO_SEM_TLS` na
  primeira conexão, antes de ler a conta, do backup, da confirmação e de
  qualquer `UPDATE`; depois o processo caiu com `Unhandled 'error' event`
  (`57P01`). Nada foi gravado. Causa e correção em "Falha de 23/10/2026".
- Tentativas seguintes, já com a correção de TLS, pararam antes de qualquer
  conexão: `ERR_ENDPOINT_DIFERENTE_DO_PILOTO` (registrada em
  `operacoes.jsonl`) e `ERR_URL_INVALIDA`. Lançador e entrada oculta revistos
  em "Lançador e entrada oculta — 23/10/2026".

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
2. Entrada (`promover-master-owner-entrada.mjs`): lida sem eco; recusada,
   com a categoria e nunca o conteúdo, se vier vazia, com `Ctrl+V` sem colagem,
   com caracteres de controle, com mais de uma URL, com texto depois do Enter
   ou com texto extra (psql, aspas, espaços). Nenhuma URL é escolhida entre
   várias e nada é removido do meio.
3. Destino pela URL, antes de qualquer rede: endpoint do piloto em
   `*.neon.tech`, banco `neondb`, sem pooler, sem o endpoint proibido em
   nenhuma parte da URL, sem `sslmode` afrouxado nem `uselibpqcompat`.
4. TLS com cadeia e hostname verificados (independe do `sslmode` da URL),
   conferido no socket do cliente (`TLSSocket` cifrado e `authorized`,
   TLS 1.2+, `checkServerIdentity` com o host da URL), e
   `current_database() = neondb`. `pg_stat_ssl` só é exibido: no Neon o TLS
   termina no proxy e a sessão interna aparece como `false`. Toda conexão tem
   listener de `error` e é encerrada em qualquer falha.
5. Leitura somente: exatamente uma conta com o e-mail (o `citext` segue a
   normalização do login), ativa e com credencial `argon2id`. Não mostra
   senha nem hash. Se já for MASTER_OWNER, termina sem alteração.
6. Backup: `pg_dump -Fc` no mesmo snapshot das contagens por tabela, com
   `manifesto.json` e sha256.
7. Confirmação digitada: `PROMOVER wwluiz90@gmail.com`. Qualquer outra
   resposta aborta sem gravar.
8. Transação: `SELECT ... FOR UPDATE`, nova conferência, `UPDATE` só de
   `platform_role`, condicionado ao papel lido antes e exigindo 1 linha.
9. Conferência após o commit, em nova conexão: papel final, conta ativa,
   demais campos, permissões, credencial, vínculos, MASTER_OWNER +1 e total
   de usuários iguais.
10. Registro em `operacoes.jsonl` (horário, ID, e-mail, papel anterior/novo,
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

No PC do trabalho a execução usa um worktree separado,
`C:\Projetos\Agenda-Cloud-promocao` (branch
`chore/continuidade-promocao-master-owner`, `backend\node_modules` como junção
para o do clone principal), para não trocar a branch do clone principal.

Forma recomendada: o lançador `backend/scripts/abrir-promocao-master-owner.ps1`
por `-File`, aberto explicitamente no Windows Terminal. Ele define
`IGNORE_DOTENV_FILE`, os Endpoint IDs (sem exibi-los), `PG_BIN` e
`AGENDA_OPS_DIR`, roda o script e deixa a janela aberta com o código de saída:

```powershell
wt.exe --window new powershell.exe -NoExit -NoProfile -ExecutionPolicy Bypass `
  -File C:\Projetos\Agenda-Cloud-promocao\backend\scripts\abrir-promocao-master-owner.ps1 `
  -PilotEndpointId <ep-...> -ProductionEndpointId <ep-...>
```

No Windows Terminal, cole com Ctrl+V uma única vez e pressione Enter. No
console clássico (conhost), Ctrl+V **não cola** enquanto a entrada está
oculta; ali, use o botão direito.

Saída esperada numa promoção: `TLS_CLIENTE: TLSv1.3 hostname=ok cadeia=...`
(`TLS_INTERNO_PG_STAT_SSL (informativo): false` é normal no Neon),
`TLS_VERIFICADO: true`, `CONTAS_COM_O_EMAIL: 1`,
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
- Limitação desse ensaio, que levou à falha abaixo: o TLS terminava no próprio
  PostgreSQL, então `pg_stat_ssl.ssl` era `true`. Não representava o proxy do
  Neon.

## Falha de 23/10/2026 e correção

Primeira execução real, em `a70c279`, contra o piloto:

```
DESTINO_ENDPOINT_PILOTO: true
DIFERENTE_DO_PROIBIDO: true
BANCO: neondb
ERRO: ERR_CONEXAO_SEM_TLS
```

seguida de `Unhandled 'error' event` do `pg.Client` com
`terminating connection due to administrator command` (`57P01`) e código de
saída 1.

Comprovado (código e reprodução descartável):

- `ERR_CONEXAO_SEM_TLS` vinha de `conectar()`, na primeira conexão (leitor),
  logo depois de `client.connect()`: `SELECT s.ssl ... FROM pg_stat_ssl` e
  `if (ssl !== true)`. Isso antecede a leitura da conta, o backup, a
  confirmação e qualquer `UPDATE`; nada foi gravado.
- `pg_stat_ssl` descreve a sessão que o PostgreSQL recebe. Atrás de um proxy
  que termina o TLS, como o do Neon, essa sessão chega sem TLS e aparece como
  `false`, mesmo com o trecho cliente-proxy cifrado e verificado. Com um proxy
  descartável que termina TLS e repassa em TCP, a versão `a70c279` reproduziu
  exatamente `ERR_CONEXAO_SEM_TLS`, e o servidor mostrou a sessão do script como
  `idle` com `ssl = f`.
- O `parar()` lançava dentro de `conectar()` antes de devolver o cliente, sem
  `client.end()` e sem listener de `error`. A conexão ficou aberta e ociosa e
  mantinha o processo vivo. Quando o servidor a encerrou (`57P01` vem como
  ErrorResponse sem consulta ativa), o `pg.Client` emitiu `error` sem ouvinte e
  o Node abortou. Reproduzido com `pg_terminate_backend` na sessão abandonada:
  mesma mensagem, mesmo código.

Não comprovado: quem encerrou a conexão no piloto. `57P01` é o que o
PostgreSQL envia ao receber SIGTERM (por exemplo `pg_terminate_backend`, ou um
desligamento rápido do compute). Não há evidência, nesta máquina, de que tenha
sido suspensão por inatividade, reinício ou ação manual.

Correção no script (proteções de destino, conta, backup, confirmação e
transação inalteradas):

- TLS conferido no socket do cliente: `TLSSocket` com `encrypted`,
  `authorized === true` (cadeia validada pelo Node com `rejectUnauthorized`),
  TLS 1.2 ou 1.3 e `tls.checkServerIdentity` com o host da URL. Saída
  `TLS_CLIENTE` mostra protocolo, cadeia e validade. `pg_stat_ssl` virou
  informativo (`TLS_INTERNO_PG_STAT_SSL`).
- `conectar()` registra o cliente, anexa listener de `error` antes do
  `connect()` e o encerra em qualquer falha antes de relançar. Todo `end()`
  passa por `encerrar()`, e um `finally` final encerra o que ainda estiver
  aberto.
- O listener não deixa o procedimento seguir: registra o erro
  (`CONEXAO_ENCERRADA: <código>`); a próxima operação nesse cliente falha, e
  o erro final traz `ORIGEM: conexão encerrada antes (<código>)`, também gravado
  em `operacoes.jsonl` (`codigoDriver`, `conexoesEncerradas`).
- Ctrl+C na entrada oculta também pausa o stdin.

Observação, sem mudança: o `pg` do Node trata `channel_binding=require` como
preferência (usa `SCRAM-SHA-256-PLUS` só se o servidor oferecer). O `pg_dump`
recebe `PGCHANNELBINDING=require` e o exige; se o servidor não oferecer, o
backup falha e nada é gravado.

### Ensaio da correção — 23/10/2026

Mesmo PostgreSQL 18.6 descartável, `neondb` recriado com as seis migrations e
os mesmos dados fictícios. Proxy descartável em Node (responde `S` ao
SSLRequest, termina TLS e repassa em TCP para o PostgreSQL, que aceita
`hostnossl` só para esse banco e usuário de ensaio), em variações:

| Caso | Resultado |
| --- | --- |
| `a70c279` pelo proxy TLS | `ERR_CONEXAO_SEM_TLS`, conexão deixada `idle`; ao encerrá-la, `Unhandled 'error' event` `57P01` (reprodução) |
| Proxy sem TLS (`N`) | `The server does not support SSL connections`, saída 1 |
| Certificado de CA não confiável | `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, saída 1 |
| Hostname incorreto, CA confiável | `ERR_TLS_CERT_ALTNAME_INVALID`, saída 1 |
| Banco reescrito no proxy (falha depois de conectar) | `ERR_BANCO_DIFERENTE_DE_NEONDB`, saída 1 |
| Leitor encerrado no servidor durante o backup | `CONEXAO_ENCERRADA: 57P01`, `pg_dump` sem o snapshot, `ORIGEM: ... (57P01)`, saída 1, nada gravado |
| `channel_binding=require` pelo proxy (sem PLUS) | `pg_dump` recusa, saída 1, nada gravado |
| Direto no PostgreSQL com TLS, abortar | `TLS_INTERNO_PG_STAT_SSL: true`, abortado |
| Proxy: abortar (Enter vazio) | abortado, nada gravado |
| Proxy: promover | `COMMIT: ok`, oito `CONFERE_*: true` |
| Proxy: repetir | sem alteração |

Em todos os casos o processo terminou sozinho, sem evento não tratado, e o
servidor não ficou com nenhuma sessão `agenda-cloud-%`. As demais contas,
credenciais, vínculos e sessões tiveram hash idêntico antes e depois. O dump da
promoção foi restaurado: sha256 e contagens das 37 tabelas iguais ao
manifesto, com a conta-alvo sem papel. Nenhuma senha apareceu nos registros.
Nada foi testado contra o Neon.

## Lançador e entrada oculta — 23/10/2026

Depois da correção de TLS houve duas tentativas sem conexão:
`ERR_ENDPOINT_DIFERENTE_DO_PILOTO` (12:25 UTC, registrada em
`operacoes.jsonl`) e `ERR_URL_INVALIDA`. O registro guarda só o código, então a
entrada exata dessas tentativas não é conhecida; nenhuma das duas chegou a
abrir conexão, ler a conta ou fazer backup.

Comprovado:

- O lançador anterior era um `-Command` montado numa string e passado por
  `Start-Process -ArgumentList`. As aspas duplas eram removidas na linha de
  comando do Windows, e `(o host da URL ...)` virou uma subexpressão: daí
  `O termo 'o' não é reconhecido`. Esse lançador também imprimia o Endpoint ID.
- Na janela aberta por `Start-Process powershell.exe` neste Windows, o
  console é o Windows Terminal (handoff do terminal padrão; `WT_SESSION` não
  aparece nesse caso). No Windows Terminal, Ctrl+V entrega a URL intacta ao
  modo oculto, inteira ou em blocos.
- No console clássico (conhost), com o stdin em modo raw, Ctrl+V não cola:
  chega só o caractere `\u0016`. `new URL()` descarta esse controle e falha,
  o que dava `ERR_URL_INVALIDA`. O botão direito cola normalmente.
- Antes desta correção, uma entrada vazia, `psql '...'` ou a URL entre aspas
  davam `ERR_URL_INVALIDA` sem dizer por quê, e duas URLs concatenadas
  **passavam** na leitura: o host era o da primeira e a segunda ia parar no
  valor de `channel_binding`. Isso foi corrigido.

Hipóteses para as duas tentativas, sem evidência que as distinga: entrada
vazia (Enter antes da colagem), texto além da URL (por exemplo o trecho
`psql` do painel do Neon), Ctrl+V num console clássico ou URL de outro
endpoint.

Correção:

- Lançador versionado `backend/scripts/abrir-promocao-master-owner.ps1`, por
  `-File`, sem montar comandos com várias camadas de aspas. Endpoint IDs como
  parâmetros, conferidos sem repetir o valor e nunca exibidos.
- Leitura e classificação da entrada em
  `backend/scripts/promover-master-owner-entrada.mjs`, com
  `promover-master-owner-entrada.spec.ts` (stdin simulado). O script mostra
  `ERRO:` e `MOTIVO:` com a categoria (`entrada vazia`, `Ctrl+V chegou como
  tecla`, `há mais de uma URL`, `chegou texto depois do Enter`, `copie
  somente a URL`, ...). Nunca imprime nem grava a entrada.
- Depois do Enter, a leitura espera 250 ms: texto além de espaços nesse
  intervalo (uma segunda linha colada) é recusado, em vez de ir para a
  confirmação.
- TLS, encerramento de conexões, destino, conta, backup, confirmação e
  transação ficaram como em `d63b8c7`.

Testes (somente URLs fictícias; a área de transferência foi sobrescrita com
elas e nunca lida):

- Diagnóstico isolado com o módulo real, sem rede, colando de verdade pela área
  de transferência: Ctrl+V real (`SendKeys`) no Windows Terminal e no conhost,
  e clique real com o botão direito (`mouse_event`) no conhost.

| Caso | Windows Terminal, Ctrl+V | conhost, Ctrl+V | conhost, botão direito |
| --- | --- | --- | --- |
| Colagem única + Enter | aceita, idêntica | `CTRL_V_SEM_COLAGEM` | aceita, idêntica |
| Colagem em dois blocos | aceita, idêntica | `CTRL_V_SEM_COLAGEM` | aceita, idêntica |
| Entrada vazia | `URL_VAZIA` | `URL_VAZIA` | `URL_VAZIA` |
| Duas URLs concatenadas | `URL_MAIS_DE_UMA` | `CTRL_V_SEM_COLAGEM` | `URL_MAIS_DE_UMA` |
| `psql '...'` | `URL_COM_TEXTO_EXTRA` | `CTRL_V_SEM_COLAGEM` | `URL_COM_TEXTO_EXTRA` |
| URL entre aspas | `URL_COM_TEXTO_EXTRA` | `CTRL_V_SEM_COLAGEM` | `URL_COM_TEXTO_EXTRA` |
| Duas linhas coladas | (não testado: o Windows Terminal pede confirmação de colagem de várias linhas) | — | `URL_MAIS_DE_UMA_LINHA` |

  "Idêntica" quer dizer igual, caractere a caractere, à URL fictícia, inclusive
  a senha `npg_Ab1-x.Y_z~Q9%21`. Digitar a URL pelo teclado simulado também
  chegou intacto no Windows Terminal; no conhost com teclado ABNT2, o `~`
  (tecla morta) gerou caracteres de controle e a entrada foi recusada.
- Lançador real + script real, abertos com `wt.exe` e colados com Ctrl+V real,
  com IDs fictícios e host `*.exemplo.invalid`, que para antes da rede:
  colagem única chegou à conferência de destino (`ERR_HOST_NAO_NEON`); vazia
  `ERR_URL_VAZIA`; duas colagens `ERR_URL_MAIS_DE_UMA`; `psql`
  `ERR_URL_COM_TEXTO_EXTRA`. A tela, lida por UI Automation, não mostrou a
  URL nem os IDs; o registro também não. Sem terminal interativo, o lançador
  imprime o cabeçalho e o script para em `ERR_TERMINAL_NAO_INTERATIVO`.
- Regressão no PostgreSQL descartável atrás do proxy TLS: abortar, promover
  (oito `CONFERE_*: true`) e repetir sem alteração; duas URLs recusadas antes
  da rede; nenhuma sessão restante.
- `vitest run scripts/` no backend: 227 testes em 15 arquivos; `oxlint` sem
  avisos.

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
