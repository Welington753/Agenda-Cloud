# Continuidade: portal da plataforma (#84) e vários serviços (#85)

Checkpoint de 2026-11-03. Nada foi mesclado, publicado ou aplicado em banco
real. Nenhuma mensagem foi enviada.

## 1. Estado de produção e do piloto (não mudou neste lote)

- API e web publicados em `99242a662cfa2a8bb3b144b62c2fe5fe000ee222`.
- CommercialAccess1793232000000 aplicada e conferida: piloto com **12
  migrations**. Não repetir nem reverter nenhuma.
- Já existem registros comerciais posteriores à aplicação (um teste até
  06/12/2026, um estabelecimento no Max). Não assumir zero períodos nem todos
  no Pro.
- Backup automático continua desativado.
- Base da integration (`integration/nestjs-typeorm-frontend`):
  `99242a662cfa2a8bb3b144b62c2fe5fe000ee222`.

## 2. PRs

| PR | Branch | Head (CI verde) | Base | Estado |
| --- | --- | --- | --- | --- |
| [#84](https://github.com/Welington753/Agenda-Cloud/pull/84) | `feat/portal-plataforma` | `e1a8f9d449e1672c61d6cbd6d60636cdececbbf8` | integration em `99242a6` | aberto, sem merge |
| [#85](https://github.com/Welington753/Agenda-Cloud/pull/85) | `feat/agendamento-multiplos-servicos` | `27e4eff88741cc16d5f226dc6176c14796a8eb87` | integration em `99242a6` | aberto, sem merge |

Nos dois heads, os dois checks exigidos passaram: "auth real e serviços
reais (navegador + API) contra PostgreSQL descartável" e
"migration:show/run reais contra PostgreSQL descartável". No #85, a
primeira execução do head falhou antes dos testes (o PostgreSQL do container
ainda não aceitava conexão no passo de TLS); o job foi reexecutado e passou.

PR #74 continua aberto e intocado.

## 3. Entrega 1 — portal da plataforma (#84)

Decisões em `docs/plans/portal-da-plataforma.md` (no branch do PR).

- Portal em `/plataforma`, com layout e menu próprios; `/administracao/**` e
  `/conta/administracao/**` só encaminham. A autorização é do servidor.
- **Só conta ativa com `MASTER_OWNER`.** `MASTER_ADMIN` e `MASTER_SUPPORT`
  ficam no banco, mas deixam de abrir qualquer coisa; só o papel de
  proprietário pode ser atribuído (DTO e serviço). Dono, gerente e
  profissional de qualquer plano (inclusive Max) são recusados em todas as
  rotas. A proteção do último proprietário continua.
- `GET /platform/requests/:key` passou a exigir proprietário.
- `POST /platform/reauth` **continua acessível a qualquer sessão
  autenticada**: o dono do estabelecimento confirma a senha por ela antes das
  ações sensíveis de equipe e recebimentos. Ela só marca a própria sessão e
  não concede nada.
- Ativo/Inativo reaproveita suspender/reativar; inativo prevalece; reativar
  não perdoa vencimento.
- "Sem vencimento" (`tenant_no_expiry_grants`): motivo, confirmação,
  auditoria, consequência mostrada antes de retirar; retirar não devolve a
  exceção de legado; não é pagamento, não libera recurso fora do plano, não
  muda papel.
- Preços: catálogo mensal/trimestral por plano (`plan_prices`), contrato por
  cliente (`tenant_contract_prices`), origem do valor no pagamento decidida no
  servidor (`amount_source`), ajuste só do pagamento × alterar o contrato,
  pendente nunca vira zero, histórico não recalculado. Mapeamento mantido:
  Básico=`essencial`, Pro=`equipe`, Max=`pro`.
- **Preços não aprovados e não cadastrados.** A migration não grava preço.

## 4. Entrega 2 — vários serviços (#85)

Decisões em `docs/plans/agendamento-multiplos-servicos.md` (no branch do PR).

- Uma reserva, um item congelado por serviço (nome, preço, duração, ordem);
  mesmo profissional, que faz todos; duração = soma; intervalo = o maior;
  conflito e disponibilidade no intervalo completo; tudo recalculado no
  servidor; total sob consulta se algum item for sob consulta; até 6.
- Interno, público, detalhes, agenda, remarcação, cancelamento,
  recebimentos, visão geral e agenda própria cobertos; restrições de preço e
  contato do gerente mantidas.
- **Limitação:** itens de reservas antigas não têm o nome congelado
  (`service_name_snapshot` nulo) e mostram o nome atual do serviço. Nada é
  inventado.
- Na tela interna, o serviço pré-marcado é o primeiro vínculo do
  profissional, cuja ordem não é fixa.

## 5. Migrations novas — NÃO aplicadas no piloto

- `PlatformPortal1793318400000` (#84): 3 tabelas, coluna
  `tenant_access_periods.amount_source`, 4 valores de `audit_action`.
- `AppointmentServiceSnapshots1793404800000` (#85): coluna anulável
  `appointment_items.service_name_snapshot`.

Pendências antes de publicar:

1. Procedimento protegido de cada uma (backup, `pilot:check-database` antes e
   depois, aplicar só a migration do lote), no padrão dos kits anteriores.
   Ainda não escrito.
2. As duas são independentes, mas quem for integrado depois precisa ajustar
   as listas de migrations nos testes
   (`backend/scripts/lote6b2-migration.migration-e2e-spec.ts` e a contagem em
   `backend/src/database/migrations-runtime-compiled.spec.ts`).
3. Conferir, só com leitura, quais contas reais têm `platform_role`. O papel
   sozinho não prova que as contas são de Welington e Leonardo: confirmar a
   identidade de cada conta. Qualquer `MASTER_ADMIN`/`MASTER_SUPPORT` perde o
   portal com a API nova. Nenhum papel foi alterado.
4. Publicação: migration, depois API, depois web, do mesmo SHA.
5. Cadastrar pelo portal só preços aprovados.

## 6. Testes realmente executados (local, PostgreSQL 17 descartável com TLS)

#84:
- backend: 1.659 unitários, 137 e2e HTTP, `tsc`, `oxlint`, `nest build`;
  13 migrations aplicadas em banco novo;
- `platform-portal-postgres.db-e2e-spec.ts`: 5/5;
- suíte completa `db-e2e`: **232/233**. A falha (`team-manager-postgres`,
  reautenticação) passou em duas execuções isoladas. Registrada como
  **possível instabilidade**, causa não comprovada;
- web: 883 unitários, `tsc`, `eslint`, `lint:types` (só avisos), `next build`;
- navegador: `administracao` 2/2, `contas` 2/2, `equipe` 1/1.

#85:
- backend: 1.662 unitários, 137 e2e HTTP, `tsc`, `oxlint`, `nest build`;
- `multi-services-postgres.db-e2e-spec.ts`: 8/8; suíte completa 234/236 na
  primeira rodada (as 2 eram a forma exata do recibo público, atualizada; a
  suíte pública passou 19/19 depois);
- web: 884 unitários, `tsc`, `eslint`, `lint:types` (só avisos antigos);
- navegador: `appointments` 5/5 (3 vezes seguidas no fim), `servicos-publicos`,
  `agendamento-publico`, `recebimentos`, `calendario-funcionario`,
  `agenda-profissional`, `agenda-view`, `visao-geral` 1/1, `recuperacao` 12/12.

Limitações locais:
- **VAPID:** sem chaves locais, o cenário de push da suíte `aparencia` falha
  ("servidor não envia notificações"); o cenário público dessa suíte passou, e
  no CI passa.
- **Ensaio de migrations** (`test:migration-e2e`) não roda no Windows
  (`spawn npm`); validado só no CI.

## 7. O que ficou só no PC de casa

Nada de código. Todos os commits estão nos branches remotos. Ficam só
localmente, descartáveis:
- worktrees `C:\Projetos\Agenda-Cloud-portal`,
  `C:\Projetos\Agenda-Cloud-multiservicos` e
  `C:\Projetos\Agenda-Cloud-continuidade-pm` (este documento);
- o cluster PostgreSQL 17 descartável no scratchpad da sessão (dados
  fictícios), parado no fim.

No repositório principal continuam, intocados: `CLAUDE.md` modificado e
`stash@{0}`.

## 8. Próximo passo

Revisar #84 e #85 e decidir ordem de integração e publicação. Não há
autorização de merge, deploy ou migration.
