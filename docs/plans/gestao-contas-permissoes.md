# Plano — Gestão de contas, permissões e ciclo SaaS multiestabelecimento

## Situação encontrada (linha de base)

22 testes passando, lint e build limpos. O núcleo (`types.ts`, `repositories/`,
`availability/engine.ts`, `tenant-context.tsx`, `verticals/terminologia.ts`) já
suporta multi-tenant com isolamento por `tenantId`, mas o modelo de sessão é
simplista: `UsuarioSimulado` mistura "administrador master" e "usuário de
estabelecimento" num único papel plano (`master | dono | profissional | cliente`),
sem `Membership`, sem permissões granulares, sem convites, sem auditoria e sem
planos com features reais (havia só um mapa fixo de booleanos por tenant).

## Ambiguidade de "cliente" — decisão

O tipo `Cliente` (a pessoa que agenda um horário) e a palavra genérica "cliente"
já usada em comentários coexistiam sem problema **até agora** — mas esta etapa
introduz `UsuarioEstabelecimento` (a equipe que trabalha no tenant), tornando a
palavra "cliente" ambígua entre "quem agenda" e "quem trabalha ali". Renomeio
`Cliente` → `Consumidor` (tipo, repositório, campos `clienteId/clienteNome/clienteWhatsapp`
em `Agendamento` → `consumidorId/consumidorNome/consumidorWhatsapp`, rota
`/painel/clientes` → `/painel/consumidores`) para alinhar com a taxonomia pedida.
A **terminologia exibida** (`Terminologia.cliente` → `Terminologia.consumidor`)
continua trocável por tenant ("Cliente", "Paciente", "Tutor"...) — é só o nome
interno do conceito que deixa de ser ambíguo.

Não renomeei mais nada mecanicamente: `Profissional`, `Servico`, `Agendamento`,
`Estabelecimento` já eram conceitos únicos e continuam com os mesmos nomes.

## Arquitetura escolhida

### Modelo de contas (novos tipos em `types.ts`)

- `UsuarioPlataforma` — administrador do SaaS. `papel: PapelPlataforma` (
  `MASTER_OWNER | MASTER_ADMIN | MASTER_SUPPORT`).
- `UsuarioEstabelecimento` — pessoa da equipe de um tenant (dono, gerente,
  recepcionista, profissional). Não carrega papel nem tenant diretamente — isso
  vive no `Membership`, porque a mesma pessoa poderia (arquiteturalmente) ter
  vínculos com mais de um estabelecimento no futuro.
- `Membership` — vínculo `usuarioId + tenantId + papel: PapelEstabelecimento`,
  com `permissoesLiberadas`/`permissoesNegadas` para ajustes individuais e
  `profissionalId` quando o papel é `profissional`.
- `Convite` — ciclo pendente → aceito/expirado/revogado, para convite de dono,
  equipe ou administrador master. Sem e-mail real: "aceitar" é uma ação
  simulada disponível na tela (claramente marcada como tal).
- `RegistroAuditoria` — log somente-leitura de ações sensíveis.

### Planos e features (`Feature`, `DefinicaoPlano`)

Troquei o mapa fixo `FuncionalidadesHabilitadas` (booleano solto por tenant) por
um modelo de **plano + exceções**, que é o que o cálculo de acesso pedido
realmente precisa:

- `DefinicaoPlano.features: Feature[]` — o que o plano (`essencial | equipe | pro`)
  inclui por padrão, mais `maxProfissionais`/`maxUnidades`.
- `Estabelecimento.featuresDesativadas: Feature[]` — exceções do master
  **removendo** uma feature que o plano incluiria (não existe exceção de
  adicionar uma feature fora do plano nesta fase — ver limitações).
- `Estabelecimento.limites: { maxProfissionais, maxUnidades }` — herda do plano
  na criação, mas o master pode ajustar por tenant.

`listaDeEspera`, `comissoes`, `pagamentos`, `assinaturas`, `dominioProprio`
aparecem no plano Pro como "incluído no plano" mas a interface mostra
explicitamente **"Em breve"** — o toggle existe, a funcionalidade não.

### Cálculo de acesso efetivo — função única e testada

`src/lib/access/access-control.ts` exporta `calcularAcessoEfetivo(entrada)`,
usada por **todo** lugar que decide mostrar/ocultar/bloquear algo no portal do
estabelecimento. Ordem de avaliação (para bater com o pedido):

