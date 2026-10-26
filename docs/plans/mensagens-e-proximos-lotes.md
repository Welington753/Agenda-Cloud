# Mensagens e próximos lotes (clientes pagantes, financeiro e estoque)

Base: integration em `f37cbc9947806d12d6705cd812e8043fcbcace67`, o runtime
publicado no piloto. Este documento registra o lote 1 (mensagens),
implementado, e organiza os seguintes a partir do código real. Nada dos lotes
A a D foi implementado aqui. Agenda Cloud continua sendo um nome provisório.

## Lote 1 — mensagens (implementado)

### E-mails de conta

Arquivos: `backend/src/accounts/account-emails.ts` (textos e layout) e
`backend/src/email/marca.ts` (nome e cores da marca, um lugar só; o remetente
padrão também vem dali).

| Situação | Assunto | Botão |
| --- | --- | --- |
| Convite, conta nova, estabelecimento | `Convite para acessar <estabelecimento>` | Ativar meu acesso |
| Convite, conta existente, estabelecimento | `Convite para acessar <estabelecimento>` | Aceitar o convite |
| Convite, administração da plataforma | `Convite para a administração do Agenda Cloud` | Ativar meu acesso (ou Aceitar o convite) |
| Reenvio de qualquer convite | `Novo link: convite para ...` | o mesmo do convite |
| Redefinição pedida pela administração | `Crie uma nova senha no Agenda Cloud` | Criar nova senha |

- **Conta nova** (sem senha, inclusive a conta pendente de um convite
  anterior): cria a senha. **Conta existente** (com senha): confirma com a
  senha atual e não cria outra. É o mesmo critério do aceite
  (`target_has_credential`).
- O convite de plataforma hoje só aceita e-mail sem conta
  (`invitePlatform`), então a variante "plataforma + conta existente" existe
  no template mas não é emitida.
- O reenvio diz que os links anteriores deixaram de funcionar, o que é
  verdade: ele troca o token.
- A redefinição diz que a **administração** enviou o link. Não existe
  "esqueci minha senha", e o texto nunca diz que a pessoa pediu.
- A validade vem do link emitido (`expires_at` menos o instante da emissão,
  hoje 24 horas por `ACCOUNT_LINK_TTL_MS`), arredondada para baixo. O texto
  também cita o uso único.
- Cada mensagem tem prévia, título, saudação com o primeiro nome, botão,
  endereço por extenso para quando o botão não funciona, validade, aviso para
  quem não reconhece a mensagem e rodapé com o destinatário. O texto simples
  tem o mesmo conteúdo, com o link numa linha própria.
- Layout: uma coluna de até 560 px, tabelas e estilos inline, sem media
  query nem imagem externa. O botão usa `#9a5417` com texto branco
  (contraste acima de 4,5:1).
- Dados de cadastro (nome, estabelecimento) perdem caracteres de controle,
  quebras de linha e marcas de direção, e são escapados no HTML. Acentos e
  emoji ficam. O assunto é sempre uma linha só.
- O link é montado com `URL`: exige token no formato (64 hex), frontend
  http(s) sem usuário, senha, busca ou fragmento. Um link inválido gera erro e
  o e-mail não sai.

Sem mudança em: validade, uso único, rotação no reenvio, limite de reenvios,
destinatários, regras de aceite e de sessão, política e registro de envio,
provedor. Nenhum token ou link vai para log.

### WhatsApp "Combinar outro horário"

Arquivo: `src/lib/contato/whatsapp.ts`. Texto novo:

> Olá, Maria! Aqui é do Estúdio Ana & Bia. Precisamos combinar outro horário
> para seu agendamento de 20/10/2026 às 23:30. Qual dia ou período fica
> melhor para você? Vamos conferir a disponibilidade antes de confirmar a
> alteração.

- Data e hora no fuso do estabelecimento, como antes. Nenhum dado do serviço.
- Sem nome: "Olá!". Sem estabelecimento: a frase "Aqui é do ..." sai. Hora
  fora de `HH:MM` ou fuso inválido: sem botão.
- Continua sendo só um link `wa.me` aberto em outra aba: não chama a API, não
  marca mensagem como enviada e não muda a reserva. A normalização do telefone,
  a codificação do texto e o estado "telefone indisponível" não mudaram.
- "Aqui é do" segue o texto de referência. Para nomes femininos ("Clínica",
  "Barbearia") a forma neutra seria "Aqui é a equipe de ..."; fica como
  decisão de texto.

### Verificação

- Unitários novos: `backend/src/accounts/account-emails.spec.ts` (links,
  validade, cada variante, escape, acentos, controles, token só no link) e
  os casos novos de `src/lib/contato/whatsapp.test.ts`.
- `accounts-postgres.db-e2e-spec.ts`: assunto e texto de cada variante, e o
  botão do HTML apontando para o mesmo link do texto, com o Brevo apontado
  para uma caixa HTTP local.
- `contas-convites-flow.spec.ts`: a caixa local (`caixa-de-email.mjs`) agora
  guarda o HTML. O teste confere conta nova, conta existente e reenvio, e
  captura o e-mail em 1280, 390 e 360 px, sem JavaScript, sem rede e sem
  rolagem horizontal. O endereço por extenso, que leva o token, é coberto
  na captura.
