# Portal: clientes e internos/teste

Separa, no portal da plataforma, os **clientes** (estabelecimentos que usam o
Agenda Cloud) dos estabelecimentos **internos/teste**. "Cliente" aqui é o
estabelecimento, nunca a pessoa que agenda um serviço.

Reaproveita o que o lote anterior criou
(`docs/plans/estabelecimento-teste-e-slugs-reservados.md`): a coluna
`tenants.is_test`, a rota `PUT /platform/establishments/:tenantId/test-flag`,
a capacidade `manageEstablishments` e a auditoria `TENANT_TEST_FLAG_CHANGED`.
Sem migration, sem campo ou enum novo. Internos e testes formam um grupo só.

## Decisões

- **Alcance** (`scope`): `CLIENTS` (padrão, `is_test = false`), `INTERNAL`
  (`is_test = true`) e `ALL`. A regra fica em uma fonte só:
  `matchesScope`/`scopeSql` em `backend/src/platform/portal-overview.ts`.
- **Lista** (`GET /platform/establishments?scope=`): o mesmo WHERE serve à
  contagem e à página, então total e paginação seguem o alcance. O filtro de
  acesso (`filter`) é calculado só dentro do alcance. O `summary` usa o
  mesmo alcance (sem busca nem filtros). A resposta traz o `scope` aplicado.
- **Visão geral** (`GET /platform/overview?scope=`): totais, "Precisa de
  atenção" e pagamentos do mês, todos no mesmo alcance. A resposta traz o
  `scope`. Corpo estrito: parâmetro desconhecido é 400.
- **Pagamentos** (`/portal/pagamentos`): não mudou neste lote. É o extrato
  completo, de todos os estabelecimentos, inclusive os internos/teste. O total
  dele pode ser diferente do total de pagamentos do mês na Visão geral, que
  segue o alcance escolhido. A tela da Visão geral diz isso.
- **Tela**: seletor "Clientes / Internos/teste / Todos" na lista e na Visão
  geral, guardado na URL (`alcance`, omitido quando é o padrão). Os links dos
  indicadores levam o alcance para a lista. Os itens marcados têm o selo
  "Interno/teste" na lista e na ficha.
- **Marca na ficha**: o mesmo controle de antes, com texto novo. Ele explica
  que o estabelecimento sai da lista padrão e dos números de clientes, que a
  página pública sai da busca (`noindex`) mas continua acessível pelo link, e
  que cobrança, plano e limites não mudam. Os textos da auditoria passaram a
  dizer "interno/teste".
- **Permissões**: nada novo. Ler o portal continua exigindo o acesso da
  plataforma, e marcar exige `manageEstablishments`, conferido na transação.
  Dono, gerente e equipe recebem 403 e não mudam a classificação.
- **Sem classificação automática.** `is_test = false` é o padrão técnico da
  coluna. Um cadastro antigo aparece em "Clientes" até alguém marcá-lo, e
  isso não comprova que ele foi conferido como cliente real. A tela diz isso
  no texto do alcance "Clientes" e no cartão da ficha.

## Compatibilidade e ordem de publicação

**A API vai antes do web**, no mesmo roteiro de sempre
(`docs/runbooks/publicacao-piloto-render.md`). Não há migration.

- **Web novo com API antiga**: a API antiga não devolve `scope`. Nesse caso
  a tela **não** afirma que os números ou a lista são só de clientes. Ela
  mostra o aviso "Alcance não confirmado pelo servidor…", e o indicador
  total volta a se chamar "Estabelecimentos cadastrados"
  (`alcanceConfirmado` em `src/lib/administracao/diretorio.ts`). A tela
  nunca recorta no navegador a página recebida. No alcance padrão, o web não
  envia `scope`, então a API antiga responde normalmente (com todos). Pedir
  "Internos/teste" ou "Todos" à lista da API antiga dá 400 (corpo estrito),
  e a tela mostra o erro, nunca zero.
- **API nova com web antigo**: o web antigo não envia `scope`, então recebe
  só clientes, e o texto antigo ("podem incluir contas de teste") continua
  verdadeiro, só que mais cauteloso do que precisa.

## Fora deste lote

Relatórios por período, 2FA, redesign da página inicial, indicadores novos,
mudanças em cobrança, planos ou limites, e alcance no extrato de pagamentos.

## Testes

- Backend unitário: `matchesScope`/`scopeSql` e totais por alcance
  (`portal-overview.spec.ts`); DTO com padrão `CLIENTS`, valores inválidos e
  corpo estrito, e WHERE gerado (`platform.spec.ts`).
- Backend HTTP sem banco: `scope` repassado e valores inválidos dão 400
  (`test/platform.e2e-spec.ts`).
- Banco descartável (`test/portal-visao-geral-postgres.db-e2e-spec.ts`):
  com 3 clientes e 2 internos fictícios, `pageSize=2`, confere lista e
  paginação por alcance, `summary` (clientes + internos = todos), filtro de
  acesso dentro do alcance, diferença dos indicadores e dos pagamentos do mês
  por alcance, e marcar/desmarcar pela rota (muda de grupo, auditoria com
  texto novo). Também confere que o dono do estabelecimento recebe 403 em
  todos os alcances e na marca.
- Web: `alcanceConfirmado`, textos, contratos com e sem `scope`, rotas
  (`src/lib/administracao/*.test.ts`).
- Navegador: `portal-visao-geral-flow` (alcance na Visão geral e na lista,
  selo, API sem `scope`) e `administracao-flow` (marcar/desmarcar na ficha e
  a lista relida).

## Estado e retomada

- **Feito** (branch `feat/portal-clientes-internos`, a partir de `43ed0f9`):
  backend, web, testes e documentação acima.
- **Não feito**: alcance no extrato `/portal/pagamentos` (fica de propósito
  como extrato completo); classificar os cadastros antigos, que é tarefa
  manual no portal, depois da publicação.
- **Próximo passo**: PR para `integration/nestjs-typeorm-frontend`, com o CI
  verde no head final. A publicação vai separada da de comissões (`5d74556`):
  API, depois web, no mesmo SHA.
- **Só neste computador**: nada.
