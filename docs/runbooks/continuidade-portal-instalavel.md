# Continuidade: dois aplicativos instaláveis (Agenda Cloud e Portal AC)

Nota para retomar o trabalho em qualquer máquina. Atualizada em 09/11/2026.

## Atualização de 09/11/2026, tarde: C_final publicado no piloto, iPhone pendente

- **C_final já estava Live quando a sessão autorizada começou.** A conferência
  read-only no Render CLI mostrou os dois serviços em
  `8e8577d698fd3d2b9eb2a42b6945fbd3cb3205d2`, com deploys manuais:
  - API `agenda-cloud-piloto-api`: `dep-dbosjcijnfac73ftrdug`, criado às
    13:25:06 UTC, Live às 13:26:16 UTC (Nest iniciou às 13:26:10);
  - web `agenda-cloud-piloto-web`: `dep-dbosjeajnfac73ftrio0`, Live às
    13:27:42 UTC.
  - Os deploys anteriores (C16 `879cef8`: API `dep-dboscs6417fc7398vef0`, web
    `dep-dbosds6c6qcc738k3llg`) estão `deactivated`.
  - Auto-Deploy continua desligado (`autoDeploy: no`, trigger `off`).
  - **Nenhum deploy novo foi criado nesta sessão**, porque o commit autorizado
    já estava publicado na ordem API → web. A origem desses dois deploys
    (quem disparou) não foi conferida aqui.
- **Pré-requisitos conferidos:**
  - última `conferir` do kit da 16 (execução `2026-11-09T13-16-38-431Z`, em
    `operacoes.jsonl`): estado `after-commission-settings` (o estado que o
    kit só atribui com 16 migrations e `7/7`), `sessoesDaMigration: 0`,
    `janelaOk: true` (`JANELA_DE_TRANSICAO: ok`); feita às 13:16 UTC, antes
    dos deploys do C_final, e não repetida nesta sessão;
  - CI no C_final: run 42611417755, `head_sha` `8e8577d`, `completed/success`;
  - `git diff 879cef8 8e8577d -- backend` vazio: o C_final não muda backend
    nem migrations. Nenhuma migration foi executada e nenhum backup foi
    restaurado.
- **Validação HTTP no piloto (09/11/2026, depois dos deploys):**
  - `/login` 200; `/agenda_api/auth/me` sem sessão 401; `auth/me` direto na
    API 401;
  - `/portal` e `/portal/visao-geral` (200) anunciam um único manifest,
    `/portal/manifest.webmanifest`, e um único `apple-touch-icon`,
    `/portal/apple-icon`, com título e `apple-mobile-web-app-title`
    "Portal AC";
  - manifest do portal: `id` e `start_url` `/portal/visao-geral`,
    `scope` `/portal`, nome "Portal AC"; ícones `/portal/icone-*.png` e
    `/portal/apple-icon` respondem 200 `image/png`;
  - `/login` e `/conta/visao-geral` continuam com `/manifest.webmanifest` e
    `/apple-icon`, título "Agenda Cloud";
  - manifest da operação (`id`/`start_url` `/conta/visao-geral`, `scope` `/`)
    é idêntico ao da base `92cc6ae` guardada em
    `C:\Projetos\portal-pwa-evid\base\manifest.json`; `icone-192.png`,
    `icone-512.png`, `icone-maskable-512.png` e o `apple-icon` são iguais à
    base, byte a byte;
  - logs da API e do web desde 13:24 UTC sem linhas de erro.
- **Passo 0 do iPhone (comportamento anterior do atalho): não registrado.** O
  usuário ainda não informou o que viu antes do deploy, e o deploy já estava
  feito quando a sessão começou. Nada foi observado pelo Claude no aparelho.
  Registrar aqui somente o que o usuário confirmar.
- **Pendente:** validação no iPhone (passo 1 abaixo), feita e confirmada pelo
  usuário.

## Atualização de 09/11/2026: mesclado, publicação e iPhone pendentes

- PR #100 mesclado na integração (merge commit, `[skip render]`):
  **C_final = `8e8577d698fd3d2b9eb2a42b6945fbd3cb3205d2`**, sobre o C16
  `879cef8f378d1007f606ba67246ae7e5535df905` das comissões.
- **CI do PR #100 (head `208f2c8`):** a tentativa 1 do run 42095434698 falhou
  antes dos testes, ao ligar o TLS do PostgreSQL descartável (`psql` sem
  socket logo depois do `pg_isready`; instabilidade da preparação, não do
  código). A tentativa 2 (job 129121693322) passou, com `portal-instalavel` 3/3.
- **CI no C_final:** `test-frontend-auth` por `workflow_dispatch`, run
  42611417755, `head_sha` = `8e8577d`, sucesso; `portal-instalavel` 3/3 e as
  suítes de comissões passaram.
- **Nada publicado:** API e web continuam em `92cc6ae`, Auto-Deploy desligado
  (Render CLI, 09/11/2026).
- **Pendente:**
  1. migrations 15 e 16 e deploy do C16, pelo runbook das comissões;
  2. passo 0 no iPhone, antes do deploy do C_final;
  3. deploy do C_final (API e web do mesmo commit, API primeiro, Manual
     Deploy);
  4. validação no iPhone, passo 1 abaixo.

As seções seguintes são o registro de 05/11/2026 (antes do commit e do PR).

## Onde está