- `whatsapp-contato-flow.spec.ts`: texto novo, `wa.me` interceptado, nenhuma
  escrita na API, reserva intacta.

### Publicação

Muda o runtime dos dois serviços: a API (textos dos e-mails) e o web (texto
do WhatsApp). Sem migration e sem variável nova. Se o auto-deploy estiver
ligado, o merge na integration publica os dois serviços. Os registros de
deployment sugerem que está ligado; a confirmação no painel ainda está
pendente (nota `docs/runbooks/continuidade-publicacao-contas.md`, na branch
`docs/recuperacao-api-reserva`).

## Levantamento do código (em `f37cbc9`)

| Tema | Existe | Incompleto | Falta |
| --- | --- | --- | --- |
| Backup | Dumps manuais com manifesto e restauração conferida, no procedimento das migrations (`backend/scripts/operacao-piloto.mjs`, `conferir-restauracao-piloto.mjs`) | Ficam no PC de quem operou | Rotina automática, cópia fora dos PCs, retenção, teste periódico de restauração |
| Monitoramento | `healthCheckPath` do Render (`/` na API, `/login` no web); tratamento de API hibernada no frontend | Sem alerta nem registro central de erros | Alertas, registro de erros sem dados pessoais, rotina de resposta |
| Acesso | Convite, aceite, redefinição pedida pela administração, bloqueio e reativação de conta | Sem "esqueci minha senha" | Pedido pela própria pessoa, com resposta neutra e limite |
| Folgas e bloqueios | Tabela `time_blocks`, já respeitada pelo motor de disponibilidade | Nenhuma rota ou tela grava bloqueios | Bloqueio pontual, folga, feriado do estabelecimento; política para reservas já existentes |
| Pedidos sem resposta | Pedido público nasce `PENDING`, ocupa o horário; limite de pendentes por telefone; aviso por push | Nada acontece com pedido esquecido | Regra explícita (lembrete, expiração ou nenhuma), com efeitos descritos |
| Retorno ao cliente | `notification_jobs` grava confirmação e lembretes ao confirmar; executor e contrato de provedor existem; opt-in de WhatsApp em `consumers` | Executor não é chamado por nada; não há provedor real | Mensagens manuais de confirmação e recusa; depois, envio automático |
| Suporte e privacidade | Tabela `support_sessions` no schema; auditoria de contas | Sem rota de suporte | Procedimentos, atendimento a pedidos sobre dados, exportação e exclusão/anonimização de cliente |
| Financeiro da plataforma | `plans.price_cents` (catálogo), `tenants.plan_id`, `tenants.status` com `PAST_DUE` e `SUSPENDED`, `suspension_reason` | Nenhuma escrita de status do tenant; preço de catálogo não é valor contratado | Contrato, cobrança por competência, recebimento, histórico, suspensão e reativação |
| Financeiro do estabelecimento | `appointment_items.price_cents_snapshot`; `commission_rules` e `commission_entries` no schema | Comissões sem uso no runtime | Venda, recebimento, despesa, caixa, estorno, relatórios |
| Estoque | Nada | — | Produto, movimentação, saldo, integração com venda |

## Sequência de PRs

Cada PR é pequeno, tem testes de banco e de navegador próprios e só mostra
botão do que já funciona. Migrations seguem o fluxo protegido
(`docs/runbooks/migrations-production.md`).

### A. Operação e confiabilidade

1. **A1 — Backup automático fora dos PCs.** Dump agendado em ambiente
   controlado (por exemplo, um workflow do GitHub com segredo próprio),
   criptografado, enviado a um armazenamento com retenção definida e acesso
   restrito; manifesto com contagens e hash; restauração ensaiada em banco
   descartável a cada ciclo. Sem dados reais no Git. *Decisões:* onde
   armazenar (custo), retenção, quem tem a chave. Conferir antes a janela de
   restauração do plano atual do Neon.
2. **A2 — Monitoramento.** Registro de erros sem token, senha, e-mail ou
   telefone; alerta de falha de deploy, de health check e de picos de 5xx;
   página de situação simples. Nada de ping para manter a API acordada.
   *Decisão:* ferramenta (gratuita ou paga) e quem recebe os alertas.
3. **A3 — "Esqueci minha senha".** Pedido pela página de login com resposta
   igual para e-mail existente ou não, limite por IP e por conta, mesmo
   token de 24 horas e uso único da redefinição atual, e uma variante de
   e-mail própria ("você pediu"), diferente da enviada pela administração.
   Depende do lote 1.
4. **A4 — Bloqueios, folgas e feriados.** Rotas e telas sobre `time_blocks`
   (profissional ou estabelecimento inteiro, com motivo). Feriado pode ser um
   bloqueio do estabelecimento inteiro, sem tabela nova. Reservas que já
   existem no período não são canceladas sozinhas: a tela lista os conflitos
   para tratar um a um.
