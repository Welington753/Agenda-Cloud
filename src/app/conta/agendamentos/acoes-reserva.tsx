"use client";

// Ações sobre uma reserva existente: remarcar e cancelar (Lote 6D.6),
// confirmar, iniciar, concluir e registrar falta (Lote 6D.7).
//
// QUAIS botões aparecem vem de `acoesDaReserva` (estado + horário), uma cópia
// de apresentação das regras do servidor: esconder um botão não é controle de
// acesso, e o servidor revalida tudo dentro da transação.
//
// "Confirmar" e "Iniciar" são um clique só — não encerram nada. "Cancelar",
// "Concluir" e "Registrar falta" pedem confirmação que NOMEIA a reserva,
// porque não têm volta pela agenda.
//
// Toda ação envia o instante que a tela MOSTRA como `expectedStartAt`: se a
// reserva foi movida depois de a agenda carregar, o servidor recusa com 409 e
// a agenda é recarregada — nunca há reenvio automático.
import { useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, Play, ThumbsUp, UserX, XCircle } from "lucide-react";
import type { AgendamentoReal } from "@/lib/api/appointments-api";
import type { AcaoDeStatusReal } from "@/lib/api/appointment-status-api";
import type { AcoesDaReserva } from "@/lib/profissionais/andamento";
import { Botao } from "@/components/ui/button";
import { ConfirmarAcao, type AcaoConfirmada, type ConfirmacaoPendente } from "./confirmar-acao";
import { PainelRemarcacao } from "./painel-remarcacao";

interface AcoesReservaProps {
  tenantId: string;
  agendamento: AgendamentoReal;
  /** O que a linha oferece agora (estado + horário). */
  acoes: AcoesDaReserva;
  /** `true` enquanto QUALQUER gravação da agenda está em voo. */
  gravando: boolean;
  /** Confirmação aberta para ESTA reserva, se houver. O estado vive em
   * `AgendaDoDia`: o reload da agenda desmonta esta linha, e a confirmação
   * (com o aviso de que a reserva mudou) precisa sobreviver a ele. */
  confirmacao: ConfirmacaoPendente | null;
  aoAbrirConfirmacao: (acao: AcaoConfirmada) => void;
  aoFecharConfirmacao: () => void;
  aoCancelar: (appointmentId: string, expectedStartAt: string) => Promise<boolean>;
  aoAlterarStatus: (
    appointmentId: string,
    acao: AcaoDeStatusReal,
    expectedStartAt: string,
  ) => Promise<boolean>;
  aoRemarcar: (
    appointmentId: string,
    dados: { startAt: string; expectedStartAt: string },
  ) => Promise<boolean>;
}

export function AcoesReserva({
  tenantId,
  agendamento,
  acoes,
  gravando,
  confirmacao,
  aoAbrirConfirmacao,
  aoFecharConfirmacao,
  aoCancelar,
  aoAlterarStatus,
  aoRemarcar,
}: AcoesReservaProps) {
  const [remarcando, setRemarcando] = useState(false);

  // A reserva mudou de instante ou de estado: o painel de remarcação passa a
  // falar de algo que não existe mais, então fecha. Uma confirmação aberta NÃO
  // fecha em silêncio: `AgendaDoDia` passa a mostrar os dados novos com aviso.
  useEffect(() => {
    setRemarcando(false);
  }, [agendamento.startAt, agendamento.status]);

  if (confirmacao) {
    const { acao, exibida } = confirmacao;
    return (
      <ConfirmarAcao
        confirmacao={confirmacao}
        gravando={gravando}
        aoDesistir={aoFecharConfirmacao}
        aoConfirmar={async () => {
          // O instante MOSTRADO nesta confirmação, nunca o mais recente da
          // agenda: se divergir do gravado, o servidor recusa com 409.
          const ok =
            acao === "cancel"
              ? await aoCancelar(exibida.id, exibida.startAt)
              : await aoAlterarStatus(exibida.id, acao, exibida.startAt);
          if (ok) aoFecharConfirmacao();
        }}
      />
    );
  }

  if (remarcando) {
    return (
      <PainelRemarcacao
        tenantId={tenantId}
        agendamento={agendamento}
        gravando={gravando}
        aoDesistir={() => setRemarcando(false)}
        aoRemarcar={aoRemarcar}
      />
    );
  }

  /** Um clique só: o instante enviado é o da linha que está na tela. */
  const imediata = (acao: AcaoDeStatusReal) => () =>
    void aoAlterarStatus(agendamento.id, acao, agendamento.startAt);

  return (
    <div className="flex flex-wrap gap-2" data-testid="acoes-reserva">
      {acoes.confirmar && (
        <Botao
          type="button"
          data-testid="confirmar-reserva"
          disabled={gravando}
          onClick={imediata("confirm")}
        >
          <ThumbsUp size={14} className="mr-1" />
          Confirmar
        </Botao>
      )}
      {acoes.iniciar && (
        <Botao
          type="button"
          data-testid="iniciar-atendimento"
          disabled={gravando}
          onClick={imediata("start")}
        >
          <Play size={14} className="mr-1" />
          Iniciar atendimento
        </Botao>
      )}
      {acoes.concluir && (
        <Botao
          type="button"
          data-testid="abrir-conclusao"
          disabled={gravando}
          onClick={() => aoAbrirConfirmacao("complete")}
        >
          <CheckCircle2 size={14} className="mr-1" />
          Concluir
        </Botao>
      )}
      {acoes.registrarFalta && (
        <Botao
          type="button"
          variante="secundaria"
          data-testid="abrir-falta"
          disabled={gravando}
          onClick={() => aoAbrirConfirmacao("no-show")}
        >
          <UserX size={14} className="mr-1" />
          Registrar falta
        </Botao>
      )}
      {acoes.remarcar && (
        <Botao
          type="button"
          variante="secundaria"
          data-testid="abrir-remarcacao"
          disabled={gravando}
          onClick={() => setRemarcando(true)}
        >
          <CalendarClock size={14} className="mr-1" />
          Remarcar
        </Botao>
      )}
      {acoes.cancelar && (
        <Botao
          type="button"
          variante="secundaria"
          data-testid="abrir-cancelamento"
          disabled={gravando}
          onClick={() => aoAbrirConfirmacao("cancel")}
        >
          <XCircle size={14} className="mr-1" />
          Cancelar
        </Botao>
      )}
    </div>
  );
}
