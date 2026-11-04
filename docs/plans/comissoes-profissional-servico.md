# Comissão por profissional e serviço

Base: integration `6fac73c`. Uma migration nova, a 15ª:
`ProfessionalCommissions1793491200000`.

## Pedido

- Configurar, para cada serviço que o profissional atende, percentual, valor
  fixo ou "sem comissão", diferente de "não configurada".
- Apurar na conclusão do atendimento, item a item, pelo preço registrado na
  reserva, e somar. Um profissional por reserva, como hoje.
- Gravar a regra e o cálculo; mudanças posteriores não recalculam o histórico
  nem geram comissão retroativa.
- Relatório por profissional e período, sem apresentar comissão como pagamento.
  Repasses fora deste lote.

## O que já existia e foi reaproveitado

- **Catálogo:** o recurso `COMISSOES` já existia, só no plano de código `pro`
  (chamado Rede no catálogo inicial e Max desde a migration CommercialAccess).
  As rotas usam o mesmo recurso, como os recebimentos usam `PAGAMENTOS`.
- **`commission_rules`** (migration inicial, nunca gravada até aqui): uma regra
  por estabelecimento, profissional e serviço. O percentual fica em pontos-base
  e o valor fixo em centavos. Ficou como está.
- **`commission_entries`** (idem): a fotografia do cálculo, com `CONFIRMED` e
  `REVERSED`.
- **Permissões:** `COMISSOES_VISUALIZAR` e `COMISSOES_GERENCIAR` já estavam no
  enum e passaram a restringir o dono.

## Modelagem

| Tela | Banco |
| --- | --- |
| Não configurada | sem linha em `commission_rules` |
| Sem comissão | `PERCENTAGE` com valor 0 |
| Percentual | `PERCENTAGE`, 1 a 10000 pontos-base (12,5% = 1250) |
| Valor fixo | `FIXED`, de 1 centavo a R$ 1.000.000,00 |

Nas tabelas de comissão, a migration muda só `commission_entries`, que
passa a ter uma linha por serviço da reserva:

- **Coluna nova:** `appointment_item_id`, com FK composta com o tenant (nova
  `UNIQUE (tenant_id, id)` em `appointment_items`) e índice único.
- **Linhas antigas sem item:** continuam limitadas a uma por reserva, porque o
  índice antigo virou parcial.
- **Colunas que aceitam NULL:** preço, tipo, valor da regra, comissão e parte
  do estabelecimento. Assim se grava o que houve sem inventar zero. O tipo e o
  valor da regra vão sempre juntos (CHECK).
- **Enums:** `audit_action` ganha `COMMISSION_RULE_CHANGED`, e `permission`
  ganha `COMISSOES_PROPRIAS_VISUALIZAR`. É a concessão do dono ao funcionário,
  separada da permissão que restringe o dono.

**Planos.** Os nomes comerciais não são os códigos: Básico é `essencial`, Pro
é `equipe` e Max é `pro` (`backend/src/commercial/plan-catalog.ts`). A
mesma migration acrescenta uma linha a `plan_features`
(`pf_pc_equipe_comissoes`: plano `equipe`, recurso `COMISSOES`), com
`ON CONFLICT DO NOTHING`. Fica assim, em instalação nova e em banco
existente:

| Plano (código) | Comissões |
| --- | --- |
| Básico (`essencial`) | não, por padrão |
| Pro (`equipe`) | sim (novo) |
| Max (`pro`, antigo Rede) | sim (já tinha) |

- **O que não muda:** preços, limites, os outros recursos e as exceções por
  estabelecimento (`tenant_feature_overrides`). Uma exceção desligada num Pro
  continua desligando; uma ligada num Básico continua ligando.
- **Funcionário:** o recurso no plano libera a consulta e a configuração ao
  dono. Funcionário continua dependendo da concessão própria.
- **Migration já aplicada:** nenhuma foi editada. A linha entrou na 15ª, que
  ainda não rodou em banco real.
- **Interface:** as áreas vêm do servidor (`tenant-effective-access`), então a
  tela segue o catálogo sem lista própria. O site passou a listar comissões
  como disponível nos planos Pro e Max.
- **Demonstração legada:** `src/lib/planos.ts` (`/painel`, `/master`) não
  foi tocada; ela já não acompanhava os nomes Básico/Pro/Max.

