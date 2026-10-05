"use client";

// Confirmação das ações que não têm volta neste momento, sobre UMA reserva:
// cancelar (Lote 6D.6), concluir e registrar falta (Lote 6D.7).
//
// A confirmação NOMEIA a reserva (hora, serviço, profissional e cliente) e o
// horário enviado como `expectedStartAt` é o que ela MOSTRA. Se a reserva
// mudou com a confirmação aberta (ou o servidor recusou com 409 porque mudou),
// ela passa a mostrar os dados novos com um aviso — a pessoa decide de novo,
// nada é reenviado sozinho.
import type { AgendamentoReal } from "@/lib/api/appointments-api";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";

/** Ações que pedem confirmação. "Confirmar" e "Iniciar" são um clique só. */
export type AcaoConfirmada = "cancel" | "complete" | "no-show";

/** O que a confirmação está mostrando, e o que mostrava antes se a reserva
 * mudou com ela aberta. */
export interface ConfirmacaoPendente {
  acao: AcaoConfirmada;
  exibida: AgendamentoReal;
  anterior: AgendamentoReal | null;
}

interface Textos {
  testId: string;
  testIdReserva: string;
  testIdBotao: string;
  pergunta: string;
  explicacao: string;
  confirmar: string;
  confirmando: string;
  desistir: string;
  nadaFeito: string;
}

const TEXTOS: Record<AcaoConfirmada, Textos> = {
  cancel: {
    testId: "confirmar-cancelamento",
    testIdReserva: "reserva-a-cancelar",
    testIdBotao: "confirmar-cancelamento-botao",
    pergunta: "Cancelar esta reserva?",
    explicacao:
      "O horário volta a ficar livre para outra reserva. A reserva não é apagada: fica registrada como cancelada.",
    confirmar: "Sim, cancelar",
    confirmando: "Cancelando...",
    desistir: "Manter reserva",
    nadaFeito: "Nada foi cancelado.",
  },
  complete: {
    testId: "confirmar-conclusao",
    testIdReserva: "reserva-a-concluir",
    testIdBotao: "confirmar-conclusao-botao",
    pergunta: "Concluir este atendimento?",
    explicacao:
      "A reserva passa a constar como concluída. Esta ação não pode ser desfeita pela agenda.",
    confirmar: "Sim, concluir",
    confirmando: "Concluindo...",
    desistir: "Voltar",
    nadaFeito: "Nada foi alterado.",
  },
  "no-show": {
    testId: "confirmar-falta",
    testIdReserva: "reserva-com-falta",
    testIdBotao: "confirmar-falta-botao",
    pergunta: "Registrar que o cliente não compareceu?",
    explicacao:
      "O horário continua ocupado e a reserva passa a constar como falta. Esta ação não pode ser desfeita pela agenda.",
    confirmar: "Sim, registrar falta",
    confirmando: "Registrando...",
    desistir: "Voltar",
    nadaFeito: "Nada foi alterado.",
  },
};

export function ConfirmarAcao({
  confirmacao,
  gravando,
  aoDesistir,
  aoConfirmar,
}: {
  confirmacao: ConfirmacaoPendente;
  gravando: boolean;
  aoDesistir: () => void;
  aoConfirmar: () => Promise<void>;
}) {
  const { acao, exibida: agendamento, anterior } = confirmacao;
  const textos = TEXTOS[acao];

  return (
    <Cartao>
      <CartaoCorpo className="space-y-3" data-testid={textos.testId}>
        {anterior && (
          <p role="alert" className="text-sm text-ink" data-testid="reserva-alterada">
            Esta reserva foi alterada depois que a confirmação foi aberta (antes:{" "}
            {anterior.localStart}–{anterior.localServiceEnd}). {textos.nadaFeito} Confira os dados
            atualizados abaixo antes de confirmar de novo.
          </p>
        )}
        <p className="text-sm font-semibold text-ink">{textos.pergunta}</p>
        <p className="text-sm text-ink" data-testid={textos.testIdReserva}>
          {agendamento.localStart}–{agendamento.localServiceEnd} · {agendamento.service.name} · com{" "}
          {agendamento.professional.name} · para {agendamento.consumer.name}
        </p>
        <p className="text-xs text-ink-soft">{textos.explicacao}</p>
        <div className="flex flex-wrap gap-2">
          <Botao
            type="button"
            data-testid={textos.testIdBotao}
            disabled={gravando}
            aria-busy={gravando}
            onClick={() => void aoConfirmar()}
          >
            {gravando ? textos.confirmando : textos.confirmar}
          </Botao>
          <Botao type="button" variante="secundaria" disabled={gravando} onClick={aoDesistir}>
            {textos.desistir}
          </Botao>
        </div>
      </CartaoCorpo>
    </Cartao>
  );
}
