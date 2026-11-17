# Assinatura modular por estabelecimento e limite de usuários da equipe

Cada estabelecimento contrata o **Agendamento essencial** e, se quiser,
**adicionais**. A administração da plataforma escolhe, na criação e depois na
aba "Plano e adicionais" da ficha, os módulos, o valor mensal contratado (com
motivo quando negociado) e o **limite de usuários da equipe**. Sem gateway de
pagamento: o pagamento continua registrado à mão no portal.

Branch `feat/assinatura-modular-limite-equipe`, a partir da integration em
`df535a1`.

## 1. Decisões do responsável

- Adicionais contratáveis: **Indicadores** (recurso RELATORIOS) e
  **Comissões**. Recebimentos e Equipe ficam no essencial.
- Clientes atuais **ficam no plano atual** (Básico, Pro, Max). A conversão é
  manual e explícita, pela aba. Estabelecimentos novos nascem modulares.
- Limite vazio segue o do plano (2/5/20). Nunca vira zero sozinho.
  Estabelecimento novo exige o limite explícito.
- Vigência imediata. Sem cobrança retroativa nem proporcional. A revisão
  mostra o novo valor recorrente antes de salvar.
- A Visão geral operacional continua sem Indicadores. "Indicadores
  avançados" descreve só o que existe: o resumo do período e o resumo
  financeiro da Visão geral.
- Contratos modulares novos são só mensais. Trimestral converte só com
  confirmação explícita.
- Os preços (29,90 / 9,90 / 14,90) são exemplos. Nenhum preço é gravado pela
  migration; sem preço, aparece "a definir" e não dá para contratar.

## 2. Catálogo

| Módulo | Disponibilidade | Recurso |
|---|---|---|
| Agendamento essencial | sempre incluído | AGENDA, AGENDAMENTO_PUBLICO, PROFISSIONAIS, CONSUMIDORES, EQUIPE, PAGAMENTOS (serviços não têm recurso próprio) |
| Indicadores avançados | Disponível | RELATORIOS |
| Comissões | Disponível | COMISSOES |
| WhatsApp automático | Em desenvolvimento (o provedor é só um stub) | — |
| Controle de estoque, Gestão financeira, Marketing e fidelização | Planejado | — |

A disponibilidade só muda por migration, ou seja, com o código liberado e
validado. O preço muda pelo portal ("Planos e adicionais"). Mudar um preço
não reajusta nenhuma assinatura existente: cada versão guarda o preço da
data.

## 3. Como funciona

- **Liberação de recurso:** continua sendo só `commercial-gate.ts`
  (`COALESCE(override, plan_features)`).
  - O plano `plan_modular` traz o essencial em `plan_features`.
  - Cada adicional contratado é um override `enabled = true`. Retirar apaga o
    override, e o histórico do módulo fica preservado.
  - Overrides de outros recursos nunca são tocados.
- **Versões:** `tenant_subscriptions` + `tenant_subscription_items`,
  append-only. Cada versão guarda:
  - preço base e itens do catálogo na data;
  - total do catálogo e valor contratado (motivo obrigatório quando
    diferentes);
  - limite de usuários e a vigência (`effective_at`).
- **Contrato:** cada versão grava `tenant_contract_prices` (plano modular,
  MONTHLY, valor contratado). Assim a sugestão do próximo pagamento continua
  "contrato > catálogo".
- **Plano modular sem linha na migration:** `ensureModularPlan`
  (`commercial/modular-plan.ts`) cria a linha na primeira assinatura ou no
  primeiro preço base, na mesma transação. Ver a seção 5.
- **Trava no banco:** o gatilho adiado `trg_tenants_modular_subscription`
  recusa, no commit, um estabelecimento no plano modular sem limite ou sem
  versão de assinatura.
- **Permissão:** só `MASTER_OWNER` com senha confirmada há pouco
  (`lifecycleActor`) altera assinatura, preços ou limite. A criação usa
  `manageEstablishments`, como antes. O dono gerencia a equipe dentro do
  limite e nunca muda o próprio limite.
- **Rotas antigas para estabelecimento modular:** respondem 409
  `ASSINATURA_MODULAR`.
  - troca de plano (inclusive de um plano anterior **para** o modular);
  - valor contratado;
  - "alterar o contrato" pelo pagamento.

  Registrar o pagamento em si continua permitido. Ciclo trimestral no modular
  responde 409 `CICLO_NAO_DISPONIVEL`.
