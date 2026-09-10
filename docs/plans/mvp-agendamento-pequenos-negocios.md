# MVP de Mensageria de Agendamento — Requisitos para o Piloto Real

**Contexto:** o Lote 6A criou o site comercial e o onboarding demonstrável do Agenda Cloud (`/onboarding`), anunciando lembrete, confirmação, cancelamento/remarcação por link, mensagem pós-atendimento, pesquisa de satisfação, convite de reagendamento e notificações ao estabelecimento como "em desenvolvimento para o piloto" (ver `src/lib/site/conteudo-comercial.ts`). Nenhuma dessas funcionalidades tem envio real implementado nesta etapa — este documento registra o que é obrigatório resolver antes de abrir um piloto real com clientes de verdade. Não é um plano de implementação passo a passo; é o registro de requisitos que qualquer implementação futura precisa atender.

**Fora de escopo aqui:** enviar qualquer mensagem de verdade, conectar um provedor externo (e-mail, SMS ou WhatsApp), ou desenhar a UI de configuração dessas mensagens. Isso fica para quando o piloto real for de fato implementado.

## Catálogo de planos e preços (Lote 6B.2)

- Códigos internos estáveis: `essencial`, `equipe`, `pro` (`CodigoPlano` em `src/lib/types.ts`, mesmos códigos no banco em `plans.code`).
- Nomes comerciais exibidos ao cliente: Essencial, Gestão e Rede — mapeiam 1:1 para `essencial`/`equipe`/`pro`, respectivamente. Um nome comercial pode divergir do código interno (ex.: código `equipe` aparece como "Gestão").
- Preço (`price_cents`/`precoCentavos`) ainda não foi aprovado comercialmente: é `NULL` ("não definido"), nunca `0`. O site comercial não mostra valor numérico — só "Preço em definição para o piloto" ou "Participe do piloto".
- Cobrança (processar pagamento, cobrar assinatura) permanece fora de escopo do MVP atual, junto com os itens já listados abaixo.

## Cadastro de estabelecimento (Lote 6B.3)

- **Implementado no backend:** `POST /auth/register` (`backend/src/auth/`) cria, numa única transação TypeORM, o User (sem privilégios de plataforma), a Credential, o Tenant, a Unit principal, a Membership com papel `DONO` e a Session — com rollback total se qualquer etapa falhar.
- **Trial de 14 dias:** todo novo estabelecimento entra automaticamente no plano comercial **Gestão** (código interno `equipe`), com preço ainda `NULL` (não definido comercialmente — ver seção acima). O trial começa no instante da criação da conta e termina exatamente 14 dias depois, sempre calculado em UTC a partir de `Tenant.createdAt` (não há coluna dedicada de trial; início/fim são derivados dessa mesma coluna + duração fixa de 14 dias).
- **Senha:** hash com Argon2id (nunca outro algoritmo), gerado só no servidor; texto puro nunca é persistido, logado ou aparece em mensagem de erro.
- **Sessão:** opaca (nunca JWT) — token aleatório de 32+ bytes via `node:crypto`, exposto ao cliente só pelo cookie `session_token` (HttpOnly, SameSite=Lax, Secure em produção, Path=/); o banco guarda somente o SHA-256 do token. O cookie só é emitido depois do COMMIT da transação.
- **Rate limit:** 5 tentativas de cadastro por IP a cada 15 minutos (`express-rate-limit`, `MemoryStore`). O `MemoryStore` só é aceitável para o MVP em instância única — hospedagem horizontal (múltiplas instâncias) vai exigir um store compartilhado (Redis ou equivalente) para o limite valer entre processos, o que ainda não existe.
- **Pendente para o Lote 6B.4:** login, `GET /auth/me` e logout continuam não implementados — o cadastro cria a sessão inicial, mas não há forma de autenticar de novo com a mesma credencial ainda.
- **Ainda não verificados:** telefone e e-mail são só armazenados/normalizados no cadastro — nenhuma verificação (código por SMS, confirmação por e-mail) existe nesta etapa.
- **Frontend:** ainda não conectado a este endpoint — o formulário de onboarding em `/onboarding` continua demonstrativo (ver Lote 6A), sem chamar `POST /auth/register` de verdade.

## Requisitos obrigatórios antes do piloto

- **Lembrete configurável** — no mínimo dois horários de disparo por padrão: 24 horas e 2 horas antes do agendamento. O estabelecimento deve poder ajustar esses horários.
- **Confirmação, cancelamento e remarcação** — o cliente precisa conseguir confirmar presença, cancelar ou remarcar a partir da própria mensagem (link), sem precisar ligar ou mandar mensagem separada.
- **Cancelamento automático dos lembretes pendentes quando o agendamento mudar** — se o horário for remarcado ou cancelado, qualquer lembrete/mensagem futura já agendada para o horário antigo precisa ser cancelada. Nunca pode chegar um lembrete de um horário que não existe mais.
- **Mensagem pós-atendimento** — agradecimento, pesquisa rápida de satisfação e convite para um novo agendamento, disparados depois que o atendimento é marcado como concluído.
- **Modelos de mensagem configuráveis** — o texto de cada tipo de mensagem (lembrete, confirmação, pós-atendimento etc.) deve poder ser editado pelo estabelecimento, não fixo no código.
- **Consentimento e opção de não receber (opt-out)** — o cliente precisa poder optar por não receber esse tipo de mensagem, e essa escolha precisa ser respeitada em todos os disparos futuros.
- **Horário local do estabelecimento** — todo disparo respeita o fuso horário do estabelecimento (`Estabelecimento.fusoHorario`), nunca UTC bruto nem o fuso do servidor.
- **Histórico de entrega** — cada mensagem enviada (ou tentativa) fica registrada: tipo, destinatário, horário, canal e resultado (entregue, falhou, etc.).
- **Tentativas controladas, sem duplicidade** — reenvio automático em caso de falha, mas com limite de tentativas e proteção contra mandar a mesma mensagem duas vezes para o mesmo agendamento.
- **Provedores substituíveis** — a camada de envio deve ser desacoplada do provedor: trocar o provedor de e-mail, SMS ou WhatsApp não pode exigir reescrever a lógica de quando/o que enviar.

## Não fazer nesta etapa

- Não implementar envio real de nenhuma mensagem.
- Não conectar nenhum provedor externo (e-mail, SMS, WhatsApp) nem guardar credencial de provedor.
- Não prometer, na comunicação com usuários, que qualquer um destes itens já funciona.
