"use client";

// Confirmação de cancelamento de UMA reserva (Lote 6D.6), separada de
// acoes-reserva.tsx. Mostra exatamente a reserva cujo horário será enviado
// como `expectedStartAt` e, se ela mudou com a confirmação aberta, avisa e
// mostra os dados novos — a pessoa decide de novo, nada é reenviado sozinho.
import type { AgendamentoReal } from "@/lib/api/appointments-api";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";

/** A confirmação NOMEIA a reserva: hora, serviço, profissional e cliente. */
export function ConfirmarCancelamento({
  agendamento,
  anterior,
  gravando,
  aoDesistir,
  aoConfirmar,
}: {
  agendamento: AgendamentoReal;
  /** O que a confirmação mostrava antes de a reserva mudar, se mudou. */
  anterior: AgendamentoReal | null;
  gravando: boolean;
  aoDesistir: () => void;
  aoConfirmar: () => Promise<void>;
}) {
  return (
    <Cartao>
      <CartaoCorpo className="space-y-3" data-testid="confirmar-cancelamento">
        {anterior && (
          <p role="alert" className="text-sm text-ink" data-testid="reserva-alterada">
            Esta reserva foi alterada depois que a confirmação foi aberta (antes:{" "}
            {anterior.localStart}–{anterior.localServiceEnd}). Nada foi cancelado. Confira os dados
            atualizados abaixo antes de confirmar de novo.
          </p>
        )}
        <p className="text-sm font-semibold text-ink">Cancelar esta reserva?</p>
        <p className="text-sm text-ink" data-testid="reserva-a-cancelar">
          {agendamento.localStart}–{agendamento.localServiceEnd} · {agendamento.service.name} · com{" "}
          {agendamento.professional.name} · para {agendamento.consumer.name}
        </p>
        <p className="text-xs text-ink-soft">
          O horário volta a ficar livre para outra reserva. A reserva não é apagada: fica registrada
          como cancelada.
        </p>
        <div className="flex flex-wrap gap-2">
          <Botao
            type="button"
            data-testid="confirmar-cancelamento-botao"
            disabled={gravando}
            aria-busy={gravando}
            onClick={() => void aoConfirmar()}
          >
            {gravando ? "Cancelando..." : "Sim, cancelar"}
          </Botao>
          <Botao type="button" variante="secundaria" disabled={gravando} onClick={aoDesistir}>
            Manter reserva
          </Botao>
        </div>
      </CartaoCorpo>
    </Cartao>
  );
}
