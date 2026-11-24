# Publicação da recuperação de senha (migration 26, API e web)

Plano do lote: `docs/plans/recuperacao-de-senha.md`. Este roteiro não contém nenhuma credencial nem URL de banco. Os valores reais ficam com quem opera, fora do repositório e fora de conversa.

**Antes de começar:**
- Nada aqui é autorizado por este texto. Cada passo no piloto depende de pedido explícito do responsável.
- Os SHAs ficam assim:
  - **atual = `63f1cd6`:** o par API e web no ar desde 23/11, com o banco em 25 migrations.
  - **SHA_R:** merge do PR #144 na integração. Inclui:
    - o login simplificado do #143 (merge `8093875`);
    - a recuperação de senha;
    - a migration 26 (`SelfServicePasswordReset1794441600000`), com o manifesto até 26.
- Entre `63f1cd6` e SHA_R só há uma migration nova, a 26.
  - Web: login, "Esqueci minha senha", "Criar nova senha" e a origem do link na ficha do usuário no portal.
  - API: pedido público, fila persistente de envio no próprio banco e um campo novo na ficha do usuário.

## P. Sequência

1. **Conferir o ambiente:**
   - API e web live em `63f1cd6` (`render deploys list <serviço> -o json --confirm`), fila vazia e Auto-Deploy `off` nos dois serviços (conferido em 24/11).
   - `/health` responde.
   - O banco tem 25 migrations, conferidas só com consulta de leitura em `typeorm_migrations` (última: `ConsumerSharedPhone1794355200000`). Nunca usar `migration:show`, porque ele escreve.
   - Se algo divergir, parar.
2. **Conferir o e-mail da API, só leitura**, sem copiar valores para fora do painel. Detalhes na seção E.
3. **Backup novo** `pre-mig26-25-backup-<data>` em `%USERPROFILE%\AgendaCloud-operacoes`:
   - usar `SET TIME ZONE 'UTC'` nas duas pontas;
   - CA em PEM (no Windows, `sslrootcert=system` falha).
4. **Restauração conferida** num cluster descartável com TLS, com hash por tabela igual ao original.
5. **Estado atual, só agregados.** Na cópia restaurada:
   - `SELECT status, count(*) FROM password_resets GROUP BY status;`
   - links pendentes ainda válidos (`status = 'PENDING' AND expires_at > now()`). Continuam valendo depois da migration, com origem `ADMIN`.
6. **Ensaio na cópia restaurada, os 4 passos:**
   1. `aplicarSomenteAPendente` (`backend/scripts/operacao-piloto.mjs`) com o kit `dist-migrations` do SHA_R:
      - `esperadasAntes` = as 25;
      - `pendente` = `SelfServicePasswordReset1794441600000`;
      - `posteriores` vazio.

      Conferir a seção P2 e a janela 1.
   2. API SHA_R sobre a cópia, com o web atual. Conferir a janela 2, inclusive com um pedido de "Esqueci minha senha" feito direto na API.
   3. Web SHA_R. Conferir a janela 3 e o roteiro curto, com a caixa de e-mail local no lugar do provedor.
   4. Ensaio de retorno: a seção P3, com envios pendentes nos estados listados lá.
7. **Piloto:** repetir os passos 6.1 a 6.3 contra o piloto, um de cada vez.
   - Rodar as consultas só de leitura da seção P2 antes e depois da migration, e conferir cada janela.
   - `pilot:check-database` não tem estado esperado para 25 ou 26 migrations. As consultas P2 o substituem, como nos lotes de estoque e de clientes. Não rodar `migration:show`.
   - API e web terminam no mesmo SHA_R. A janela 2 é compatível com navegadores que ainda tenham o web atual aberto (seção P0), então não há pressa entre os dois deploys.
   - Entre os passos, parar se algo divergir.
8. **Teste real de e-mail**, depois do passo 7 e com pedido do responsável:
   - usar o roteiro curto com uma conta real de e-mail confirmado, controlada pelo responsável;
   - conferir a chegada (inclusive na pasta de spam), o remetente, o link para o endereço público e a validade de 1 hora;
   - depois, repetir pelo celular, com teclado real.
9. **Registrar:**
   - SHAs, ids de deploy e estado do banco;
   - os agregados do passo 5;
   - "Estado e retomada" do plano e a memória.

## E. Configuração de e-mail (conferida só em leitura em 24/11)

A recuperação só funciona com entrega real. Com `EMAIL_PROVIDER=none`, o pedido responde 202, mas o link fica registrado como "não configurado" e nunca é enviado.