O `down` recusa se houver apuração por item, para não apagar histórico, e deixa
os valores de enum. Ele remove só a linha `pf_pc_equipe_comissoes`.

### Recuperação depois da publicação

Depois da primeira apuração, o `down` não é caminho de recuperação: ele recusa,
e forçá-lo apagaria histórico. Fica proibido.

Voltar a API para a versão anterior mantém o schema novo e é aceito por ela:
a versão anterior não lê as tabelas de comissão e descarta a concessão
`COMISSOES_PROPRIAS_VISUALIZAR`. Mas isso **não é recuperação completa**, e o
impacto funcional é real:

- **Sem apuração:** atendimentos concluídos enquanto a API antiga estiver no ar
  não geram comissão. Ao voltar a API nova, eles continuam sem, porque a
  apuração só acontece na conclusão e não há preenchimento retroativo.
- **Sem relatório e sem regras:** a tela de comissões, a configuração de regras
  e a visão do funcionário deixam de funcionar. Regras e apurações já gravadas
  ficam no banco, intactas.

Use a volta da API só para conter um defeito grave, sabendo dessas lacunas, e
registre o período em que ela ficou no ar.

As entidades continuam espelhando a migration inicial (`entity-metadata.spec`),
como nas outras mudanças posteriores. A leitura e a gravação são em SQL
explícito (`backend/src/commissions/`).

## Apuração na conclusão

A apuração fica em `commission-accrual.ts`. Ela é chamada por
`applyStatusChange` quando o destino é `COMPLETED`, na mesma transação e com a
reserva travada. Vale para a conclusão pelo dono, pelo gerente e pela agenda
própria.

- **Recurso do plano:** só apura se o estabelecimento tem `COMISSOES` na hora
  da conclusão. Sem o recurso (o Básico, por padrão), a conclusão segue igual
  e nada é gravado em `commission_entries`.
- **Uma linha por item:** cada uma guarda o preço do item, a regra que valia (ou
  nenhuma), a comissão e a parte do estabelecimento.
- **Cálculo:** é inteiro, item a item. Para cada item, `floor((preço ×
  pontos-base + 5000) / 10000)`, que arredonda meio centavo para cima. O total
  é a soma dos itens. O valor fixo vale mesmo sem preço.
- **Sem valor:** sem regra, ou percentual sobre serviço "sob consulta", não há
  valor (NULL), e o item vai para conferência.
- **Comissão maior que o preço:** fica gravada sem parte do estabelecimento e
  vai para conferência.
- **Repetição:** concluir de novo sai antes, porque o estado já é o destino. A
  apuração ignora item já apurado e usa `ON CONFLICT DO NOTHING`. Duas
  conclusões simultâneas dão uma apuração só.
- **Cancelado e falta:** nunca apuram.
- **Concluído não volta atrás:** hoje `COMPLETED` é final, e cancelar um
  concluído é recusado.
- **Reabertura futura:** um lote futuro que reabra ou cancele um concluído chama
  `reverterApuracao`. A linha fica, marcada `REVERSED`, e sai do total. Concluir
  de novo reativa a mesma fotografia, sem recalcular.

## Relatório

`GET /tenants/:id/commissions?from&to&professionalId` (dono):

- **Período:** pela data local do atendimento, no mesmo formato do Início. Sem
  datas, vale o mês corrente.
- **Total apurado:** soma das apurações `CONFIRMED` de atendimentos que
  continuam concluídos. Os totais por profissional contam o período inteiro; a
  lista mostra até 200 atendimentos.
- **Conferência:** marca o item ou o atendimento, que continua no total. Os
  casos são "sem regra na conclusão", "percentual sem preço", "comissão maior
  que o preço" e "recebimento do cliente estornado". Um estorno não apaga nem
  muda a comissão.
