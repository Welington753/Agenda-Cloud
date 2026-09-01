# Plano — Refatoração multinicho (preparar o núcleo para além de barbearias)

## Situação encontrada

O protótipo já nasceu com boa separação em camadas (`types.ts` → `seed-data.ts` →
`repositories/` → `availability/engine.ts` → componentes), com `tenantId` em toda
entidade e rotas dinâmicas por slug (`/[slug]`, `/[slug]/agendar`,
`/[slug]/agendamento/[id]`) já lendo o estabelecimento via
`estabelecimentoRepository.obterPorSlug` — ou seja, **as rotas públicas já não estão
presas a `/dom-navalha`** e já mostram um estado "não encontrado" para slugs
inexistentes sem misturar dados de outro tenant. O motor de disponibilidade
(`engine.ts`) também já é 100% agnóstico de nicho (nenhuma ocorrência de
`barbearia`/`corte`/`barba` nele).

O que falta é: (1) modelar explicitamente **categoria/vertical**, **terminologia**,
**identidade visual** e **políticas de agendamento** como configuração de primeira
classe; (2) remover os poucos acoplamentos reais que restaram; (3) provar a
arquitetura com um segundo tenant de nicho diferente; (4) tornar a restauração de
dados segura por tenant.

## Varredura de acoplamento (`barbearia`, `barbeiro`, `navalha`, `corte`, `Dom Navalha`, `dom-navalha`)

| Ocorrência | Classificação | Ação |
| --- | --- | --- |
| `seed-data.ts` — nomes de serviços ("Corte tradicional", "Barba"...), nomes de profissionais, tenant `dom-navalha` | **Conteúdo legítimo da demonstração** | Mantido — é exatamente o dado da Barbearia Dom Navalha. |
| `src/app/page.tsx` (landing) — "Feito para barbearias pequenas", link "Ver página da barbearia demonstrativa" | **Conteúdo legítimo** (posicionamento comercial pedido explicitamente) | Mantido — a home deve continuar vendendo para barbearias. |
| `src/lib/config.ts` — `NOME_PRODUTO`/`SLOGAN_PRODUTO` | **Conteúdo legítimo** (identidade do produto, não do tenant) | Mantido. |
| `src/app/login/page.tsx` — perfis de demonstração com `tenant-dom-navalha` | **Conteúdo legítimo da demonstração** | Mantido, e ampliado com um perfil "Dono da Clínica Sorriso Leve" para provar que o painel não depende de um tenant fixo. |
| `src/app/[slug]/page.tsx:46`, `src/app/[slug]/agendar/page.tsx:130/223`, `src/app/[slug]/agendamento/[id]/page.tsx:89/172/213`, `src/app/painel/page.tsx:88`, `src/app/painel/configuracoes/page.tsx:128`, `src/app/painel/clientes/page.tsx:40` | **Acoplamento indevido em componente compartilhado** — a palavra "barbearia" está escrita direto em telas que agora atendem qualquer tenant | Trocado por texto genérico (usa `terminologia.estabelecimento` quando fizer sentido, ou "estabelecimento"/"negócio" quando é rótulo neutro de UI). |
| `src/lib/permissions.ts:10` — `ROTA_INICIAL_POR_PAPEL.cliente: "/dom-navalha"` | **Acoplamento indevido no domínio compartilhado** (e código morto — nada importa essa constante) | Removida a entrada `cliente` (não existe rota inicial genérica para esse papel sem um tenant) e documentado o motivo. |

Nenhuma ocorrência foi encontrada dentro de `engine.ts`, `engine.test.ts`,
`repositories/`, `consulta.ts` ou dos componentes de UI genéricos (`components/ui/*`)
— o núcleo já estava limpo.

## Arquitetura escolhida

1. **Categoria/vertical** (`CategoriaNegocio`) — campo em `Estabelecimento`, sem
   nenhum `if (categoria === "barbearia")` fora da configuração de terminologia.
2. **Terminologia centralizada** (`src/lib/verticals/terminologia.ts`) — um mapa
   `CategoriaNegocio → Terminologia` (singular/plural/gênero de estabelecimento,
   profissional, cliente, serviço, agendamento). Componentes compartilhados recebem a
   terminologia via `useTenant()` (painel/profissional) ou a calculam a partir do
   `estabelecimento` já carregado (páginas públicas), nunca a hardcodam.
3. **Identidade visual** (`IdentidadeVisual`) — nome, nome curto, iniciais do
   logo, cor principal/secundária/destaque, estilo, endereço, telefone, redes
   sociais, texto de apresentação. Passa a viver em `Estabelecimento.identidadeVisual`
   em vez de campos soltos (`nome`, `corDestaque`, `endereco`... na raiz).