- Branch `feat/portal-app-instalavel`, worktree `C:\Projetos\Agenda-Cloud-portal-pwa`.
  Ela parte de `origin/integration/nestjs-typeorm-frontend` em `92cc6ae`, SHA
  conferido antes de criar a branch.
- **Nada commitado nem enviado:** sem commit, push, PR, merge ou deploy.
- Os PRs de comissões (#98 e #99) **não** estão neste lote.
- O lote mexe só no frontend. Não há migration nem mudança no backend.
- **O que o lote faz:**
  - o portal (`/portal`, `/portal/**`) passa a anunciar manifest, ícone e
    título próprios: `src/app/portal/layout.tsx` e
    `/portal/manifest.webmanifest`, com `id` e `start_url` em
    `/portal/visao-geral` e `scope: "/portal"`;
  - o manifest e os ícones da operação ficam como estão;
  - ao tocar numa notificação, `public/sw.js` nunca reaproveita nem navega uma
    janela `/portal` ou `/portal/**`.
- **O `scope: "/portal"` não é isolamento de segurança.** Ele funciona por
  prefixo. O acesso ao portal continua exigindo `MASTER_OWNER`, e os destinos
  internos continuam validados estritamente por `sanitizarDestinoInterno` e
  `destinoNoPortal`.

## Validação local (não é CI)

Feita no PC do trabalho em 05/11/2026, contra PostgreSQL 18 descartável com
TLS e dados fictícios:

- `npm test` passou nos 919 testes. `npx tsc --noEmit`, `npm run lint` e
  `npm run lint:types` saíram sem erros.
- Comparação do HTML do `next build` (Turbopack) com o build da base `92cc6ae`:
  - nas páginas do portal, há um único manifest, `/portal/manifest.webmanifest`,
    com `apple-touch-icon` em `/portal/apple-icon` e título "Portal AC";
  - em `/conta/visao-geral`, `/login`, `/agendar/<slug>` e `/`, os metadados
    são idênticos à base;
  - o manifest e os PNGs da operação são idênticos à base, byte a byte.
- Playwright, uma suíte por invocação: `portal-instalavel` passou nos 3
  testes, e `portal-entrada`, `portal-recusas`, `push` e `agendamento-publico`
  passaram.
- As evidências (HTML, manifests e PNGs da base e da versão nova) estão em
  `C:\Projetos\portal-pwa-evid`, e os logs de build em
  `C:\Projetos\portal-pwa-build*.log`. Ficam fora do repositório. Não apague.

## CI

- O passo `Run installable platform portal` (`npm run test:browser:portal-instalavel`)
  foi adicionado ao `test-frontend-auth.yml`, com o mesmo padrão das outras
  suítes do portal.
- O filtro de caminhos passou a incluir `public/**`, onde está o `sw.js`.
- **Esse CI ainda não rodou:** o job só dispara num PR para a integration ou
  por `workflow_dispatch`.
- O job tem `timeout-minutes: 20`, e o passo novo acrescenta cerca de 1 minuto.
  Se o tempo estourar por lentidão de infraestrutura, por exemplo na
  instalação do Playwright, dispare o job de novo.

## Pendente: validação no iPhone

O Chromium não comprova nada disto. O roteiro completo está no plano do lote.

0. **Antes do deploy**, no Safari:
   - abra `/portal/visao-geral` e adicione à Tela de Início;
   - anote o nome sugerido e o endereço em que o atalho abre.

   Isso confirma a causa no aparelho.
1. **Depois do deploy**, confira no aparelho:
   - o app "Agenda Cloud" já instalado continua igual;
   - o "Portal AC" é instalado a partir de `/portal`, com o nome e o ícone
     próprios;
   - depois do login, o Portal AC volta à Visão geral do portal;
   - cada app tem sessão própria;
   - links fora do `scope`, como redefinir senha, abrem na visualização do
     Safari;
   - o toque na notificação push continua abrindo Solicitações no Agenda Cloud.
2. Se já existir um atalho errado do portal no aparelho, apague-o antes do
   passo 1.

## Estado do ambiente local (PC do trabalho)

- Os servidores locais da worktree `Agenda-Cloud-comissoes-geral` (portas 3000
  e 3001, PIDs 11496 e 13776) foram encerrados com autorização do usuário e
  **não foram religados**.
- O cluster PostgreSQL descartável dos testes (porta 55436, no scratchpad da
  sessão) está **parado**. Os servidores de teste deste lote também foram
  encerrados.
- `CLAUDE.md`, o stash, as worktrees e as junctions existentes foram
  preservados e não fazem parte deste lote.

## Publicação: coordenar com as migrations pendentes do piloto

- **Estado do piloto em 05/11/2026:**
  - API e web estão em `92cc6ae`, publicados manualmente sem a migration 15
    (comissões) no banco;
  - a migration 16 (#98 e #99) está aberta e aguarda revisão do usuário.
- **Pré-requisitos:** este lote não traz migration, mas só deve ser publicado
  com o banco do piloto na migration que o commit publicado exige. Antes:
  1. siga a sequência combinada das comissões (kit da 15 e, depois, kit da 16);
  2. publique pelo runbook `publicacao-piloto-render.md`, com API e web do
     mesmo commit, a API primeiro, por Manual Deploy.
- Não publique esta branch isolada por cima do piloto. Ela entra pela
  integration, por PR, e sai junto com o próximo commit que for publicado.
- Faça o passo 0 do iPhone antes desse deploy.
