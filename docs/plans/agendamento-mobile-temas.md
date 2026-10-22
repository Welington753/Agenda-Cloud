# Agendamento público no celular, temas e acesso às notificações

Lote feito a partir da integration em `b5a2c06` (merge do PR #60), na branch
`feat/agendamento-mobile-temas`. Sem mudança de schema, sem dependência nova,
sem mudança no backend.

A promoção da conta do responsável a MASTER_OWNER continua numa tarefa
separada (checkpoint `chore/continuidade-promocao-master-owner`, em
`7c07281`). Este lote não executou o script de promoção.

## Agendamento público (`/agendar/[slug]`)

- Percurso em cinco etapas: Serviço → Profissional → Dia e horário → Seus
  dados → Revisar. As regras ficam em `src/lib/agendamento-publico/fluxo-publico.ts`
  e têm testes de unidade próprios.
- Cabeçalho com as iniciais e o nome do estabelecimento. O contrato público
  (`GET /public/:slug`) só traz nome, slug e fuso: logo, endereço e outras
  informações não aparecem porque não existem nele. Nenhuma rota privada é
  chamada.
- Serviços em cartões com nome, descrição curta, duração e preço. Preço
  ausente ou oculto aparece como "Sob consulta". Com seis serviços ou mais
  aparece a busca local por nome, sem diferenciar acentos.
- Um serviço e um profissional por pedido. Com um único profissional válido,
  ele já vem escolhido e a etapa é pulada na ida e na volta; o pedido continua
  levando o id dele.
- Voltar mantém o que continua válido. Trocar o serviço mantém o profissional
  só se ele atende o serviço novo; trocar serviço, profissional ou dia derruba
  o horário e a disponibilidade é consultada de novo. Se a lista nova não tem
  mais o horário escolhido, ele cai.
- Dias numa grade de duas semanas (sem rolagem lateral) e horários agrupados
  em manhã, tarde e noite, sempre no fuso do estabelecimento, com o nome do
  fuso na tela. O horário escolhido tem fundo cheio, ícone de confirmação e
  `aria-pressed`, nos dois temas.
- A barra "Continuar" da etapa de horário é `sticky`, não `fixed`: ocupa o
  próprio lugar no fim do conteúdo, respeita `safe-area-inset-bottom` e não
  existe nas etapas com campo de texto, então o teclado não a sobrepõe a
  campos ou mensagens.
- A revisão mostra estabelecimento, serviço, profissional, data, horário,
  fuso, preço, nome e WhatsApp. O botão final diz "Solicitar agendamento" e o
  resultado diz "Solicitação enviada — aguardando confirmação". Um pedido
  PENDING nunca aparece como confirmado.
- Mantido sem alteração: a chave de idempotência gerada quando o pedido muda,
  a barreira contra clique duplo, "Verificar envio" para resposta perdida,
  nenhum POST repetido sozinho, o tratamento de conflito (volta para a escolha
  do horário com a lista relida), limite de tentativas, página desativada e a
  recuperação de hibernação do PR #59 nas leituras. Enter num campo só envia
  na etapa Revisar.

## Aparência

- Claro, Escuro ou Seguir aparelho. A primeira visita segue o aparelho e a
  escolha manual fica salva neste navegador (`agenda-cloud:aparencia`).
- O `<html>` recebe `data-tema` por um script inline no `<head>` antes da
  primeira pintura; em "Seguir aparelho" o próprio CSS acompanha
  `prefers-color-scheme`. O conteúdo não muda na hidratação.
- Os tokens escuros só valem em página que se declara adaptável
  (`MarcadorAparencia`): agendamento público, `/conta`, login, cadastro e
  administração. A demonstração (`/painel`, `/master`, `/[slug]`, site) não
  foi revisada para o escuro e continua sempre clara.
- Tokens novos: `on-accent`, `on-danger`, `border-strong` (bordas de campo com
  3:1) e `chrome` (menu lateral e painel do login, escuros nos dois temas).
  Contraste do tema escuro: texto ≥ 7:1, estados ≥ 6:1.
- No agendamento público, o seletor fica no rodapé. Na área da conta, no menu
  da conta.

## Notificações do responsável

- Sino "Notificações" no cabeçalho com o número real de pendentes, vindo do
  `SolicitacoesProvider` (nenhuma consulta nova). Leva à tela de Solicitações,
  que agora mostra a lista antes dos controles. Abrir não confirma, recusa nem
  remarca nada.
- Menu da conta: quem está conectado, pendentes, situação das notificações
  neste aparelho (ativadas, desativadas, bloqueadas, indisponíveis), som,
  link para os controles que já existiam (`/conta/solicitacoes#notificacoes`),
  Aparência, Minha conta e Sair.
- A situação do push usa o mesmo hook do cartão existente
  (`src/lib/push/use-notificacoes-do-dispositivo.ts`): uma verificação ao abrir
  o menu, nunca periódica. A permissão do navegador só é pedida pelo botão
  "Ativar" do cartão. As instruções do iPhone continuam as do cartão.
- O cliente público não vê nada disso, nem WhatsApp automático ou lembretes,
  que seguem fora deste lote.

## Validação no Windows (22/10/2026)

PostgreSQL 17 descartável, criado só para esta validação num diretório
temporário, porta 55433, TLS com verificação completa do certificado
autoassinado, migrations aplicadas por `migration:run:compiled`.
`IGNORE_DOTENV_FILE=true` em todos os processos; nenhum `.env` real,
`agenda_dev`, Neon, piloto ou produção foi usado. Push nunca enviado: o
PushManager é simulado onde é preciso e as chaves VAPID são da execução.

- Unidade do frontend: 823 testes; lint e lint de tipos sem erro (só os
  dois avisos antigos); typecheck e build.
- Navegador, cada suíte na própria invocação (servidores novos): auth (8),
  services (5), professionals (3), working-hours (2), availability (2),
  appointments (4), administracao (1), clients (3), whatsapp (1),
  agendamento-publico (1), avisos-solicitacoes (1), recuperacao (12),
  push (1), aparencia (2, nova), agenda-view (1), agenda-profissional (1)
  e visao-geral (1). Todas passaram.
- `test:browser:proxy`: 4 de 5. O caso de cadastro/login pela mesma origem
  para em "Conectando ao servidor…" antes do login, a mesma falha já
  registrada neste Windows no commit base `20e3fdc`. O CI Linux decide.
- Backend sem alteração neste lote; as suítes dele rodam no CI.
- Capturas conferidas: as cinco etapas do agendamento e o menu da conta, em
  claro e escuro, a 360, 390 e 1280 px, com nome de estabelecimento e de
  serviço longos, sem rolagem lateral.

## Fica para a validação física, depois da publicação

- iPhone: área segura com a barra "Continuar", teclado aberto em "Seus
  dados", tema do aparelho mudando com a página aberta, aparência no app
  instalado na Tela de Início.
- Recebimento real de push no iPhone instalado e no Android (roteiro em
  `docs/runbooks/publicacao-piloto-render.md`).
