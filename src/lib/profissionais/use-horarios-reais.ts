"use client";

// Estado da tela real de horários semanais (Lote 6D.3) — mesma disciplina de
// use-profissionais-reais.ts.
//
// Descarte de dados ao trocar de contexto: o efeito depende de tenant E de
// profissional, então trocar qualquer um dos dois volta o estado para
// "carregando" e ignora resposta atrasada do par anterior (guarda o par que
// originou a chamada + AbortController).
//
// Nunca repete uma gravação automaticamente após falha — quem decide tentar
// de novo é a pessoa, com um clique explícito.
import { useCallback, useEffect, useRef, useState } from "react";
import * as horariosApi from "@/lib/api/working-hours-api";
import type {
  DiaDeTrabalhoReal,
  FalhaProfissionaisReal,
  HorariosReais,
} from "@/lib/api/working-hours-api";
import type { ResultadoProfissionaisReal } from "@/lib/api/professionals-api";

export type EstadoHorarios =
  | { status: "carregando" }
  | { status: "carregada"; horarios: HorariosReais }
  | { status: "falha"; falha: FalhaProfissionaisReal };

export interface HorariosReaisControlados {
  estado: EstadoHorarios;
  gravando: boolean;
  recarregar: () => void;
  salvar: (days: DiaDeTrabalhoReal[]) => Promise<ResultadoProfissionaisReal<HorariosReais>>;
}

export function useHorariosReais(
  tenantId: string | null,
  professionalId: string | null,
): HorariosReaisControlados {
  const [estado, setEstado] = useState<EstadoHorarios>({ status: "carregando" });
  const [gravando, setGravando] = useState(false);
  const [recarga, setRecarga] = useState(0);
  /** Par vigente conforme o render mais recente — lido pela gravação para
   * nunca aplicar resultado de um contexto que já mudou. */
  const contextoRef = useRef<string | null>(null);

  const chave = tenantId && professionalId ? `${tenantId}:${professionalId}` : null;

  useEffect(() => {
    contextoRef.current = chave;

    if (!tenantId || !professionalId) {
      setEstado({ status: "carregando" });
      return;
    }

    // Descarta o que estava na tela ANTES de pedir o novo.
    setEstado({ status: "carregando" });

    const controller = new AbortController();
    let cancelado = false;

    void (async () => {
      const resultado = await horariosApi.buscarHorarios(
        tenantId,
        professionalId,
        controller.signal,
      );
      if (cancelado || contextoRef.current !== chave) return;

      setEstado(
        resultado.ok
          ? { status: "carregada", horarios: resultado.dados }
          : { status: "falha", falha: resultado.falha },
      );
    })();

    return () => {
      cancelado = true;
      controller.abort();
    };
  }, [tenantId, professionalId, chave, recarga]);

  const recarregar = useCallback(() => setRecarga((n) => n + 1), []);

  const salvar = useCallback(
    async (days: DiaDeTrabalhoReal[]): Promise<ResultadoProfissionaisReal<HorariosReais>> => {
      const contextoDaChamada = contextoRef.current;
      if (!tenantId || !professionalId || !contextoDaChamada) {
        return { ok: false, falha: { tipo: "sem_acesso" } };
      }

      setGravando(true);
      const resultado = await horariosApi.salvarHorarios(tenantId, professionalId, days);
      setGravando(false);

      // Resposta que chega depois de trocar de profissional/tenant nunca
      // escreve na tela do novo contexto.
      if (contextoRef.current !== contextoDaChamada) return resultado;
      if (resultado.ok) setEstado({ status: "carregada", horarios: resultado.dados });
      return resultado;
    },
    [tenantId, professionalId],
  );

  return { estado, gravando, recarregar, salvar };
}
