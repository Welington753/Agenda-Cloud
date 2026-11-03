# Plano: portal da plataforma independente da operação

Pedido registrado em 2026-11-03. **Ainda não implementado.** Nada deste
documento foi publicado; o piloto continua no SHA operacional
`8916f180cad7397074e54c25ef237ffc7c797681`, com as 14 migrations aplicadas e
conferidas (ver `docs/runbooks/continuidade-portal-multisservicos.md`).

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
