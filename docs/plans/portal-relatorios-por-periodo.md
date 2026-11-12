# Portal: relatórios por mês ou período

Relatórios da **administração do SaaS**, no portal da plataforma
(`/portal/relatorios`). Mostram o que o Agenda Cloud recebeu das assinaturas e
os cadastros registrados, por mês ou por período escolhido. Nada aqui é
faturamento dos estabelecimentos nem dinheiro dos atendimentos (`payments/`).

Reaproveita o que já existia:

- o alcance Clientes / Internos/teste / Todos (`matchesScope`/`scopeSql` em
  `backend/src/platform/portal-overview.ts`, lote
  `docs/plans/portal-clientes-e-internos.md`);
- o indicador "Pagamentos de assinaturas" do mês na Visão geral, cuja regra
  passou a ter uma fonte só (`subscriptionPaymentWhere`), usada pela Visão
  geral, pelo relatório e pelo extrato;
- a permissão de leitura do portal (`requirePlatformAccess` /
  `viewDirectory`). Nenhuma permissão nova.

Sem migration, sem tabela, sem coluna e sem histórico novos.

## Decisões

- **Página própria** `/portal/relatorios`. A Visão geral continua mostrando a
  situação de agora e o mês atual, com link "Ver outros meses".
- **Relatório sem período**: mês atual em `America/Sao_Paulo`, calculado pelo
  relógio do **servidor**. O servidor devolve o período aplicado e a tela usa
  essa resposta (nunca o relógio do navegador).
- **Extrato** (`/portal/pagamentos`) sem período: todo o histórico. Alcance
  padrão da tela: Clientes, com opção Internos/teste e Todos.
- **Lista de estabelecimentos** sem datas de cadastro: sem restrição por
  cadastro, como antes.
- **"Cadastros registrados no período"** por `tenants.created_at`. Não é
  "clientes conquistados" nem "novas assinaturas".

## Datas, fuso e limites

- Um fuso só para os relatórios: `America/Sao_Paulo` (`PLATFORM_TIME_ZONE`).
- Período: duas datas de calendário `YYYY-MM-DD`, **as duas inclusas**.
  Validação (uma função pura, `checkDateRange` em
  `backend/src/platform/portal-reports.ts`, usada pelos três esquemas):
  - data real (`2026-02-30` e `2026-02-29` são recusadas; `2028-02-29` vale);
  - as duas datas juntas, ou nenhuma;
  - início menor ou igual ao fim;
  - no máximo **366 dias contando os dois extremos**
    (`2028-01-01` a `2028-12-31` = 366 dias, aceito; `2026-01-01` a
    `2027-01-02` = 367 dias, recusado).
  A função NÃO escolhe padrão: cada rota decide o que a ausência significa
  (relatório: mês atual; extrato e lista: sem restrição).
- `payment_received_on` é `date`: `BETWEEN de AND ate`.
- `tenants.created_at` é `timestamptz`: intervalo semiaberto em São Paulo,
  `>= (de 00:00 em São Paulo)` e `< (ate + 1 dia, 00:00 em São Paulo)`. Nada
  do último dia fica de fora (`23:59:59.999` entra) e nenhum offset fixo é
  usado.

## Indicadores

Todos no alcance escolhido, pela classificação `is_test` **atual**.

1. **Pagamentos recebidos** (quantidade e total em BRL)
   - Registro: `tenant_access_periods` com `kind = 'PAID'`
     (`confirmation_source = 'MANUAL'`, `currency = 'BRL'`), **atualmente não
     anulados**, com `payment_received_on` no período.
   - Movimentação no período, pela data de recebimento informada à mão.
   - Soma `contracted_price_cents` gravado em cada registro, nunca recalculado
     pelo catálogo ou contrato.
   - Um trimestral conta inteiro no mês em que foi recebido, sem rateio.
   - Não é receita reconhecida, MRR, previsão nem cobrança a vencer.
2. **Registros anulados**
   - Mesmo registro e mesmas datas de recebimento, com `canceled_at`
     preenchido. Situação **atual** do registro.
   - Uma anulação feita depois muda o relatório do período original: o
     registro sai do total de recebidos e entra nos anulados.
   - Anulação corrige o registro; não comprova devolução de dinheiro (estorno
     acontece fora do Agenda Cloud e não é registrado).
3. **Detalhamento por plano e ciclo** (informativo, sem links)
   - As mesmas linhas do item 1, agrupadas pelo plano e pelo ciclo gravados
     no pagamento (o plano da época, que pode não ser o atual). A soma dos
     grupos é o total do item 1.
4. **Cadastros registrados no período**
   - Registro: `tenants.created_at` no período (fuso acima).
   - O que a contagem representa: linhas de `tenants` existentes hoje cuja
     data de criação cai no período. Fluxos conferidos no código:
     - criação: só `backend/src/accounts/invites.service.ts` (convite do
       dono) insere em `tenants`, com `created_at` = instante da criação;
     - arquivar, suspender, cancelar: mudam `status`, nunca apagam a linha
       (`establishment-admin.service.ts`). Arquivados e suspensos continuam
       contando no período do cadastro;
     - exclusão: nenhum fluxo da aplicação apaga `tenants`. Várias tabelas
       ligadas usam `ON DELETE RESTRICT`, outras `ON DELETE CASCADE`, então a
       FK não garante sozinha a permanência. Uma exclusão feita direto no
       banco (fora da aplicação) tiraria o cadastro da contagem, sem rastro.
   - Datas antigas podem refletir importação ou migração de dados, não a data
     real de entrada do estabelecimento.

