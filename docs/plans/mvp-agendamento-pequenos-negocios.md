# MVP de Mensageria de Agendamento — Requisitos para o Piloto Real

**Contexto:** o Lote 6A criou o site comercial e o onboarding demonstrável do Agenda Cloud (`/onboarding`), anunciando lembrete, confirmação, cancelamento/remarcação por link, mensagem pós-atendimento, pesquisa de satisfação, convite de reagendamento e notificações ao estabelecimento como "em desenvolvimento para o piloto" (ver `src/lib/site/conteudo-comercial.ts`). Nenhuma dessas funcionalidades tem envio real implementado nesta etapa — este documento registra o que é obrigatório resolver antes de abrir um piloto real com clientes de verdade. Não é um plano de implementação passo a passo; é o registro de requisitos que qualquer implementação futura precisa atender.

**Fora de escopo aqui:** enviar qualquer mensagem de verdade, conectar um provedor externo (e-mail, SMS ou WhatsApp), ou desenhar a UI de configuração dessas mensagens. Isso fica para quando o piloto real for de fato implementado.

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
