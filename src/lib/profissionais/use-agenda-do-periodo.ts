"use client";

// Leitura da agenda por período (Calendário do dono). Uma leitura por pedido
// (abrir, trocar período ou profissional, "Tentar novamente"); a mais recente
// vence e uma resposta atrasada nunca sobrescreve a atual.
import { useCallback, useEffect, useRef, useState } from "react";
import type { FalhaAgendamentoReal } from "@/lib/api/appointments-api";
import { listarAgendamentosDoPeriodo, type AgendaDoPeriodoReal } from "@/lib/api/appointments-periodo-api";

export type EstadoAgendaDoPeriodo =
  | { status: "carregando"; anterior: AgendaDoPeriodoReal | null }
  | { status: "carregada"; agenda: AgendaDoPeriodoReal }
  | { status: "falha"; falha: FalhaAgendamentoReal };

export function useAgendaDoPeriodo(
  tenantId: string | null,
  periodo: { from: string; to: string } | null,
  professionalId: string | null,
) {
  const [estado, setEstado] = useState<EstadoAgendaDoPeriodo>({ status: "carregando", anterior: null });
  const sequenciaRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const de = periodo?.from ?? null;
  const ate = periodo?.to ?? null;

  const carregar = useCallback(() => {
    if (!tenantId || !de || !ate) return;
    sequenciaRef.current += 1;
    const sequencia = sequenciaRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setEstado((atual) => ({ status: "carregando", anterior: atual.status === "carregada" ? atual.agenda : null }));
    void (async () => {
      const r = await listarAgendamentosDoPeriodo(tenantId, { from: de, to: ate, professionalId }, controller.signal);
      if (sequencia !== sequenciaRef.current) return;
      controllerRef.current = null;
      setEstado(r.ok ? { status: "carregada", agenda: r.dados } : { status: "falha", falha: r.falha });
    })();
  }, [tenantId, de, ate, professionalId]);

  useEffect(() => {
    setEstado({ status: "carregando", anterior: null });
  }, [tenantId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { estado, recarregar: carregar };
}
