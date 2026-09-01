"use client";

import { useEffect, useState } from "react";
import { setHours, setMinutes, startOfDay } from "date-fns";
import { Modal } from "@/components/ui/modal";
import { Botao } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatarDataLonga } from "@/lib/format";
import { bloqueioRepository } from "@/lib/repositories";
import type { Terminologia } from "@/lib/verticals/terminologia";
import type { Profissional } from "@/lib/types";

interface ModalBloqueioProps {
  aberto: boolean;
  aoFechar: () => void;
  tenantId: string;
  profissionais: Profissional[];
  dia: Date;
  profissionalPreSelecionadoId?: string;
  terminologia: Terminologia;
  onCriado: () => void;
}

function combinar(dia: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return setMinutes(setHours(startOfDay(dia), h), m);
}

export function ModalBloqueio({
  aberto,
  aoFechar,
  tenantId,
  profissionais,
  dia,
  profissionalPreSelecionadoId,
  terminologia,
  onCriado,
}: ModalBloqueioProps) {
  const { notificar } = useToast();
  const [profissionalId, setProfissionalId] = useState(profissionalPreSelecionadoId ?? profissionais[0]?.id ?? "");
  const [horaInicio, setHoraInicio] = useState("12:00");
  const [horaFim, setHoraFim] = useState("13:00");
  const [motivo, setMotivo] = useState("");

  useEffect(() => {
    if (aberto) {
      setProfissionalId(profissionalPreSelecionadoId ?? profissionais[0]?.id ?? "");
      setHoraInicio("12:00");
      setHoraFim("13:00");
      setMotivo("");
    }
  }, [aberto, profissionalPreSelecionadoId, profissionais]);

  function confirmar() {
    if (!profissionalId || !motivo.trim()) {
      notificar("Selecione o profissional e informe o motivo do bloqueio.", "erro");
      return;
    }
    const inicio = combinar(dia, horaInicio);
    const fim = combinar(dia, horaFim);
    if (fim <= inicio) {
      notificar("O horário final precisa ser depois do horário inicial.", "erro");
      return;
    }
    bloqueioRepository.criar({ tenantId, profissionalId, inicio: inicio.toISOString(), fim: fim.toISOString(), motivo: motivo.trim() });
    notificar("Horário bloqueado com sucesso.", "sucesso");
    onCriado();
    aoFechar();
  }

  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo={`Bloquear horário — ${formatarDataLonga(dia)}`}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-ink-soft">{terminologia.profissional.singular}</label>
          <select
            value={profissionalId}
            onChange={(e) => setProfissionalId(e.target.value)}
            className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
          >
            {profissionais.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-semibold text-ink-soft">Início</label>
            <input
              type="time"
              value={horaInicio}
              onChange={(e) => setHoraInicio(e.target.value)}
              className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-semibold text-ink-soft">Fim</label>
            <input
              type="time"
              value={horaFim}
              onChange={(e) => setHoraFim(e.target.value)}
              className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-ink-soft">Motivo</label>
          <input
            type="text"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: Almoço estendido, curso, folga..."
            className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
          />
        </div>
      </div>

      <div className="mt-5">
        <Botao className="w-full" onClick={confirmar}>
          Bloquear horário
        </Botao>
      </div>
    </Modal>
  );
}