- **Conversão:** a revisão pré-marca os adicionais cujo recurso já está
  liberado. Retirar um deles exige `confirmRemoval`, senão 409
  `RECURSO_SERIA_RETIRADO`.
  - Contrato ou último período pago trimestral exige
    `cycleChange: { from: 'QUARTERLY', acknowledged: true }`, senão 409
    `CONVERSAO_DE_CICLO`.
  - Períodos, pagamentos e validade nunca são editados: o trimestre pago vale
    até o fim.
  - Os contratos do plano anterior ficam no histórico e deixam de ser
    "atuais", porque as leituras filtram por `t.plan_id`.
  - A versão 1 grava `previous_contract`.

## 4. Limite de usuários da equipe

- **Quem conta:**
  - cada usuário com vínculo ATIVO e papel diferente de DONO, uma vez por
    estabelecimento;
  - mais os convites de equipe pendentes e no prazo, um por e-mail, sem quem
    já tem vínculo ali.
- **Quem não conta:** dono, profissional sem login, acesso suspenso, convite
  vencido ou revogado. O aceite não conta duas vezes.
- **Fonte:** `staffSeatUsage` e `EFFECTIVE_TEAM_USER_LIMIT_SQL`
  (`team/seats.ts`). O limite em vigor é
  `COALESCE(tenants.team_user_limit, plans.max_professionals)`. O fallback só
  serve aos planos anteriores; no modular o limite é obrigatório.
- **Profissionais:** o limite de profissionais é outro (`plans.max_professionals`,
  NULL = sem limite contratual, só no modular).
- **Bloqueio na API:** criar acesso, convidar, aceitar, reativar e trocar papel
  travam a linha do estabelecimento (`FOR NO KEY UPDATE`, a mesma trava das
  vagas) e recusam acima do limite com `LIMITE_DO_PLANO`.
  - O código foi mantido para o web anterior; a mensagem agora fala em limite
    contratado.
  - Pedidos simultâneos ficam em fila: com uma vaga, só um passa. Convite e
    redução do limite ao mesmo tempo nunca passam juntos.
- **Redução:** abaixo do ocupado ou reservado responde 409
  `LIMITE_ABAIXO_DO_USO`, com "X ativos e Y reservados por convite". Nada é
  desativado para caber, e o limite não muda a mensalidade.
- **Na tela:** "3 de 5 acessos utilizados (1 reservado por convite)", na tela
  do dono e na aba do portal. Acima do limite aparece o aviso.

### Transição da contagem (clientes atuais)

A contagem anterior era: PROFISSIONAL e GERENTE ativos mais convites de
PROFISSIONAL. A nova acrescenta só:

- convites de GERENTE pendentes;
- vínculos RECEPCIONISTA. A API não atribui esse papel, então ele só existe
  por SQL manual.

Quem passar do limite com a contagem nova **não perde nada**. Só novas
entradas são recusadas, e o portal e a tela do dono mostram o aviso.

O relatório somente leitura `seatTransitionReport` (`team/seat-transition.ts`)
compara, por estabelecimento, a ocupação anterior, a nova e o limite.
**Pendente para a publicação:** rodá-lo na restauração do backup em banco
descartável (kit da etapa).

## 5. Compatibilidade na publicação (migration → API → web)

- **Migration com a API anterior no ar:** a migration só acrescenta e **não**
  cria a linha do plano modular, então a API anterior nunca oferece esse
  plano.
  - Ensaiado em 17/11 com a API de `df535a1` contra um banco com as 19
    migrations: a API sobe, `GET /platform/plans` devolve só os 3 planos
    (aceitos pelo validador do web anterior), a criação no plano anterior
    funciona e a criação com `plan_modular` responde 404.
  - Teste fixo: `lote6b2-migration` roda a lista da API anterior sobre um
    banco recém-migrado.
- **Proteção extra (volta da API depois do plano criado):** se a API voltar
  para a anterior depois de a nova ter criado o plano modular:
  - a lista de planos da API anterior traz o modular com
    `maxProfessionals: null`, e o web anterior recusa a tela de criação;
  - a tentativa de criar ou trocar para o modular é barrada pelo gatilho
    (ensaiado: 500, nada gravado).

  Portanto **não voltar a API para antes deste lote depois da primeira
  assinatura modular**. A volta exige também voltar o web (ou aceitar a
  criação indisponível no portal), e os dados ficam íntegros.
