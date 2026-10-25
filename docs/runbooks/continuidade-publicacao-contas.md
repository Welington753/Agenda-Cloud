# Continuidade: publicação da gestão de contas no piloto

Checkpoint de 23/10/2026, feito no PC do trabalho, atualizado em 25/10/2026
no PC de casa. O roteiro completo está em `publicacao-contas-piloto.md`.

## Feito no piloto

**A migration `AccountsAdministration1792800000000` já foi aplicada e
conferida.** Não aplique de novo.

| Etapa | Resultado |
| --- | --- |
| Commit de onde a operação rodou | `f37cbc9947806d12d6705cd812e8043fcbcace67` |
| `preparar` | estado `before` confirmado (6 migrations, 0/40), backup feito |
| `restauracao` | 37 tabelas com contagens e md5 iguais; migration ensaiada na cópia |
| `aplicar` | às 18:05:42 UTC: `aplicada_e_conferida`, 7 migrations, 40/40, `RESULT: SUCCESS` |

Repetir a fase `aplicar` só daria `ERR_ESTADO_ANTES_DIVERGENTE`. Ela não
grava nada nesse caso, mas não há motivo para rodá-la.

## Publicação: o que está comprovado (25/10/2026)

A versão anterior desta nota dizia que nada tinha sido publicado e que a API
no ar era `35f4713`. Os registros abaixo mostram outra coisa.

### Histórico de deployment no GitHub

O Render grava um deployment no GitHub a cada deploy. Consulta de 25/10/2026
(`gh api repos/Welington753/Agenda-Cloud/deployments` e `/statuses`), todos
com status `success`, horários de 23/10/2026 em UTC:

| Início | Serviço | SHA | Observação |
| --- | --- | --- | --- |
| 13:36 / 13:39 | web / API | `35f4713` | PR #62 |
| 14:48 / 14:48 | API / web | `9847c6a` | PR #63, mesclado às 14:44 |
| 16:50 / 16:50 | web / API | `26d9d85` | PR #65, mesclado às 16:47; **antes** da migration (18:05) |
| 18:48 / 18:48 | API / web | `f37cbc9` | um minuto depois do commit desta nota (18:47); Live às 18:49 (API) e 18:50 (web) |

`26d9d85` e `f37cbc9` têm o mesmo código de runtime: a diferença entre eles
é só `backend/scripts/` (procedimento da migration) e `docs/`.

Consequências:

- Entre cerca de 16:51 e 18:05 UTC, a API nova rodou com o schema antigo.
  Pela tabela "Compatibilidade" do runbook, login e agenda funcionam, mas
  convites, ficha de usuário, histórico, reautenticação e redefinição de
  senha falham nessa combinação. Já passou; não há o que desfazer.
- Os deploys de `9847c6a` e `26d9d85` começaram 3 a 4 minutos depois do merge
  na integration. Isso sugere **auto-deploy ligado**, ao contrário do que o
  runbook dizia.

### Funcionamento observado (25/10/2026, 23:57 UTC)

Requisições de um PC comum, sem cookie. Todas passaram pela borda do Render
(`Server: cloudflare`, `x-render-origin-server: Render`, `rndr-id`). Todas as
respostas são da aplicação: JSON do NestJS ou HTML do Next, nunca a página
HTML de erro da borda.

| Verificação | Resultado | Origem da resposta |
| --- | --- | --- |
| `GET $API/` | `200`, `Hello World!` | NestJS (`x-powered-by: Express`) |
| `GET $WEB/agenda_api/auth/me` | `401` `{"message":"Não autenticado.",...}` | API, repassada pelo proxy |
| `POST $API/auth/register`, corpo `{}` | `404` `{"message":"Cannot POST /auth/register",...}` | NestJS: rota inexistente |
| `POST $WEB/agenda_api/auth/register`, `Origin: $WEB`, corpo `{}` | `404`, mesmo JSON | API, repassada pelo proxy (o 404 próprio do proxy diria "Caminho inválido.") |
| `GET $WEB/cadastro` | `200`, título "Acesso por convite", texto "O acesso é liberado pela administração", sem `<form>` nem `<input>` | Next |
| `GET $WEB/login` | `200`; o bundle da página tem "Saiba como obter" e nenhum chunk tem "Criar conta" | Next (a página é renderizada no navegador, por isso a conferência foi no JavaScript servido) |

O corpo `{}` não cadastra ninguém em nenhuma versão: na API antiga
(`35f4713`), `registerSchema` exige `ownerName`, `businessName`, `email`,
`phone` e `password`, e o `ZodValidationPipe` responde `400` antes de chamar
o serviço. Nenhum login, alteração de conta ou envio de e-mail foi feito.

O `404` com "Cannot POST /auth/register" mostra que a API no ar não tem a rota
de cadastro, ou seja, não é `35f4713`. A API de reserva também não tem essa
rota; ela foi excluída pelo histórico do GitHub, que não registra deploy dela.

### Pendente de confirmação no painel do Render

- Qual deploy está **Live** em `agenda-cloud-piloto-api` e em
  `agenda-cloud-piloto-web` (esperado: `f37cbc9` nos dois).
- Se o **Auto-Deploy** está ligado e com qual gatilho. Se estiver, mesclar
  qualquer PR na integration publica os dois serviços, e trocar a branch do
  serviço da API para a reserva também publica na hora.

