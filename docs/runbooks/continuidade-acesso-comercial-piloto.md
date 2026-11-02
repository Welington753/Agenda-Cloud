# Continuidade: kit de publicação de CommercialAccess (planos e validade)

**Atualização (2ª rodada, PR #83):** o PR também corrige a compatibilidade
da aplicação (`billing` de volta na ficha, que o web publicado exige) e
define a janela sem criação de estabelecimento entre a migration e a API
nova. Ver "Estado depois da 2ª rodada" no fim.

Estado entre sessões da preparação da publicação do PR #82 (planos Básico, Pro
e Max e validade do acesso), migration `CommercialAccess1793232000000`. Nada
foi executado no piloto, no Neon ou em `agenda_dev`; nenhuma consulta ao
banco real; nenhuma mensagem enviada; Render, Auto-Deploy e backup automático
não foram tocados.

Substitui, para a publicação, a nota `continuidade-planos-validade.md` (branch
`chore/continuidade-planos-validade`, `d6eaf58`), que citava o "fluxo
protegido de `migrations-production.md`": aquele runbook é só do Lote 6B.2.

## Estado em 02/11/2026

- `integration/nestjs-typeorm-frontend` em `a2d123b` (merge do PR #82). O
  conteúdo da aplicação foi validado no PR #82 e não mudou aqui.
- Branch `feat/kit-publicacao-commercial-access`, a partir de `a2d123b`, com o
  PR deste kit para a integration. **Sem merge.**
- Commits:
  - `30aa461`: procedimento (lançador, aplicar, restauração, regras puras,
    conferência do schema, consulta de impacto, testes);
  - `9d542ae`: correção do levantamento (recurso negado só onde a migration
    não cobre). **Commit dos ensaios do procedimento;**
  - o commit seguinte: runbook, esta nota, referências ao 6B.2 corrigidas,
    consulta "validade depois" e o teste dela.
- **Piloto:** onze migrations, até `TeamManagerAccess1793145600000`. **Não as
  repita.** CommercialAccess **não** aplicada.
- **Render:** SHA Live da API e do web **não confirmado**.
- **Backup:** o código do backup agendado (PR #81) está mesclado, mas o
  backup real **não foi ativado** (nenhuma conta, bucket, chave, papel ou
  agendamento).
- **Preços:** continuam como proposta (catálogo com preço nulo).
- **Exceções de recurso desligadas no piloto:** desconhecidas. A consulta não
  foi executada; agora é feita pela fase `preparar`, que para antes do backup
  se houver alguma.
- **PR #74:** continua separado; nada aqui depende dele.

## Comprovado (dados fictícios, PostgreSQL 17.11 descartável com TLS)

Detalhes e tabelas em `publicacao-acesso-comercial-piloto.md` ("Ensaio" e
"Recuperação").

- **Procedimento:** exceção desligada, histórico e schema incompatíveis,
  preparar, restauração pelo **lançador oficial com binários 17.11**, backup e
  comprovante incompatíveis, frase errada, tabela ocupada, quedas antes e
  depois do COMMIT, conferência posterior falha, aplicação, repetição
  recusada, banco fora do ar, travas do modo piloto. `conferir` também pelo
  lançador num Windows Terminal real (teclas simuladas).
- **Só as mudanças previstas:** na cópia restaurada, todas as outras tabelas
  (contas, papéis globais, reservas, recebimentos, auditoria...) com md5
  igual; colunas antigas de `tenants` e `plans` iguais; linhas antigas de
  `plan_features` e `tenant_feature_overrides` iguais; nenhum período criado;
  nenhum recurso negado.
- **API nova com o schema anterior:** dono e funcionários não entram (500).
  A migration vem antes da API.
- **Web anterior com a API nova:** a ficha da administração não abre (o web
  anterior exige `billing`); o resto segue. Publicar o web logo depois da API.
- **API anterior (`0c44052`, candidata, não confirmada como Live) com o
  schema novo:** estabelecimento vencido **recupera acesso total** e grava;
  registros comerciais ficam invisíveis; estabelecimento criado nela nasce sem
  marca e sem teste e fica **bloqueado** quando a API nova volta. Não é
  combinação segura.
- **`down` numa cópia:** apaga todos os períodos (pagamentos, cortesias,
  testes, anulações), a marca de anterior, as exceções `tfo_ca_*` e as linhas
  `pf_ca_*`; mantém auditoria e valores de enum. Com a API nova sobre o schema
  revertido, o dono não entra. Não é recuperação.

## Testes rodados

- backend: 1.656 unitários (inclui `comercial-piloto.spec.ts` e
  `acesso-comercial-schema.spec.ts`), `tsc`, `oxlint`, `nest build`, build dos
  scripts;
- db-e2e: `pilot-commercial-access-check` e `pilot-team-manager-check` num
  banco descartável com as doze migrations;
- a validação da aplicação (PR #82) não foi repetida: o código da aplicação
  não mudou.

## Próximo passo exato

1. Revisão e decisão de merge do PR deste kit pelo dono.
2. Depois do merge: definir o SHA operacional (o merge na integration) e
   confirmar no Render o SHA Live dos dois serviços.
3. Com autorização própria para cada uma, no SHA operacional: `preparar`
   (primeira leitura do piloto, inclui as exceções desligadas) →
   `restauracao` → `aplicar` → `conferir` → API → web, pelo runbook.

## Itens só neste PC (casa)

- Worktree `C:\Projetos\Agenda-Cloud-commercial` (esta branch) e
  `C:\Projetos\Agenda-Cloud-compat-0c44052` (HEAD destacado em `0c44052`, só
  para o ensaio de compatibilidade; pode ser removida).
- Pasta principal `C:\Projetos\Agenda-Cloud` em
  `docs/continuidade-identidade-escura`, com `CLAUDE.md` modificado e não
  commitado (preservar), um stash (`fix/cancel-stale-confirmation`) e as
  worktrees `-organizacao`, `-publicacao` e `-publicacao-ar`. Nada disso foi
  alterado.
- Cluster PostgreSQL 17.11 descartável, harness de ensaio e saídas no
  scratchpad da sessão (só dados fictícios; nada vai para o repositório).

## Estado depois da 2ª rodada

- Commits novos no PR #83:
  - `4c10a2e`: `billing: { available: false }` de volta na ficha
    administrativa; contrato congelado do web `0c44052` em
    `backend/test/support/contrato-web-anterior.ts`, rodado nos db-e2e
    `platform-postgres` e `commercial-access-postgres`; levantamento com
    `SEM_MARCA_E_SEM_PERIODO` e `CONTAS_QUE_CRIAM_ESTABELECIMENTO`; `aplicar`
    anuncia a janela e `conferir` a confere (`ok` ou `VIOLADA`, saída 1).
    **Commit dos ensaios da rodada 2;**
  - o commit seguinte: runbook (janela, recuperação, rodadas e SHAs) e esta
    nota. Só documentação.
- **Janela sem criação:** começa antes da frase da `aplicar`; só criar
  estabelecimento fica indisponível (único caminho na API anterior:
  `POST /platform/establishments`); termina com a API nova Live e
  `JANELA_SEM_CRIACAO: ok` na `conferir`. Violação: regularização individual
  pelo dono (prorrogar teste ou cortesia), nunca a marca de anterior.
- **Recuperação:** voltar só o web passou a ser alternativa (ficha abre);
  defeito da API = corrigir para frente ou interrupção controlada (suspender a
  API no Render; não ensaiado); API anterior não é retorno seguro; `down` e
  restauração sobre o piloto não são recuperação padrão.
- **Comprovado localmente (rodada 2):** sequência com a API anterior no ar
  durante a migration, troca para a nova, `conferir` ok, criação com teste
  pela nova, ficha no **navegador** com o web anterior, violação detectada e
  regularizada. Detalhes no runbook, "Sequência da publicação".
- **Depende do Render e não foi ensaiado:** momento e duração da troca de
  instância no deploy, suspensão/retomada do serviço.
- **Testes:** backend 1.656 unitários, 137 e2e HTTP, `tsc`, `oxlint`, build;
  db-e2e afetados (`platform-postgres`, `commercial-access-postgres`,
  `pilot-commercial-access-check`, `pilot-team-manager-check`); conferido que
  tirar `billing` faz o contrato falhar.
- Nada no piloto, no Neon ou no Render; `0c44052` segue só candidata.

## Próximo passo exato (atualizado)

1. Revisão e decisão de merge do PR #83 pelo dono.
2. Depois do merge: SHA operacional = o merge na integration; confirmar no
   Render o SHA Live dos dois serviços; listar com o dono as contas com
   `manageEstablishments` (o `preparar` mostra quantas).
3. Com autorização própria para cada uma: `preparar` → `restauracao` →
   janela sem criação + `aplicar` → API → `conferir` (`JANELA_SEM_CRIACAO:
   ok`) → web, pelo runbook.
