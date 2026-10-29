# Continuidade: planos e validade do acesso (PR #82)

Checkpoint de 2026-10-29, feito no PC do trabalho para retomar em outro
computador. Só documentação; nada foi publicado.

## Estado no remoto

- **PR #81 (O1, backup agendado):** mesclado na integration em
  `0c44052056d95332591e02079a163d5c11b71ada`. O backup real continua
  **desativado**: nenhuma conta, bucket, chave, papel no banco, agendamento
  ou alerta foi criado.
- **PR #82 (planos e validade do acesso):** aberto, **sem merge e sem
  publicação**. Branch de origem `feat/planos-validade-acesso`, base
  `integration/nestjs-typeorm-frontend`, head revisado
  `65cece17e104481d1f894749610e19cbc5c48acb`. Os dois checks automáticos
  desse SHA passaram (migration e navegador + API). Não empurrar nada nessa
  branch sem necessidade: um push novo abre outra rodada de CI.
- Plano, decisões e checkpoint detalhado do lote:
  `docs/plans/planos-e-validade-do-acesso.md` (na branch do PR #82).

## O que o PR #82 entrega

- Planos Básico (`essencial`), Pro (`equipe`) e Max (`pro`), com códigos e
  ids preservados. **Preços são só proposta**: o catálogo continua com
  preço nulo.
- Controle de validade (teste, pago, cortesia), registro manual de
  pagamento, prorrogação, cortesia e correção de registro feito por engano;
  estabelecimentos existentes marcados como anteriores ao controle
  ("Validade ainda não definida"); aviso de vencimento dentro do app.

## Pendências antes e durante a publicação

- A migration nova **`CommercialAccess1793232000000` está pendente no
  piloto**. Rodar só ela, pelo fluxo protegido de
  `docs/runbooks/migrations-production.md`. **Nenhuma das 11 migrations
  existentes deve ser repetida.**
- Antes da migration, conferir as exceções de recurso desligadas:
  `SELECT count(*) FROM tenant_feature_overrides WHERE enabled = false`
  (esperado 0). **Essa consulta ao banco real ainda não está autorizada**:
  fica registrada só como pendência.
- Publicação: API antes do web, do mesmo commit.
- **SHA Live no Render não confirmado** nesta sessão.

## Próximo passo

Decisão de merge do PR #82 pelo dono. Publicação, migration e qualquer
operação no banco real são etapas posteriores, cada uma com autorização
própria.

## Itens que existem só no PC do trabalho

- Pasta principal `C:\Projetos\Agenda-Cloud` na branch
  `feat/senha-dono-calendario-profissional`, com `CLAUDE.md` modificado e
  não commitado (preservar).
- Worktrees locais: `Agenda-Cloud-planos` (`feat/planos-validade-acesso`,
  em dia com o remoto), `Agenda-Cloud-o1`, `Agenda-Cloud-promocao`,
  `Agenda-Cloud-recebimentos` (1 commit atrás do remoto, não mexido),
  `Agenda-Cloud-reserva` e quatro em HEAD destacado (`-ensaio`,
  `-ensaio-pr2`, `-publicacao`, `-publicacao-gerente`).
- Nenhum stash.
- Cluster PostgreSQL 18 descartável no scratchpad da sessão (parado; dados
  só de teste) e as capturas dos testes de navegador. Nada disso vai para o
  repositório.