1. `tenantStatus === "ativo"` (senão nega: tenant suspenso).
2. `usuarioStatus === "ativo"` (senão nega: usuário suspenso/convite pendente).
3. Feature associada à permissão (se houver) está no plano — `PERMISSAO_PARA_FEATURE`.
4. Feature não está em `featuresDesativadas`.
5. Permissão está no conjunto efetivo do papel (`PERMISSOES_PADRAO_POR_PAPEL[papel] ∪ permissoesLiberadas`).
6. Permissão **não** está em `permissoesNegadas` (isso sempre vence, mesmo que os passos 3–5 permitam).

Retorna `{ permitido: boolean; motivo?: string }` — o motivo alimenta a página
403. Testado isoladamente em `access-control.test.ts` (função pura, sem
localStorage, sem React).

Acesso de nível **plataforma** (master) usa uma checagem separada e mais simples
(`podeAdministrarPlataforma`, em vez de reaproveitar `calcularAcessoEfetivo`):
não existe "plano" nem "tenant" no contexto de um administrador master, então
misturar os dois domínios numa função só a tornaria confusa. `MASTER_OWNER` tem
tudo; `MASTER_ADMIN` tem uma lista configurável de permissões de plataforma
(`PermissaoPlataforma`); `MASTER_SUPPORT` só acessa suporte/leitura por padrão.

### Sessão simulada

`UsuarioSimulado` foi trocado por `SessaoUsuario`, um único formato que cobre os
dois mundos:

```ts
interface SessaoUsuario {
  id: string; nome: string; email: string;
  escopo: "plataforma" | "estabelecimento";
  papel: PapelPlataforma | PapelEstabelecimento;
  tenantId?: string;       // só quando escopo === "estabelecimento"
  membershipId?: string;
  profissionalId?: string; // só quando papel === "profissional"
}
```

`RequireRole` continua existindo (checagem de papel, usada nos layouts para a
divisória grossa entre as 3 áreas), e ganha uma irmã `RequirePermission`
(checagem fina de permissão, usada dentro de cada página do portal do
estabelecimento) que usa `calcularAcessoEfetivo` e renderiza uma página 403
amigável em vez de apenas redirecionar — bloqueio por rota direta, não só
ocultação de menu.

### Três áreas, três guardas

- **Site público** (`/[slug]`, `/agendar`, `/agendamento/[id]`): sem guarda de
  sessão; resolve o tenant **só** pelo slug (`estabelecimentoRepository.obterPorSlug`),
  nunca por um `tenantId` vindo de formulário/URL.
- **Portal do estabelecimento** (`/painel/**`, `/profissional/**`): `RequireRole`
  com os papéis de estabelecimento + `TenantProvider` (tenant vem da sessão) +
  `RequirePermission` por página.
- **Master** (`/master/**`): `RequireRole` com os papéis de plataforma; nunca
  aceita um usuário de estabelecimento, mesmo que ele adivinhe a URL.

## Rotas novas ou alteradas

| Rota | O que muda |
| --- | --- |
| `/login` | Reconstruída: e-mail/senha/lembrar/esqueci senha + bloco "Acessos para demonstração" que preenche o formulário em vez de logar direto. |
| `/painel/clientes` | Renomeada para `/painel/consumidores`. |
| `/painel/equipe`, `/painel/equipe/novo` | Novas — gestão de `UsuarioEstabelecimento`/`Membership` do tenant atual. |
| `/painel/personalizacao` | Nova — identidade visual + modelo de página, com campos avançados bloqueados por feature. |
| `/master/administradores` | Nova — CRUD de `UsuarioPlataforma` + convites. |
| `/master/estabelecimentos/novo` | Nova — assistente de 5 etapas que cria tenant + unidade + membership do dono + convite. |
| `/master/estabelecimentos/[id]` | Nova — detalhe/edição: plano, features, limites, suspensão/reativação, auditoria do tenant. |
| `/403` | Nova — página amigável para acesso negado por permissão. |

## Estratégia de migração dos dados simulados