- **Fora do total, mas listado:** apuração revertida.
- **Recebimento do cliente:** aparece separado ("cliente pagou", "sem
  recebimento registrado", "estornado"). A tela diz que comissão apurada não é
  pagamento ao profissional.

`GET /tenants/:id/my-agenda/commissions` (funcionário) mostra só as próprias
comissões, sem o recebimento do cliente. Exige `COMISSOES_PROPRIAS_VISUALIZAR`
concedida pelo dono em "Equipe e acessos" e o recurso no plano.

## Acesso

| Quem | Relatório | Regras | Próprias |
| --- | --- | --- | --- |
| Dono | ver a agenda, ver os recebimentos e `COMISSOES_VISUALIZAR` não negada | também ver profissionais e serviços e `COMISSOES_GERENCIAR` não negada | — |
| Gerente | não | não | com profissional ligado, confirmação do dono e a concessão |
| Funcionário | não | não | com a concessão |

- **Gerente:** não há concessão de comissões ao gerente neste lote.
- **Concessão ao funcionário:** só é oferecida com o recurso no plano e quando
  o próprio dono vê as comissões.
- **Ids de outro estabelecimento:** respondem como inexistentes (404).
- **Isolamento:** a spec de isolamento ganhou as cinco rotas novas.

## Telas

- **Profissionais → Comissões** (`/conta/configuracoes/profissionais/:id/comissoes`):
  uma escolha por serviço, com a regra atual em etiqueta. "0" pede "Sem
  comissão".
- **Início:** ganhou o link "Ver comissões apuradas", que abre `/conta/comissoes`
  com o período, filtro por profissional e o aviso de que não é pagamento.
- **Minha agenda:** ganhou o link "Minhas comissões" quando liberado
  (`/conta/minha-agenda/comissoes`).
- **Equipe e acessos:** ganhou a caixa "Ver as próprias comissões" na própria
  agenda, vinda do servidor.

## Validação

- **Unitários do backend:** cálculo, arredondamento, representação, DTO e
  políticas.
- **Unitários do frontend:** percentual em pontos-base sem ponto flutuante,
  rótulos e forma das respostas.
- **`test/commissions-postgres.db-e2e-spec.ts`:**
  - catálogo: Pro e Max com o recurso, Básico sem, o resto dos planos igual;
  - plano Pro: apura e consulta; exceção desligada num Pro e ligada num
    Básico; funcionário sem concessão recusado;
  - regras e histórico;
  - reserva com dois serviços, concluída em paralelo e repetida;
  - preço do catálogo mudado depois;
  - regra mudada e removida sem recalcular;
  - conclusão sem regra;
  - estabelecimento sem o recurso, depois ligado (sem retroativo);
  - cancelado, falta, cancelar concluído recusado;
  - reabertura e reativação;
  - sob consulta, acima do preço, estorno;
  - período e profissional;
  - isolamento entre estabelecimentos;
  - dono restringido;
  - gerente com tudo concedido recusado;
  - funcionário sem e com a concessão;
  - Básico: concluir segue normal, sem apuração; consulta recusada.
- **`1793491200000-ProfessionalCommissions.spec.ts`:** a linha nova é só
  `equipe` + `COMISSOES`, o Básico continua sem, e o `down` remove só ela.
- **Mutações:** sem o critério do total ou sem a proteção contra repetição, os
  casos falham.
- **`npm run test:browser:comissoes`:** no Básico, nada de comissões na tela
  nem no servidor; no Pro, regras pela tela, conclusão repetida,
  relatório, regra mudada, funcionário sem e com a concessão. Capturas em claro
  e escuro, 1280, 390 e 360 px.
- **Migration:** ensaiada em PostgreSQL 18 descartável com TLS. Foram três
  ensaios:
  - do zero, com as 15 migrations;
  - só a 15ª sobre uma base com 14 e dados;
  - `revert` e reaplicação.

## Decisões comerciais em aberto

1. **Planos:** decidido. Comissões no Pro (`equipe`) e no Max (`pro`), fora do
   Básico (`essencial`) por padrão. Um Básico só ganha por exceção individual.
2. **Período do relatório:** é pela data do atendimento. Fechar pela data da
   conclusão muda atendimentos concluídos depois da virada do mês.
3. **Arredondamento:** é meio centavo para cima, por item. Outra regra (por
   exemplo, truncar) muda centavos.
4. **Comissão fixa maior que o preço:** é aceita e sinalizada. Pode virar
   recusa.
5. **Gerente:** não há concessão para ver ou configurar comissões.
6. **Repasses ao profissional:** registro de pagamento e saldo ficam para um
   lote próprio.
7. **Cancelamento ou reabertura de atendimento concluído:** hoje não existe. O
   lote que criar isso precisa chamar `reverterApuracao`.
