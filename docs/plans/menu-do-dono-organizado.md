# Menu do dono organizado

Lote só de navegação da área real (`/conta`). Reorganiza o menu do dono, agrupa Configurações por assunto e passa a usar o termo do segmento para quem atende. Nenhuma página nova, nenhuma página apagada, nenhum endereço mudou.

## Antes e depois

Menu do dono:

| Antes | Depois |
|---|---|
| Início | Dashboard (mesmo endereço, `/conta/visao-geral`) |
| Agenda | Agenda |
| Clientes | Profissionais ("Barbeiros" na barbearia) |
| Serviços | Serviços |
| Profissionais | Clientes |
| Configurações | Equipe e acessos (antes, dentro de Configurações) |
| | Comissões (antes, só pelo atalho do Início; só com o recurso no plano) |
| | Configurações |

Índice de Configurações do dono:

| Antes (lista única) | Depois (por assunto) |
|---|---|
| Estabelecimento | **Estabelecimento:** Estabelecimento, Notificações |
| Equipe e acessos | **Financeiro:** Recebimentos (antes, só pelo atalho do Início) |
| Notificações | **Sua conta:** Aparência, Perfil e segurança |
| Aparência | |
| Perfil e segurança | |

No celular a barra inferior continua com quatro áreas (Dashboard, Agenda, Clientes e Configurações). Profissionais, Serviços, Equipe e acessos e Comissões ficam no menu da conta, como Serviços e Profissionais já ficavam.

## Decisões

- **Endereços mantidos.** Equipe e acessos continua em `/conta/configuracoes/equipe` e Recebimentos em `/conta/recebimentos`. Os encaminhamentos dos endereços antigos não mudaram.
- **Acessos contextuais mantidos.** Horários e disponibilidade (com os bloqueios) continuam abertos pelo cartão de cada profissional. Os atalhos do Dashboard para Recebimentos e Comissões continuam. A comissão em massa continua em Profissionais.
- **Comissões no menu só com o recurso no plano.** O item aparece quando a sessão traz a área `COMISSOES_VER`, que o servidor só dá com o recurso contratado e sem restrição ao dono (`backend/src/auth/session-areas.ts`). Sem a lista de áreas, o item não aparece. A rota continua recusando no servidor.
- **Termo do segmento.** A sessão passa a informar o segmento do estabelecimento (`tenantCategory` no contexto, vindo de `tenants.category`). A regra fica em `src/lib/conta/termos.ts`: barbearia usa "Barbeiros"; os outros segmentos ficam com "Profissionais". Vale para o item do menu do dono e o título da página. O resto do texto da tela continua dizendo "profissional".
- **Personalização não entrou.** Ela só existe na demonstração (`/painel/personalizacao`). Na área real não há tela nem rota. Nenhum link foi criado.
- **Gerente, funcionário e administração da plataforma não mudam.** O menu do gerente segue as áreas concedidas, com os mesmos nomes.
- **Menu lateral rola em janela baixa.** Com oito áreas, "Configurações" saía da tela numa janela de 400 px de altura. O menu passou a rolar por dentro e o submenu de Configurações ficou com posição fixa, calculada a partir do item.

## Ordem de publicação

O web funciona com a API de antes: sem `tenantCategory` o termo fica "Profissionais". Para "Barbeiros" aparecer, a API deste lote precisa estar publicada. Não há migration.

## Estado e retomada

- **Feito:**
  - branch `feat/menu-dono-organizado` a partir de `187c507`;
  - menu em `src/lib/conta/navegacao.ts` (`itensDoDono`), grupos em `src/lib/conta/rotas.ts` (`agruparSecoes`), termo em `src/lib/conta/termos.ts`;
  - `tenantCategory` no contexto da sessão (`backend/src/auth/session-context.ts` e `auth.service.ts`);
  - testes de regra e de navegador atualizados.
- **Validação local** (PostgreSQL descartável com TLS, nesta máquina):
  - Vitest do web, lint, lint com tipos e `tsc`;
  - backend: `typecheck`, lint e testes de `src/auth`;
  - suítes de navegador: `services`, `clients`, `auth`, `equipe`, `visao-geral`, `professionals`, `gerente`, `recebimentos`, `comissoes` e `acesso-usuario`;
  - capturas em 1280 px e 390 px, com barbearia nos planos Pro e Básico.
- **Não rodou localmente:** `test:browser:proxy` (precisa de HTTPS local); fica para o CI.
- **Próximo passo:** revisão do PR. Sem merge nem deploy até aprovação.
- **Fora deste lote:**
  - na página de Recebimentos aberta pelo índice, o retorno ainda diz "Voltar ao Dashboard", e nenhum item do menu do dono fica marcado nela;
  - o termo do segmento no restante dos textos e para o gerente;
  - a remoção das contas fictícias do login, que está no PR #112.
- **Só neste computador:** a worktree `C:\wt\menu`.
