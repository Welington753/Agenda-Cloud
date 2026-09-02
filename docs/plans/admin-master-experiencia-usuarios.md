# Admin Master + Experiência de Usuários — Plano de Evolução

> **Status:** planejamento apenas. Nenhum código foi alterado para produzir este documento. Execução via `writing-plans`/`executing-plans` específico de cada lote, quando aprovado — não deste documento diretamente.

**Goal:** Planejar três frentes — (1) duas contas Master com acesso completo e modo de suporte auditável, (2) agendamento público mais profissional, (3) gestão do estabelecimento mais simples e segura — com um modelo de acesso único e coerente, sem fingir segurança de backend que ainda não existe.

**Contexto verificado:** branch `feat/melhorias-frontend`, HEAD em `04a5c8e` (`fix: harden commission tracking`), working tree limpa. Baseline: 113 testes, lint limpo, build com 21 rotas.

---

## 1. Auditoria do estado atual

### 1.1 Autenticação e sessão

`src/lib/auth/autenticacao.ts` — login 100% simulado: qualquer conta aceita a senha fixa `SENHA_DEMONSTRACAO = "demo123"`, sem hash, sem verificação de servidor. `src/lib/auth/auth-context.tsx` guarda a "sessão" em `sessionStorage` (`agenda-barber:v3:sessao-usuario`) como JSON puro — qualquer pessoa com acesso ao DevTools pode escrever ali um `SessaoUsuario` arbitrário (papel `dono`, `MASTER_OWNER`, qualquer `tenantId`) e o app aceita, porque não há nada do outro lado validando. Isso é esperado num protótipo frontend-only e está documentado nos comentários do próprio código — mas precisa ficar explícito neste plano que **nenhuma proteção de papel/permissão hoje sobrevive a um usuário técnico adulterando `sessionStorage`/`localStorage` diretamente**.

### 1.2 Usuários e vínculos

Dois domínios de conta, sempre separados:
- `UsuarioPlataforma` (`papel: PapelPlataforma` = `MASTER_OWNER | MASTER_ADMIN | MASTER_SUPPORT`) — administra a plataforma inteira, sem tenant.
- `UsuarioEstabelecimento` + `Membership` (`papel: PapelEstabelecimento` = `dono | gerente | recepcionista | profissional`) — vinculado a exatamente um tenant hoje (arquitetura já permite múltiplos vínculos por usuário, mas nenhuma tela usa isso).

`autenticar()` busca primeiro em `usuarioPlataformaRepository`, depois em `usuarioEstabelecimentoRepository` — nunca mistura os dois domínios na mesma sessão. Essa separação já é a base correta para o modelo de dois Masters.

### 1.3 Roles e matriz de permissões existente

- `src/lib/access/access-control.ts` tem duas funções centrais, cada uma para seu domínio: `calcularAcessoEfetivo` (permissão de tenant, considera papel + plano + features desativadas + negação/liberação individual) e `podeAdministrarPlataforma` (permissão de plataforma, considera papel + `permissoesExtras`).
- `PapelPlataforma`: hoje `MASTER_OWNER` tem tudo incondicionalmente (`if (papel === "MASTER_OWNER") return {permitido:true}`); `MASTER_SUPPORT` só tem `suporte.acessar` por padrão; `MASTER_ADMIN` não tem nada por padrão (só o que estiver em `permissoesExtras`).
- `identificarProprietarioPrincipal` já existe e protege **só o `MASTER_OWNER` mais antigo** contra remoção — não generaliza para "nunca zero owners", que é a regra que os dois sócios precisam.
- `Permission` (tenant) já cobre agenda/agendamento/profissionais/servicos/consumidores/relatorios/equipe/comissoes/personalizacao/configuracoes — matriz robusta e já testada (`access-control.test.ts`).

### 1.4 Rotas e guards

| Rota | Guard | Observação |
|---|---|---|
| `/master/*` | `RequireRole(["MASTER_OWNER","MASTER_ADMIN","MASTER_SUPPORT"])` no layout | Gate grosso — qualquer um dos 3 papéis entra em qualquer página `/master/*`; granularidade fina fica a cargo de cada página. |
| `/master/administradores` | `podeGerenciarAdministradores(papel)` calculado inline na página, **não** via `RequirePlatformPermission` | Componente `RequirePlatformPermission` existe e funciona (visto em `require-platform-permission.tsx`), mas esta página não o usa — inconsistência de padrão a corrigir no Lote 1. |
| `/painel/*` | `RequireRole(["dono","gerente","recepcionista"])` no layout + `RequirePermission` por página | Já é o padrão correto e testado (visto nas features de agenda/comissões). |
| `/profissional/*` | `RequireRole(["profissional"])` (a confirmar no layout) + `RequirePermission` | Mesma família de guard. |
| `/[slug]`, `/[slug]/agendar`, `/[slug]/agendamento/[id]` | Sem guard de sessão (público por definição) | Bloqueio é por `status` do tenant e feature do plano, não por role. |

### 1.5 Falha de proteção encontrada em `/master/administradores` (documentar, não corrigir agora)

