# MVP de Mensageria de Agendamento — Requisitos para o Piloto Real

**Contexto:** o Lote 6A criou o site comercial e o onboarding demonstrável do Agenda Cloud (`/onboarding`), anunciando lembrete, confirmação, cancelamento/remarcação por link, mensagem pós-atendimento, pesquisa de satisfação, convite de reagendamento e notificações ao estabelecimento como "em desenvolvimento para o piloto" (ver `src/lib/site/conteudo-comercial.ts`). Nenhuma dessas funcionalidades tem envio real implementado nesta etapa — este documento registra o que é obrigatório resolver antes de abrir um piloto real com clientes de verdade. Não é um plano de implementação passo a passo; é o registro de requisitos que qualquer implementação futura precisa atender.

**Fora de escopo aqui:** enviar qualquer mensagem de verdade, conectar um provedor externo (e-mail, SMS ou WhatsApp), ou desenhar a UI de configuração dessas mensagens. Isso fica para quando o piloto real for de fato implementado.

## Catálogo de planos e preços (Lote 6B.2)

- Códigos internos estáveis: `essencial`, `equipe`, `pro` (`CodigoPlano` em `src/lib/types.ts`, mesmos códigos no banco em `plans.code`).
- Nomes comerciais exibidos ao cliente: Essencial, Gestão e Rede — mapeiam 1:1 para `essencial`/`equipe`/`pro`, respectivamente. Um nome comercial pode divergir do código interno (ex.: código `equipe` aparece como "Gestão").
- Preço (`price_cents`/`precoCentavos`) ainda não foi aprovado comercialmente: é `NULL` ("não definido"), nunca `0`. O site comercial não mostra valor numérico — só "Preço em definição para o piloto" ou "Participe do piloto".
- Cobrança (processar pagamento, cobrar assinatura) permanece fora de escopo do MVP atual, junto com os itens já listados abaixo.

## Cadastro de estabelecimento (Lote 6B.3)

- **Implementado no backend:** `POST /auth/register` (`backend/src/auth/`) cria, numa transação TypeORM, o User (sem privilégios de plataforma), a Credential, o Tenant, a Unit principal, a Membership com papel `DONO` e a Session — com rollback total se qualquer etapa falhar. Colisão real de slug do tenant (`uq_tenants_slug`, corrida entre a checagem e o `INSERT`) nunca reaproveita a transação abortada pelo Postgres: abre uma `DataSource.transaction` inteiramente nova (até `MAX_SLUG_SAVE_RETRIES = 3`) e tenta de novo do zero com o próximo slug candidato. Colisão de e-mail e qualquer erro desconhecido nunca disparam retry.
- **Trial de 14 dias:** todo novo estabelecimento entra automaticamente no plano comercial **Gestão** (código interno `equipe`), com preço ainda `NULL` (não definido comercialmente — ver seção acima). O trial começa no instante da criação da conta e termina exatamente 14 dias depois, sempre calculado em UTC a partir de `Tenant.createdAt` (não há coluna dedicada de trial; início/fim são **derivados** dessa mesma coluna + duração fixa de 14 dias — nunca uma assinatura persistida). Só se aplica ao fluxo de criação de tenant (`POST /auth/register`); nenhum código trata tenant já existente retroativamente como se estivesse em trial.
- **Pendência explícita:** antes de cobrança real, criar modelo de assinatura com status, início, término, renovação, cancelamento e período pago — `Tenant.createdAt` + 14 dias fixos deixa de ser suficiente assim que existir renovação, upgrade/downgrade de plano ou cobrança de verdade.
- **Senha:** hash com Argon2id (nunca outro algoritmo), gerado só no servidor; texto puro nunca é persistido, logado ou aparece em mensagem de erro.
- **Sessão:** opaca (nunca JWT) — token aleatório de 32+ bytes via `node:crypto`, exposto ao cliente só pelo cookie `session_token` (HttpOnly, SameSite=Lax, Secure em produção, Path=/); o banco guarda somente o SHA-256 do token. O cookie só é emitido depois do COMMIT da transação.
- **Rate limit:** 5 tentativas de cadastro por IP a cada 15 minutos (`express-rate-limit`, `MemoryStore`). O `MemoryStore` só é aceitável para o MVP em instância única — hospedagem horizontal (múltiplas instâncias) vai exigir um store compartilhado (Redis ou equivalente) para o limite valer entre processos, o que ainda não existe.
- **Ainda não verificados:** telefone e e-mail são só armazenados/normalizados no cadastro — nenhuma verificação (código por SMS, confirmação por e-mail) existe nesta etapa.
- **Frontend:** ainda não conectado a este endpoint — o formulário de onboarding em `/onboarding` continua demonstrativo (ver Lote 6A), sem chamar `POST /auth/register` de verdade.