## Pendente

1. **Confirmar no painel** os itens acima.
2. **Teste autenticado**, com a conta `wwluiz90@gmail.com`: abas da
   Administração e lista de usuários sem contas bloqueadas (etapa 6 do
   runbook).
3. **Configurar o e-mail**, quando decidir (seção "E-mail" do runbook). Sem
   ele, convites ficam como "envio não configurado".
4. **PR desta branch para a integration.** É só documentação. Se o
   auto-deploy estiver ligado, o merge dispara um deploy com o mesmo runtime.

## Rollback e API de reserva

- **O Rollback do Render publica o deploy que você escolher** na lista de
  deploys do serviço; não há um alvo fixo.
- Para a API, só servem como alvo deploys de `26d9d85` ou `f37cbc9`. Os dois
  têm o mesmo runtime e o cadastro fechado. **Nunca** escolha um deploy de
  `35f4713`, `9847c6a` ou anterior: eles aceitam `POST /auth/register`.
- Se o defeito estiver no próprio runtime de `f37cbc9`, Rollback para
  `26d9d85` não resolve. Nesse caso, publique a API de reserva.

API de reserva (só para recuperação):

- **Branch e SHA:** `reserva/api-cadastro-fechado`,
  `5fe816626b7e891099f0c08ae8b309e1130234f9`.
- **O que é:** `35f4713` sem a rota `POST /auth/register`. O cadastro dá 404
  direto e pelo proxy; o resto é igual à API de `35f4713`.
- **Nunca mesclar na integration.** Ela existe só para ser publicada no
  serviço da API se a API nova precisar sair do ar.
- **Testes:** 1.365 unitários e 117 HTTP e2e. Contra um PostgreSQL descartável
  com as 7 migrations e TLS verificado:
  - cadastro 404 sem gravar nada;
  - login e sessão funcionando, inclusive sessões criadas pela API nova;
  - conta bloqueada recusada;
  - restrição `DENIED` respeitada;
  - agenda funcionando;
  - web novo no navegador: as telas da administração nova ficam indisponíveis.
- **Limitações:**
  - não se sabe se o Render aceita deploy por SHA de outra branch; o plano B
    é trocar a branch do serviço temporariamente;
  - o teste no navegador foi em HTTP local;
  - o CI não rodou nessa branch.

Detalhes, tabela do que fica indisponível e procedimento em
`publicacao-contas-piloto.md`, seção "API de reserva".

## Fica só no PC do trabalho (fora do Git, de propósito)

**Pasta de operações** `C:\Users\User\AgendaCloud-operacoes`:

- `contas-preparar-2026-10-23T17-49-14-052Z`: dump, `manifesto.json` e
  `restauracao-conferida.json`;
- `contas-aplicar-2026-10-23T17-59-40-736Z`: dump e `manifesto.json`. É o
  ponto de recuperação anterior à migration, 18:01:11 UTC;
- `operacoes.jsonl`: registro das operações;
- os backups `master-owner-*` da promoção;
- `promover-master-owner.mjs`: cópia antiga do script, com os Endpoint IDs
  fixos.

Por que não vão para o Git: os dumps têm dados reais e hashes de senha; os
manifestos e o registro têm o Endpoint ID do piloto. Copie para outro
computador só por meio seguro e fora de pastas sincronizadas.

**Worktrees do PC do trabalho:**

- `C:\Projetos\Agenda-Cloud-publicacao`: detached em `f37cbc9`, sem
  alterações;
- `C:\Projetos\Agenda-Cloud-reserva`: `reserva/api-cadastro-fechado`, já
  enviada ao remoto;
- `C:\Projetos\Agenda-Cloud-promocao`: `chore/continuidade-promocao-master-owner`,
  já no remoto.

Nenhum deles tem trabalho que não esteja no remoto. O clone de casa
(`C:\Projetos\Agenda-Cloud`) não tem esses worktrees.

## Retomar em outro computador

Nenhum passo abaixo precisa de banco nem da pasta de operações.

1. Atualize o clone e confira os SHAs:
   ```powershell
   git fetch origin
   git rev-parse origin/integration/nestjs-typeorm-frontend   # f37cbc9947806d12d6705cd812e8043fcbcace67
   git rev-parse origin/reserva/api-cadastro-fechado          # 5fe816626b7e891099f0c08ae8b309e1130234f9
   git switch docs/recuperacao-api-reserva                    # esta nota e o runbook atualizado
   ```
2. Confira o histórico de deployment antes de qualquer deploy:
   ```powershell
   gh api "repos/Welington753/Agenda-Cloud/deployments?per_page=6" --jq '.[] | .environment + \" \" + .sha[0:7] + \" \" + .created_at'
   ```
3. Siga a seção "Pendente". Não publique de novo se o painel confirmar
   `f37cbc9` Live nos dois serviços.
4. **Se a API nova falhar:** veja "Rollback e API de reserva" acima.

Para uma conferência só de leitura do banco (fase `conferir`), você precisa de
três coisas:

- os Endpoint IDs, que estão no gerenciador de senhas;
- a URL direta do piloto;
- uma pasta limpa em `f37cbc9` com `npm ci` (passo 0 do runbook).

Ela não é necessária para validar a publicação.
