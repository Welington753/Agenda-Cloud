# Equipe por estabelecimento, limite do plano e administração da plataforma

Base: integration em `fad3cc4` (inclui o PR #67, de mensagens). Este lote
reaproveita os mecanismos dos PRs #64 e #65: contas, convites, aceite com
link, permissões por vínculo, bloqueio, reautenticação e histórico.

Entrega em dois PRs encadeados:

1. **API e migration** (parte A): migration `TeamAccess1792886400000`,
   rotas da equipe, agenda do funcionário, ciclo de vida e plano do
   estabelecimento na plataforma, limite de profissionais.
2. **Telas** (parte B): administração da plataforma, "Equipe e acessos" e a
   área do funcionário, com os testes de navegador.

A parte A funciona com o web atual: as rotas novas só são chamadas pelo web
novo. A única mudança de comportamento visível com o web atual é o limite de
profissionais do plano (ver abaixo), que responde 409 com mensagem.

## Papéis: plataforma × estabelecimento

| Onde | Papel | O que faz |
| --- | --- | --- |
| Plataforma | `MASTER_OWNER` | tudo da administração, inclusive situação e plano dos estabelecimentos |
| Plataforma | `MASTER_ADMIN` + `ESTABLISHMENTS_MANAGE` | consulta; cria estabelecimentos; convida donos; edita dados cadastrais; contas sem papel de plataforma |
| Plataforma | `MASTER_SUPPORT` + `ESTABLISHMENTS_MANAGE` | só consulta |
| Estabelecimento | `DONO` | operação do estabelecimento e "Equipe e acessos" |
| Estabelecimento | `PROFISSIONAL` | funcionário: só a própria agenda, e as ações que o dono liberar |

Os dois níveis são independentes: um vínculo de estabelecimento nunca concede
nada na plataforma, e um papel de plataforma não dá acesso à operação de um
estabelecimento. Suspender, reativar, arquivar e trocar plano exigem a
capacidade nova `manageEstablishmentLifecycle`, que só o `MASTER_OWNER` tem.
`PLANS_MANAGE` continua sem efeito até uma decisão explícita de delegar.

## Vagas de acesso de funcionário

Limite: `plans.max_professionals` do plano do estabelecimento (o mesmo número
que limita os profissionais ativos).

- Cada acesso de funcionário fica ligado a **um** profissional daquele
  estabelecimento; cada profissional tem no máximo **um** acesso
  (`uq_memberships_professional_id`) **ou** um convite pendente
  (`uq_invites_pending_professional`). Neste lote, uma pessoa é ligada a um
  profissional por estabelecimento (`uq_memberships_user_tenant`).
- **Ocupam vaga:** acessos de funcionário ativos + convites de funcionário
  pendentes e dentro do prazo.
- **Não ocupam:** o acesso de DONO; acesso suspenso; convite revogado,
  vencido ou aceito (o aceito vira o acesso, que ocupa a mesma vaga).
- **Reenvio** não ocupa outra vaga (é o mesmo convite). Reenviar um convite
  vencido pelo prazo volta a ocupá-la, só se couber.
- **Reativar** um acesso suspenso confere a vaga de novo. Uma conta
  bloqueada pela plataforma não é reativada pelo dono.
- **Ligar um login a um profissional existente** não cria profissional nem
  conta duas vezes. Se o dono também atende, o cadastro de profissional dele
  conta no limite de profissionais, e o acesso de dono não conta como vaga de
  funcionário.

Exemplo: plano para três profissionais, três profissionais cadastrados → um
login de funcionário para cada um, além do acesso do dono.

**Concorrência:** convite, aceite, reativação de acesso, reenvio,
criação/reativação de profissional e troca de plano travam antes a linha do
estabelecimento (`FOR NO KEY UPDATE`). Duas operações pela última vaga ficam
em fila; a segunda já conta a primeira e recebe `LIMITE_DO_PLANO`. O `NO KEY`
não bloqueia as gravações comuns que só referenciam o estabelecimento.

**Limite de profissionais:** criar ou reativar um profissional agora respeita
`max_professionals` (`LIMITE_DE_PROFISSIONAIS`). Quem já tinha mais
profissionais ativos que o plano não perde nenhum; só não cria nem reativa até
caber.

## O que cada ação faz

| Ação | Quem | Efeito | Não faz |
| --- | --- | --- | --- |
| Bloquear conta | plataforma | conta `SUSPENDED`, todas as sessões encerradas, sem acesso a nenhum estabelecimento | não apaga a conta, vínculos nem histórico |
| Remover acesso (desvincular) | plataforma, ou o dono para funcionários | apaga só aquele vínculo e os ajustes dele | não apaga a conta, os outros vínculos, o profissional nem as reservas |
| Suspender acesso | dono (funcionários) | vínculo `SUSPENDED`: deixa de operar aquele estabelecimento já na próxima requisição; libera a vaga | não encerra sessões nem afeta outros estabelecimentos |
| Suspender estabelecimento | `MASTER_OWNER` | `SUSPENDED`: painel, agenda, agendamento público e avisos param; as contas continuam entrando nos outros estabelecimentos | não apaga nada |
| Arquivar estabelecimento | `MASTER_OWNER` | `ARCHIVED` (exclusão lógica): os mesmos efeitos, como encerramento; pede o endereço digitado | não apaga agenda, clientes, reservas, vínculos nem histórico; é reversível |
| Reativar estabelecimento | `MASTER_OWNER` | volta à situação anterior à restrição (TRIAL ou ACTIVE) | não inventa situação: sem registro, recusa |
| Desativar profissional | dono | sem reservas novas; acesso do funcionário ligado a ele para; a resposta diz quantas reservas futuras em aberto ficaram | não cancela nem move reservas |

Mudanças sensíveis (situação e plano do estabelecimento; suspender, reativar,
remover e mudar permissões de funcionário) exigem a senha confirmada há menos
de 10 minutos **na mesma sessão** (a reautenticação existente) e gravam o
histórico na mesma transação. Telas desatualizadas recebem 409
(`updated_at` do estabelecimento; liberações que a tela mostrava).

Proteções mantidas: último `MASTER_OWNER` ativo, ninguém age sobre a própria
conta pela administração, conta com papel de plataforma só por quem gerencia
a plataforma. O dono não convida a si mesmo, não altera outro dono nem a si
mesmo pela equipe e não concede papel de plataforma.

## Funcionário

- Vê a própria agenda: data, horário, cliente (nome), serviço e situação. Sem
  telefone, observações, preço, lista de clientes, agenda de colegas,
  configurações ou financeiro.
- O dono libera, uma a uma: iniciar, concluir e marcar falta nos próprios
  atendimentos (`ATENDIMENTO_PROPRIO_*`, `GRANTED`). Só concede o que ele
  mesmo pode fazer (`AGENDA_GERENCIAR` não negado). Confirmar, cancelar,
  remarcar e criar reservas continuam com o dono.
- As ações usam as mesmas regras de estado, horário e `expectedStartAt` da
  agenda do dono (`AppointmentsService.applyStatusChange`).
- O profissional vem do vínculo da sessão, nunca da URL ou do corpo. Reserva
  de colega ou de outro estabelecimento: 404. Rotas do dono: 403.
- Tudo é relido a cada requisição: permissão retirada, acesso suspenso ou
  removido, profissional desativado e estabelecimento fora de operação valem
  na requisição seguinte, mesmo com a sessão aberta.
- Avisos de novas solicitações continuam só para quem vê a agenda geral (o
  dono); o funcionário não passa a recebê-los.

## Convite de funcionário

Mesmo fluxo dos convites de #64: link de 24 horas, uso único, só o hash no
banco, reenvio troca o link, teto de 5 links. E-mail sem conta cria a conta
pendente; a pessoa define a própria senha no aceite. E-mail com conta: nada
da pessoa muda; ela aceita com a senha atual. O dono nunca vê nem escolhe a
senha. O formato do e-mail não é verificação: o endereço só é dado como
verificado quando a pessoa aceita pelo link.

No aceite, o servidor revalida com o estabelecimento travado: estabelecimento
em operação, profissional ativo e sem acesso, e vaga sem contar o próprio
convite.

## API (parte A)

Equipe (dono, `tenants/:tenantId/team`):

| Rota | Efeito |
| --- | --- |
| `GET /` | profissionais com a situação do acesso, convites pendentes, vagas, limite, o que o dono pode liberar |
| `POST /invites` | convida (`professionalId`, `name`, `email`, `requestKey`) |
| `POST /invites/:id/resend` · `/revoke` | reenvia · revoga |
| `POST /members/:id/suspend` · `/reactivate` | suspende · reativa (reautenticação) |
| `DELETE /members/:id` | remove o acesso (reautenticação) |
| `PUT /members/:id/permissions` | liberações do funcionário (reautenticação) |

Funcionário (`tenants/:tenantId/my-agenda`): `GET ?date=` e
`POST /:appointmentId/start|complete|no-show` com `expectedStartAt`.

Plataforma (`platform/establishments/:id`): `PATCH` (nome, segmento,
CPF/CNPJ; nunca o endereço), `POST /suspend`, `/archive` (com
`confirmSlug`), `/reactivate`, `PUT /plan`. A ficha (`GET`) passa a trazer o
uso real (profissionais, unidades, vagas), cada plano do catálogo com o que
passaria do limite, e as ações que a conta pode usar. Preço continua sendo só
o de catálogo; nenhum valor contratado ou cobrança é inventado.

## Migration `1792886400000-TeamAccess`

Só acrescenta:

- `tenant_status` + `ARCHIVED`; `tenants.restore_status`;
- `permission` + `ATENDIMENTO_PROPRIO_INICIAR|CONCLUIR|FALTA`;
- `audit_action` + `TENANT_UPDATED`, `TENANT_ARCHIVED`,
  `MEMBERSHIP_SUSPENDED`, `MEMBERSHIP_REACTIVATED`;
- `memberships.status` (`ACTIVE` por padrão para todos os vínculos
  existentes), `status_changed_at`, `status_changed_by_user_id`;
- `invites.professional_id` com FK composta com o tenant, a regra
  "convite de PROFISSIONAL ⇔ tem profissional" e um pendente por
  profissional.

`down` remove colunas, constraints e índice; os valores de enum ficam (o
PostgreSQL não os remove). Um estabelecimento `ARCHIVED` continua fora de
operação depois de uma reversão.

Ensaiada no PostgreSQL 18.6 descartável (TLS verificado,
`IGNORE_DOTENV_FILE=true`) já populado pela suíte de banco (183
estabelecimentos, 181 vínculos, 10 convites, 116 reservas): aplicada,
revertida e reaplicada; os 181 vínculos ficaram `ACTIVE`.

Conferência só-leitura para o piloto: `scripts/lib/equipe-acessos-schema.ts`,
expectativas `before-team-access` e `after-team-access` de
`npm run pilot:check-database`. O "antes" recusa histórico diferente das sete
migrations até AccountsAdministration e convites de PROFISSIONAL sem
profissional (que fariam a migration falhar no meio).

## Publicação (não executada)

Ordem: **backup → `before-team-access` → migration → `after-team-access` →
API → web**.

- Migration antes da API: a API atual não lê as colunas novas (todas com
  padrão ou nulas) e continua funcionando. A API nova sem a migration falharia
  ao ler `memberships.status`.
- API antes do web: o web novo chama rotas que só a API nova tem.
- Antes de publicar, conferir (só leitura) quantos estabelecimentos já têm
  mais profissionais ativos que o plano: eles continuam operando, mas não
  criam nem reativam profissionais até caber.
- O procedimento protegido de `aplicar-contas-piloto.mjs` é específico de
  AccountsAdministration; aplicar TeamAccess no piloto pede um roteiro próprio
  (mesmas fases: preparar, aplicar, conferir), ainda não escrito.

## Verificação da parte A

- Backend: unitários (1.419), HTTP e2e (131, inclui `test/team.e2e-spec.ts`),
  lint e build.
- PostgreSQL 18.6 descartável com TLS: suíte de banco inteira (174), com
  `test/team-access-postgres.db-e2e-spec.ts` (12 casos): plano de três com três
  profissionais e o dono; dois convites simultâneos pela última vaga; reenvio,
  revogação, expiração e convite vencido que só volta se couber; aceite que
  revalida o profissional; conta existente aceitando sem mudar nome, senha ou
  outros acessos; funcionário vendo só a própria agenda, com dados mínimos,
  e 404 para colega, outro estabelecimento e ids trocados; ações liberadas
  uma a uma e retiradas com a sessão aberta; dono que não concede o que não
  pode; suspender, reativar (vaga, conta bloqueada) e remover sem afetar a
  conta, as reservas e o acesso em outra empresa; profissional desativado;
  suspender, arquivar e reativar o estabelecimento (agendamento público,
  contextos de sessão, histórico, reautenticação, administrador delegado
  recusado); edição que preserva o endereço; troca de plano recusada com o
  detalhe do excesso e aceita depois do ajuste.
