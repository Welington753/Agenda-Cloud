# Continuidade — identidade escura (PR #76)

Checkpoint gravado em 27/10/2026, à noite, no PC de casa, para retomar no PC do trabalho. Esta nota só registra o estado. Nada aqui foi conferido de novo no painel do Render ou no banco ao escrevê-la.

## Estado no remoto (GitHub)

| O quê | Onde | SHA |
|---|---|---|
| PR #76: identidade escura, aberto, **sem merge e sem deploy** | `feat/identidade-escura` | `ca121a31463c3dec3893da90ef77904d8da4c2bd` |
| Capturas do PR #76 (dados fictícios, 19 PNG) | `capturas/identidade-escura` | `65ec5631b92b25346e59766015a30989f1c6deaa` |
| Integration, com o PR #75 mesclado | `integration/nestjs-typeorm-frontend` | `f4314cda33a4fb8c9d75e03b8b0d4afd3c7f0371` |
| PR #74: procedimento StaffLogin + AppointmentPayments, **sem merge** | `chore/publicacao-staff-pagamentos-piloto` | `764bec5` (nota da aplicação) |
| Esta nota | `docs/continuidade-identidade-escura` | o commit que adiciona este arquivo |

O código validado do PR #76 é o head `ca121a3`. O CI ("auth real e serviços reais…") passou nesse SHA. Esta branch de documentação parte desse mesmo estado. Ela não deve ser mesclada no lugar do PR #76 nem mudar o head dele.

## Só neste PC (não estão no Git, de propósito)