| Variável na API | Situação em 24/11 | Pendência |
|---|---|---|
| `EMAIL_PROVIDER` | `brevo` | nenhuma |
| `EMAIL_API_KEY` | presente | nenhuma |
| `EMAIL_FROM` | presente, endereço de e-mail gratuito | **decisão do responsável:** um remetente de domínio próprio, autenticado no provedor, entrega melhor. Um endereço gratuito tende a cair em spam ou ser recusado por DMARC. |
| `EMAIL_FROM_NAME` | "Agenda-Cloud" | **decisão do responsável:** o produto se chama "TimVix" para o usuário, e o assunto do e-mail já diz "TimVix". |
| `EMAIL_API_BASE_URL` | ausente | nenhuma (só para teste local) |
| `FRONTEND_URL` | endereço público do web | nenhuma: o link do e-mail é montado a partir dele |

- A fila persistente não exige variável nova: ela usa o próprio banco.
- No plano gratuito, a API dorme. Como o pedido chega na própria API, ela está acordada quando o pedido é gravado e o envio sai na mesma hora. Uma nova tentativa agendada (1 e 5 minutos) só sai se a API estiver acordada nesse momento; se não, sai quando ela acordar, desde que o link ainda esteja dentro da validade.
- As duas pendências não bloqueiam o roteiro, mas o teste real do passo 8 mostra se o remetente atual entrega.

## P0. Janelas entre migration, API e web

| Janela | Banco | API | Web | Situação |
|---|---|---|---|---|
| 1 | 26 | atual | atual | A API atual sobe com uma migration a mais. Os links da administração continuam iguais: a coluna `origin` nasce `ADMIN` por padrão e o autor continua preenchido. As tabelas e colunas novas ficam paradas. |
| 2 | 26 | SHA_R | atual | O pedido público passa a existir na API, mas o web atual não tem a tela. A ficha do usuário no portal continua abrindo no web atual: o campo `latestPasswordReset`, que o web atual lê, só traz links da administração, sempre com autor. O link de "Esqueci minha senha" vai num campo novo (`latestSelfServicePasswordReset`), que o web atual ignora. |
| 3 | 26 | SHA_R | SHA_R | Final: "Esqueci minha senha" no login e no portal, "Criar nova senha", e na ficha do usuário o link mais recente, venha da administração ou do autoatendimento. |

**Combinações testadas em 24/11** (banco descartável com a migration 26, caixa de e-mail local):

| API | Web | Resultado |
|---|---|---|
| SHA_R antes da correção (`d07c1f4`) | #143 (`4b5912d`; igual ao `63f1cd6` em todo o portal) | **Quebrava:** a ficha de um usuário cujo último link veio de "Esqueci minha senha" não abria ("This page couldn't load", `requestedBy` nulo lido como `requestedBy.name`). Com e sem histórico da administração. |
| SHA_R com a correção | #143 | A ficha abre nos dois casos. Com histórico, mostra o último link da administração com o autor; sem histórico, só o botão de enviar link. |
| SHA_R com a correção | SHA_R | Teste unitário `src/lib/administracao/contas.test.ts` (link mais recente dos dois campos) e as suítes de navegador do CI. |
| `63f1cd6` | qualquer | Ensaio de retorno da seção P3. |

A parte automática fica em:
- `test/password-recovery-postgres.db-e2e-spec.ts`: fila, reinício, concorrência, link preservado e o contrato da ficha (`latestPasswordReset` nunca traz link sem autor; registro e auditoria da administração intactos);
- `test/schema-readiness-postgres.db-e2e-spec.ts`, caso 2d: a API recusa o schema 25 e aprova o 26;
- a suíte de navegador `test:browser:recuperacao-senha`.

**Prova em cada janela, no ensaio:**
- login do dono e do portal;
- portal: abrir a ficha de um usuário que pediu "Esqueci minha senha" e a de um com link da administração; criar um link pela administração e usá-lo;
- na janela 3: o roteiro curto completo.

## P1. Se algo falhar

- **Migration 26 falha:** a transação é desfeita. O banco fica em 25, e API e web atuais seguem.
- **Deploy da API SHA_R falha:** o Render mantém a API atual, que roda no schema 26 (janela 1). Não publicar o web.
- **Deploy do web SHA_R falha:** fica a janela 2, que é compatível. Repetir o deploy do web.
- **E-mail não chega no teste real:** a API registra a falha no próprio link e faz até 3 tentativas (em 1 e 5 minutos). Na terceira recusa, o link é revogado.
  - Conferir a configuração da seção E pelo painel.
  - Os links pendentes expiram sozinhos em 1 hora.
  - Não é preciso voltar a versão.
- **Schema:** nunca há `down` desta migration no piloto. O `down` apaga os links de autoatendimento e existe só para ensaio. A correção é sempre para frente.

## P2. Conferências só de leitura

