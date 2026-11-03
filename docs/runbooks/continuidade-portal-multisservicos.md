# Continuidade: portal da plataforma (#84) e vários serviços (#85)

Checkpoint de 2026-11-03, depois da revisão dos dois PRs (PC do trabalho).
Nada foi mesclado, publicado ou aplicado em banco real. Nenhuma mensagem foi
enviada. Os preços continuam sem aprovação.

## 1. Estado de produção e do piloto (não mudou)

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

| PR | Branch | Head | Base | Estado |
| --- | --- | --- | --- | --- |
| [#84](https://github.com/Welington753/Agenda-Cloud/pull/84) | `feat/portal-plataforma` | `3174b91d105948da898430382eb522e6d54e7dc8` | integration em `99242a6` | aberto, sem merge |
| [#85](https://github.com/Welington753/Agenda-Cloud/pull/85) | `feat/agendamento-multiplos-servicos` | `27e4eff88741cc16d5f226dc6176c14796a8eb87` (sem mudança na revisão) | integration em `99242a6` | aberto, sem merge |

Checks exigidos: "auth real e serviços reais (navegador + API) contra
PostgreSQL descartável" e "migration:show/run reais contra PostgreSQL
descartável".

- #84 em `3174b91`: os dois passaram (seção 6).
- #85 em `27e4eff`: os dois passaram (o primeiro job falhou antes dos testes,
  com o PostgreSQL do container ainda subindo, e passou na reexecução).

PR #74 continua aberto e intocado.

## 3. Revisão do #84 — portal e comercial

Decisões em `docs/plans/portal-da-plataforma.md` (no branch do PR).

Conferido, sem defeito:
- `platformCapabilities`: só conta ativa com `MASTER_OWNER` tem alguma
  capacidade. Toda rota do portal passa por `loadActor` relido do banco na
  transação (`viewDirectory`, `manageEstablishments`,
  `managePlatformAccess`, `manageEstablishmentLifecycle`). A Membership
  nunca é lida: dono, gerente e profissional de qualquer plano, inclusive
  Max, são recusados por tela, URL antiga (`/administracao/**`,
  `/conta/administracao/**`) e API direta (db-e2e do portal, 1º caso).
- Último proprietário: `ULTIMO_MASTER_OWNER` no bloqueio e na troca de papel,
  sob lock. Só `MASTER_OWNER` (ou nenhum) é atribuível (DTO e serviço).
  `MASTER_ADMIN`/`MASTER_SUPPORT` ficam no banco e perdem todo acesso.
  Convite de plataforma pendente criado antes com papel delegado, se
  aceito, grava o papel sem efeito nenhum (inofensivo; observação).
- `POST /platform/reauth`: confere a senha da própria conta
  (`credentials.user_id = req.auth.userId`) e só marca a própria sessão
  (`WHERE id = sessionId AND user_id = userId`). Não concede capacidade:
  cada ação seguinte relê papel/vínculo e exige a reautenticação recente.
- Sem vencimento: `NO_EXPIRY` só afeta a validade; recurso fora do plano e
  limites continuam (`featureEnabled`, vagas), papel não muda. Suspensão
  prevalece (tenant não utilizável antes do portão comercial). Reativar não
  perdoa vencimento. Retirar não devolve a exceção de legado
  (`ACCESS_LEGACY_SQL` exige nunca ter tido concessão). Motivo, confirmação,
  auditoria e consequência antes da retirada.
- Vale na próxima requisição: capacidades e sinalizadores comerciais são
  relidos a cada requisição, com a sessão aberta.
- Preços: contrato vigente > catálogo > pendente (nunca zero); origem
  calculada no servidor (`amountSource`), campo do navegador recusado;
  "ajustar só este pagamento" × "alterar o contrato"; idempotência por
  `(recorded_by_user_id, request_key)` com recusa de chave reutilizada;
  valores históricos ficam na linha do período e não são recalculados.
- Reescrita de `tests/browser/administracao-flow.spec.ts`: os cenários
  antigos continuam (recusa por URL e API, endereços antigos, ficha sem
  trocar estabelecimento nem criar vínculo, legado, filtro, falha de rede sem
  "zero", celular, revogação na próxima leitura, sem estabelecimento) e
  entram Max, preços, sem vencimento e papel delegado. Perda pequena: o caso
  "sem estabelecimento" não confere mais a barra do celular com só duas
  áreas e sem "Mais"; `MASTER_SUPPORT` saiu do navegador e ficou só no
  unitário de capacidades.

Defeito corrigido (commit `5277ab3`):
- **Criação de estabelecimento repetida em paralelo, com ciclo combinado,
  dava 500.** O contrato é gravado com a mesma `requestKey` antes do
  convite; a repetição esperava o slug, tentava de novo e esbarrava em
  `uq_tenant_contract_prices_request_key`, que não era tratada como
  repetição. Reproduzido com 6 envios paralelos
  (`[200, 500, 200, 200, 200, 200]`); agora é repetição. Caso novo no
  `platform-portal-postgres.db-e2e-spec.ts`.

Falha 232/233 (`team-manager-postgres`, reautenticação) — commit `3174b91`:
- O log original ficou no PC de casa; não foi possível ver qual asserção
  falhou. O que foi comprovado aqui: as fixtures gravavam
  `sessions.reauthenticated_at = now()` (relógio do PostgreSQL, arredondado
  para ms por `timestamptz(3)`), e os serviços comparam com `new Date()` do
  Node (truncado). Logo depois do INSERT o valor gravado fica 1 ms à frente
  em 1.318 de 2.000 amostras (Windows, PG 18), e `reauthStillValid` recusa
  idade negativa: uma chamada protegida feita nessa janela recebe
  `REAUTENTICACAO_NECESSARIA`.
- Causa **provável**, não comprovada para aquela execução. Correção só nas
  fixtures (`now() - interval '1 second'`, como `senha-do-dono` já fazia),
  em 5 arquivos db-e2e. Produção não é afetada: a reautenticação real grava
  o relógio do Node.

Não verificado: as identidades reais dos proprietários (seção 5, item 3).

## 4. Revisão do #85 — vários serviços

Decisões em `docs/plans/agendamento-multiplos-servicos.md` (no branch do PR).

Conferido, sem defeito:
- Uma reserva com um item por serviço (nome, preço, duração, posição
  congelados), todos do mesmo estabelecimento (busca por `tenantId`) e com
  vínculo do mesmo profissional para cada um; travas em ordem de id.
- Duração = soma, intervalo depois = o maior, preço = soma (sob consulta se
  algum for), tudo no servidor; DTO estrito sem campo de preço/duração;
  duplicados recusados no DTO e em `calcular`; até 6.
- Ocupação `start + duração + intervalo` na constraint de exclusão e na
  disponibilidade: conflito no trecho posterior ao primeiro serviço recusado.
- Público exige todos no online; recibo com snapshots; hash de idempotência
  igual ao antigo para um serviço.
- Remarcação usa a ocupação congelada e exige os serviços ainda ativos (regra
  que já valia para um). Cancelamento não apaga itens. Recebimentos, visão
  geral e agenda própria usam `ITENS_DA_RESERVA_SQL`. Gerente sem
  `RECEBIMENTOS_VISUALIZAR` não vê preço (reserva e disponibilidade). As
  mensagens automáticas não citam serviço.
- Reservas antigas: `service_name_snapshot` nulo mostra o nome atual,
  documentado; nada inventado.

Nenhuma mudança no #85.

## 5. Migrations novas — NÃO aplicadas no piloto

- `PlatformPortal1793318400000` (#84): 3 tabelas, coluna
  `tenant_access_periods.amount_source` com check, 4 valores de
  `audit_action`. Não grava preço.
- `AppointmentServiceSnapshots1793404800000` (#85): coluna anulável
  `appointment_items.service_name_snapshot`.

Integração (#84 antes do #85), ensaiada numa worktree temporária destacada
(merge local dos dois heads de origem, sem commit em branch):
- Só dois conflitos, nas listas de migrations:
  `backend/scripts/lote6b2-migration.migration-e2e-spec.ts` (manter as duas,
  `PlatformPortal` e depois `AppointmentServiceSnapshots`) e
  `backend/src/database/migrations-runtime-compiled.spec.ts` (contagem
  `13` → `14` e as duas asserções de nome). A contagem de tabelas (44) não
  muda: o #85 não cria tabela.
- Depois do merge do #84, o #85 precisa receber a integration e esses dois
  ajustes, e rodar o CI de novo.
- Na combinação: `tsc` ok, 14 migrations compiladas em banco novo,
  `migrations-runtime-compiled.spec` 4/4 (com 14), db-e2e portal,
  vários serviços, público, recebimentos, plataforma e comercial 50/50.

Ensaio de compatibilidade feito (banco descartável, dados fictícios):
14 migrations → `revert` das duas novas (os `down` funcionam) → banco em 12
com teste até 06/12/2026, um Max pago (R$ 99,90), um legado e uma reserva
antiga → `migration:run` aplica só as duas. Nada reescrito: períodos, plano,
situação e marca de legado iguais; `amount_source` e `service_name_snapshot`
nulos; nenhuma linha em `plan_prices`, `tenant_contract_prices` e
`tenant_no_expiry_grants`.

Pendências antes de publicar:
1. Kit protegido de cada lote, no padrão dos anteriores (CommercialAccess):
   `pilot:check-database` ainda não conhece as novas expectativas. Falta
   `PILOT_EXPECT` antes/depois para PlatformPortal (3 tabelas, índices,
   coluna/check, 4 valores de enum) e AppointmentServiceSnapshots (coluna),
   aceitando no "antes" exatamente as 12 atuais; `aplicar-*-piloto.mjs`,
   `conferir-restauracao-*.mjs` e runbook; backup antes; aplicar só a
   migration do lote.
2. Ensaio de restauração do backup do piloto (PostgreSQL 17) com as duas
   migrations por cima, como nos lotes anteriores; o ensaio de migrations
   (`test:migration-e2e`) só roda no CI.
3. Conferir, só com leitura e com autorização, quais contas reais têm
   `platform_role`, e confirmar a identidade de cada uma. Qualquer
   `MASTER_ADMIN`/`MASTER_SUPPORT` perde o portal com a API nova. Nenhum
   papel foi alterado; não presumir quais são as contas.
4. Publicação: migration, depois API, depois web, do mesmo SHA.
5. Cadastrar pelo portal só preços aprovados.

## 6. Testes executados nesta revisão (PC do trabalho, PostgreSQL 18 descartável com TLS)

- #84 (worktree do branch): `platform-portal` 6/6 três vezes; sem a
  correção, o caso novo falha com 500; db-e2e `team-manager`, `payments`,
  `staff-login`, `senha-do-dono`, `accounts`, `platform-portal`,
  `platform` 59/59; `tsc`, `oxlint`; unitários de `accounts`, `platform`,
  `commercial` 83/83.
- #85: `multi-services` + `public-booking` 27/27 (13 migrations).
- Combinação: ver seção 5.
- Não repetido (já suficiente no checkpoint anterior e sem mudança de
  código): web, navegador e a suíte db-e2e completa localmente; o CI do
  #84 roda a suíte completa no novo head.

CI do #84 em `3174b91`: os dois checks exigidos passaram (web 883,
backend 1.659 unitários, 137 e2e HTTP, db-e2e completo **234/234**, que é
233 + o caso novo, e as suítes de navegador do workflow).

Execuções do checkpoint anterior (PC de casa, PG 17) continuam valendo para
o resto: #84 1.659 unitários, 137 e2e HTTP, web 883, navegador
`administracao`/`contas`/`equipe`; #85 1.662 unitários, web 884, navegador
`appointments`, públicos, recebimentos, calendários, `recuperacao`.

Limitações locais: VAPID sem chaves locais (suíte `aparencia`, cenário de
push); `test:migration-e2e` não roda no Windows (`spawn npm`).

## 7. O que fica só no PC do trabalho

Nada de código. Ficam localmente, descartáveis:
- worktrees `C:\Projetos\Agenda-Cloud-pr84`, `C:\Projetos\Agenda-Cloud-pr85`,
  `C:\Projetos\Agenda-Cloud-continuidade-pm` e
  `C:\Projetos\Agenda-Cloud-combo` (merge local não commitado dos dois PRs,
  só ensaio; não publicar);
- cluster PostgreSQL 18 descartável no scratchpad da sessão (porta 55434,
  dados fictícios).

No repositório principal deste PC continuam, intocados: `CLAUDE.md`
modificado, branch `feat/senha-dono-calendario-profissional` e as demais
worktrees. Este PC não tem stash (o `stash@{0}` é do PC de casa).

## 8. Próximo passo

1. Ordem recomendada: **#84 primeiro, depois #85** (o #85 recebe a
   integration e os dois ajustes da seção 5, e passa no CI de novo).
2. Antes de publicar: pendências 1 a 3 da seção 5.
3. Não há autorização de merge, deploy, migration nem consulta ao piloto.
