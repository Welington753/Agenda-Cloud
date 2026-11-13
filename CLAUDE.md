# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

Agenda Cloud: agendamento multi-tenant para pequenos negócios. O nome exibido ao usuário é **TimVix** (`NOME_PRODUTO` em `src/lib/config.ts`); repositório, serviços e chaves técnicas continuam "Agenda Cloud". Interface, docs e mensagens de erro em português do Brasil; commits em inglês (Conventional Commits).

- **Mapa técnico** (módulos, fonte de cada regra, testes): `docs/arquitetura/mapa-tecnico.md`
- **Plano de expansão** (ordem dos próximos lotes e decisões pendentes): `docs/plans/plano-de-expansao.md`
- Cada lote tem um plano em `docs/plans/` com a seção "Estado e retomada". Leia o do lote antes de continuar.

## Estrutura

Dois projetos npm independentes, Node `>=24 <25`:

- **Raiz**: web Next.js (App Router, `src/app/`). Regras puras de tela em `src/lib/<area>/` com teste ao lado; um cliente por área em `src/lib/api/`.
  - **Área real** (sessão por cookie, API de verdade): `/conta/*` (estabelecimento); `/portal/*` (administração da plataforma, `src/lib/administracao/rotas.ts`); `/login`, `/cadastro`, `/convite` e `/redefinir-senha`; agendamento público em `/agendar/[slug]` (endereço canônico; `/<slug>` só encaminha para ele quando o slug não é da demonstração, com colisões pendentes no achado R6).
  - **Sem exceção:** nenhum arquivo da área real, inclusive `/login`, importa a demonstração. Ela entra só pela página inicial ("Ver demonstração", `/onboarding`).
  - **Guardas:** `src/lib/servicos/sem-dados-demo.test.ts` (imports diretos) e `sem-dados-demo-transitivo.test.ts` (cadeia inteira) reprovam qualquer caminho da área real até a demonstração. Pasta nova da área real entra nas listas dessas guardas.
- **`backend/`**: API NestJS + TypeORM + PostgreSQL. Um módulo por domínio em `backend/src/<area>/`.
  - `commercial/` não é módulo Nest: guarda o catálogo de planos (`plan-catalog.ts`), preços, períodos de acesso e o gate do recurso contratado (`commercial-gate.ts`). `common/tenant-authorization.ts` chama o gate depois do vínculo e antes da permissão pessoal. O plano libera pelo vínculo em `plan_features` (só migrations escrevem); uma linha em `tenant_feature_overrides` vence o plano para aquele estabelecimento.
- **Legado, não estender:** a demonstração em `localStorage` (`src/app/painel`, `master`, `profissional`, `onboarding`, `src/app/[slug]`, `src/lib/repositories`) e o Prisma (`prisma/`, `src/generated/prisma`). TypeORM é a única fonte do schema; `src/architecture-prisma-boundary.test.ts` barra import novo de Prisma.

## Onde colocar cada mudança

| Mudança | Lugar |
|---|---|
| Quem pode o quê numa área | `backend/src/<area>/<area>-access.ts` (função pura + mensagem do 403) |
| Permissão nova do gerente | `backend/src/common/manager-permissions.ts` (+ valor no enum `permission` por migration) |
| Regra de negócio e SQL | `backend/src/<area>/<area>.service.ts` |
| Forma do corpo da rota | `backend/src/<area>/<area>.dto.ts` (zod, corpo estrito) |
| Schema | migration NOVA em `backend/src/migrations/` (nunca editar uma existente; 16 migrations aplicadas no piloto, conferido em 13/11/2026) |
| Chamada à API pelo web | `src/lib/api/<area>-api.ts` (valida a forma da resposta; erro classificado pelo status; `mensagemDoBackend` para o texto) |
| Regra de tela | `src/lib/<area>/*.ts` com `*.test.ts`; componente só desenha |
| Item de menu ou seção de Configurações em `/conta` | `src/lib/conta/navegacao.ts` e `rotas.ts` (+ testes ao lado e `tests/browser/configuracoes-navegacao-flow.spec.ts`) |

**Navegação de `/conta`:** o menu de cada papel sai de `src/lib/conta/navegacao.ts` (dono: Dashboard, Agenda, Profissionais, Serviços, Clientes, Equipe e acessos, Comissões, Configurações). Endereços e grupos do índice de Configurações ficam em `src/lib/conta/rotas.ts`. Página nova entra por esses dois arquivos, sem mudar endereço existente.

- Item que depende do plano só aparece com a área correspondente em `areas` da sessão (ex.: Comissões com `COMISSOES_VER`); a tela nunca presume o plano.
- Termo do segmento ("Barbeiros" na barbearia) vem de `src/lib/conta/termos.ts`, a partir de `tenantCategory` da sessão; sem ele, "Profissionais". A terminologia de `src/lib/verticals` é da demonstração.
- Personalização só existe na demonstração: não criar link para ela na área real.

