"use client";

// Atalhos para conversar com o cliente no WhatsApp (ver lib/contato/whatsapp.ts).
// São LINKS comuns para o wa.me, abertos em outra aba: nada aqui chama a API,
// grava estado ou mexe na reserva. Quem revisa e envia a mensagem é o
// responsável, no próprio WhatsApp.
//
// Aparecem só onde o telefone já está na tela para quem tem acesso (resultado
// de Clientes e cartão da agenda) — nenhum dado novo é exposto.
import clsx from "clsx";
import { CalendarClock, MessageCircle } from "lucide-react";
import type { AgendamentoReal } from "@/lib/api/appointments-api";
import { linkWhatsapp, mensagemCombinarOutroHorario } from "@/lib/contato/whatsapp";

const CLASSE_LINK =
  "inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-card px-3 text-sm font-medium text-ink hover:bg-paper-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** Só faz sentido combinar outro horário de reserva que ainda vai acontecer. */
const STATUS_COMBINAVEIS: ReadonlySet<AgendamentoReal["status"]> = new Set([
  "PENDING",
  "CONFIRMED",
]);

interface LinkWhatsappClienteProps {
  nome: string;
  telefone: string;
  className?: string;
}

/** Abrir a conversa com o cliente, sem texto pronto. */
export function LinkWhatsappCliente({ nome, telefone, className }: LinkWhatsappClienteProps) {
  const href = linkWhatsapp(telefone);
  if (!href) {
    return (
      <span className="text-xs text-ink-soft" data-testid="whatsapp-indisponivel">
        WhatsApp indisponível: telefone sem formato válido.
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="abrir-whatsapp"
      className={clsx(CLASSE_LINK, className)}
    >
      <MessageCircle size={16} aria-hidden="true" />
      WhatsApp
      <span className="sr-only"> de {nome} (abre o WhatsApp em outra aba)</span>
    </a>
  );
}

interface ContatoDaReservaProps {
  agendamento: AgendamentoReal;
  /** Nome do estabelecimento ativo, como a sessão o mostra. */
  estabelecimento: string;
}

/** Atalhos do cartão da agenda: conversa e "Combinar outro horário". */
export function ContatoDaReserva({ agendamento, estabelecimento }: ContatoDaReservaProps) {
  const { consumer } = agendamento;
  const mensagem = STATUS_COMBINAVEIS.has(agendamento.status)
    ? mensagemCombinarOutroHorario({
        nomeCliente: consumer.name,
        estabelecimento,
        startAt: agendamento.startAt,
        horaLocal: agendamento.localStart,
        timezone: agendamento.timezone,
      })
    : null;
  const hrefCombinar = mensagem ? linkWhatsapp(consumer.whatsapp, mensagem) : null;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="contato-reserva">
      <LinkWhatsappCliente nome={consumer.name} telefone={consumer.whatsapp} />
      {hrefCombinar && (
        <a
          href={hrefCombinar}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="combinar-outro-horario"
          className={CLASSE_LINK}
        >
          <CalendarClock size={16} aria-hidden="true" />
          Combinar outro horário
          <span className="sr-only"> com {consumer.name} pelo WhatsApp (abre em outra aba)</span>
        </a>
      )}
    </div>
  );
}