Em `src/app/master/administradores/page.tsx`:
- `alternarStatus(id, statusAtual)` (suspender/reativar administrador) **não checa `podeGerenciar` nem impede suspender o próprio proprietário principal** — qualquer `MASTER_SUPPORT` autenticado pode chamar essa função (o botão "Suspender/Reativar" aparece pra todo mundo, sem `{podeGerenciar && ...}`).
- `alterarPapel(id, novoPapel)` **não tem nenhuma guarda** — o `<select>` só aparece na UI quando `podeGerenciar && papel !== "MASTER_OWNER"`, mas a função em si não confere `podeGerenciar` nem impede rebaixar o último `MASTER_OWNER`. Esconder o `<select>` não é proteção real da função.
- Isso é exatamente o padrão de bug que as correções de comissão (`04a5c8e`) já corrigiram em outras telas — vale replicar a mesma disciplina aqui no Lote 1: toda função de mutação confere a permissão de novo, nunca só o botão.

### 1.6 Equipe e convites (nível tenant)

`/painel/equipe` já tem fluxo de convite (`Convite`, `conviteRepository`) com token, expiração, revogação ao reenviar — mesmo padrão que `/master/administradores` deveria usar para os dois Masters (aceitar convite gera `UsuarioPlataforma` novo). Boa referência de UX já validada a reaproveitar.

### 1.7 Menus

`src/components/layout/admin-shell.tsx` é o shell único (sidebar desktop + drawer mobile) usado por `/master`, `/painel` e `/profissional` — cada layout monta sua própria lista `itens: ItemNavegacao[]` e passa pronta. `/master/layout.tsx` usa uma lista **fixa**, sem filtrar por permissão (todo Master vê os 3 itens, mesmo que não possa agir em algum). `/painel/layout.tsx` já filtra por `podeAcessar(item.permissao).permitido` — padrão a replicar em `/master`.

### 1.8 Dashboard do estabelecimento (`/painel`)

Mostra hoje: contagem de agendamentos do dia, faturamento previsto (soma simples de `precoCentavos`), lista dos próximos atendimentos. Não tem: atalhos de ação rápida, alertas de configuração pendente, cancelamentos/faltas do período, nem comissão do período (feature nova, ainda não integrada ao dashboard). Não diferencia conteúdo por papel além do guard de página.

### 1.9 Fluxo completo do agendamento público

`/[slug]` (apresentação) → `/[slug]/agendar` (wizard de 5 etapas: serviço, profissional, data/horário, dados, confirmação) → `/[slug]/agendamento/[id]` (detalhe + cancelar/remarcar). Já tem: `BarraDeEtapas` (indicador de progresso), reconfirmação de disponibilidade antes de gravar (implementada nas correções de agendamento desta sessão), loading state nos horários (`carregandoHorarios`), estado vazio "nenhum horário livre", `aria-pressed` nos botões de data/horário, `aria-invalid`/`aria-describedby` no formulário de dados, máscara de WhatsApp, `disabled={enviando}` no botão final (previne duplo clique), bloqueio quando tenant suspenso/cancelado ou feature fora do plano (implementado na correção de integridade de agendamento desta sessão).

**Não tem:** resumo persistente da escolha (usuário perde de vista o serviço/profissional escolhido ao avançar etapas), destaque para o primeiro horário disponível, botão "voltar" que preserva dados ao trocar de etapa anterior sem perder o que já foi preenchido nas etapas seguintes (hoje volta zera a etapa seguinte via `setEtapa`), foto/especialidade do profissional (dado não existe no modelo — corretamente omitido hoje), CTA fixo consistente em todas as etapas.

### 1.10 Página pública do estabelecimento

`/[slug]` já usa `ModeloClassico`/`ModeloModerno` — identidade visual, endereço, horário, lista de serviços com preço/duração, lista de profissionais (nome + avatar, sem foto), CTA de agendar condicionado a `agendamentoPublicoHabilitado`. Já parece uma página de apresentação, não um painel — ponto positivo a preservar no redesenho. Falta: política de cancelamento visível antes de agendar, informações "antes da visita".

### 1.11 Componentes de formulário/modal/botão/navegação