5. **A5 — Pedidos sem resposta.** Primeiro, visibilidade: idade do pedido na
   lista e lembrete ao estabelecimento. Expiração automática só com a regra
   escrita: prazo, a partir de quando conta, o que acontece com o horário
   (liberado), o que o cliente recebe e o que fica registrado.
6. **A6 — Retorno ao cliente.** Primeiro, links `wa.me` com textos de
   confirmação, recusa e remarcação concluída, no mesmo padrão do lote 1, sem
   marcar nada como enviado. Envio automático só depois da decisão do
   provedor; o executor de `notification_jobs` precisa de um agendador
   externo, que não pode ser um ping de manter acordado.
7. **A7 — Suporte e privacidade.** Procedimento de atendimento, registro dos
   pedidos sobre dados, exportação dos dados de um cliente do estabelecimento
   e exclusão ou anonimização com regra para reservas e histórico. Texto de
   privacidade revisado por quem responde juridicamente.

### B. Financeiro da plataforma (registro manual, sem gateway)

Base: a proposta de `administracao-real-e-financeiro.md`, "Próximo lote".

1. **B1 — Contrato por estabelecimento.** Valor contratado em centavos
   (`bigint`), separado do preço do catálogo; vigência; dia de vencimento;
   histórico de mudanças (nova vigência, nunca sobrescrita). Só
   `MASTER_OWNER` no começo. Auditoria em `audit_logs`.
2. **B2 — Cobranças por competência.** Uma por contrato e mês (constraint
   única), valor devido congelado, vencimento (regra para os dias 29 a 31),
   cancelamento com motivo.
3. **B3 — Recebimentos manuais.** Valor, data, forma, quem registrou, chave
   de idempotência; estorno como lançamento novo que aponta o original. Pago,
   parcial e em atraso calculados da soma, nunca digitados.
4. **B4 — Suspensão e reativação.** Rota que muda `tenants.status` com
   motivo e auditoria. Efeitos explícitos: as sessões de **todos** os
   vínculos daquele estabelecimento deixam de valer para ele; as mesmas
   contas continuam entrando nos outros estabelecimentos; agendamento
   público e notificações daquele estabelecimento param. Nenhuma suspensão
   automática por atraso neste escopo.

### C. Financeiro de cada estabelecimento

1. **C1 — Vendas.** Venda com itens (serviço ligado a uma reserva, ou
   produto), preço congelado em centavos, quem vendeu. Atendimento concluído
   não vira venda nem pagamento sozinho: a venda é registrada.
2. **C2 — Recebimentos.** Formas de pagamento, parcial, pendente,
   idempotência; estorno com histórico.
3. **C3 — Despesas e caixa.** Despesas com categoria; abertura e fechamento
   de caixa com saldo conferido.
4. **C4 — Relatórios por período.** Faturamento (vendas), recebido
   (dinheiro que entrou) e saldo de caixa separados. Nada é chamado de lucro.

Todas as tabelas com `tenant_id` e chaves estrangeiras compostas com o
tenant, permissões novas na política pura por módulo (`*-access.ts`) e
auditoria. Separadas do financeiro da plataforma. Sem nota fiscal e sem
integração bancária.

### D. Estoque de cada estabelecimento

1. **D1 — Produtos e materiais.** Tipo (venda ou consumo), unidade, custo,
   preço, estoque mínimo. Saldo nunca é digitado.
2. **D2 — Movimentações.** Saldo inicial, entrada, saída, ajuste com
   justificativa e devolução, sempre com usuário, data e motivo. Saldo é a
   soma; uma constraint impede saldo negativo, se essa for a regra escolhida.
3. **D3 — Integração com vendas.** A venda de produto gera a saída na mesma
   transação, com chave única por item vendido (sem baixa duplicada); o
   estorno gera a devolução. Depende de C1.
4. **D4 — Consumo por serviço.** Só depois de escrita a regra (quanto de
   cada material cada serviço gasta, em que momento baixa, o que acontece se
   faltar).

### Dependências

```
lote 1 ── A3
A4 ── A5 ── A6
B1 ── B2 ── B3 ── B4
C1 ── C2 ── C3 ── C4
C1 ── D3;  D1 ── D2 ── D3 ── D4
```

A1 e A2 vêm antes de qualquer cliente pagante. B e C não dependem um do
outro.

## Decisões pendentes

1. Auto-deploy do Render: confirmar se está ligado e com qual gatilho antes
   de mesclar qualquer PR com runtime.
2. Marca definitiva (trocar em `email/marca.ts` e `src/lib/config.ts`) e
   endereço de resposta dos e-mails.
3. Texto "Aqui é do" ou forma neutra no WhatsApp.
4. Armazenamento, retenção e chave dos backups; ferramenta de monitoramento.
5. Regra para pedidos sem resposta (lembrete, expiração ou nenhuma).
6. Provedor de WhatsApp e custo do envio automático.
7. Financeiro da plataforma: competência, vencimento nos dias 29 a 31,
   carência, quem registra pagamento.
8. Estabelecimento: saldo de estoque pode ficar negativo? Formas de
   pagamento aceitas. Regra de consumo de material por serviço.
9. Privacidade: prazo de guarda dos dados de clientes e o que a exclusão
   apaga ou anonimiza.