4. **Contexto de tenant** (`src/lib/tenant/tenant-context.tsx`) — `TenantProvider`
   usado pelos layouts `/painel` e `/profissional` (que já vivem atrás de
   `RequireRole`): lê o `tenantId` da sessão simulada (nunca da URL/formulário),
   carrega o `Estabelecimento` uma vez e expõe `{ estabelecimento, terminologia,
   carregando, recarregar }` via `useTenant()`. O `AdminShell` continua sem saber
   nada de nicho — recebe os rótulos já resolvidos por prop.
5. **Políticas de agendamento** (`RegrasAgendamento`, o "BookingPolicy" pedido) —
   mantém o nome de campo `regras` (convenção já usada no resto do código em
   português) mas passa a ser um tipo nomeado e ganha: `confirmacaoAutomatica`,
   `permitirQualquerProfissional`, `permitirRemarcacaoCliente`,
   `exigirTelefoneCliente`, `exigirEmailCliente`, `exibirPrecoPublico`,
   `intervaloPadraoMinutos`. Todas realmente conectadas ao fluxo de agendamento
   (não são apenas campos decorativos) — ver seção de testes.
6. **Funcionalidades habilitadas por tenant** (`FuncionalidadesHabilitadas`) —
   objeto de flags booleanas. Nesta fase só `agendamentoPublico` é de fato lida (a
   página pública só mostra "Agendar horário" se estiver habilitada); as demais
   existem no modelo/seed para não travar evolução futura, mas não têm UI ainda.
7. **Recurso e Unidade** — modelos novos (`Recurso`, `Unidade`) com repositórios
   somente-leitura e dados simulados, sem UI e sem entrar no motor de
   disponibilidade. Documentado explicitamente como funcionalidade futura
   (bloqueio simultâneo de recursos).
8. **Preço opcional por serviço** — `Servico.precoCentavos` passa a ser opcional e
   ganha `precoVisivel`. Um serviço sem preço ou com `precoVisivel: false` aparece
   como "Sob consulta" nas telas públicas; o painel do dono continua vendo o valor
   real (quando existe) para fins internos.
9. **Segundo tenant de demonstração** — Clínica Sorriso Leve
   (`clinica-sorriso-leve`), categoria `clinica_odontologica`, reaproveitando 100%
   dos componentes de `/[slug]`, `/[slug]/agendar` e `/[slug]/agendamento/[id]`.

## Arquivos que serão modificados/criados

**Novos:**
- `src/lib/verticals/terminologia.ts` — tipos + mapa de terminologia por categoria.
- `src/lib/tenant/tenant-context.tsx` — `TenantProvider`/`useTenant`.
- `src/lib/repositories/restaurar.ts` — `restaurarTenant(tenantId)` e
  `restaurarPlataformaCompleta()`.
- `docs/plans/refatoracao-multinicho.md` (este arquivo).

**Modificados (domínio e dados):**
- `src/lib/types.ts` — `CategoriaNegocio`, `IdentidadeVisual`,
  `FuncionalidadesHabilitadas`, `RegrasAgendamento`, `Unidade`, `Recurso`,
  `Servico.precoCentavos?`/`precoVisivel`/`modalidade`/`ativo`/
  `exigeConfirmacaoManual`, `Cliente.email?`, `Agendamento.precoCentavos?`/`clienteEmail?`.
- `src/lib/seed-data.ts` — gera identidade visual/categoria/regras/funcionalidades
  para os 3 estabelecimentos existentes e adiciona a Clínica Sorriso Leve completa
  (profissionais, procedimentos, agendamentos, unidade, recursos).
- `src/lib/repositories/index.ts` — nenhuma mudança de assinatura; passa a expor
  `unidadeRepository`/`recursoRepository` somente-leitura.
- `src/lib/storage/local-storage.ts` — namespace de schema sobe de `v1` para `v2`
  (ver "Migração" abaixo).
- `src/lib/permissions.ts` — remove a rota inicial hardcoded para `cliente`.
- `src/lib/format.ts` — `formatarPrecoPublico(servico, exibirPrecoPublico)`.

**Modificados (UI compartilhada, para receber terminologia/identidade em vez de
hardcode):**
- `src/components/layout/admin-shell.tsx` — sem mudança de conteúdo textual (já
  recebe `itens`/`subtitulo` via prop); só passa a ser alimentado por dados vindos
  do `TenantProvider` nos layouts.
- `src/app/painel/layout.tsx`, `src/app/profissional/layout.tsx` — passam a envolver
  os filhos com `TenantProvider` e montam os rótulos do menu com a terminologia.
- `src/app/painel/page.tsx`, `agenda/page.tsx`, `profissionais/page.tsx`,
  `servicos/page.tsx`, `clientes/page.tsx`, `configuracoes/page.tsx`,
  `src/app/profissional/agenda/page.tsx` — trocam textos fixos ("Profissionais",
  "Clientes", "sua barbearia"...) pela terminologia do tenant atual; `configuracoes`
  ganha o seletor de categoria e o botão de restaurar **apenas o tenant atual**.