- `Botao` (`src/components/ui/button.tsx`): `forwardRef`, `disabled` nativo com estilo, sem indicador de "por quê" desabilitado (`title`/`aria-describedby` ausente quando desabilitado).
- `Modal` (`src/components/ui/modal.tsx`): já tem `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, fecha com `Escape`, trava scroll do body. **Falta:** foco automático no primeiro elemento focável ao abrir, foco preso dentro do modal (Tab não escapa), e restauração do foco ao elemento que abriu o modal ao fechar.
- **`Link` envolvendo `Botao`** (que renderiza `<button>`) — HTML inválido (`<a><button></button></a>`), confirmado em `src/components/publico/modelo-classico.tsx` (CTA "Agendar"), `src/app/[slug]/agendar/page.tsx` e `src/app/[slug]/agendamento/[id]/page.tsx` (botões "Voltar" em telas de erro). Padrão repetido, não é caso isolado.
- `AdminShell`: menu mobile fecha com clique fora, mas não com `Escape`; não há `aria-expanded` no botão "Abrir menu".

### 1.12 Personalização do estabelecimento

`/painel/personalizacao` existe, gerenciada só via `personalizacao.gerenciar` (permissão sem feature associada — sempre disponível independente do plano, conforme comentário em `access-control.ts`). Não auditado a fundo nesta rodada — fora do escopo imediato dos 3 lotes de UX pedidos.

### 1.13 Comportamento mobile

`AdminShell` já é responsivo (sidebar desktop / drawer mobile). Formulário público já usa `inputMode` correto. Grade de horários já é `grid-cols-3 sm:grid-cols-4` (mobile-first). Sem problema estrutural grave encontrado — ajustes ficam a nível de polimento nos lotes 3-5.

### 1.14 Dados em `localStorage`

Tudo sob o namespace `agenda-barber:v3:` (`src/lib/storage/local-storage.ts`), com `readCollection` semeando automaticamente coleções ausentes — mecanismo já testado e usado para as duas coleções novas de comissão sem quebrar dados antigos. O mesmo mecanismo serve para semear as duas contas Master (ver §3.1).

### 1.15 O que pode ser simulado no frontend vs. o que exige backend

**Pode ser simulado agora (protótipo, não é segurança real):**
- Esconder/mostrar UI por papel e permissão.
- Guards de rota (`RequireRole`, `RequirePermission`, `RequirePlatformPermission`).
- Funções de mutação que conferem a permissão de novo antes de agir (já é o padrão desde as correções de agendamento/comissão).
- Estrutura de dados e fluxo conceitual do modo de suporte (banner, entrada/saída, registro em `auditoriaRepository`).
- Contas de demonstração sem credenciais reais (senha fixa documentada como não-real).

**Exige backend antes de produção:**
- Login real com verificação de servidor.
- Hash de senha (bcrypt/argon2), nunca senha em texto plano nem fixa.
- Sessão segura (JWT assinado ou cookie `httpOnly`/`secure`/`sameSite`), nunca objeto JSON legível em `sessionStorage`.
- Recuperação de conta, MFA.
- Provisionamento dos dois Masters por comando administrativo/seed protegido no backend — nunca credencial no código-fonte do frontend.
- Auditoria confiável (gravada e validada no servidor — hoje `auditoriaRepository` é só `localStorage`, qualquer um edita).
- Revogação de sessão, bloqueio de força bruta.
- Proteção real dos endpoints (autorização no servidor a cada requisição, nunca confiar no que o cliente envia — `tenantId` incluso).
- Isolamento multi-tenant garantido no banco (row-level ou schema), não só filtro `.filter(x => x.tenantId === ...)` no cliente.
- Confirmação re-autenticada de ações sensíveis (ex.: excluir estabelecimento, mudar plano).
- Qualquer proteção contra alteração manual do `localStorage`/`sessionStorage` — **isso é estruturalmente impossível de resolver só no frontend**; a única defesa real é o servidor nunca confiar em nada vindo do cliente.

**Nunca apresentar** a matriz de permissões do frontend como segurança de produção — ela é UX e prevenção de erro de uso, não controle de acesso adversarial.

---

## 2. Modelo administrativo recomendado

### 2.1 Master da plataforma — duas contas

Ambos os sócios recebem `papel: "MASTER_OWNER"`. Não crio um papel novo — `MASTER_OWNER` já concede acesso incondicional em `podeAdministrarPlataforma`, exatamente o "acesso completo" pedido. Provisionamento:

- **Agora (frontend/demo):** `gerarUsuariosPlataformaSeed()` em `seed-data.ts` ganha um segundo registro `MASTER_OWNER` (nome/e-mail placeholder claramente marcados como demo, ex. `socio2@demo.local` — nunca um e-mail real dos sócios). Isso é aceitável porque é dado de demonstração, não credencial.
- **Futuro (backend):** as duas contas reais são provisionadas por comando administrativo (`nest cli` custom command ou migration/seed protegida por variável de ambiente, executada uma vez na infraestrutura) — nunca hardcoded no repositório, nunca em `.env` versionado. O comando gera a senha inicial (ou envia link de definição de senha) fora do controle de versão. Este plano **não** pede nem grava e-mail/senha reais dos sócios — combinado.

**Regra do "último Master" generalizada:** hoje `identificarProprietarioPrincipal` protege só o mais antigo. Nova regra pura a implementar no Lote 1: `podeRemoverOuRebaixarMaster(usuarios: UsuarioPlataforma[], alvoId: string): boolean` — retorna `false` se a ação deixaria zero contas com `papel === "MASTER_OWNER" && status === "ativo"`. Com dois owners, cada um pode remover/rebaixar o outro (não a si mesmo, ver regra abaixo) desde que sobre pelo menos um.

**Regras adicionais de guarda (pura, testável, sem depender de backend):**
- Um usuário nunca promove a si mesmo a Master — `alterarPapel`/criação de Master só é alcançável a partir de uma sessão **já** de plataforma (`escopo === "plataforma"`); rota de estabelecimento (`escopo === "estabelecimento"`) nunca tem acesso a `usuarioPlataformaRepository`, isso já é verdade estruturalmente hoje (repositórios diferentes, nenhuma tela de `/painel` importa `usuarioPlataformaRepository`) — só precisa ficar testado explicitamente para não regredir.
- Dono de estabelecimento não pode criar Master — mesma garantia estrutural acima; adicionar teste de regressão explícito.

### 2.2 Modo de suporte (Master entrando no contexto de um tenant)

**Não existe hoje** — busca no código confirma zero implementação. Desenho:

- `SessaoUsuario` (só quando `escopo === "plataforma"`) ganha campo opcional `contextoSuporte?: { tenantId: string; entradoEm: string }`.
- Entrar: Master, a partir de `/master/estabelecimentos/[id]`, clica "Entrar em modo de suporte" → grava `contextoSuporte` na sessão (via `entrarComo` do `AuthContext`, reaproveitando o mesmo mecanismo) → redireciona para `/painel` **do tenant escolhido**.
- Enquanto `contextoSuporte` ativo: banner fixo no topo de `AdminShell` — "Modo de suporte: você está vendo [Nome do Estabelecimento] como [Nome do Master]. [Sair do modo de suporte]" — visualmente distinto (cor de alerta), presente em toda página do `/painel` durante essa sessão.
- Dentro do modo de suporte, o Master **vê e usa `/painel` normalmente com acesso total** (não fica preso à matriz `dono/gerente/...` — é suporte, não personificação de um papel específico) — mas toda ação de mutação feita durante o modo de suporte fica marcada para auditoria com o `usuarioResponsavelId` do **Master**, nunca fingindo ser o dono.
- Sair: botão no banner volta para `/master`, limpa `contextoSuporte` da sessão.
- Auditoria: dois `AcaoAuditoria` novos — `"suporte.tenant.entrado"` e `"suporte.tenant.saido"` — gravados em `auditoriaRepository.registrar(...)` com `tenantId` preenchido e `usuarioResponsavelId`/`Nome` do Master. (A `AcaoAuditoria` existente `"suporte.acessado"` já usada em dado semeado permanece para o significado genérico de "suporte olhou algo"; as duas novas são específicas de entrar/sair do contexto do tenant.)
- **Isto não é "login como usuário"**: a sessão nunca copia identidade do dono/gerente, nunca reusa `membershipId` de outra pessoa — é sempre a sessão do próprio Master, com um flag de contexto. Por isso satisfaz a regra "separar acesso de suporte de personificação de usuário".

### 2.3 Dono do estabelecimento

Continua sendo o papel com controle total do próprio tenant (já é `TODAS_AS_PERMISSOES` em `PERMISSOES_PADRAO_POR_PAPEL.dono`, ver `access-control.ts`). Ações "somente dono" pedidas que **ainda não têm permissão dedicada** e precisam de `Permission` nova (Lote 1):
- `dados_juridicos.gerenciar` (CNPJ/CPF, razão social — hoje `Estabelecimento.documentoFiscal` é editável por qualquer um com `configuracoes.gerenciar`, que gerente também tem).
- `estabelecimento.excluir_solicitar` (nova — hoje não existe fluxo de solicitação de exclusão).
- `dados.exportar` (nova — hoje não existe exportação).
- `equipe.gerenciar` já cobre convidar/remover administradores — mas **hoje gerente também tem `equipe`?** — conferido: `PERMISSOES_PADRAO_POR_PAPEL.gerente` não inclui `equipe.visualizar`/`equipe.gerenciar` hoje, então já está correto (só dono, por padrão do papel). Precisa é impedir que o dono **libere** `equipe.gerenciar` para um gerente via `permissoesLiberadas` sem essa ficar marcada como ação de alto risco (ver matriz §4).

### 2.4 Gerente

Já tem operacional amplo por padrão (`agenda`, `agendamento.*`, `profissionais.*`, `servicos.*`, `consumidores.*`, `relatorios.visualizar`, `comissoes.*` — este último adicionado nas correções desta sessão). Falta reforçar que gerente **nunca** deve aparecer com acesso a: `dados_juridicos.gerenciar`, `estabelecimento.excluir_solicitar`, mudança de plano (não existe hoje tela de mudança de plano pelo tenant — correto, é `/master` que muda), `dados.exportar`. Regra "não conceder permissões superiores às próprias" — hoje `permissoesLiberadas` em `Membership` não tem NENHUMA validação impedindo um dono de liberar `configuracoes.gerenciar` para um gerente que inclua acesso indireto a algo sensível — este plano recomenda validar, no Lote 1, que a UI de gestão de equipe (`/painel/equipe`) nunca ofereça liberar uma permissão marcada como "somente dono" (ver coluna da matriz).

### 2.5 Recepcionista

Já corresponde ao desenhado: `agenda.visualizar/gerenciar`, `agendamento.criar/editar/cancelar`, `consumidores.*` — e **não** tem `comissoes.*`, `servicos.gerenciar`, `profissionais.gerenciar`, `equipe.*`, `personalizacao.gerenciar`, `configuracoes.gerenciar` hoje. Já está correto, sem mudança necessária além de confirmar via teste de regressão.

### 2.6 Profissional

Já corresponde: `agenda.visualizar/gerenciar`, `agendamento.editar/cancelar` — sem acesso a `servicos`/`profissionais`/`equipe`/`comissoes`. "Futuramente a própria comissão, nunca a de outros" — hoje `/painel/comissoes` exige `comissoes.visualizar`, que profissional não tem; quando for construída a tela própria do profissional (fora de escopo destes 3 lotes, mencionado só como visão futura), precisará de uma nova permissão `comissoes.visualizar_propria` filtrando por `profissionalId === usuario.profissionalId`, nunca reusando `comissoes.visualizar` (que hoje mostra todos).

### 2.7 Cliente público

Sem mudança de modelo — já é 100% sem conta, ações limitadas às regras públicas existentes (cancelar/remarcar dentro do prazo, bloqueado se tenant suspenso/cancelado).

---

## 3. Matriz de permissões

Convenção: **F** = proteção de frontend possível agora (guard/esconder/validar no cliente) · **B** = exige validação no backend antes de produção (nunca confiar só no frontend) · **F+B** = ambas, F já implementável, B obrigatório depois. 🔴 = ação de alto risco, deve pedir confirmação reforçada agora e reautenticação no backend futuro.

| Área | Ação | Master | Dono | Gerente | Recepcionista | Profissional | Cliente | Frontend | Backend |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|---|---|
| Estabelecimentos | Cadastrar/editar/consultar | ✅ | — | — | — | — | — | F | B |
| Estabelecimentos | Suspender/reativar 🔴 | ✅ | — | — | — | — | — | F | B |
| Estabelecimentos | Solicitar exclusão 🔴 | ✅ (executar) | ✅ (solicitar) | — | — | — | — | F | B |
| Planos | Visualizar todos | ✅ | próprio | próprio | — | — | — | F | B |
| Planos | Alterar plano do estabelecimento 🔴 | ✅ | — | — | — | — | — | F | B |
| Usuários Master | Criar/convidar 🔴 | owner | — | — | — | — | — | F | B |
| Usuários Master | Remover/rebaixar (nunca zerar owners) 🔴 | owner | — | — | — | — | — | F | B |
| Administradores do tenant | Convidar/remover | — | ✅ | — | — | — | — | F | B |
| Roles (tenant) | Atribuir papel | — | ✅ | — | — | — | — | F | B |
| Permissões (tenant) | Liberar/negar individual | — | ✅ | — | — | — | — | F | B |
| Permissões (tenant) | Conceder permissão superior à própria | — | ❌ (n/a, é dono) | ❌ bloqueado | ❌ | ❌ | — | F | B |
| Agenda | Visualizar | modo suporte | ✅ | ✅ | ✅ | própria | — | F | B |
| Agenda | Criar/editar/remarcar | modo suporte | ✅ | ✅ | ✅ | própria | público (regras próprias) | F | B |
| Agenda | Cancelar | modo suporte | ✅ | ✅ | ✅ | própria | público (regras próprias) | F | B |
| Bloqueios | Criar/remover | modo suporte | ✅ | ✅ | — | próprios | — | F | B |
| Clientes (consumidores) | Visualizar/gerenciar | modo suporte | ✅ | ✅ | ✅ | — | próprio (via link) | F | B |
| Profissionais | Visualizar | modo suporte | ✅ | ✅ | ✅ (consulta) | — | público (limitado) | F | B |
| Profissionais | Gerenciar (criar/editar/desativar) | modo suporte | ✅ | ✅ | — | — | — | F | B |
| Serviços | Visualizar | modo suporte | ✅ | ✅ | ✅ (consulta) | — | público | F | B |
| Serviços | Gerenciar | modo suporte | ✅ | ✅ | — | — | — | F | B |
| Comissões | Visualizar relatório | modo suporte | ✅ | ✅ | — | própria (futuro) | — | F | B |
| Comissões | Configurar regra 🔴 | modo suporte | ✅ | — | — | — | — | F | B |
| Personalização | Gerenciar | modo suporte | ✅ | — | — | — | — | F | B |
| Relatórios | Visualizar | modo suporte | ✅ | ✅ | — | — | — | F | B |
| Exportação de dados 🔴 | Exportar tudo | ✅ | ✅ | — | — | — | — | F | B |
| Dados jurídicos 🔴 | Editar (CNPJ/razão social) | ✅ | ✅ | — | — | — | — | F | B |
| Exclusão 🔴 | Excluir qualquer registro em massa | ✅ | ✅ (próprio tenant) | — | — | — | — | F | B |
| Auditoria | Consultar | ✅ | — (futuro: log do próprio tenant) | — | — | — | — | F | B (gravação confiável) |
| Modo de suporte 🔴 | Entrar/sair do contexto do tenant | ✅ | n/a | n/a | n/a | n/a | n/a | F | B (assinatura de auditoria) |

Ações 🔴 (alto risco — confirmação reforçada na UI agora, reautenticação/2FA no backend futuro): suspender/reativar estabelecimento, solicitar/executar exclusão de estabelecimento, alterar plano, criar/remover/rebaixar Master, configurar regra de comissão (dinheiro), editar dados jurídicos, exportar todos os dados, excluir em massa, entrar em modo de suporte.

---

## 4. Agendamento público — problemas e novo fluxo

### 4.1 Problemas confirmados (ver §1.9)

1. Sem resumo persistente — usuário some da vista do que já escolheu ao avançar de etapa.
2. Sem destaque para o primeiro horário disponível.
3. `Link` envolvendo `Botao` em telas de erro/CTA — HTML inválido, ruim para leitor de tela.
4. Sem foco automático/preso em modais (afeta o modal de cancelamento em `/[slug]/agendamento/[id]`).
5. Nenhuma seção de "informações antes da visita" (política de cancelamento já existe como texto condicional, mas não como bloco visual dedicado antes da confirmação).

### 4.2 Fluxo recomendado (já é essencialmente o fluxo atual — reforço, não reinvenção)

1. Serviço → 2. Profissional/"Qualquer" → 3. Data → 4. Horário → 5. Dados → 6. Resumo (hoje é a etapa "Confirmação", já existe) → 7. Confirmar → 8. Sucesso (hoje é `/[slug]/agendamento/[id]`, já existe).

Ajustes a planejar no Lote 4 (sem inventar dado que não existe — foto/depoimento/selo ficam de fora enquanto o modelo não tiver esses campos):
- Barra de resumo fixa (rodapé ou topo, conforme viewport) mostrando serviço + preço + duração + profissional escolhido, visível a partir da etapa 3 em diante.
- Badge "Primeiro horário disponível" no primeiro botão da grade de horários do dia mais próximo com vaga.
- Trocar todo `<Link><Botao>` por `<Botao>` com `onClick={() => router.push(...)}` ou `<Botao asChild>`-like (decisão de implementação no Lote 4) — elimina aninhamento inválido.
- Mensagem de conflito já existe ("Esse horário acabou de ser preenchido") — reforçar com re-fetch automático da grade em vez de só notificar (a reconfirmação já bloqueia a gravação; falta atualizar a UI da grade sem exigir novo clique).
- Seção "Antes da sua visita" na etapa de confirmação: política de cancelamento (já tem o dado, `estabelecimento.regras.prazoCancelamentoHoras`) + endereço + telefone (já existem em `identidadeVisual`) — sempre condicionada à existência do dado.
- Estado do tenant suspenso/cancelado e feature fora do plano **já tratados** (correção de integridade desta sessão) — só garantir que a mensagem também apareça de forma consistente na página de apresentação (`/[slug]`), não só no wizard.

---

## 5. Página pública — redesenho

Já é estruturalmente uma página de apresentação (não parece painel) — manter essa direção. Adicionar, só quando o dado existir: bloco "antes da visita" (política de cancelamento, o que levar/preparar — texto livre opcional novo em `RegrasAgendamento` ou `IdentidadeVisual`, a decidir no Lote 3), reforçar hierarquia visual entre "ver serviços" e "agendar agora" (CTA principal já existe, fixo no rodapé mobile — manter). Não adicionar avaliação, contagem de clientes, selos ou depoimentos — nenhum desses campos existe no modelo e não serão inventados.

---

## 6. Gestão do estabelecimento — problemas e novo dashboard

### 6.1 Problemas confirmados (ver §1.8)

Dashboard atual é só "hoje" (contagem + faturamento previsto + lista). Sem atalhos de ação, sem alertas de configuração pendente (ex.: nenhum serviço vinculado a nenhum profissional, nenhuma regra de comissão configurada), sem cancelamentos/faltas do período, sem comissão do período (feature nova ainda não integrada), sem diferenciação de conteúdo por papel além do guard de página inteira.

### 6.2 Dashboard recomendado (Lote 5)

- Resumo de hoje (mantém o que já existe).
- Próximos atendimentos (mantém).
- Cancelamentos/faltas do período (novo — já há dados em `Agendamento.status`, só falta agregação).
- Comissões do período — **só renderiza a seção inteira se `podeAcessar("comissoes.visualizar").permitido`** (nunca mostrar opção que o usuário não pode usar, conforme pedido explícito).
- Atalhos: novo agendamento, bloquear horário, cadastrar cliente, cadastrar serviço/profissional — cada atalho já checa a permissão correspondente antes de aparecer (mesmo padrão de `podeAcessar` já usado em `/painel/agenda`).
- "Configuração pendente": checklist simples e condicional — ex. "Nenhum profissional aceita agendamento online", "Nenhuma comissão configurada" (só para quem tem `comissoes.gerenciar`) — cada item só aparece se a condição for real, nunca lista fixa.
- Onboarding/checklist inicial: mostrado só quando o tenant tem poucos dias de vida e faltam passos básicos (ex.: nenhum serviço cadastrado ainda) — nunca permanente.

### 6.3 Menu, busca, estados vazios

Menu de `/painel` já é filtrado por permissão (`podeAcessar`) — reforçar mesmo padrão em `/master` (hoje não filtra, ver §1.7). Busca simples e filtros persistentes: fora do escopo imediato dos 3 lotes de UX (marcar como melhoria futura, não bloqueante). Estados vazios já existem em várias telas (`EstadoVazio`) — padronizar texto/CTA nos que ainda não orientam próximo passo (ex.: dashboard sem nenhum agendamento hoje).

---

## 7. Acessibilidade e componentes — inventário para correção futura

| Item | Onde | O que falta |
|---|---|---|
| `Link` envolvendo `button` | `modelo-classico.tsx`, `modelo-moderno.tsx` (a confirmar), `[slug]/agendar/page.tsx`, `[slug]/agendamento/[id]/page.tsx` | Trocar aninhamento por `onClick`+`router.push` ou reestruturar `Botao` para aceitar `asChild`. |
| Foco preso/restaurado em modal | `src/components/ui/modal.tsx` | Auto-foco no primeiro elemento focável ao abrir; `Tab`/`Shift+Tab` não escapam do modal; foco volta ao elemento que abriu ao fechar. |
| Fechar com `Escape` | `modal.tsx` (✅ já tem) · `admin-shell.tsx` drawer mobile (❌ falta) | Adicionar listener de `Escape` no drawer mobile. |
| Título/descrição acessíveis | `modal.tsx` (✅ `aria-labelledby`) | Ok, sem ação. |
| Navegação por teclado | Grade de horários/dias (✅ são `<button>`, focáveis nativamente) | Sem problema estrutural; validar ordem de tab visualmente no Lote 6. |
| Estados de foco visíveis | Global (Tailwind padrão) | Auditar se `focus-visible` está estilizado em todos os componentes interativos (`Botao`, `<select>`, `<input>`) — não confirmado nesta auditoria, checar no Lote 6. |
| Mensagens associadas aos campos | `etapa-dados-cliente.tsx` (✅ já tem `aria-describedby`) | Padrão bom — replicar nos formulários de `/painel` que ainda não têm (`modal-servico.tsx`, `modal-profissional.tsx` — não usam `aria-invalid`/`aria-describedby` hoje). |
| Contraste | Não auditado nesta rodada (exige ferramenta visual) | Marcar para checagem com Lighthouse/axe no Lote 6, sem instalar dependência de produção — pode ser devDependency de teste manual. |
| Botão desabilitado com motivo | `Botao` (`disabled` nativo, sem `title`/texto) | Adicionar `title`/texto auxiliar quando desabilitado por regra de negócio (ex. "Configure percentual ou valor" no botão salvar comissão). |
| Confirmação de ação destrutiva | `window.confirm` nativo em vários lugares (`remover servico`, `remover regra comissão`, `remover admin`) | Funciona, mas é inconsistente visualmente com o resto do design system — padronizar num modal de confirmação próprio no Lote 6, mantendo a mesma barreira lógica. |
| Prevenção de duplo envio | `[slug]/agendar/page.tsx` (✅ `disabled={enviando}`) · outros formulários de criação (`modal-novo-agendamento.tsx`, `modal-servico.tsx`, `modal-profissional.tsx`, `painel/comissoes/page.tsx`) não têm estado de "salvando" | Padronizar `disabled` durante a chamada ao repository nesses 4 pontos. |

Nenhuma biblioteca nova instalada nesta etapa — tudo acima é reorganização de componentes já existentes (`Modal`, `Botao`, `AdminShell`) mais estado local novo (foco, `salvando`).

---

## 8. Divisão em lotes

### Lote 1 — Modelo administrativo e matriz de permissões
**Objetivo:** dois `MASTER_OWNER` semeados, regra "nunca zero owners", `Permission`/`PermissaoPlataforma` novas (`comissoes.visualizar_propria` fica para depois, fora de escopo — ver §2.6), correção das duas mutações desprotegidas em `/master/administradores`, testes de regressão para "usuário comum não vira Master" e "dono não cria Master".
**Arquivos prováveis:** `src/lib/seed-data.ts`, `src/lib/types.ts`, `src/lib/access/access-control.ts` + `.test.ts`, `src/app/master/administradores/page.tsx`.
**Riscos:** mexer em `identificarProprietarioPrincipal` pode afetar telas que já a usam — checar todos os call-sites antes.
**Testes:** função pura `podeRemoverOuRebaixarMaster`, regressão de escopo (estabelecimento nunca cria plataforma), guarda de `alternarStatus`/`alterarPapel`.
**Critérios de aceitação:** dois owners semeados; remover/rebaixar o penúltimo owner é bloqueado só quando zeraria; `alterarPapel`/`alternarStatus` recusam sem `podeGerenciar`.
**Dependências:** nenhuma — pode começar imediatamente.
**Pode ser feito agora:** sim, 100% frontend/protótipo.

### Lote 2 — Estrutura visual do Master e modo de suporte demonstrativo
**Objetivo:** `contextoSuporte` na sessão, banner "Modo de suporte", entrar/sair a partir de `/master/estabelecimentos/[id]`, dois `AcaoAuditoria` novos gravados via `auditoriaRepository`.
**Arquivos prováveis:** `src/lib/types.ts` (`SessaoUsuario`, `AcaoAuditoria`), `src/lib/auth/auth-context.tsx`, `src/app/master/estabelecimentos/[id]/page.tsx`, `src/components/layout/admin-shell.tsx` (banner), novo componente `src/components/layout/banner-modo-suporte.tsx`.
**Riscos:** vazar `contextoSuporte` para fora da sessão de plataforma (garantir que só existe quando `escopo === "plataforma"`); esquecer de limpar ao trocar de conta.
**Testes:** entrar/sair grava auditoria corretamente; sessão de estabelecimento nunca tem `contextoSuporte`; banner aparece em toda página de `/painel` durante o modo.
**Critérios de aceitação:** Master navega para `/painel` de qualquer tenant e volta sem perder a própria sessão.
**Dependências:** Lote 1 (dois owners já semeados ajuda a testar "Master A audita Master B").
**Pode ser feito agora:** sim — é estrutura/demo, não segurança real (auditoria confiável de verdade é backend, documentado em §1.15).

### Lote 3 — Redesenho da página pública
**Objetivo:** bloco "antes da visita" condicional, reforço de hierarquia CTA, sem inventar dado.
**Arquivos prováveis:** `src/components/publico/modelo-classico.tsx`, `modelo-moderno.tsx`, possível campo novo opcional em `RegrasAgendamento`/`IdentidadeVisual` (a decidir).
**Riscos:** campo novo em tipo existente precisa ser opcional/com default seguro para não quebrar dados antigos (mesmo cuidado já aplicado nas features anteriores).
**Testes:** renderização condicional (sem o dado, a seção não aparece) — pode ser testado via revisão estática, sem lib de componente.
**Critérios de aceitação:** página não fica mais lenta, nenhuma seção aparece vazia.
**Dependências:** nenhuma.
**Pode ser feito agora:** sim.

### Lote 4 — Redesenho do fluxo de agendamento
**Objetivo:** resumo persistente, destaque do primeiro horário, remoção de `Link>Botao`, atualização automática da grade em conflito.
**Arquivos prováveis:** `src/app/[slug]/agendar/page.tsx`, `src/components/agendamento/etapa-data-horario.tsx`, `src/components/agendamento/etapa-confirmacao.tsx`, `src/components/ui/button.tsx` (se decidido suporte a `asChild`).
**Riscos:** mudar a navegação de `Link` para `router.push` precisa preservar comportamento de "abrir em nova aba" (não existia, então sem risco real) e não quebrar testes de acessibilidade (`aria-label`) já existentes.
**Testes:** funções puras de "qual é o primeiro horário disponível" (já é o primeiro item do array ordenado — trivial, mas testável).
**Critérios de aceitação:** nenhum `<a><button>` aninhado restante nas 3 rotas públicas; resumo visível da etapa 3 em diante.
**Dependências:** nenhuma.
**Pode ser feito agora:** sim.

### Lote 5 — Dashboard e navegação do estabelecimento
**Objetivo:** dashboard com atalhos, alertas condicionais, comissão do período (com permissão), menu `/master` filtrado por permissão.
**Arquivos prováveis:** `src/app/painel/page.tsx`, `src/app/master/layout.tsx`.
**Riscos:** agregações novas (cancelamentos/faltas do período) precisam de cuidado de performance se a base de agendamentos crescer — hoje é `localStorage`, sem paginação; aceitável para o protótipo.
**Testes:** funções puras de agregação (contagem de cancelamento/falta por período) testáveis sem UI.
**Critérios de aceitação:** nenhuma seção do dashboard aparece para quem não tem a permissão associada.
**Dependências:** Lote 1 (matriz atualizada).
**Pode ser feito agora:** sim.

### Lote 6 — Acessibilidade e componentes compartilhados
**Objetivo:** corrigir os itens da tabela §7 — foco de modal, `Escape` no drawer, `aria-invalid` nos formulários de painel que faltam, botão desabilitado com motivo, `disabled` durante salvamento nos 4 formulários pendentes, modal de confirmação padronizado substituindo `window.confirm`.
**Arquivos prováveis:** `src/components/ui/modal.tsx`, `src/components/layout/admin-shell.tsx`, `src/components/painel/modal-servico.tsx`, `modal-profissional.tsx`, `modal-novo-agendamento.tsx`, `src/app/painel/comissoes/page.tsx`, novo `src/components/ui/modal-confirmacao.tsx`.
**Riscos:** foco preso mal implementado pode quebrar navegação por teclado pior do que hoje — testar manualmente com teclado antes de considerar concluído.
**Testes:** sem lib de teste de componente — validação manual documentada + testes puros onde aplicável (ex.: função que calcula o próximo elemento focável, se extraída).
**Critérios de aceitação:** checklist da tabela §7 zerado.
**Dependências:** nenhuma, mas faz sentido depois dos Lotes 2-5 (menos retrabalho de foco em componentes que ainda vão mudar).
**Pode ser feito agora:** sim.

### Lote 7 — Testes e validação visual
**Objetivo:** rodar `npm run test`/`lint`/`build` ao final de cada lote anterior (já é prática desta sessão), mais uma passada de revisão manual cruzando a matriz do §3 contra o comportamento real de cada papel (login como cada perfil e conferir menu/botões/funções).
**Arquivos prováveis:** nenhum arquivo de produto — só arquivos de teste dos lotes 1-6 que ainda não tiverem cobertura.
**Riscos:** nenhum.
**Testes:** consolidação — total esperado de testes cresce a cada lote, sem lib nova.
**Critérios de aceitação:** suíte completa passando, matriz do §3 validada manualmente para os 6 papéis.
**Dependências:** Lotes 1-6.
**Pode ser feito agora:** sim.

### Lote 8 — Autenticação real no NestJS
**Objetivo:** login real, hash de senha, sessão segura, provisionamento real dos dois Masters, auditoria confiável no servidor, isolamento multi-tenant no banco.
**Arquivos prováveis:** fora deste repositório frontend — depende da branch/repositório do backend NestJS (não auditado aqui, fora do escopo desta sessão, que não mexe em NestJS/Prisma/Neon).
**Riscos:** todo o modelo de permissão do frontend precisa ser espelhado (nunca só confiado) no backend — retrabalho se a matriz do §3 mudar depois que o backend já estiver pronto, por isso vale fechar §3 antes de começar o Lote 8.
**Testes:** fora do escopo deste repositório.
**Critérios de aceitação:** fora do escopo desta sessão.
**Dependências:** Lotes 1-7 (a matriz de permissões precisa estar estável antes de virar contrato de API).
**Pode ser feito agora:** **não** — depende de decisão e branch de backend que não existe neste repositório ainda.

---

## 9. Perguntas para o dono do produto

1. Os dois sócios devem ter exatamente o mesmo nível (`MASTER_OWNER` para ambos), ou um deve ser owner "principal" com o outro em nível ligeiramente inferior (`MASTER_ADMIN` com `permissoesExtras` amplas)?
2. No modo de suporte, o Master deve ter acesso irrestrito ao tenant (como assumido neste plano) ou deve respeitar algum limite mesmo em suporte (ex.: nunca ver dados jurídicos do tenant sem uma segunda confirmação)?
3. Exportação de dados (`dados.exportar`) — formato esperado (CSV, JSON, PDF) e escopo (tudo do tenant, ou por área)? Isso muda o tamanho do Lote 6/futuro.
4. "Solicitar exclusão do estabelecimento" pelo dono — deve gerar um pedido que o Master aprova depois (fluxo de duas etapas), ou o dono pode excluir diretamente com confirmação reforçada?
5. Bloco "antes da visita" na página pública (Lote 3) — quais informações além de política de cancelamento/endereço/telefone o dono consideraria essenciais, dado que não existem campos de depoimento/selo/avaliação no modelo hoje?