## Login, sessão e logout (Lotes 6B.4 e 6B.5)

- **Implementado no backend:** `POST /auth/login`, `GET /auth/me` e `POST /auth/logout` (`backend/src/auth/`), reaproveitando o mesmo mecanismo de sessão opaca do cadastro (token de 32+ bytes, SHA-256 no banco, cookie `session_token` HttpOnly/SameSite=Lax/Secure em produção). Nenhuma migration foi necessária — os três endpoints usam só colunas já existentes (`Session.tokenHash/expiresAt/revokedAt`, `Membership`, `Tenant`, `Unit`, `Plan`).
- **Login:** e-mail normalizado (lowercase/trim) e senha verificada com Argon2id; todo caminho de recusa de IDENTIDADE (e-mail inexistente, senha errada, credencial ausente, algoritmo desconhecido, usuário inativo) responde com o mesmo 401 genérico, sem revelar qual etapa falhou. Quando o e-mail não existe (ou a credencial/algoritmo não é utilizável), a verificação Argon2id ainda roda contra um hash fictício fixo (`DUMMY_PASSWORD_HASH`, gerado uma única vez, nunca por request) para não haver diferença de tempo óbvia entre "e-mail existe" e "e-mail não existe". Sucesso cria uma sessão nova (nunca reaproveita token do cliente — sem fixação) e emite o cookie só depois do COMMIT. Um tenant inativo (SUSPENDED/PAST_DUE/CANCELED) **não invalida a identidade** — o login continua funcionando, o tenant só fica fora da lista de `contexts` da resposta (ver correção multi-tenant abaixo).
- **GET /auth/me:** protegido por `SessionGuard`, que autentica só a IDENTIDADE (sessão válida + usuário ativo) — sem cookie, cookie malformado, token desconhecido, sessão expirada/revogada ou usuário inativo retornam 401 (formato inválido nunca chega a consultar o banco); o guard nunca toca Membership/Tenant/Unit/Plan/Credential. Depois do guard, o controller pede a `AuthService.getSessionContext(userId)` a lista de estabelecimentos utilizáveis — consulta própria, nunca duplicando o trabalho do guard.
- **POST /auth/logout:** idempotente — sempre 204, com ou sem cookie, token válido ou não. Sessão válida recebe `revokedAt`; cookie é sempre limpo (`buildClearSessionCookieOptions`, sem `maxAge` — `Max-Age` teria precedência sobre `Expires` no navegador e o cookie nunca seria limpo de verdade).
- **Rate limit do login:** limiter próprio (`login-rate-limit.ts`), 5 tentativas por IP a cada 15 minutos, instância separada do limiter de cadastro (esgotar um nunca afeta o outro). `GET /auth/me` e `POST /auth/logout` não têm rate limit neste lote.
- **Pendência explícita — auditoria de login/logout:** o enum `AuditAction` (tipo `audit_action` do Postgres) não tem valores para login/logout bem-sucedidos; adicionar exigiria `ALTER TYPE` (migration), fora do escopo permitido nesta tarefa. Login e logout **não geram `AuditLog`** por enquanto. Antes de qualquer exigência de trilha de auditoria de sessão: criar migration adicionando `LOGIN_SUCCEEDED`/`LOGOUT` (ou equivalentes) ao enum, depois implementar os `AuditLog` correspondentes. `Session.createdAt`/`expiresAt`/`revokedAt` continuam servindo de rastreabilidade mínima e provisória enquanto isso não existe.
- **Frontend:** ainda não conectado a nenhum destes três endpoints.

### Correção multi-tenant (Lote 6B.6)

Um usuário com múltiplos estabelecimentos (várias `Membership`) é um estado de negócio **válido**, nunca um erro — a versão anterior deste lote tratava isso incorretamente como `AmbiguousSessionContextError`/500. Corrigido separando dois contextos:

- **`IdentityContext`** (só o que `SessionGuard` prova): `userId` + `sessionId`. Nunca inclui tenant/membership — um usuário com 0, 1 ou N vínculos autentica exatamente da mesma forma.
- **`TenantContext`** (um vínculo utilizável — Membership + tenant TRIAL/ACTIVE): `membershipId`, `tenantId`, `tenantName` (derivado do nome da Unit principal, já que `Tenant` não tem coluna própria de nome — cai para `tenantSlug` se não houver unit principal), `tenantSlug`, `role`, `unit` principal, `planCode`, `planName`, `trial` calculado (ver abaixo) e `tenantStatus`. Tenant inativo nunca vira `TenantContext` — fica de fora da lista, silenciosamente.

