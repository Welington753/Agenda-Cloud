# Plano: visão geral, listagem comercial e navegação do portal

Pedido de 2026-11-03. Parte da integration em `d2a4479` (merge do #87), na
branch `feat/portal-visao-geral`. Sem migration: usa o schema das 14
migrations já aplicadas no piloto. Nada aqui foi publicado.

## Objetivo

1. **Navegação**: "Visão geral" como destino padrão do portal, menu lateral
   no computador e recolhível no celular, aparência no menu do usuário.
2. **Visão geral** com dados reais da API: totais, acesso liberado e
   bloqueado, validades que terminam em 7 dias, pagamentos de assinatura do
   mês e a lista "Precisa de atenção".
3. **Listagem** dos estabelecimentos com plano, condição contratada, situação
   do estabelecimento, modalidade e validade do acesso, e filtros.

## Decisões

- **Uma regra de acesso só.** O acesso efetivo combina as duas regras que o
  servidor já usa na operação: `isTenantUsableForSession` (situação
  administrativa: só TRIAL e ACTIVE operam) e `accessSituation` (validade:
  teste, pago, cortesia, sem vencimento, legado, ausente, vencido). Nenhuma
  contagem é feita por SQL sobre status ou datas.
- **Conjunto completo, sem uma consulta por estabelecimento.** Os períodos
  válidos e os sinalizadores de todos os estabelecimentos são lidos em duas
  consultas (mesmos predicados das consultas por estabelecimento, em
  `commercial-gate.ts`), e a regra central roda em memória para cada um. A
  listagem continua paginada no SQL; um filtro de acesso vira uma lista de
  ids na mesma consulta.
- **Preço**: a condição de cada ciclo usa `cyclePricing` (contrato em vigor,
  senão catálogo, senão pendente) com o catálogo de `plan_prices`. Os dois
  ciclos aparecem quando existem; o trimestral é o total de três meses. O
  último pagamento nunca vira contrato.
- **Pagamentos do mês**: `tenant_access_periods` com `kind = 'PAID'`,
  `confirmation_source = 'MANUAL'`, `canceled_at IS NULL`, com
  `payment_received_on` entre o primeiro e o último dia do mês corrente em
  `America/Sao_Paulo`. Soma de `contracted_price_cents` como registrado.
- **Fora deste lote**: MRR, previsão de receita, inadimplência, classificação
  de uso interno, observações de atendimento, autenticação em duas etapas,
  ativação do backup, cadastro de preços.

## Etapas

1. Backend: funções puras (acesso efetivo, dias restantes, janela de 7 dias,
   mês), carga em lote, `GET /platform/overview` e filtros/campos novos em
   `GET /platform/establishments` (campos só acrescentados).
2. Frontend: rotas, shell com menu lateral/recolhível e menu do usuário,
   página Visão geral, listagem nova.
3. Testes: unitários (backend e frontend), db-e2e com banco descartável,
   suíte de navegador própria, ajustes nas suítes do portal.
4. PR para a integration, checks, atualização deste plano.

## Comportamento entregue

### Navegação

- `/portal` (entrada) leva à **Visão geral** (`/portal/visao-geral`) quando
  não há `next`. Um `next` de dentro do portal continua sendo seguido; um da
  operação continua ignorado. Os endereços antigos (`/plataforma/**`,
  `/administracao/**`, `/conta/administracao/**`) seguem para `/portal`.
- Menu lateral no computador; no celular, barra superior com o botão "Menu"
  (seções recolhidas, fecham ao navegar ou com Escape) e o menu do usuário.
  As seções existem uma vez no DOM (`nav` "Seções do portal").
- **Menu do usuário** (nome, e-mail ou login, Aparência e "Sair"), no rodapé
  do menu lateral ou no canto da barra do celular. A aparência saiu do topo
  da área central. O menu aparece também na recusa e na troca de senha.
- Sem mudança: troca de senha temporária pelo portal, sessão expirada
  voltando à entrada do portal, "Sair" para `/portal`, operação sem atalho
  para o portal, portal sem vínculo com estabelecimento.

### Visão geral (`GET /platform/overview`)

Totais de **todos os estabelecimentos cadastrados**. Ainda não há
classificação de uso interno: a tela diz que os números podem incluir contas
de teste e da equipe e não afirma que todos são clientes comerciais.

| Indicador | Critério |
| --- | --- |
| Cadastrados | linhas de `tenants` |
| Acesso liberado | situação TRIAL/ACTIVE **e** validade sem bloqueio (teste, pago, cortesia, sem vencimento, validade ainda não definida) |
| Acesso bloqueado | situação fora de operação (suspenso, arquivado, cancelado, `PAST_DUE`) **ou** em operação com validade vencida/ausente; a tela separa as duas causas |
| Termina em até 7 dias | teste, pago ou cortesia em curso cujo último dia coberto, com as renovações já registradas, é hoje até hoje + 6, no fuso do estabelecimento (inclui suspensos) |
| Suspensos | situação `SUSPENDED` |
| Condição contratada pendente | nenhum valor contratado específico em vigor no plano atual, em nenhum ciclo |
| Modalidades | contagem por `accessSituation` (teste gratuito, período pago, cortesia, sem vencimento, validade ainda não definida, sem validade registrada, vencido) |

**Pagamentos de assinaturas do mês**: períodos `PAID` com
`confirmation_source = 'MANUAL'`, `canceled_at IS NULL`, moeda BRL e
`payment_received_on` entre o dia 1 e o último dia do mês corrente em
`America/Sao_Paulo` (inclusive). Soma de `contracted_price_cents` como foi
gravado. Os anulados no mesmo intervalo aparecem só como contagem, fora da
soma, com o aviso de que anular corrige o registro e não é estorno. Nada de
`appointment_payments` (recebimentos das barbearias). Sem MRR, previsão ou
inadimplência.

**Precisa de atenção**: só estabelecimentos em operação (TRIAL/ACTIVE),
primeiro os bloqueados pela validade, depois os que terminam em até 7 dias
(menos dias primeiro). Até 20 itens, cada um com link para a ficha; os totais
e os filtros (validade em 7 dias, validade vencida ou ausente, condição
pendente, suspensos) levam à listagem filtrada.

### Listagem (`GET /platform/establishments`)

- Campos acrescentados a cada item (os antigos continuam iguais):
  `operational`, `access` (modalidade, `lastDay`, `daysLeft`, acesso efetivo)
  e `commercial` (condição de cada ciclo: contrato, catálogo, pendente; ciclo
  da última condição registrada).
- Parâmetro novo `filter`: `ACCESS_ALLOWED`, `ACCESS_BLOCKED`,
  `EXPIRING_SOON`, `VALIDITY_BLOCKED` (vencido ou sem período e sem marca de
  anterior, qualquer situação) e `CONTRACT_PENDING`. Combina com busca,
  situação e plano; a paginação continua no SQL.
- Tela: filtros na URL (`q`, `situacao`, `plano`, `filtro`, `pagina`), com o
  significado do filtro escrito na tela. Colunas: estabelecimento,
  responsável, plano e condição (valores contratados por ciclo, trimestral
  como "total de 3 meses", catálogo à parte, "Pendente: sem valor
  contratado"), situação e acesso ("Em operação" ou a situação, acesso
  efetivo, modalidade, validade com dias restantes). Sem vencimento e
  validade ainda não definida têm texto próprio, sem data.
- Os cartões de resumo antigos da lista (que contavam TRIAL como "Em teste"
  ao lado de "Ativos") saíram: os totais corretos estão na Visão geral. O
  campo `summary` continua na API por compatibilidade.

### Implementação

- `backend/src/platform/portal-overview.ts`: regras puras (acesso efetivo,
  dias restantes, janela de 7 dias, filtros, mês, atenção, totais).
- `backend/src/platform/portal-directory.ts`: leitura em lote (tenants,
  períodos válidos, sinalizadores, catálogo e contrato em vigor) em seis
  consultas fixas; `commercial-gate.ts` ganhou as versões em lote das
  consultas de períodos e sinalizadores, com os mesmos predicados.
- As consultas novas passam pelo mesmo `SessionGuard` (troca de senha
  obrigatória) e pelo `requirePlatformAccess` (MASTER_OWNER ativo, relido a
  cada requisição). `/platform/reauth` e a proteção do último proprietário não
  mudaram. Nenhuma migration, preço ou condição comercial foi gravado.

## Estado e retomada

Implementado em `feat/portal-visao-geral` (worktree
`Agenda-Cloud-portal-visao-geral`), sem merge, deploy, banco real ou contas
reais.

### Testes

- Backend unitário: `portal-overview.spec.ts` (acesso efetivo e modalidades,
  limites de 0, 6 e 7 dias, renovação futura encostada, fuso, contrato x
  catálogo, mensal e trimestral juntos, filtros, atenção, totais sem
  duplicar, virada do mês em São Paulo).
- Backend db-e2e (`portal-visao-geral-postgres.db-e2e-spec.ts`, banco
  descartável): 26 estabelecimentos fictícios (mais que uma página), deltas
  dos totais e dos pagamentos (anulado e mês anterior fora), filtros
  paginados, condição contratada, recusas (dono, MASTER_ADMIN,
  MASTER_SUPPORT, troca de senha obrigatória, proprietário suspenso). A rota
  nova entrou na lista de recusas de `platform-portal-postgres`.
- Frontend unitário: `diretorio.test.ts` e `rotas.test.ts`.
- Navegador: suíte nova `portal-visao-geral` (3 logins) e ajustes em
  `portal-entrada`, `portal-senha-temporaria`, `portal-recusas` e
  `administracao` (destino padrão, menu do usuário, menu recolhível).

### Próximas etapas (lotes próprios)

- Publicação: API e depois web no mesmo SHA, sem migration.
- Classificação explícita de uso interno, observações de atendimento, MRR e
  previsão, autenticação em duas etapas, ativação do backup.
- Cadastro de preços e condições comerciais reais (fora deste lote).
