# "Recebe comissão" e regra geral por profissional

Base: integration `92cc6ae` (comissões do #91). Uma migration nova, a 16ª:
`ProfessionalCommissionSettings1793577600000`.

## Pedido

- O dono decide, por profissional, se ele recebe comissão ("Recebe comissão").
- Desligado: nenhuma apuração nova para o profissional, quaisquer que sejam as
  regras guardadas. O histórico fica.
- Ligado: regra geral opcional, percentual sobre o preço de cada serviço ou
  valor fixo por serviço realizado, com exceções por serviço (percentual, fixo
  ou "sem comissão").
- Funcionário não altera regras nem liga a própria comissão.
- Profissionais e regras existentes mantêm exatamente o comportamento; nada é
  recalculado. Planos, permissões e repasses ficam como estão.

## Precedência (apuração e tela, a mesma função)

`regraEfetiva` (`backend/src/commissions/commission-calculation.ts`), por item
da reserva:

1. exceção do serviço (linha em `commission_rules`), inclusive "sem comissão"
   (`PERCENTAGE 0`);
2. regra geral do profissional;
3. nenhuma: "não configurada", sem valor (NULL), em conferência.

"Recebe comissão" desligado decide antes: nada é gravado. A tela recebe do
servidor a regra que valeria (`effective`) e mostra a origem; desligada, avisa
que as regras ficam guardadas, mas não geram comissão.

## Modelagem

`professional_commission_settings` (uma linha por estabelecimento e
profissional, FK composta com `CASCADE`):

| Tela | Banco |
| --- | --- |
| Não recebe | `receives_commission = false` |
| Recebe, sem regra geral | `receives_commission = true`, regra NULL |
| Recebe, regra geral | `default_type`/`default_value` (`PERCENTAGE` 1–10000 pontos-base, `FIXED` 1–100000000 centavos) |
| (sem linha) | recebe, sem regra geral: o estado anterior à regra geral |

- **Preservação:** a migration não preenche nada. Todo profissional existente
  fica sem linha e segue recebendo como antes; "não configurada" continua NULL.
- **Profissional novo:** só `ProfessionalsService.create` grava a linha
  desligada, na mesma transação. Um profissional criado pela API anterior (na
  janela entre migration e publicação) fica sem linha, como a API anterior o
  tratava.
- **`commission_entries.applied_rule_scope`** (anulável): `SERVICE` ou `DEFAULT`
  na apuração nova. Linha anterior fica NULL. O relatório lê:
  - escopo NULL com regra: "regra por serviço" (regra antiga), nunca "exceção";
  - sem regra: sem origem, em conferência ("Sem regra na conclusão").
- **Sem enum novo:** a auditoria reaproveita `COMMISSION_RULE_CHANGED`
  ("Comissão de Ana: não recebe → recebe, regra geral R$ 10.00 fixo.").
- **`down`:** recusa se houver configuração gravada ou apuração com escopo.

## Concorrência

- Quem muda regra ou configuração trava o profissional com `FOR UPDATE`
  (`commissions.service.ts`).
- A apuração trava com `FOR KEY SHARE` e só depois lê, em instrução separada,
  configuração e exceções (`commission-accrual.ts`). Em READ COMMITTED, um
  `SELECT ... FOR KEY SHARE` com JOIN que esperou o `FOR UPDATE` relê só a linha
  travada: o JOIN traria a configuração antiga com as exceções novas. O teste
  "a conclusão espera uma mudança em curso" pegou exatamente isso.
- Os testes de trava provam bloqueio, não lentidão: esperam, por
  `pg_blocking_pids`, até a outra operação estar parada na trava (a conclusão
  no `FOR KEY SHARE`; as mudanças de configuração e de exceção no
  `FOR UPDATE`), sem espera fixa. Sem a trava, falham.
- `FOR KEY SHARE` não conflita com a reserva (`FOR SHARE`) nem com a
  desativação (`UPDATE` sem chave), só com mudanças de comissão e de jornada.

## Reabertura futura (`reverterApuracao`)

A reativação de linhas `REVERSED` passa a valer nas mesmas condições de uma
apuração nova: recurso `COMISSOES` no plano e profissional recebendo. Fora
delas, a fotografia continua revertida, fora do total. Quando volta, é a MESMA
fotografia, sem recalcular, mesmo com regra ou configuração diferente. Hoje
nenhum caminho reabre um concluído.

Atendimento concluído com o profissional desligado não tem linha; religar e
repetir a conclusão não apura (a repetição sai antes, estado já é o destino).

## API

- `GET tenants/:id/commissions/rules/:professionalId`: ganha `settings` e, por
  serviço, `effective: { source, rule }`.
- `PUT tenants/:id/commissions/settings/:professionalId`:
  `{ receivesCommission, defaultRule: { kind: 'PERCENTAGE' | 'FIXED', value } | null }`.
- `GET tenants/:id/commissions/settings`: quem recebe, para a lista de
  profissionais.
- Mesma autorização das regras (`canManageCommissionRules`, recurso
  `COMISSOES`): só o dono; ids de outro estabelecimento respondem 404.

## Telas

- **Profissionais → Comissões:** cartão "Comissão do profissional"
  ("Recebe comissão" e regra geral). Por serviço, "Usar regra geral" no lugar de
  "Não configurada", com etiqueta da regra que vale e da origem.
- **Profissionais:** etiqueta "Recebe comissão" / "Não recebe comissão", com
  ícone, para quem configura comissões.
- **Relatórios** (dono e funcionário): origem do item ("exceção do serviço",
  "regra geral", "regra por serviço").

## Kits de publicação

Nenhum executável de kit mudou: o da 15 continua recusando um runtime com
migrations posteriores (`ERR_MIGRATIONS_COMPILADAS_INESPERADAS`) e só serve no
commit dele. As specs históricas passaram a nomear as posteriores numa lista
explícita (`aplicar-somente-a-pendente`, `pilot-comissoes-profissionais-check`,
`lote6b2`), e a da 15 prova a recusa do kit como está. Publicar a 16 no piloto
exige kit próprio, fora deste lote.

## Validação

- Unitários backend: precedência, "sem comissão" vencendo a regra geral, fixo
  por item, estado sem linha, origem apurada, DTO, migration (up só acrescenta;
  down recusa), cadastro desligado.
- `test/commissions-postgres.db-e2e-spec.ts` (17 casos): legado igual ao #91;
  novo desligado (exceções não geram; religar e repetir não é retroativo);
  precedência apurada = a da tela; mudanças simultâneas às conclusões; trava
  nos dois sentidos (conclusão espera mudança; mudança espera apuração);
  reabertura com profissional desligado; acesso e isolamento. Mutações (ignorar
  desligado, reativar antes das condições, inverter precedência, sem escopo,
  sem trava) fazem casos falharem.
- db-e2e completo em banco novo; isolamento com as rotas novas.
- Navegador (`comissoes`, `professionals`, `services`, `equipe`,
  `working-hours`, `availability`); capturas claro/escuro em 1280/390/360 px.
- Atualização ensaiada em banco descartável: dados e apuração criados pelo
  código anterior (15 migrations), migration 16, API nova.
