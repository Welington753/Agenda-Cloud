// Prévia da agenda na página inicial: a MESMA lista da agenda do dia real
// (visualização "Lista": o contêiner de agenda-do-dia.tsx e cada linha
// desenhada por CartaoAtendimento), alimentada com dados fictícios
// (src/lib/site/previa-da-agenda.ts). Sem ações, sem relógio ("No horário
// agora" depende da hora de quem vê) e sem nenhuma chamada à API.
//
// Para o leitor de tela a prévia é uma figura com legenda: o conteúdo
// fictício fica escondido dele, para não ser lido como uma agenda de verdade.
// No celular aparecem só as três primeiras linhas.
import { CartaoAtendimento } from "@/components/conta/cartao-atendimento";
import { LEGENDA_DA_PREVIA, ROTULO_DA_PREVIA, agendamentosDaPrevia } from "@/lib/site/previa-da-agenda";

export function PreviaAgenda() {
  return (
    <figure className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-paper shadow-[var(--shadow-lift)]">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-3 sm:px-5">
        <span className="text-sm font-semibold text-ink">Agenda do dia</span>
        <span
          data-testid="selo-da-previa"
          className="rounded-[var(--radius-control)] border border-dashed border-border-strong px-2 py-0.5 text-xs font-semibold text-ink-soft"
        >
          {ROTULO_DA_PREVIA}
        </span>
        <span className="sr-only">{LEGENDA_DA_PREVIA}</span>
      </figcaption>
      <div aria-hidden="true" inert className="p-3 sm:p-5">
        <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border bg-card">
          {agendamentosDaPrevia().map((agendamento, i) => (
            <li key={agendamento.id} className={i >= 3 ? "max-sm:hidden" : undefined}>
              <CartaoAtendimento agendamento={agendamento} noHorario={false} recemCriada={false} />
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}
