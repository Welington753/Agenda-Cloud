# Plano: portal da plataforma independente da operação

Pedido registrado em 2026-11-03. **Implementado na branch
`feat/portal-independente`** (a partir da integration em `8916f18`), sem
merge nem deploy. O piloto continua no SHA operacional
`8916f180cad7397074e54c25ef237ffc7c797681`, com as 14 migrations aplicadas e
conferidas (ver `docs/runbooks/continuidade-portal-multisservicos.md`). Este
lote não tem migration. Ver "Estado e retomada" no fim.

## Objetivo

Separar completamente a experiência do portal da plataforma da operação dos
estabelecimentos.

## Estado atual (publicado em `8916f18`, observado na validação de 03/11)

- O portal mora em `/plataforma/*` (`/conta/administracao` redireciona para
  `/plataforma/estabelecimentos`).
- A navegação operacional de `/conta` mostra, para `MASTER_OWNER`, o grupo
  "PLATAFORMA" com o atalho "Portal da plataforma".
- O portal tem "Ir para a operação" e "Sair" no cabeçalho.
- A entrada é o `/login` comum, que leva à operação (`/conta/visao-geral`).

## Requisitos

1. `/conta` e suas telas apresentam **somente** funções operacionais do
   cliente.
2. Remover o grupo "PLATAFORMA" e o atalho "Portal da plataforma" da
   navegação operacional, **inclusive** para quem também é proprietário do
   sistema. Conferir desktop, celular e menus de perfil.
3. O portal tem endereço direto próprio, preferencialmente `/portal`, com
   entrada/login, layout e navegação independentes da operação.
4. Entrar no portal não pode exigir criar, selecionar ou possuir vínculo com
   um estabelecimento. O acesso administrativo não depende do plano nem da
   validade de um estabelecimento.
5. Os recursos administrativos continuam exclusivos de contas **ativas**
   `MASTER_OWNER`. Clientes, donos de estabelecimentos, gerentes e
   profissionais de qualquer plano, inclusive Max, são recusados **pelo
   servidor**, mesmo acessando URLs e APIs diretamente.
6. Não usar nome, e-mail ou nome do plano como regra de autorização.
7. As três contas proprietárias existentes já foram confirmadas pelo usuário
   como pertencentes aos dois donos do sistema. Não remover, unir ou alterar
   essas contas automaticamente.
8. Preservar a proteção do último proprietário.
9. Tratar as rotas antigas (`/plataforma/*`, `/conta/administracao/*`) com
   autorização adequada (redirecionamento para o portal sem expor dados a
   quem não é `MASTER_OWNER`).
10. Revisar os fluxos de autenticação e redirecionamento (`next=`, destino
    depois do login, sessão expirada, logout de cada lado).
11. Preservar a reautenticação usada pelas ações operacionais de equipe e
    recebimentos. **Não** bloquear indiscriminadamente `/platform/reauth`.

## Testes necessários

- Proprietário (`MASTER_OWNER` ativo) **sem** vínculo operacional entra no
  portal pela entrada própria e usa lista, ficha e demais telas.
- Proprietário que também é dono de estabelecimento: a operação não mostra
  atalhos administrativos; o portal funciona pela entrada própria.
- Cliente sem papel global (dono, gerente, profissional; planos Básico, Pro e
  Max) é recusado no portal pela URL e pela API (`/platform/*`), inclusive
  rotas antigas.