Mudança de forma incompatível de novo (`Estabelecimento.plano`/`status`,
`Servico`/`Agendamento` com campos `consumidor*`, novas coleções). Sigo a mesma
estratégia da etapa anterior: sobe o namespace do `localStorage` de
`agenda-barber:v2:` para `agenda-barber:v3:` — dados antigos ficam órfãos e
inofensivos, tudo resemeia limpo. Nenhuma migração campo-a-campo (dado 100%
descartável, sem usuário real em risco).

## Novos tenants de demonstração

Além de Dom Navalha e Clínica Sorriso Leve (mantidos), dois novos, cada um com
identidade, slug, profissionais, serviços, consumidores e agenda próprios:

- **Barbearia JR** (`/barbearia-jr`) — plano Equipe, modelo de página Moderno.
- **Barbeiro Bastião** (`/barbeiro-bastiao`) — plano Essencial (mostra limites
  de plano na prática: sem consumidores/relatórios/equipe), modelo Clássico.

Um consumidor com o mesmo telefone pode existir nos quatro tenants como quatro
registros `Consumidor` isolados (IDs prefixados por tenant, como já era feito).

## Modelos de página pública

`src/components/publico/modelo-classico.tsx` e `modelo-moderno.tsx` — mesma
fonte de dados (`estabelecimento`, `servicos`, `profissionais`), apresentação
diferente. `/[slug]/page.tsx` escolhe pelo campo `identidadeVisual.modelo`. Dom
Navalha e Clínica Sorriso Leve ficam no Clássico (preserva a aparência atual);
Barbearia JR e Clínica usam para provar reuso.

## Testes adicionados

Mantendo os 22 testes atuais (todos continuam passando), foram adicionados **28
novos testes** — total final de 50 — em três arquivos: `src/lib/access/access-control.test.ts`
(função pura de cálculo de acesso), extensões em `tenant-isolation.test.ts` e o
novo `tenant-lifecycle.test.ts` (criação de tenant, convites, features). Cobrem:

1. Plano sem a feature bloqueia mesmo com permissão de papel.
2. Master desativando a feature bloqueia mesmo com plano incluindo.
3. Negação individual explícita vence permissão liberada pelo papel/plano.
4. Usuário suspenso é bloqueado independentemente de papel/plano.
5. Tenant suspenso bloqueia qualquer permissão do portal.
6. `permissoesLiberadas` concede algo fora do padrão do papel.
7. Dono tem acesso total ao que o plano permite; recepcionista não acessa relatórios.
8. Slug duplicado é rejeitado na criação de tenant.
9. Criar tenant cria unidade principal + membership do dono + convite pendente.
10. Consumidor da Barbearia JR não aparece no Barbeiro Bastião (nem em nenhum outro tenant).
11. Agendamento público sempre nasce com o `tenantId` resolvido pelo slug, nunca por valor externo.
12. `restaurarTenant` de um tenant não afeta os outros três.
13. Usuário de estabelecimento não pode ser criado com papel de plataforma.
14. Convite expirado não pode ser aceito.
15. Reenviar convite invalida o token anterior.
16. Desativar uma feature não apaga os dados associados (ex.: relatórios desativados não apagam agendamentos).
17. `MASTER_SUPPORT` sem permissão extra não administra estabelecimentos.
18. Apenas `MASTER_OWNER` pode remover outro administrador master.
19. O proprietário principal (`MASTER_OWNER` seed) não pode ser removido.
20. Página pública resolve o modelo (clássico/moderno) a partir do tenant.

## Limitações desta etapa (documentadas, não escondidas)

Continuam simulados e claramente sinalizados no código onde aparecem:
autenticação real, hash de senha, sessão segura/JWT, recuperação de senha por
e-mail, envio de e-mail de convite, banco de dados, pagamentos, domínio
próprio, WhatsApp real, assinaturas, comissões, prontuário, lista de espera.
Além disso, nesta fase especificamente:

- Exceção de feature é só "remover" (plano → desativado); não existe "adicionar
  uma feature fora do plano" para um tenant específico.
- Upload de foto/logo não existe (sem backend) — campos de imagem aceitam URL.
- "Ordem das seções" da personalização avançada é uma lista reordenável simples
  (mover para cima/baixo), não um construtor de página arrastar-e-soltar.
- Revogar sessão e "último acesso simulado" são valores/ações simulados, sem
  sessão real por trás.
- Auditoria é local (mesmo `localStorage`), não um log imutável de servidor.
