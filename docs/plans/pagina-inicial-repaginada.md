# Lote 4: página inicial repaginada e nome TimVix

## Objetivo

Uma página inicial pública mais bonita, clara e convincente, com a identidade da área real. Ela só afirma o que o produto **publicado** sustenta. O visitante precisa entender em segundos três coisas: o que o sistema faz, para quem serve e como entrar, obter acesso ou ver a demonstração.

Na mesma branch, o nome do produto exibido muda de "Agenda Cloud" para **TimVix**.

## Decisões do usuário (12/11/2026)

- **Visual:** faixas escuras (`chrome`, a mesma cor da lateral da `/conta`) no menu, no topo, no contato e no rodapé. O corpo fica creme (`paper`). O terracota aparece só em detalhes e no botão principal sobre o creme. A marca é o "//." que já existe, com poucos cartões.
- **Contato:** o e-mail público é `timvix.agenda@gmail.com`.
- **"Como obter acesso":** leva à seção `#contato` da própria página. A página `/cadastro` só explica o convite, sem contato, e não entra neste lote.
- **Planos:** comparação compacta, sem preço, com uma única chamada.
- **Demonstração:** continua como chamada secundária, sempre identificada como "dados fictícios".
- **Prévia do produto:** fiel à agenda real, com dados fictícios identificados. Nada de controles, estados ou recursos inventados.

## O que a página pode anunciar

Só entra o que existe no código **e** já estava publicado em `8e8577d`:
- agenda (lista, por profissional e calendário);
- página de agendamento;
- profissionais, horários e bloqueios;
- serviços e duração;
- clientes;
- equipe e acessos;
- recebimentos manuais com estorno;
- comissões (Pro e Max);
- aviso de novas solicitações com o sistema aberto.

Fica de fora:
- comissão em massa: integrada em `5d74556`, mas ainda não publicada;
- notificação push: depende da configuração VAPID;
- WhatsApp, SMS e lembretes automáticos;
- multiunidade e personalização;
- portal, relatórios comerciais e 2FA, que são da plataforma;
- preços, depoimentos e números de clientes.

**Comportamento conferido:** o pedido feito na página de agendamento nasce `PENDING`. Ele entra na agenda na hora como "Aguardando confirmação" e já ocupa o horário (`availability-rules.ts`, item 5). A equipe confirma ou recusa. O texto "Como funciona" diz exatamente isso.

## Estrutura

1. **Menu** (escuro): marca, âncoras, "Ver demonstração", "Entrar" e "Como obter acesso".
2. **Topo** (escuro):
   - título "A agenda do seu negócio, organizada num só lugar.";
   - chamadas para o contato, o login e a demonstração.
3. **Produto** (`#produto`):
   - prévia da agenda do dia, desenhada com `CartaoAtendimento` e o mesmo contêiner da visualização "Lista", com o selo "Demonstração · dados fictícios";
   - "Como funciona" em três passos.
4. **Funcionalidades:** três destaques mais uma lista curta.
5. **Para quem:** segmentos em texto corrido.
6. **Planos:** Básico 2, Pro 5 + comissões, Max 20. Sem preço.
7. **Perguntas frequentes.**
8. **Contato** (`#contato`, escuro): como funciona o convite, o e-mail, "Enviar e-mail" e "Já tenho conta: entrar".
9. **Rodapé** (escuro).

A prévia usava primeiro a visualização "Por profissional". Na captura de 1280px, os cartões em duas colunas ficaram estreitos demais e o nome do cliente quebrava letra por letra. Por isso ela passou a usar a visualização "Lista", que é a padrão da agenda.

## SEO e segurança

Continuam iguais:
- metadata da página, JSON-LD `Organization` sem preço;
- canonical só com origem confiável;
- `robots`, `sitemap` e CSP.

A home continua estática (`○`). Não entram fonte, imagem nem script externos. O `mailto:` não esbarra na CSP. O H1 deixa de repetir o slogan, que continua na descrição, no JSON-LD e na imagem de compartilhamento.

## Nome TimVix

**Muda:** todo texto exibido.
- `NOME_PRODUTO` e `MARCA.nome` dos e-mails;
- emissor do TOTP;
- manifests e "Portal TimVix";
- textos da `/conta`, do portal e do agendamento público.

**Não muda**, porque são identificadores e não nomes exibidos:
- `agenda-cloud:*` no AAD do TOTP e no hash dos códigos de recuperação. Trocar invalidaria os segredos e códigos gravados.
- Chaves e eventos do `localStorage`. Trocar perderia a preferência de tema, o estabelecimento ativo e o som dos avisos.
- Nomes dos serviços no Render (`agenda-cloud-piloto-*`) e hostnames.
- `application_name` e formato dos scripts de backup e migration.
- Repositório, domínio `.invalid` da demonstração, Prisma legado e planos antigos em `docs/` (são registro histórico).
- `CLAUDE.md`: o arquivo tem uma versão local no stash, e mexer nele agora criaria conflito.

## Requisitos operacionais da publicação (não feitos aqui)

- **Remetente dos e-mails:** se `EMAIL_FROM_NAME` estiver definido no Render como "Agenda Cloud", os e-mails continuam com o nome antigo no remetente até a variável ser trocada.
- **Verificação em duas etapas:** quem cadastrar um fator verá "TimVix" no aplicativo autenticador. Ainda não há fatores no piloto, porque o 2FA não foi publicado.
- **Instalações antigas:** quem já instalou o PWA mantém o nome antigo até reinstalar ou até o sistema atualizar o manifest.
- **Ordem da fila:** comissões `5d74556` primeiro, separadas.

## Observação fora do escopo

Na primeira captura, a visualização "Por profissional" em duas colunas deixou o cartão real (`CartaoAtendimento`, com grade de quatro colunas a partir de `lg`) estreito demais. A área `/conta` pode ter o mesmo aperto entre `lg` e telas largas. Isso não foi conferido nem corrigido aqui; fica para um lote próprio.

## Estado e retomada

- **Feito:**
  - plano aprovado com ajustes;
  - branch `feat/pagina-inicial-timvix` criada a partir de `b5e5586`;
  - página reescrita (commit `8b537da`) e nome TimVix (commit `6a2d790`);
  - capturas em 1280px e 390px conferidas, sem rolagem horizontal;
  - build com `/` estática.
- **Validação local:**
  - verdes: lint e tipos (web e backend), Vitest web (112 arquivos e 1073 testes), backend unitários (2012) e e2e (167);
  - db-e2e de contas e 2FA (31), contra PostgreSQL descartável com TLS;
  - suítes de navegador: auth 7, services 7, aparência 2, portal instalável 4 e segundo fator 1.
- **Próximo passo:** PR para `integration/nestjs-typeorm-frontend` com `[skip render]` e CI completo verde no head final. Sem merge até nova aprovação.
- **Só neste computador:** o stash do `CLAUDE.md`, a worktree `C:wtpmd` e o banco descartável local `home`.
- **Restrições:** sem merge, deploy, Render, DNS, backup ou banco real. As comissões `5d74556` seguem separadas e primeiro na fila.