- **API nova com o web anterior:**
  - O corpo antigo de criação (`planId`, sem `teamUserLimit`) recebe 409
    `TELA_DESATUALIZADA`, "Recarregue a página…". O web anterior só exibe a
    mensagem do servidor em 409. Quem não pode criar continua recebendo 403.
  - As listas que o web anterior lê (`GET /platform/plans`, catálogo de
    preços, opções de troca) não trazem o plano modular.
  - As leituras só ganham campos.
  - Clientes atuais continuam com `periodSummary` e `finance`, porque
    RELATORIOS entrou no Básico (o Pro e o Max já tinham).
  - Validadores e SQL do web e da API anteriores estão congelados em
    `backend/test/support/contrato-web-anterior-assinatura.ts` e conferidos no
    db-e2e.
- **Antes de criar estabelecimentos pelo web novo:** definir o preço do
  Agendamento essencial (e dos adicionais que serão vendidos) em "Planos e
  adicionais". Sem preço, a criação mostra a pendência e a API responde
  `PRECO_BASE_PENDENTE`.

## 6. Testes

- **Unitários:**
  - `commercial/subscription.spec.ts` (totais com os exemplos, indisponível,
    pendente, motivo, diff, redução);
  - spec da migration (não cria o plano, não preenche limite, não reescreve
    linha);
  - `create-establishment.pipe.spec.ts`;
  - `src/lib/administracao/assinatura.test.ts`;
  - `src/lib/equipe/contratos.test.ts`.
- **db-e2e** (`test/modular-subscription-postgres.db-e2e-spec.ts`):
  - contagem, relatório de transição e cliente acima do limite;
  - limite próprio e redução recusada;
  - concorrência (última vaga; convite × redução);
  - criação modular, versões, catálogo sem reajuste e valor negociado;
  - conversão com overrides preservados e isolamento;
  - conversão trimestral;
  - rotas antigas recusadas e permissões;
  - Visão geral com e sem o adicional;
  - compatibilidade com o web e a API anteriores; cliente atual intacto.

  Specs antigos ajustados: criação nova, contagem do catálogo, listas de
  migrations posteriores. Os levantamentos antigos de vagas
  (`equipe-acessos-schema.ts`, `gerente-acessos-schema.ts`) ignoram
  estabelecimentos no plano modular, que é posterior à regra que eles
  levantam.
- **Navegador:** a suíte nova `assinatura-modular-flow.spec.ts` (em
  `test:browser:administracao`) cobre catálogo, criação com limite e
  adicional, revisão, nova versão e histórico, com capturas a 1280 e 390 px,
  claro e escuro, sem rolagem horizontal. Também passaram `contas`,
  `administracao`, `equipe`, `gerente`, `visao-geral` e `portal-visao-geral`.

## 7. Estado e retomada

**Feito (17/11/2026):**
- API, migration, web e testes acima.
- Bateria completa local verde num banco descartável limpo:
  - backend: unitários 2083, HTTP 172, db-e2e 35 arquivos / 350 testes;
  - web: 1132 testes;
  - lint, typecheck e build;
  - as 6 suítes de navegador afetadas mais a nova.
- Ensaio de compatibilidade com a API anterior (seção 5).

**Não feito:**
- Kit de publicação da etapa: backup real, `pilot:check-database` antes e
  depois, relatório de transição das vagas na restauração.
- Definição dos preços reais.

**Próximo passo concreto:** PR para a integration, CI verde e merge com
`[skip render]`.

**Publicação bloqueada:** o lote tem migration e muda o contrato da API.
Entra depois da etapa 3 e da etapa do #121
(`docs/plans/publicacao-consolidada-b5b2704.md`), que ainda dependem de:
- backup real;
- D5/D7/D8;
- dados da seção 8.

Ordem: migration (runbook, backup) → API → web, no mesmo SHA. Nunca o web
sozinho.

**Só neste computador:** o cluster PostgreSQL descartável usado nos testes
(pasta temporária da sessão, porta 55441). Nada a recuperar.