```sql
SELECT count(*) FROM typeorm_migrations;                        -- 25 antes; 26 depois
SELECT name FROM typeorm_migrations ORDER BY id DESC LIMIT 2;   -- SelfServicePasswordReset1794441600000 no topo
SELECT origin, status, count(*) FROM password_resets GROUP BY origin, status;
                                                                -- só ADMIN logo depois; totais iguais ao passo 5
SELECT count(*) FROM password_resets WHERE delivery_due_at IS NOT NULL; -- 0 logo depois
SELECT count(*) FROM password_reset_requests;                   -- 0 logo depois
SELECT conname FROM pg_constraint
 WHERE conname IN ('ck_password_resets_origin', 'ck_password_resets_origin_requester',
                   'ck_password_resets_delivery_due_self_service', 'ck_password_reset_requests_state')
 ORDER BY conname;                                              -- 4 linhas
```

HTTP sem sessão, depois da API SHA_R: `POST /password-resets/request` com corpo inválido responde 400; com um endereço qualquer, 202 e `Cache-Control: no-store`. Não usar endereço real nesse teste.

Fila de envio, antes de qualquer troca de versão da API (seção P3):

```sql
SELECT count(*) AS pedidos_parados, min(requested_at) AS mais_antigo
  FROM password_reset_requests WHERE processed_at IS NULL;
SELECT count(*) AS envios_agendados, min(delivery_due_at) AS proximo
  FROM password_resets WHERE delivery_due_at IS NOT NULL;
```

## P3. Até quando o retorno é seguro

A migration 26 só acrescenta, e a API atual roda no schema 26. O retorno da API SHA_R para a atual não quebra telas nem dados a qualquer momento, mas **não é neutro para os envios pendentes**.

**Ensaio de 24/11.** No banco descartável, a sequência foi API SHA_R, depois `63f1cd6`, depois SHA_R de novo, com três titulares:
- **X:** link de autoatendimento já enviado;
- **Y:** pedido aceito (202) e gravado, com o processo parado antes de resolver;
- **Z:** envio recusado pelo provedor, com nova tentativa agendada.

| Situação | Com a API atual (`63f1cd6`) | Quando a SHA_R volta |
|---|---|---|
| Link já enviado (X) | Funciona: a prévia diz válido e a conclusão troca a senha (204). | Nada muda. |
| Pedido parado na fila (Y) | Fica parado: a API atual não tem o executor. Ninguém recebe nada. | É processado na hora e o e-mail sai **atrasado**, com validade de 1 hora a partir do envio. |
| Nova tentativa agendada (Z) | Não sai, mesmo depois do horário. O titular fica sem link até a SHA_R voltar ou a administração reemitir. | Sai na próxima rodada se o link ainda estiver pendente e dentro da validade; se tiver vencido, é encerrado sem envio. |
| Administração reemite durante o retorno (Z) | Funciona: o link de autoatendimento é revogado e o novo, da administração, é enviado. | O link revogado nunca é enviado (o agendamento é limpo sem envio) e o link da administração continua válido. |
| Ficha do usuário no portal | Abre: a API atual lê os links com `JOIN` no autor, então os de autoatendimento ficam fora da ficha. | O web SHA_R volta a mostrar os dois. |

**Limites do retorno:**
- Antes de voltar para a API atual, rodar as consultas de fila da seção P2 e registrar os números. Pedidos parados serão atendidos com atraso quando a SHA_R voltar; se o retorno durar mais que alguns minutos, avisar o responsável. Ele decide se quem pediu deve ser orientado a ignorar um e-mail tardio.
- Durante o retorno, a recuperação por "Esqueci minha senha" fica parada. A recuperação assistida (link pela administração) continua funcionando.
- O web volta junto para o atual, porque a tela "Esqueci minha senha" depende da rota nova da API. Com a API atual, a tela do web SHA_R recebe 404 e mostra "Tente de novo".
- Nunca rodar o `down` no piloto, nem apagar linhas da fila à mão.

## Roteiro curto de teste (janela 3)

1. Login da equipe: "Esqueci minha senha" abre "Recuperar senha", com a orientação para login sem e-mail. "Voltar para a entrada" volta ao login.
2. Portal: o mesmo link abre a mesma tela e volta ao portal.
3. Pedido com um login sem e-mail e com o e-mail confirmado: a mesma confirmação "Pedido recebido.", com só o botão "Voltar para a entrada".
4. O e-mail "Recuperação de senha no TimVix" chega só para o e-mail confirmado, com link para o endereço público.
5. O link abre "Criar nova senha":
   - senhas diferentes mostram o erro;
   - senhas iguais levam a "Senha alterada";
   - a sessão aberta com a senha antiga cai, e o segundo fator, se ativo, continua sendo pedido.
6. O mesmo link, aberto de novo, mostra "Link indisponível" com "Este link já foi usado."
7. Portal: a ficha do usuário mostra o pedido como feito em "Esqueci minha senha", sem autor.