`POST /auth/login` e `GET /auth/me` devolvem a mesma forma — `{ user, contexts, activeContext, requiresTenantSelection, hasEstablishmentAccess }`:

| `contexts.length` | `activeContext` | `requiresTenantSelection` | `hasEstablishmentAccess` |
|---|---|---|---|
| 0 | `null` | `false` | `false` |
| 1 | o único contexto | `false` | `true` |
| ≥2 | `null` (nunca o primeiro escolhido arbitrariamente) | `true` | `true` |

Zero contexts (usuário autenticado sem nenhum estabelecimento utilizável) **nunca é erro 500** — é uma resposta 200 normal com `hasEstablishmentAccess: false`. Só sessão ausente/inválida/expirada/revogada ou usuário inativo retornam 401 (decidido pelo guard, antes de qualquer contexto ser resolvido).

**Trial por contexto:** cada `TenantContext` calcula seu próprio `trial` do mesmo jeito do cadastro — `trialStartAt = Tenant.createdAt`, `trialEndAt = trialStartAt + 14 dias`, sempre UTC, sempre **derivado** (nunca persistido), centralizado em `trial-policy.ts` para toda substituição futura por assinatura real acontecer num único lugar.

**Pendência explícita — endpoint de seleção de contexto:** nenhum endpoint de seleção/troca de tenant ativo foi criado neste lote. Quando `requiresTenantSelection: true`, o cliente sabe que precisa perguntar ao usuário qual estabelecimento usar, mas ainda não há como comunicar essa escolha ao backend. Um futuro endpoint autenticado vai receber `membershipId` (nunca um `tenantId` solto) e validar que pertence ao usuário da sessão antes de qualquer coisa. Até lá — e mesmo depois —, **nenhuma rota de negócio pode aceitar um `tenantId` arbitrário vindo do cliente sem validar a Membership correspondente**; isso é responsabilidade de cada rota de negócio, nunca do `SessionGuard`.

## Requisitos obrigatórios antes do piloto

- **Lembrete configurável** — no mínimo dois horários de disparo por padrão: 24 horas e 2 horas antes do agendamento. O estabelecimento deve poder ajustar esses horários.
- **Confirmação, cancelamento e remarcação** — o cliente precisa conseguir confirmar presença, cancelar ou remarcar a partir da própria mensagem (link), sem precisar ligar ou mandar mensagem separada.
- **Cancelamento automático dos lembretes pendentes quando o agendamento mudar** — se o horário for remarcado ou cancelado, qualquer lembrete/mensagem futura já agendada para o horário antigo precisa ser cancelada. Nunca pode chegar um lembrete de um horário que não existe mais.
- **Mensagem pós-atendimento** — agradecimento, pesquisa rápida de satisfação e convite para um novo agendamento, disparados depois que o atendimento é marcado como concluído.
- **Modelos de mensagem configuráveis** — o texto de cada tipo de mensagem (lembrete, confirmação, pós-atendimento etc.) deve poder ser editado pelo estabelecimento, não fixo no código.
- **Consentimento e opção de não receber (opt-out)** — o cliente precisa poder optar por não receber esse tipo de mensagem, e essa escolha precisa ser respeitada em todos os disparos futuros.
- **Horário local do estabelecimento** — todo disparo respeita o fuso horário do estabelecimento (`Estabelecimento.fusoHorario`), nunca UTC bruto nem o fuso do servidor.
- **Histórico de entrega** — cada mensagem enviada (ou tentativa) fica registrada: tipo, destinatário, horário, canal e resultado (entregue, falhou, etc.).
- **Tentativas controladas, sem duplicidade** — reenvio automático em caso de falha, mas com limite de tentativas e proteção contra mandar a mesma mensagem duas vezes para o mesmo agendamento.
- **Provedores substituíveis** — a camada de envio deve ser desacoplada do provedor: trocar o provedor de e-mail, SMS ou WhatsApp não pode exigir reescrever a lógica de quando/o que enviar.

## Não fazer nesta etapa

- Não implementar envio real de nenhuma mensagem.
- Não conectar nenhum provedor externo (e-mail, SMS, WhatsApp) nem guardar credencial de provedor.
- Não prometer, na comunicação com usuários, que qualquer um destes itens já funciona.
