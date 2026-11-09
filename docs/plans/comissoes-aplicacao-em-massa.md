# Aplicação de comissões em massa

Base: integration `8e8577d` (Portal AC, #100). Nenhuma migration nova: usa as
tabelas das migrations 15 (`ProfessionalCommissions`, `commission_rules` e
`commission_entries`) e 16 (`ProfessionalCommissionSettings`,
`professional_commission_settings`).

## Pedido

O dono aplica uma mesma regra geral (percentual do preço de cada serviço ou
valor fixo por serviço realizado) a todos os profissionais ativos ou só aos
escolhidos, com prévia antes de gravar. Também configura cada um
individualmente (por exemplo, Ana Luiza 20%, Lucas 10% e Marcos R$ 15 por
serviço) e escolhe, de forma explícita, se as exceções por serviço ficam ou
saem para que a regra geral valha em todos os serviços.

Decisões aprovadas:

1. **Modo SUBSTITUIR (`REPLACE`):** troca a regra geral de cada profissional
   do alcance e liga "Recebe comissão", mesmo que estivesse desligado.
2. **Modo PRESERVAR (`PRESERVE`):** mantém intactas as configurações gerais
   existentes, inclusive de quem tem "Recebe comissão" desligado. Só recebe a
   regra nova quem recebe comissão e não tem regra geral (com ou sem linha em
   `professional_commission_settings`).
3. **Exceções por serviço** (`commission_rules`): manter é o padrão, e elas
   continuam prevalecendo sobre a regra geral (`regraEfetiva`). Removê-las é
   uma escolha explícita, na edição individual e na aplicação em massa (só
   em SUBSTITUIR), com confirmação própria depois de ver quais profissionais
   e quantas exceções saem. "Substituir a regra geral" sozinho nunca remove
   exceção. PRESERVAR mantém sempre as exceções e o comportamento anterior.
4. **Alcance "Todos":** só profissionais ativos. Inativos ficam de fora.
   "Escolher" aceita só profissionais ativos do estabelecimento.
5. **Comissões já apuradas** (`commission_entries`) não mudam: a regra nova
   e a remoção de exceções valem só para as próximas conclusões.
6. **Remover exceções** apaga TODAS as exceções do profissional, inclusive
   "sem comissão" e as de serviços que ele não atende mais, e exige uma regra
   geral (é ela que passa a valer em todos os serviços). A troca da regra e a
   remoção acontecem na mesma transação.

## Resultado por profissional (função pura)

`planejarAplicacao` (`backend/src/commissions/commission-bulk.ts`), a partir
da configuração atual (`stored`, `receivesCommission`, `defaultRule`,
`exceptions`) e da escolha das exceções (`KEEP`, o padrão, ou `REMOVE`):

| Modo | Configuração atual | Resultado | Depois |
| --- | --- | --- | --- |
| SUBSTITUIR | gravada, recebe, regra igual à nova, e (manter ou sem exceções) | `UNCHANGED` | igual |
| SUBSTITUIR + remover | gravada, recebe, regra igual à nova, com exceções | `CHANGE` | igual, sem exceções |
| SUBSTITUIR | qualquer outra (inclusive sem linha, desligado) | `CHANGE` | recebe, regra nova (exceções mantidas) |
| SUBSTITUIR + remover | qualquer outra, com exceções | `CHANGE` | recebe, regra nova, sem exceções |
| PRESERVAR | recebe, sem regra geral (com ou sem linha) | `CHANGE` | recebe, regra nova |
| PRESERVAR | recebe, regra igual à nova | `UNCHANGED` | igual |
| PRESERVAR | recebe, outra regra geral | `PRESERVE` | igual |
| PRESERVAR | não recebe | `PRESERVE` | igual (continua desligado) |

PRESERVAR nunca remove exceções (o DTO recusa `REMOVE` fora de SUBSTITUIR).
O plano diz, por profissional, se grava a configuração (`settingsChange`) e
se remove as exceções (`removesExceptions`).

## API

Mesma autorização das regras (`canManageCommissionRules`, recurso
`COMISSOES`): só o dono; ids de outro estabelecimento respondem 404, como
inexistentes.

- `POST tenants/:id/commissions/bulk-settings/preview` (200): prévia, sem
  gravar nada.
- `POST tenants/:id/commissions/bulk-settings` (200): aplica.

Corpo (zod, estrito):

```json
{
  "target": "ALL" | "SELECTED",
  "professionalIds": ["..."],            // só com SELECTED: 1 a 200, sem repetição
  "defaultRule": { "kind": "PERCENTAGE" | "FIXED", "value": 1000 },
  "mode": "REPLACE" | "PRESERVE",
  "exceptions": "KEEP" | "REMOVE",       // opcional (padrão KEEP); REMOVE só com REPLACE
  "fingerprint": "<64 hex>",             // só na aplicação: o da prévia
  "confirmReplace": true,                // só na aplicação em REPLACE: obrigatório
  "confirmRemoveExceptions": true        // só na aplicação com REMOVE: obrigatório
}
```

Resposta (prévia e aplicação): `exceptions`, `fingerprint`, `summary`
(`change`, `preserve`, `unchanged`, `total`, `exceptionsRemoved`) e, por
profissional, `professional`, `current`, `next`, `exceptions` (`services`:
serviço e regra de cada exceção; `removed`) e `outcome`. A aplicação
acrescenta `applied: true` e `operationId`.

Edição individual (`PUT tenants/:id/commissions/settings/:professionalId`):
o corpo de sempre (`receivesCommission`, `defaultRule`) aceita `exceptions`
(`KEEP`, o padrão, ou `REMOVE`). `REMOVE` exige `defaultRule`,
`confirmRemoveExceptions: true` e `exceptionsFingerprint`, a impressão das
exceções que a tela mostrou (campo novo da leitura
`GET .../commissions/rules/:professionalId`). Sem `REMOVE`, confirmação e
impressão são recusadas (400).

Recusas com `code` (a tela decide pelo código, nunca pelo texto):

- 409 `PREVIA_DESATUALIZADA`: a configuração ou as exceções de algum
  profissional do alcance, o próprio alcance ou o pedido mudou desde a
  prévia.
- 409 `EXCECOES_DESATUALIZADAS` (edição individual): as exceções mudaram desde
  a leitura; a tela relê a lista e pede nova confirmação.
- 409 `PROFISSIONAL_INATIVO`: "Escolher" com profissional inativo.
- 409 `LIMITE_DA_APLICACAO_EM_MASSA`: "Todos" com mais de 200 ativos.
- 404: profissional escolhido que não existe ou é de outro estabelecimento.
- 400: corpo inválido, inclusive SUBSTITUIR sem `confirmReplace: true`,
  `REMOVE` em PRESERVAR, `REMOVE` sem `confirmRemoveExceptions: true` e, na
  edição individual, `REMOVE` sem regra geral ou sem impressão.

## Impressão da prévia (`fingerprint`)

SHA-256 de um JSON canônico com o pedido (`target`, `mode`, regra e a
escolha das exceções) e, por profissional do alcance em ordem de id, `id`,
`active`, `stored`, `receivesCommission`, `defaultType`, `defaultValue` e as
exceções (`serviceId`, tipo e valor, em ordem de serviço). As exceções entram
sempre, mesmo mantendo-as: uma exceção criada, alterada ou apagada depois da
prévia a torna desatualizada. A aplicação recalcula sobre o estado travado e
recusa com 409 se diferir. Na edição individual, `impressaoDasExcecoes`
(`commission-exceptions.ts`) faz o mesmo só com as exceções do profissional. Uma segunda aplicação do
mesmo pedido (rede caiu, clique repetido) recebe 409 e a tela mostra a prévia
nova, em que tudo já aparece "sem mudança": é idempotente pelo estado.

## Concorrência

- A aplicação, numa transação, trava TODOS os profissionais do alcance com
  `SELECT ... ORDER BY id FOR UPDATE` (ordem fixa: duas aplicações simultâneas
  não se travam mutuamente) e só depois lê as configurações e as exceções, em
  instruções separadas (a mesma lição de `commission-accrual.ts`: um JOIN que
  esperou a trava traria a configuração antiga). Grava a configuração e apaga
  as exceções na mesma transação: falhando a remoção, a regra geral também não
  muda.
- `setRule`/`clearRule` travam o mesmo profissional: nenhuma exceção muda
  entre a leitura e a gravação, e uma mudança de exceção em curso faz a
  aplicação esperar e recusar com 409. A edição individual com `REMOVE` lê as
  exceções depois de travar o profissional.
- Serializa com `setSettings`/`setRule` (mesmo `FOR UPDATE` por profissional)
  e com a apuração (`FOR KEY SHARE`): uma conclusão nunca vê a aplicação pela
  metade.
- Duas aplicações simultâneas com a mesma prévia: a segunda espera a primeira
  e recebe 409 `PREVIA_DESATUALIZADA` se a primeira mudou alguém.

## Auditoria

Sem enum novo. Um `COMMISSION_RULE_CHANGED` por profissional alterado, na
mesma transação: "Comissão de Ana (aplicação em massa, substituir): não
recebe → recebe, regra geral 10.00%." `newData.bulk` leva `operationId`,
`mode` e `exceptions`, para agrupar a operação. Preservados e sem mudança não
geram linha.

Remoção de exceções (em massa ou individual): na mesma linha do profissional,
com o resumo "...; exceção por serviço removida: Corte sem comissão." (ou "2
exceções por serviço removidas: ..."), `previousData.exceptions` e
`newData.removedExceptions` com serviço, nome e regra de cada exceção. Se só
as exceções mudaram, a configuração aparece como "(sem mudança)".

## Tela

`/conta/configuracoes/profissionais/comissao-em-massa` (dono com
`COMISSOES_CONFIGURAR`), aberta por "Aplicar comissão a vários" em
Profissionais.

- Formulário: alcance ("Todos os profissionais ativos" ou "Escolher"), regra
  geral (percentual ou fixo e valor) e modo (PRESERVAR, o padrão, ou
  SUBSTITUIR).
- Em SUBSTITUIR: "Manter exceções por serviço (padrão)" ou "Remover exceções
  por serviço", com o lembrete de que substituir sozinho não remove exceções.
  Voltar a PRESERVAR volta a manter.
- Prévia: contadores (serão alterados, preservados, sem mudança e, removendo,
  exceções removidas) e, por profissional, comissão atual, nova comissão,
  resultado e as exceções ("1 exceção mantida: Corte (40%)" ou "1 exceção
  será removida: ...").
- Aviso fixo: comissões já apuradas não mudam; exceções continuam valendo, a
  não ser que se escolha removê-las ao substituir.
- SUBSTITUIR: caixa de confirmação explícita, explicando que as
  configurações gerais individuais serão substituídas e "Recebe comissão"
  será ligado (e se as exceções ficam ou saem). Removendo, uma segunda caixa
  lista quem perde quais exceções e pede a confirmação da remoção; aplicar só
  habilita com as duas.
- Mudar qualquer campo invalida a prévia. 409 de prévia desatualizada recarrega
  a prévia e pede nova revisão.
- Depois de aplicar: o resultado da operação por profissional.
- Tokens do tema, claro e escuro, alvos de 44 px, sem rolagem horizontal em
  360 px.

Edição individual (`/conta/configuracoes/profissionais/[id]/comissoes`), no
cartão "Comissão do profissional", quando há exceções: a mesma escolha
(manter é o padrão; remover fica indisponível sem regra geral), a lista das
exceções que saem e a confirmação; o botão vira "Salvar e remover exceções" e
só habilita confirmado. A confirmação vale para a impressão mostrada: se o
servidor responder `EXCECOES_DESATUALIZADAS`, a tela relê as regras (sem
desmontar o cartão), mostra a lista nova e pede confirmação de novo. Os
editores por serviço recomeçam quando a exceção muda por fora.

## Validação

- Unitários backend: `planejarAplicacao` (todas as linhas da tabela,
  inclusive remover), impressão (estável, sensível a cada campo e a cada
  exceção), `impressaoDasExcecoes`, DTO (limites, repetição,
  `confirmReplace`, `exceptions` e `confirmRemoveExceptions` na massa e na
  edição individual).
- HTTP e2e (`test/commissions.e2e-spec.ts`): rotas registradas, 200 em POST,
  pipe de validação e mapeamento de 404/409.
- db-e2e (`test/commissions-postgres.db-e2e-spec.ts`): os dois modos com
  todos os casos da tabela; inativos fora de "Todos"; exceções e apurações
  intactas e precedência mantida na conclusão seguinte; auditoria; 409 com
  prévia desatualizada; duas aplicações simultâneas; aplicação espera uma
  conclusão em curso e vice-versa (`pg_blocking_pids`); 200 profissionais;
  201 recusado; isolamento e acesso. Exceções:
  - Ana Luiza com regra geral de 20% e exceção de 15% na barba: mantendo, a
    barba apura 15%; removendo, 20%; o já apurado não muda; 409
    `EXCECOES_DESATUALIZADAS` se uma exceção mudou depois da leitura;
    permissão, isolamento e auditoria da remoção;
  - Ana Luiza 20%, Lucas 10% e Marcos R$ 15 configurados um a um (escolhidos);
    Marcos sem exceções apura R$ 15 em cada serviço (42,50, 25,00 e sob
    consulta);
  - em massa removendo exceções só dos escolhidos: prévia com quais e
    quantas, impressão de "manter" recusada, atomicidade (gatilho que faz a
    remoção falhar deixa a regra geral como estava), exceções de quem ficou
    fora e de outro estabelecimento intactas, auditoria, 409 quando uma
    exceção muda antes da aplicação (mantendo ou removendo);
  - aplicação removendo exceções espera um `setRule` em curso e recusa com
    409 (`pg_blocking_pids`).
- Isolamento HTTP (`isolamento-estabelecimentos-postgres`): as duas rotas na
  lista.
- Web: regras de tela (`src/lib/profissionais/comissao-em-massa.test.ts`,
  `excecoes-de-comissao.test.ts`) e contrato (`comissoes-api.test.ts`,
  `comissoes-em-massa-api.test.ts`).
- Navegador (`npm run test:browser:comissoes-em-massa`): prévia, PRESERVAR,
  SUBSTITUIR com confirmação mantendo exceções, 409 por mudança paralela,
  SUBSTITUIR removendo exceções só da escolhida (duas confirmações), edição
  individual removendo exceções com 409 por mudança paralela e nova
  confirmação, capturas claro/escuro em 1280/390/360 px.

## Estado e retomada

- Feito (09/11/2026, branch `feat/comissoes-aplicacao-em-massa`):
  - backend: `commission-bulk.ts` (resultado, impressão, resumo), DTOs,
    `previewBulkSettings`/`applyBulkSettings` e as duas rotas;
  - web: contrato em `src/lib/api/comissoes-em-massa-api.ts`, regras de tela
    em `src/lib/profissionais/comissao-em-massa.ts`, página
    `comissao-em-massa` e o atalho em Profissionais. `lerValor` saiu do
    cartão de comissão para `comissoes-api.ts`, para as duas telas usarem a
    mesma leitura;
  - testes: unitários (backend e web), HTTP e2e novo
    (`test/commissions.e2e-spec.ts`), 7 casos db-e2e novos, as duas rotas no
    isolamento, suíte de navegador nova (`test:browser:comissoes-em-massa`)
    com passo próprio no CI.
- Feito (09/11/2026, mesma branch, segunda etapa do PR #102): escolha de
  manter ou remover as exceções por serviço.
  - backend: `commission-exceptions.ts` (escolha e impressão das exceções),
    `planejarAplicacao` com `REMOVE`, impressão da prévia com as exceções,
    remoção atômica na aplicação em massa e na edição individual
    (`setSettings`), 409 `EXCECOES_DESATUALIZADAS`, `exceptionsFingerprint`
    na leitura das regras e auditoria das remoções;
  - web: `src/lib/profissionais/excecoes-de-comissao.ts` (textos e regras),
    `src/components/conta/escolha-de-excecoes.tsx` (escolha e confirmação),
    cartão de comissão do profissional e tela em massa (o alcance saiu para
    `escolha-de-alcance.tsx`, para a página caber no limite de linhas); a
    página do profissional não desmonta durante a releitura;
  - testes: unitários e HTTP e2e ampliados, 4 casos db-e2e novos, suíte de
    navegador ampliada (remoção em massa e individual).
- Validação local (PostgreSQL 18 descartável com TLS, dados fictícios), no
  estado final:
  - backend: 118 arquivos de unitários (1934 testes), 14 arquivos de HTTP e2e
    (150 testes) e db-e2e completo em banco novo (30 arquivos, 294 testes);
  - web: 95 arquivos de unitários (948 testes), `lint`, `lint:types` e `tsc`;
  - navegador: `comissoes-em-massa` (1), `comissoes` (1) e `professionals` (3);
  - mutação: sem o `FOR UPDATE` da aplicação, o caso de trava falha; sem as
    exceções na impressão da prévia, os dois casos de exceção mudada antes da
    aplicação falham.
- Não feito: publicação. Não há migration nem kit: API e web saem juntas,
  pelo roteiro normal, quando o dono autorizar.
- Próximo passo: CI do PR verde no head final, revisão e merge autorizado.
- Só neste computador: o cluster descartável no scratchpad da sessão (porta
  55436), recriável como no CI.
