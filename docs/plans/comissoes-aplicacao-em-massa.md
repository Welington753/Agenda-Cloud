# Aplicação de comissões em massa

Base: integration `8e8577d` (Portal AC, #100). Nenhuma migration nova: usa as
tabelas das migrations 15 (`ProfessionalCommissions`, `commission_rules` e
`commission_entries`) e 16 (`ProfessionalCommissionSettings`,
`professional_commission_settings`).

## Pedido

O dono aplica uma mesma regra geral (percentual do preço de cada serviço ou
valor fixo por serviço realizado) a vários profissionais de uma vez, com
prévia antes de gravar.

Decisões aprovadas:

1. **Modo SUBSTITUIR (`REPLACE`):** troca a regra geral de cada profissional
   do alcance e liga "Recebe comissão", mesmo que estivesse desligado.
2. **Modo PRESERVAR (`PRESERVE`):** mantém intactas as configurações gerais
   existentes, inclusive de quem tem "Recebe comissão" desligado. Só recebe a
   regra nova quem recebe comissão e não tem regra geral (com ou sem linha em
   `professional_commission_settings`).
3. **Exceções por serviço** (`commission_rules`) não mudam e continuam
   prevalecendo sobre a regra geral (`regraEfetiva`).
4. **Alcance "Todos":** só profissionais ativos. Inativos ficam de fora.
   "Escolher" aceita só profissionais ativos do estabelecimento.
5. **Comissões já apuradas** (`commission_entries`) não mudam: a regra nova
   vale só para as próximas conclusões.

## Resultado por profissional (função pura)

`planejarAplicacao` (`backend/src/commissions/commission-bulk.ts`), a partir
da configuração atual (`stored`, `receivesCommission`, `defaultRule`):

| Modo | Configuração atual | Resultado | Depois |
| --- | --- | --- | --- |
| SUBSTITUIR | gravada, recebe, regra igual à nova | `UNCHANGED` | igual |
| SUBSTITUIR | qualquer outra (inclusive sem linha, desligado) | `CHANGE` | recebe, regra nova |
| PRESERVAR | recebe, sem regra geral (com ou sem linha) | `CHANGE` | recebe, regra nova |
| PRESERVAR | recebe, regra igual à nova | `UNCHANGED` | igual |
| PRESERVAR | recebe, outra regra geral | `PRESERVE` | igual |
| PRESERVAR | não recebe | `PRESERVE` | igual (continua desligado) |

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
  "fingerprint": "<64 hex>",             // só na aplicação: o da prévia
  "confirmReplace": true                 // só na aplicação em REPLACE: obrigatório
}
```

Resposta (prévia e aplicação): `fingerprint`, `summary` (`change`,
`preserve`, `unchanged`, `total`) e, por profissional, `professional`,
`current`, `next` e `outcome`. A aplicação acrescenta `applied: true` e
`operationId`.

Recusas com `code` (a tela decide pelo código, nunca pelo texto):

- 409 `PREVIA_DESATUALIZADA`: a configuração de algum profissional do alcance,
  o próprio alcance ou o pedido mudou desde a prévia.
- 409 `PROFISSIONAL_INATIVO`: "Escolher" com profissional inativo.
- 409 `LIMITE_DA_APLICACAO_EM_MASSA`: "Todos" com mais de 200 ativos.
- 404: profissional escolhido que não existe ou é de outro estabelecimento.
- 400: corpo inválido, inclusive SUBSTITUIR sem `confirmReplace: true`.

## Impressão da prévia (`fingerprint`)

SHA-256 de um JSON canônico com o pedido (`target`, `mode`, regra) e, por
profissional do alcance em ordem de id, `id`, `active`, `stored`,
`receivesCommission`, `defaultType` e `defaultValue`. A aplicação recalcula
sobre o estado travado e recusa com 409 se diferir. Uma segunda aplicação do
mesmo pedido (rede caiu, clique repetido) recebe 409 e a tela mostra a prévia
nova, em que tudo já aparece "sem mudança": é idempotente pelo estado.

## Concorrência

- A aplicação, numa transação, trava TODOS os profissionais do alcance com
  `SELECT ... ORDER BY id FOR UPDATE` (ordem fixa: duas aplicações simultâneas
  não se travam mutuamente) e só depois lê as configurações, em instrução
  separada (a mesma lição de `commission-accrual.ts`: um JOIN que esperou a
  trava traria a configuração antiga).
- Serializa com `setSettings`/`setRule` (mesmo `FOR UPDATE` por profissional)
  e com a apuração (`FOR KEY SHARE`): uma conclusão nunca vê a aplicação pela
  metade.
- Duas aplicações simultâneas com a mesma prévia: a segunda espera a primeira
  e recebe 409 `PREVIA_DESATUALIZADA` se a primeira mudou alguém.

## Auditoria

Sem enum novo. Um `COMMISSION_RULE_CHANGED` por profissional alterado, na
mesma transação: "Comissão de Ana (aplicação em massa, substituir): não
recebe → recebe, regra geral 10.00%." `newData.bulk` leva `operationId` e
`mode`, para agrupar a operação. Preservados e sem mudança não geram linha.

## Tela

`/conta/configuracoes/profissionais/comissao-em-massa` (dono com
`COMISSOES_CONFIGURAR`), aberta por "Aplicar comissão a vários" em
Profissionais.

- Formulário: alcance ("Todos os profissionais ativos" ou "Escolher"), regra
  geral (percentual ou fixo e valor) e modo (PRESERVAR, o padrão, ou
  SUBSTITUIR).
- Prévia: contadores (serão alterados, preservados, sem mudança) e, por
  profissional, comissão atual, nova comissão e resultado, com rótulo e ícone.
- Avisos fixos: exceções por serviço e comissões já apuradas não mudam.
- SUBSTITUIR: caixa de confirmação explícita, explicando que as
  configurações gerais individuais serão substituídas e "Recebe comissão"
  será ligado.
- Mudar qualquer campo invalida a prévia. 409 de prévia desatualizada recarrega
  a prévia e pede nova revisão.
- Depois de aplicar: o resultado da operação por profissional.
- Tokens do tema, claro e escuro, alvos de 44 px, sem rolagem horizontal em
  360 px.

## Validação

- Unitários backend: `planejarAplicacao` (todas as linhas da tabela),
  impressão (estável, sensível a cada campo), DTO (limites, repetição,
  `confirmReplace`).
- HTTP e2e (`test/commissions.e2e-spec.ts`): rotas registradas, 200 em POST,
  pipe de validação e mapeamento de 404/409.
- db-e2e (`test/commissions-postgres.db-e2e-spec.ts`): os dois modos com
  todos os casos da tabela; inativos fora de "Todos"; exceções e apurações
  intactas e precedência mantida na conclusão seguinte; auditoria; 409 com
  prévia desatualizada; duas aplicações simultâneas; aplicação espera uma
  conclusão em curso e vice-versa (`pg_blocking_pids`); 200 profissionais;
  201 recusado; isolamento e acesso.
- Isolamento HTTP (`isolamento-estabelecimentos-postgres`): as duas rotas na
  lista.
- Web: regras de tela (`src/lib/profissionais/comissao-em-massa.test.ts`) e
  contrato (`comissoes-api.test.ts`).
- Navegador (`npm run test:browser:comissoes-em-massa`): prévia, PRESERVAR,
  SUBSTITUIR com confirmação, 409 por mudança paralela, capturas claro/escuro
  em 1280/390/360 px.

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
- Validação local (PostgreSQL 18 descartável com TLS, dados fictícios):
  - backend: 118 arquivos de unitários (1896 testes), 14 arquivos de HTTP e2e
    (146 testes) e db-e2e completo em banco novo (30 arquivos, 290 testes);
  - web: 94 arquivos de unitários (941 testes), `lint`, `lint:types` e `tsc`;
  - navegador: `comissoes-em-massa` (1), `comissoes` (1) e `professionals` (3);
  - mutação: sem o `FOR UPDATE` da aplicação, o caso de trava falha.
- Não feito: publicação. Não há migration nem kit: API e web saem juntas,
  pelo roteiro normal, quando o dono autorizar.
- Próximo passo: CI do PR verde no head final, revisão e merge autorizado.
- Só neste computador: o cluster descartável no scratchpad da sessão (porta
  55436), recriável como no CI.