- `MASTER_OWNER` suspenso/inativo é recusado.
- `MASTER_ADMIN`/`MASTER_SUPPORT` continuam recusados (regra do #84).
- A operação continua funcional, sem grupo "PLATAFORMA" nem atalho, em
  desktop, celular e menu de perfil (testes de navegador).
- A reautenticação das ações de equipe e recebimentos continua funcionando.
- Proteção do último proprietário continua valendo.
- Redirecionamentos: login do portal, `next=` da operação e do portal, rotas
  antigas.

## Restrições para a implementação

- Partir da integration conferida (`integration/nestjs-typeorm-frontend`,
  hoje em `8916f18`), em branch própria.
- Sem merge, deploy, consulta ao banco real ou alteração de contas sem
  autorização expressa.
- Se exigir migration, seguir o fluxo de kit e runbook usado no #86.

## Estado e retomada

Implementado em `feat/portal-independente` (worktree
`Agenda-Cloud-portal-independente`), sem migration, merge ou deploy, sem
consulta ao banco real e sem mexer em contas reais.

### O que mudou

- **Operação (`/conta`)**: saíram o grupo "PLATAFORMA", o item "Portal da
  plataforma" (menu lateral, barra e menu da conta no celular) e os atalhos
  em Início e Perfil e segurança. `/conta` não lê mais `GET /platform/access`
  e não leva ao portal: sem estabelecimento, a pessoa fica em Configurações
  (só as pessoais). `itensDaNavegacao` não tem mais `comAdministracao`.
- **Portal (`/portal`)**: páginas movidas de `/plataforma/*` para
  `src/app/portal/(area)/*` (mesmas telas). `/portal` é a entrada própria:
  sem sessão mostra o login do portal; com sessão segue para o `next` de
  dentro do portal ou para `/portal/estabelecimentos`. Um `next` da operação
  nunca é seguido. Sessão expirada em qualquer página do portal leva a
  `/portal?next=...`; o "Sair" do portal volta para `/portal`. O cabeçalho
  do portal não tem mais "Ir para a operação".
- **Login**: o formulário virou `components/auth/formulario-login.tsx`,
  usado por `/login` (operação, comportamento igual) e por `/portal`.
- **Endereços antigos**: `/plataforma`, `/administracao` e
  `/conta/administracao` levam a `/portal`; com subcaminho, para a mesma
  página em `/portal/...` (307, preservando a busca). O destino passa pela
  entrada e pelo portão do portal: quem não é proprietário vê só a recusa.
- **Servidor**: sem mudança. `platformCapabilities` continua exigindo conta
  ativa com `MASTER_OWNER`, sem ler vínculo, plano, nome ou e-mail;
  `/platform/reauth` continua aberto a qualquer sessão (equipe e
  recebimentos); proteção do último proprietário intacta.

- **Senha temporária no portal**: um `MASTER_OWNER` ativo com troca
  obrigatória entra pelo `/portal` e vê só a tela "Escolha a sua senha"
  (`troca-de-senha-do-portal.tsx`), sem menu nem dados; o servidor já
  recusava `/platform/*` com `TROCA_DE_SENHA_OBRIGATORIA`. A troca reaproveita
  o `TrocarSenha` da operação (movido para `components/auth/trocar-senha.tsx`)
  e a mesma rota `POST /auth/password`: mesma política, exigência limpa no
  servidor, outras sessões encerradas, papel e vínculos intactos. Depois, o
  portal relê sessão e acesso e fica na página pedida (ou vai para a lista,
  se era a entrada). A troca da operação continua igual.

### Testes

- Unitários do frontend (891) e do backend (1714), lint, `lint:types` e
  build.
- Navegador contra PostgreSQL 17 descartável local com TLS (cluster
  temporário no scratchpad, porta 55433, 14 migrations aplicadas). Suítes do
  portal, cada uma na própria invocação (no CI, API nova e contadores de
  login novos; o limite de produção de 5 logins por 15 minutos por IP não
  mudou):
  - `portal-entrada` (3 logins): proprietário sem estabelecimento, login do
    portal com volta à página pedida, celular, sessão expirada, "Sair",
    login da operação sem atalho, `next` da operação ignorado;
  - `portal-senha-temporaria` (3 tentativas): login com senha temporária,
    bloqueio de tela e de API antes da troca, política de senha, troca pelo
    portal, acesso depois, outra sessão encerrada, papel e vínculos
    intactos, sessão expirada, senha antiga recusada, "Sair";
  - `portal-recusas` (2 logins): dono no Max, gerente e profissional
    recusados pelas URLs nova e antigas e pela API; reauth do dono; dono
    suspenso recusado.
  - Existentes afetadas: `administracao` (inclui `MASTER_ADMIN` recusado),
    `acesso-usuario` (troca de senha da operação), `contas`, `equipe`,
    `gerente`, `recebimentos` e `auth`. Backend: `test:db-e2e` (248) no
    mesmo banco descartável.
- CI: passos `browser_portal_entrada`, `browser_portal_senha_temporaria` e
  `browser_portal_recusas` em `test-frontend-auth.yml`.

### Pendências

- Sem teste no ambiente publicado. Publicar segue o fluxo de sempre (API e
  web no mesmo SHA); sem migration.
