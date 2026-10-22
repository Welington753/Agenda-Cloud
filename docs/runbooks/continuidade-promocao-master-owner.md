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

## O que falta

1. Fornecer a conexão autorizada do piloto: a URL **direta** (host sem
   `-pooler`) do banco `neondb`, que fica só no gerenciador de senhas. Ela é
   digitada oculta pelo script; não coloque em `.env`, variável, arquivo ou chat.
2. Executar o procedimento abaixo e conferir o resultado.
3. Publicar API e web (passo separado, ver "Publicação").

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
  contra banco.
- Nada foi testado contra o Neon: TLS da cadeia pública, SNI,
  `channel_binding`, `pg_export_snapshot` e `pg_dump` 18 contra o servidor
  do piloto só serão provados na execução real. Se o backup falhar, o
  script para antes de qualquer escrita.

## Publicação

SHA indicado para API e web: `b5a2c06e87a66a3509b5e6df449511c0e0b9389e` (árvore
idêntica a `77b8d6d`, que passou em todos os checks do PR #60). API primeiro,
depois o web; não há migration nem variável nova. **Não foi publicado.**

Depois da publicação **e** da promoção, entrar em `/login?next=/administracao`
com `wwluiz90@gmail.com`, ou Minha conta → Administração da plataforma. O papel
é relido no banco a cada requisição. Só declarar o acesso funcional depois de
verificá-lo no ambiente publicado.
