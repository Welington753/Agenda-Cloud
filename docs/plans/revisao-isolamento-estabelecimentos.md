# Plano: revisão da autorização e do isolamento entre estabelecimentos

Pedido registrado em 2026-11-03. Revisão feita na branch
`test/isolamento-estabelecimentos`, a partir da integration em `2656f69`.
Sem mudança de código de produção, sem migration, sem merge nem deploy, sem
conexão com banco real e sem contas reais. Ver "Estado e retomada" no fim.

## Regra central

- **Dono da plataforma**: só conta ativa com `platform_role = MASTER_OWNER`.
  Hoje são os dois proprietários do sistema.
- **Dono do estabelecimento**: cliente da plataforma. Acessa só o próprio
  estabelecimento e os recursos do plano dele.
- **Gerente e profissional**: limitados pelas permissões dentro do
  estabelecimento.
- Plano Max, teste, cortesia, "sem vencimento" ou classificação interna nunca
  concedem nada no portal.

## Proteções existentes (sem mudança)

- `common/tenant-authorization.ts` (`resolveAuthorizedTenant`): toda rota
  `/tenants/:tenantId` prova, no banco e a cada requisição, vínculo, situação
  do vínculo, situação do estabelecimento, validade, recurso do plano e
  permissão. Sem vínculo ou estabelecimento inativo: o mesmo 404 de
  inexistente. O `tenantId` vem só do caminho; nenhum DTO aceita `tenantId`.
- `platform/platform-access.ts` (`platformCapabilities`): o portal lê só
  `users.status` e `users.platform_role`. Vínculo, plano, nome e e-mail nunca
  entram na decisão. `MASTER_ADMIN` e `MASTER_SUPPORT` não abrem nada.
- `auth/session.guard.ts`: sessão revogada, vencida ou conta não ativa dão
  401; senha temporária dá 403 `TROCA_DE_SENHA_OBRIGATORIA` fora da sessão e
  da troca de senha. Relido a cada requisição.
- `/platform/reauth` confirma a senha da própria sessão para qualquer conta
  (equipe e recebimentos usam) e não concede acesso ao portal.

## O que faltava e foi coberto

1. **Isolamento pela API HTTP, rota por rota.** Os testes de cada módulo
   provam a regra no serviço. Faltava provar a ligação das rotas e travar
   rota nova sem caso. Novo `backend/test/isolamento-estabelecimentos-postgres.db-e2e-spec.ts`:
   - dois estabelecimentos fictícios, A e B, montados pelas próprias rotas
     (serviço, profissionais, horários, cliente, reservas em cada situação,
     recebimento, funcionário com login, convite, aparelho inscrito);
   - a lista cobre toda rota registrada sob `/tenants/:tenantId` (55 hoje),
     conferida contra o roteador;
   - o dono de A (e o profissional de A, nas rotas da própria agenda), com a
     senha confirmada, recebe em cada rota de B o mesmo 404 de inexistente,
     sem nenhum dado de B;
   - no caminho do próprio A, ids de B no caminho, no corpo ou na busca são
     recusados (404; a criação de profissional com serviço de B, 400); as
     agendas de A filtradas pelo profissional de B respondem vazias;
   - nenhuma linha com `tenant_id` de A ou de B muda;
   - controle positivo: depois disso, a conta certa de B faz a mesma chamada,
     com o mesmo corpo, e consegue;
   - conferido por mutação: tirar o `tenantId` da busca do vínculo faz o
     teste falhar em 45 rotas.
2. **Portal recusado a dono, gerente e profissional em toda rota.** O teste
   que varre toda rota registrada sob `/platform` cobria só `MASTER_ADMIN` e
   `MASTER_SUPPORT`; agora inclui dono, gerente e profissional de um Max, com
   a senha confirmada, e confere que o corpo da recusa é só a mensagem.
3. **Dono da plataforma com o próprio estabelecimento vencido ou inativo.**
   Novo caso em `platform-portal-postgres`: o portal funciona; a operação
   desse estabelecimento continua recusada (`ACESSO_VENCIDO` e 404), na mesma
   sessão.

## Observação (sem mudança)

`PUT /tenants/:tenantId/push-subscription` com um endpoint que já é de outra
conta transfere o aparelho para quem chamou e revoga a inscrição anterior,
em qualquer estabelecimento ("um aparelho avisa uma pessoa só",
`push/push-subscriptions.repository.ts`). Não é falha de isolamento: o
endpoint é o segredo do próprio navegador, não um id de recurso que outro
estabelecimento conheça, e nenhum dado volta na resposta.

## Estado e retomada

- Verificado no PostgreSQL 17 descartável local com TLS: os dois arquivos
  acima, a suíte `test:db-e2e` inteira, `lint` e `tsc --noEmit`.
- **Piloto: pendente.** Não há conta de dono do estabelecimento existente e
  autorizada para a verificação real. Não criar contas, não mudar papéis e
  não testar escritas no piloto. As contas de dono da plataforma e as
  respostas 401 sem sessão não substituem essa verificação. Quando houver uma
  conta de cliente autorizada, conferir só leituras: o próprio
  estabelecimento abre; `/platform/*` responde 403 só com a mensagem.