- **Backups operacionais** em `~/AgendaCloud-operacoes`: os backups da aplicação StaffLogin + AppointmentPayments e os registros das fases.
- **Segredos** em `~/AgendaCloud-secrets` (por exemplo, o par VAPID) e os backups antigos em `~/AgendaCloud-backups`.
- **Banco descartável local** (PostgreSQL 17 com TLS, porta 55433), o script de ambiente e os certificados, na pasta temporária da sessão do Claude. Esse banco está desligado.
- **Relatórios e capturas brutas** do Playwright em `test-results/`, que o `.gitignore` não versiona.
- **Stash** `stash@{0}` ("WIP on fix/cancel-stale-confirmation: 57faa28"), que é antigo e deve ser preservado.
- **Worktrees**, que devem ser preservados:
  - `C:/Projetos/Agenda-Cloud-publicacao` (c77c313);
  - `C:/Projetos/Agenda-Cloud-publicacao-ar` (9e6dd53, usado na aplicação do PR #74).

Nada disso foi nem deve ser enviado ao Git. No PC do trabalho esses arquivos não existem. Para testes de navegador lá, monte um banco descartável próprio, como em `docs/setup-local.md`.

## O que o PR #76 muda

A mudança é só visual. Não mexe no backend, em migrations, permissões ou regras de negócio. A navegação do PR #75 continua igual: submenu de Configurações, índice e seções sem barra interna, Serviços e Profissionais no menu do dono e quatro itens na barra do celular.

- **Paleta escura** aplicada aos tokens semânticos existentes em `src/app/globals.css`:

  | Papel | Cor |
  |---|---|
  | Fundo | `#141619` |
  | Menu lateral | `#0D0F11` |
  | Superfícies | `#1A1D21` |
  | Selecionado | `#22262B` |
  | Hover | `#282D33` |
  | Bordas | `#2B2F34` |
  | Borda de botão secundário / hover | `#414750` |
  | Texto / secundário / discreto | `#ECEEEB` / `#A4A8AD` / `#89919A` |
  | Botão principal / texto dele | `#ECEEEB` / `#141619` (hover `#D9DDD8`) |
  | Foco | `#BFC5CC` |

  Os tokens novos são `ink-muted`, `border-control`, `focus` e `chrome-*` (menu lateral). Cada um tem valor no tema claro, que mantém a identidade atual. Não há laranja no tema escuro. Erro, aviso e sucesso continuam com cor.
- **Ajuste de contraste (documentado no CSS e no PR):** a borda de campo (`border-strong`) é `#656C75`, não `#414750`. Com `#414750` o contraste fica em 1,8:1 sobre o cartão, abaixo do mínimo de 3:1. Com `#656C75` fica 3,2:1 sobre o cartão e 3,4:1 sobre o fundo.
- **Acabamento:**
  - cantos de 8 px nos cartões e 6 px nos controles;
  - sombra só em menus, modais e painel;
  - sem vidro na barra do agendamento público;
  - item ativo do menu e do submenu com fundo `#22262B` e linha de 3 px;
  - avatares neutros.
- **Agenda em lista:**
  - **Linhas:** linhas numa lista com separadores. Horário com números alinhados e peso, depois o cliente; serviço, duração e profissional discretos.
  - **Status:** neutros, com rótulo e ícone próprios.
  - **Ações:** "Novo agendamento" é o único botão claro; as ações da reserva são leves, mas mantêm 44 px de toque, e Cancelar segue vermelho.
- **Início:** ícones neutros; solicitações ficam em amarelo só quando há pendentes. Os alternadores não usam mais bloco sólido.
- **Marca:** `src/components/marca/marca.tsx`, um SVG inline com símbolo e nome.

## Pendência: símbolo da marca

**A imagem de referência não chegou ao Claude.** O símbolo usado é um calendário, o do ícone do app (`src/lib/pwa/icone.tsx`) redesenhado em traço. Falta comparar com a referência original e, se for diferente, ajustar `src/components/marca/marca.tsx` com o PR #76 ainda aberto.

## Testes realmente executados

- **Locais**, no PC de casa, com PostgreSQL 17 descartável com TLS e `IGNORE_DOTENV_FILE=true`:
  - `npx vitest run`: 842/842;
  - `tsc --noEmit`;
  - `eslint`: 0 erros, com um aviso antigo de tamanho em arquivo de teste.
- **Navegador, antes da correção de toque:**
  - `test:browser:services`: 7/7, incluindo a suíte nova `identidade-visual-flow`;
  - `test:browser:aparencia`: 2/2, com chaves VAPID efêmeras como no CI;
  - `test:browser:acesso-usuario`: 1/1.
- **Navegador, depois da correção de toque:** `whatsapp`, `agenda-view`, `agenda-profissional`, `visao-geral` e `appointments` passaram.
- **CI:**
  - a primeira execução, em `61ac24a`, falhou no teste de 44 px do WhatsApp;
  - `ca121a3` volta a altura para `min-h-11`, e o CI passou nesse SHA;
  - o log confirma que `identidade-visual-flow`, `whatsapp-contato-flow` e `aparencia-e-notificacoes-flow` rodaram.
- **Orçamento de convites:** `test:browser:services` agora gasta 6 de 10 aceites de convite.
- **Build local:** rode `next build` sem `NODE_ENV=development`, senão a pré-renderização falha.

## Publicação: divergência a resolver

- O PR #75 foi mesclado em `f4314cd`, com `[skip render]`.
- **Duas informações que não batem:**
  - o usuário informou que a publicação do #75 deu certo;
  - o último relatório do Claude afirmou que o Live continuava em `0f7bfd3`.

  Nenhuma das duas foi conferida no painel ao escrever esta nota. **O SHA que está Live na API e no web é uma pendência da retomada:** confira no painel do Render, em Events/Deploys de cada serviço, sem republicar nada só para conferir.
- Regra que continua valendo: API e web publicados do mesmo commit, a API primeiro, por Manual Deploy → Deploy a specific commit.

## Banco do piloto

- **StaffLogin e AppointmentPayments já foram aplicadas e conferidas:** 10 migrations, 28/28 objetos, conferir final com resultado "after".
- **Não repetir nem reverter.**
- Os detalhes estão em `docs/runbooks/continuidade-staff-pagamentos-piloto.md`, na branch `chore/publicacao-staff-pagamentos-piloto`.
- O PR #74 continua separado e sem merge.

## Depois do visual

Na ordem: backup automático, monitoramento, financeiro e estoque.

## Retomar no PC do trabalho (`C:\Projetos\Agenda-Cloud`)

Preserve qualquer trabalho que já esteja lá. Não use `switch --force`, `reset --hard`, `stash` automático nem `clean`.

```powershell
cd C:\Projetos\Agenda-Cloud
git remote -v                      # deve apontar para Welington753/Agenda-Cloud
git status                         # alterações locais? se houver, decida antes de trocar de branch
git stash list                     # só registre; não aplique nem descarte
git worktree list                  # só registre
git fetch origin
git log --oneline -1 origin/docs/continuidade-identidade-escura
git log --oneline -1 origin/feat/identidade-escura      # esperado: ca121a3
git show origin/docs/continuidade-identidade-escura:docs/runbooks/continuidade-identidade-escura.md
```

Para trabalhar no PR #76, com o working tree limpo:

```powershell
git switch feat/identidade-escura                         # se já existir: git merge --ff-only origin/feat/identidade-escura
# ou, se não existir localmente:
git switch -c feat/identidade-escura --track origin/feat/identidade-escura
```

Se `git status` mostrar alterações, não troque de branch por cima delas. Faça commit numa branch própria ou abra um worktree separado (`git worktree add ..\Agenda-Cloud-identidade origin/feat/identidade-escura`).

Primeiros passos da retomada:

1. Conferir no painel do Render qual SHA está Live na API e no web (ver "Publicação").
2. Comparar o símbolo com a imagem de referência e ajustar, se for preciso.
3. Revisar as capturas no PR #76 e decidir sobre o merge. Merge e deploy só com autorização explícita.