- `src/components/painel/modal-agendamento.tsx`,
  `modal-novo-agendamento.tsx`, `modal-servico.tsx` — rótulos via terminologia,
  preço opcional, `intervaloPadraoMinutos` como valor inicial.
- `src/app/[slug]/page.tsx`, `agendar/page.tsx`, `agendamento/[id]/page.tsx` e os
  componentes `components/agendamento/*` — usam `estabelecimento.identidadeVisual`,
  terminologia calculada a partir de `estabelecimento.categoria`, preço público
  opcional e as novas políticas (`permitirQualquerProfissional`,
  `permitirRemarcacaoCliente`, `confirmacaoAutomatica`, `exigirTelefoneCliente`).
- `src/components/master/modal-suporte.tsx`, `src/app/master/page.tsx`,
  `src/app/master/estabelecimentos/page.tsx` — leem `identidadeVisual` em vez de
  campos soltos; `master` ganha o botão "Restaurar toda a demonstração".

## Estratégia de migração dos dados simulados

Os dados vivem só no `localStorage` do navegador (sem servidor), então não existe
"dado real" em risco — mas o formato de `Estabelecimento`/`Servico` mudou de forma
incompatível (campos soltos → `identidadeVisual`; `precoCentavos` obrigatório →
opcional). Em vez de escrever um migrador campo-a-campo (custo alto para um dado
100% descartável), a chave de armazenamento sobe de `agenda-barber:v1:` para
`agenda-barber:v2:`. Um navegador com dados da versão anterior simplesmente para de
enxergar as chaves antigas (que ficam órfãs e inofensivas) e todo o app é
resemeado do zero na nova forma — sem exceções não tratadas, sem estado inválido.

## Testes que serão adicionados

Mantendo os 8 testes atuais do motor de disponibilidade intactos, foram
adicionados 14 novos testes em três arquivos (`src/lib/repositories/tenant-isolation.test.ts`,
`src/lib/verticals/terminologia.test.ts` e `src/lib/format.test.ts`), rodando em
Node via Vitest com um mock simples de `localStorage`):

1. Resolver estabelecimento pelo slug (`dom-navalha` e `clinica-sorriso-leve`).
2. Retornar "não encontrado" para slug inexistente sem cair para a Dom Navalha.
3. Um tenant não enxerga agendamentos de outro (`agendamentoRepository.listarPorTenant`).
4. Um tenant não enxerga clientes de outro (`clienteRepository.listarPorTenant`).
5. Terminologia de `barbearia` resolve profissional → "Barbeiro".
6. Terminologia de `clinica_odontologica` resolve profissional → "Dentista" e
   cliente → "Paciente".
7. Serviço com `precoCentavos` indefinido ou `precoVisivel: false` formata como
   "Sob consulta" via `formatarPrecoPublico`.
8. O motor de disponibilidade continua funcionando igual para os dois nichos
   (mesmos `calcularHorariosDisponiveis`, dados diferentes).
9. `restaurarTenant(tenantId)` restaura só os registros daquele tenant e preserva
   intactos os do outro tenant.
10. `encontrarProfissionalDisponivel` só considera profissionais do tenant recebido
    na lista de candidatos (a função já é pura e recebe a lista pronta — o teste
    prova que quem monta essa lista no app nunca mistura tenants).

## Limitações que permanecem para fases futuras

- **Recurso/Unidade**: modelados e com dados simulados, mas sem tela própria e sem
  entrar no motor de disponibilidade — bloqueio simultâneo de recursos (ex.: duas
  cadeiras ocupadas ao mesmo tempo) fica para uma fase futura.
- **Múltiplas unidades**: campo `unidadeId` opcional em `Profissional`, mas nenhuma
  tela filtra por unidade ainda; `funcionalidades.multiplasUnidades` fica `false`.
- **E-mail do cliente**: modelado em `Cliente` (campo opcional), mas o formulário
  de agendamento ainda não coleta e-mail — `exigirEmailCliente` existe na política
  porém não é aplicado na validação do formulário nesta fase.
- **Prontuário, diagnóstico, anamnese, convênio**: propositalmente fora de escopo
  (exigem análise separada de LGPD/segurança), apenas a flag `prontuario: false`
  existe no modelo de funcionalidades.
- **Pagamentos, assinaturas, comissões, lista de espera**: apenas flags previstas,
  sem qualquer lógica.
- **Categoria "outro"/genéricas** (salão, estética, tatuagem, pet shop) têm
  terminologia definida, mas nenhum tenant de demonstração foi criado para elas
  nesta etapa — só barbearia e clínica odontológica têm dados completos.
