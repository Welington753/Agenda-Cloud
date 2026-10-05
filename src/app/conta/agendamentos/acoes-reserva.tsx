"use client";

// Cancelamento e remarcação de uma reserva (Lote 6D.6).
//
// ESCOPO: só o horário. Não existe aqui troca de cliente, de profissional, de
// serviço nem de status — o contrato do backend também não aceita nada disso.
//
// CANCELAMENTO pede confirmação explícita e a confirmação REPETE qual reserva
// será cancelada (hora, serviço e cliente). Um "Tem certeza?" genérico, numa
// agenda com várias reservas parecidas, não deixa claro qual delas vai embora.
// O instante enviado é o que a confirmação MOSTRA: se a reserva mudar enquanto
// ela está aberta (ou o servidor recusar com 409 porque mudou), a confirmação
// passa a mostrar os dados novos com um aviso, e só um novo clique cancela —
// nunca um reenvio automático nem uma troca silenciosa do horário enviado.
//
// REMARCAÇÃO mostra o horário ATUAL e o NOVO lado a lado antes de confirmar,
// porque é a única forma de a pessoa perceber que escolheu o slot errado antes
// de gravar.
//
// Os horários NUNCA são montados no navegador: cada opção é um slot devolvido
// pelo backend e o que é enviado é o `startAt` exato dele. O mesmo vale para
// `expectedStartAt`, que é o instante da reserva como o servidor a devolveu —
// é ele que faz o servidor recusar uma remarcação disparada de uma tela
// desatualizada.
import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Info, XCircle } from "lucide-react";
import {
  listarHorariosParaRemarcar,
  type AgendamentoReal,
  type OpcoesDeRemarcacao,
} from "@/lib/api/appointments-api";
import { comoDataDeCalendario, rotuloDaData, rotuloDeDuracao } from "@/lib/profissionais/agendamentos";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { ConfirmarCancelamento } from "./confirmar-cancelamento";

interface AcoesReservaProps {
  tenantId: string;
  agendamento: AgendamentoReal;
  /** `true` enquanto QUALQUER gravação da agenda está em voo. */
  gravando: boolean;
  aoCancelar: (appointmentId: string, expectedStartAt: string) => Promise<boolean>;
  aoRemarcar: (
    appointmentId: string,
    dados: { startAt: string; expectedStartAt: string },
  ) => Promise<boolean>;
}

type Modo = "fechado" | "cancelando" | "remarcando";

/** O que a confirmação de cancelamento está mostrando, e o que mostrava antes
 * se a reserva mudou com ela aberta. */
interface ConfirmacaoCancelamento {
  exibida: AgendamentoReal;
  anterior: AgendamentoReal | null;
}

export function AcoesReserva({
  tenantId,
  agendamento,
  gravando,
  aoCancelar,
  aoRemarcar,
}: AcoesReservaProps) {
  const [modo, setModo] = useState<Modo>("fechado");
  const [confirmacao, setConfirmacao] = useState<ConfirmacaoCancelamento | null>(null);

  // A reserva mudou de instante (remarcada com sucesso, ou a agenda foi
  // recarregada): o painel de remarcação passa a falar de um estado que não
  // existe mais, então fecha. A confirmação de cancelamento NÃO fecha em
  // silêncio: ela passa a mostrar os dados novos com um aviso (efeito abaixo).
  useEffect(() => {
    setModo((atual) => (atual === "cancelando" ? atual : "fechado"));
  }, [agendamento.startAt, agendamento.status]);

  useEffect(() => {
    setConfirmacao((atual) => {
      if (!atual) return atual;
      const { exibida } = atual;
      if (exibida.startAt === agendamento.startAt && exibida.status === agendamento.status) {
        return atual;
      }
      return { exibida: agendamento, anterior: exibida };
    });
  }, [agendamento]);

  function fecharConfirmacao() {
    setConfirmacao(null);
    setModo("fechado");
  }

  if (modo === "cancelando" && confirmacao) {
    const { exibida } = confirmacao;
    return (
      <ConfirmarCancelamento
        agendamento={exibida}
        anterior={confirmacao.anterior}
        gravando={gravando}
        aoDesistir={fecharConfirmacao}
        aoConfirmar={async () => {
          // O instante MOSTRADO nesta confirmação, nunca o mais recente da
          // agenda: se divergir do gravado, o servidor recusa com 409.
          const ok = await aoCancelar(exibida.id, exibida.startAt);
          if (ok) fecharConfirmacao();
        }}
      />
    );
  }

  if (modo === "remarcando") {
    return (
      <PainelRemarcacao
        tenantId={tenantId}
        agendamento={agendamento}
        gravando={gravando}
        aoDesistir={() => setModo("fechado")}
        aoRemarcar={aoRemarcar}
      />
    );
  }

  return (
    <div className="flex flex-wrap gap-2" data-testid="acoes-reserva">
      <Botao
        type="button"
        variante="secundaria"
        data-testid="abrir-remarcacao"
        disabled={gravando}
        onClick={() => setModo("remarcando")}
      >
        <CalendarClock size={14} className="mr-1" />
        Remarcar
      </Botao>
      <Botao
        type="button"
        variante="secundaria"
        data-testid="abrir-cancelamento"
        disabled={gravando}
        onClick={() => {
          setConfirmacao({ exibida: agendamento, anterior: null });
          setModo("cancelando");
        }}
      >
        <XCircle size={14} className="mr-1" />
        Cancelar
      </Botao>
    </div>
  );
}

type EstadoOpcoes =
  | { status: "carregando" }
  | { status: "carregada"; opcoes: OpcoesDeRemarcacao }
  | { status: "falha" };

