"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Botao } from "@/components/ui/button";
import { BadgeStatusAgendamento } from "@/components/ui/badge";
import { formatarDataLonga, formatarHora, formatarMoeda, formatarWhatsapp } from "@/lib/format";
import { horariosLivresDoProfissionalNoDia } from "@/lib/availability/consulta";
import type { Terminologia } from "@/lib/verticals/terminologia";
import type { Agendamento, Estabelecimento, Profissional, Servico, StatusAgendamento } from "@/lib/types";

const PROXIMO_STATUS: Partial<Record<StatusAgendamento, { status: StatusAgendamento; rotulo: string }>> = {
  pendente: { status: "confirmado", rotulo: "Confirmar" },
  confirmado: { status: "em_atendimento", rotulo: "Iniciar atendimento" },
  em_atendimento: { status: "concluido", rotulo: "Concluir atendimento" },
};

interface ModalDetalheAgendamentoProps {
  aberto: boolean;
  aoFechar: () => void;
  agendamento: Agendamento;
  servico: Servico;
  profissional: Profissional;
  estabelecimento: Estabelecimento;
  terminologia: Terminologia;
  onMudarStatus: (status: StatusAgendamento) => void;
  onRemarcar: (novoInicio: Date) => void;
}

export function ModalDetalheAgendamento({
  aberto,
  aoFechar,
  agendamento,
  servico,
  profissional,
  estabelecimento,
  terminologia,
  onMudarStatus,
  onRemarcar,
}: ModalDetalheAgendamentoProps) {
  const [remarcando, setRemarcando] = useState(false);
  const [novoHorario, setNovoHorario] = useState<Date | null>(null);

  const horariosDoMesmoDia = useMemo(() => {
    if (!remarcando) return [];
    return horariosLivresDoProfissionalNoDia(
      profissional,
      servico,
      new Date(agendamento.dataHoraInicio),
      estabelecimento,
      agendamento.id
    );
  }, [remarcando, profissional, servico, agendamento, estabelecimento]);

  const acaoPrincipal = PROXIMO_STATUS[agendamento.status];
  const podeAlterar = agendamento.status !== "concluido" && agendamento.status !== "cancelado";

  function fecharTudo() {
    setRemarcando(false);
    setNovoHorario(null);
    aoFechar();
  }

  return (
    <Modal aberto={aberto} aoFechar={fecharTudo} titulo={agendamento.consumidorNome}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-ink-soft">Status</span>
          <BadgeStatusAgendamento status={agendamento.status} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ink-soft">{terminologia.servico.singular}</span>
          <span className="font-medium text-ink">{servico.nome}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ink-soft">{terminologia.profissional.singular}</span>
          <span className="font-medium text-ink">{profissional.nome}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ink-soft">Quando</span>
          <span className="font-medium text-ink">
            {formatarDataLonga(agendamento.dataHoraInicio)} às {formatarHora(agendamento.dataHoraInicio)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ink-soft">Valor</span>
          <span className="font-medium text-ink">
            {agendamento.precoCentavos === undefined ? "Sob consulta" : formatarMoeda(agendamento.precoCentavos)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ink-soft">WhatsApp</span>
          <span className="font-medium text-ink">{formatarWhatsapp(agendamento.consumidorWhatsapp)}</span>
        </div>

        {remarcando && (
          <div className="border-t border-border pt-3">
            <p className="mb-2 text-sm font-semibold text-ink">Novo horário no mesmo dia</p>
            {horariosDoMesmoDia.length === 0 ? (
              <p className="text-sm text-ink-soft">Nenhum outro horário livre neste dia para este profissional.</p>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {horariosDoMesmoDia.map((h) => (
                  <button
                    key={h.toISOString()}
                    type="button"
                    onClick={() => setNovoHorario(h)}
                    className={`rounded-[var(--radius-control)] border px-2 py-2 text-xs font-semibold ${
                      novoHorario?.getTime() === h.getTime() ? "border-accent bg-accent text-white" : "border-border text-ink hover:border-accent"
                    }`}
                  >
                    {formatarHora(h)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {podeAlterar && (
        <div className="mt-5 space-y-2">
          {remarcando ? (
            <div className="flex gap-2">
              <Botao variante="secundaria" className="flex-1" onClick={() => setRemarcando(false)}>
                Voltar
              </Botao>
              <Botao
                className="flex-1"
                disabled={!novoHorario}
                onClick={() => {
                  if (novoHorario) {
                    onRemarcar(novoHorario);
                    fecharTudo();
                  }
                }}
              >
                Confirmar novo horário
              </Botao>
            </div>
          ) : (
            <>
              {acaoPrincipal && (
                <Botao className="w-full" onClick={() => onMudarStatus(acaoPrincipal.status)}>
                  {acaoPrincipal.rotulo}
                </Botao>
              )}
              <div className="flex gap-2">
                <Botao variante="secundaria" className="flex-1" onClick={() => setRemarcando(true)}>
                  Remarcar
                </Botao>
                {agendamento.status !== "nao_compareceu" && (
                  <Botao variante="secundaria" className="flex-1" onClick={() => onMudarStatus("nao_compareceu")}>
                    Marcar falta
                  </Botao>
                )}
              </div>
              <Botao variante="perigo" className="w-full" onClick={() => onMudarStatus("cancelado")}>
                Cancelar {terminologia.agendamento.singular.toLowerCase()}
              </Botao>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