Ficam fora: cobrança prevista, MRR, churn, inadimplência, suspensões e
ativações por período, testes iniciados e qualquer histórico de estado.

## Classificação interno/teste

Os relatórios usam a marca `is_test` de **agora**. Marcar ou desmarcar um
estabelecimento muda também os relatórios de períodos passados. Não há
reconstrução histórica neste lote. A tela diz isso.

## API

- `GET /platform/reports?from&to&scope` (novo; esquema estrito)
  - `scope` ausente: `CLIENTS`. Datas ausentes: mês atual em São Paulo.
  - Resposta: `scope`, `timeZone`, `period { from, to, month, days }`,
    `payments { count, totalCents, canceledCount }`,
    `byPlanCycle [{ planId, planName, cycle, count, totalCents }]`,
    `registrations { count }`.
- `GET /platform/subscription-payments` ganha `from`, `to`, `scope`, `status`
  (`RECEIVED` | `CANCELED`), todos opcionais. Ausentes: o comportamento
  anterior (todo o histórico, todos os estabelecimentos, as duas situações).
  O `scope` ausente vale `ALL` aqui para não mudar quem já chamava a rota
  (inclusive com `tenantId`); a tela do extrato envia `CLIENTS` como padrão.
  Resposta ecoa `from`, `to`, `scope`, `status` aplicados. Contagem e página
  usam o mesmo WHERE.
- `GET /platform/establishments` ganha `createdFrom`, `createdTo`. Resposta
  ecoa `created { from, to, timeZone } | null`.
- `GET /platform/overview`: o mesmo número de antes, agora pela mesma fonte
  do relatório.

## Web

- `/portal/relatorios`: mês (anterior / seguinte / mês atual), período
  personalizado, alcance, cartões com links. URL: `mes=YYYY-MM` ou
  `de`+`ate`, `alcance` (o padrão não vai na URL).
- Links que correspondem aos indicadores:
  - "Pagamentos recebidos": `/portal/pagamentos?de&ate&alcance&situacao=recebidos`;
  - "Registros anulados": `...&situacao=anulados`;
  - "Cadastros": `/portal/estabelecimentos?cadastroDe&cadastroAte&alcance`;
  - o detalhamento por plano/ciclo não tem link.
- Extrato aberto direto: as duas situações, com os selos.
- Nenhum filtro é afirmado sem o eco do servidor. Resposta que não confirma
  período, alcance ou situação: a tela mostra aviso e não mostra números nem
  lista como se estivessem filtrados.

## Compatibilidade e publicação

**API antes do web** (`docs/runbooks/publicacao-piloto-render.md`).

- Web novo com API antiga: `/platform/reports` não existe (404) e os filtros
  novos são recusados (400, esquema estrito). A tela mostra "ainda não
  disponível neste servidor" e nunca apresenta zero. O extrato em "Todos"
  sem outros filtros não envia parâmetro novo, então funciona com a API
  antiga, com o aviso de alcance não confirmado.
- API nova com web antigo: nada muda para o web antigo (parâmetros novos
  opcionais, padrões antigos preservados).
- Nenhum parâmetro ou link existente foi renomeado.

## Testes

- Puros (`portal-reports.spec.ts`): data real, bissexto, 366/367 dias,
  período padrão na virada do mês e do ano em São Paulo, mês completo.
- HTTP (`platform.e2e-spec.ts`): parâmetros inválidos dão 400 e não chegam
  ao serviço; sem sessão, 401.
- PostgreSQL descartável (`portal-relatorios-postgres.db-e2e-spec.ts`), dados
  fictícios em 2001 (fora do alcance dos outros arquivos): virada do mês
  (31/10 e 01/11; cadastro às 23:59:59.999 de 31/10 em São Paulo), período
  vazio, alcance, anulado, relatório = extrato filtrado = soma do
  detalhamento = Visão geral (mês atual), reclassificação muda o passado,
  lista por cadastro, recusa a quem não tem o portal.
- Web: `periodo.test.ts`, `rotas.test.ts`, `contratos` do relatório.
- Navegador: `portal-visao-geral-flow` cobre a página de relatórios.

## Estado e retomada

- Branch `feat/portal-relatorios-periodo`, a partir da integração em
  `23fda23`.
- Feito: API (`/platform/reports`, filtros do extrato e da lista), regra
  única dos pagamentos de assinatura, telas (relatórios, extrato filtrado,
  lista por cadastro, links da Visão geral), testes puros, HTTP, PostgreSQL
  descartável e navegador.
- Achado durante os testes: em outubro de 2001 e 2002 São Paulo tinha
  horário de verão (UTC-2). Os dados de teste usam hora local convertida
  pelo banco; o código nunca usa offset fixo.
- Não feito: publicação (nada deste lote foi publicado; comissões em
  `5d74556` continua separada e antes). Sem migration.
- Próximo passo: acompanhar o CI do PR; merge só com pedido explícito.