function PainelRemarcacao({
  tenantId,
  agendamento,
  gravando,
  aoDesistir,
  aoRemarcar,
}: {
  tenantId: string;
  agendamento: AgendamentoReal;
  gravando: boolean;
  aoDesistir: () => void;
  aoRemarcar: (
    appointmentId: string,
    dados: { startAt: string; expectedStartAt: string },
  ) => Promise<boolean>;
}) {
  // Começa no dia da própria reserva: é o caso mais comum (mover uma hora no
  // mesmo dia) e não obriga a digitar a data de novo.
  const [date, setDate] = useState(() => comoDataDeCalendario(new Date(agendamento.startAt)));
  const [escolhido, setEscolhido] = useState("");
  const [estado, setEstado] = useState<EstadoOpcoes>({ status: "carregando" });

  const appointmentId = agendamento.id;

  useEffect(() => {
    setEstado({ status: "carregando" });
    // Trocar de dia invalida o slot escolhido: ele era de outro dia.
    setEscolhido("");

    const controller = new AbortController();
    let cancelado = false;

    void (async () => {
      const resultado = await listarHorariosParaRemarcar(
        tenantId,
        appointmentId,
        date,
        controller.signal,
      );
      if (cancelado) return;
      setEstado(
        resultado.ok ? { status: "carregada", opcoes: resultado.dados } : { status: "falha" },
      );
    })();

    return () => {
      cancelado = true;
      controller.abort();
    };
  }, [tenantId, appointmentId, date]);

  const slots = estado.status === "carregada" ? estado.opcoes.slots : [];
  const slotEscolhido = slots.find((slot) => slot.startAt === escolhido);

  const confirmar = useCallback(async () => {
    // Segunda barreira contra envio duplicado, além do `disabled` do botão.
    if (gravando || !slotEscolhido) return;
    const ok = await aoRemarcar(appointmentId, {
      startAt: slotEscolhido.startAt,
      // O instante que ESTA tela está mostrando — o servidor recusa se a
      // reserva já tiver sido movida por outra pessoa ou outra aba.
      expectedStartAt: agendamento.startAt,
    });
    if (ok) aoDesistir();
  }, [gravando, slotEscolhido, aoRemarcar, appointmentId, agendamento.startAt, aoDesistir]);

  return (
    <Cartao>
      <CartaoCorpo className="space-y-3" data-testid="painel-remarcacao">
        <p className="text-sm font-semibold text-ink">Remarcar reserva</p>

        {/* Horário ATUAL sempre visível: é a metade da comparação. */}
        <p className="text-sm text-ink" data-testid="horario-atual">
          Agora: {rotuloDaData(comoDataDeCalendario(new Date(agendamento.startAt)))} ·{" "}
          {agendamento.localStart}–{agendamento.localServiceEnd}
        </p>

        <div>
          <label
            htmlFor={`remarcar-data-${appointmentId}`}
            className="mb-1 block text-xs font-medium text-ink-soft"
          >
            Novo dia
          </label>
          <input
            id={`remarcar-data-${appointmentId}`}
            type="date"
            value={date}
            disabled={gravando}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
          />
        </div>

        {estado.status === "carregando" && (
          <p className="text-sm text-ink-soft" aria-busy="true">
            Consultando horários...
          </p>
        )}

        {estado.status === "falha" && (
          <p role="alert" className="text-sm text-ink">
            Não foi possível consultar os horários agora. Escolha o dia novamente.
          </p>
        )}

        {estado.status === "carregada" && slots.length === 0 && (
          <p data-testid="sem-horarios-remarcacao" className="text-sm text-ink">
            Nenhum horário livre neste dia para esta reserva.
          </p>
        )}

        {slots.length > 0 && (
          <ul data-testid="horarios-remarcacao" className="flex flex-wrap gap-2">
            {slots.map((slot) => {
              const selecionado = slot.startAt === escolhido;
              return (
                <li key={slot.startAt}>
                  <button
                    type="button"
                    data-testid="horario-remarcacao"
                    data-inicio={slot.startAt}
                    disabled={gravando}
                    onClick={() => setEscolhido(slot.startAt)}
                    className={`rounded-[var(--radius-control)] border px-3 py-1.5 text-sm ${
                      selecionado ? "border-accent bg-paper-muted font-semibold" : "border-border"
                    }`}
                  >
                    {slot.localStart}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* ANTES e DEPOIS juntos: sem isto a pessoa confirma sem ver de onde
            para onde a reserva está indo. */}
        {slotEscolhido && estado.status === "carregada" && (
          <p className="text-sm text-ink" data-testid="resumo-remarcacao">
            De {agendamento.localStart}–{agendamento.localServiceEnd} para {slotEscolhido.localStart}
            –{slotEscolhido.localEnd}, em {rotuloDaData(estado.opcoes.date)}. Mesmo cliente
            ({agendamento.consumer.name}), mesmo serviço ({agendamento.service.name}) e mesma
            duração ({rotuloDeDuracao(estado.opcoes.durationMinutes)}).
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Botao
            type="button"
            data-testid="confirmar-remarcacao"
            disabled={gravando || !slotEscolhido}
            aria-busy={gravando}
            onClick={() => void confirmar()}
          >
            <CalendarClock size={14} className="mr-1" />
            {gravando ? "Remarcando..." : "Confirmar novo horário"}
          </Botao>
          <Botao type="button" variante="secundaria" disabled={gravando} onClick={aoDesistir}>
            Desistir
          </Botao>
          {!slotEscolhido && (
            <span className="inline-flex items-center gap-1 text-xs text-ink-soft">
              <Info size={12} />
              Escolha um horário livre.
            </span>
          )}
        </div>
      </CartaoCorpo>
    </Cartao>
  );
}