Siga os nomes do arquivo vizinho (o backend mistura inglês e português; não renomeie em massa). Uma regra tem uma fonte: antes de escrever uma checagem, procure a existente pelo mapa técnico (seção 4).

## Regras que não se negociam

- **Isolamento:** todo serviço de estabelecimento começa com `resolveAuthorizedTenant` (`backend/src/common/tenant-authorization.ts`) e usa o `tenantId` que ele devolve. Todo SQL filtra por `tenant_id`. Sem vínculo, 404, nunca 403.
- **Autorização no servidor, relida a cada requisição.** A tela só esconde; quem recusa é a API. No dono, ajuste `DENIED` só tira (`algumaNegada`); no gerente, só `GRANTED` confirmado dá (`managerCan`).
- **Transações:** quem decide algo com base numa leitura trava a linha (`FOR UPDATE`/`FOR SHARE`) na mesma transação. A garantia final é a constraint (exclusão de horário, UNIQUE), traduzida para 409.
- **Idempotência:** escrita que o usuário pode repetir (rede caiu) leva chave de pedido com UNIQUE, ou é idempotente pelo estado. Nada é reenviado sozinho pelo web.
- **Segredos:** senha, hash, token e URL de banco nunca vão para resposta, log, auditoria, teste com valor real, commit ou conversa. O DataSource de runtime usa `safe-typeorm-logger.ts`.
- **Dinheiro:** centavos inteiros (`bigint`), nunca `float`; registro financeiro não é editado, é estornado.
- **Recusa que a tela precisa distinguir** de outra com o mesmo status leva `code` no corpo; nenhuma tela decide pelo texto de `message`.

## Bancos

- Testes com banco (`test:db-e2e`, `test:browser:*`) só contra PostgreSQL **descartável com TLS** (certificado autoassinado confiado por `NODE_EXTRA_CA_CERTS`), montado como no CI (`.github/workflows/test-frontend-auth.yml`): container ou cluster local, `npm run build:migrations-runtime && npm run migration:run:compiled` em `backend/`, depois `DB_E2E_DIRECT_URL` para as suítes. Nunca Neon, nunca o piloto.
- A API recusa URL que desligue a verificação TLS; use `sslmode=verify-full`.
- Banco do piloto: só por roteiro de `docs/runbooks/` (backup, `pilot:check-database` antes e depois). `migration:show` escreve (`typeorm_migrations`): nunca num banco não conferido.

## Comandos

```bash
# web (raiz)
npm run dev                          # porta 3000
npm run lint && npm run lint:types
npm run test                         # Vitest; um arquivo: npx vitest run src/lib/api/http-client.test.ts
npx next typegen && npx tsc --noEmit # tsc precisa dos tipos gerados do Next
npm run build
npm run test:browser:<suite>         # lista em package.json; precisa da API + banco descartável

# backend/
npm run start:dev                    # porta 3001
npm run lint                         # oxlint
npm run test                         # unitários; um arquivo: npx vitest run src/team/staff-access.spec.ts
npm run test:e2e                     # HTTP sem banco
npm run test:db-e2e                  # só com DB_E2E_DIRECT_URL (descartável), serial
npx tsc --noEmit -p tsconfig.build.json   # o que o build compila
npm run typecheck                    # tipos de src, specs, test e scripts (o CI exige zero)
```

**Escolher testes:** rode os do que mudou, não a bateria inteira (tabela em `docs/arquitetura/mapa-tecnico.md`, seção 6). Política ou `common/`: specs do módulo e de quem importa. SQL ou transação: o `*.db-e2e-spec.ts` da área. Rota: `test/<area>.e2e-spec.ts`. Tela: teste em `src/lib/<area>` e a suíte de navegador da área. Só documentação: nenhum teste. O CI do PR roda tudo.

## Checkpoint, commit e publicação

- Trabalhe em branch própria a partir de `integration/nestjs-typeorm-frontend` (worktree separada se a pasta principal tiver trabalho em andamento). PR para essa branch, nunca para `main`. Merge só com o CI do PR verde no head final (`test-frontend-auth.yml` sempre que dispara; `test-migration-lote6b2.yml` quando a mudança toca migrations ou `backend/src/database/**`), sem bypass e sem force push. A branch não tem proteção no GitHub: a regra é de processo.
- Commits pequenos e coerentes; `[skip render]` em commit e título de PR que não devem publicar.
- Checkpoint: atualize a seção "Estado e retomada" do plano do lote (feito, não feito, próximo passo concreto, o que só existe neste computador) e faça push, para retomar em outra máquina.
- Publicação é manual no Render: migration (se houver, pelo runbook) → API → web, os dois no mesmo SHA. Roteiro: `docs/runbooks/publicacao-piloto-render.md`. Nunca publique, conecte ao banco real ou envie mensagem sem pedido explícito.
