"use client";

// Solicitações pendentes do estabelecimento ativo, lidas do backend
// (GET /tenants/:id/booking-requests). O aviso do painel é ESTA lista: ela
// vem do banco, então continua lá depois de recarregar e some só quando a
// reserva é confirmada ou recusada — abrir a tela ou ver o número não muda
// nada no servidor.
//
// Recarrega ao montar, quando a janela volta a ter foco e quando outra parte
// da área real avisa que mudou algo (`avisarSolicitacoesAlteradas`). Não há
// push nem aviso com o aplicativo fechado.
import { useCallback, useEffect, useState } from "react";
import {
  listarSolicitacoes,
  type FalhaPrivada,
  type ListaDeSolicitacoes,
} from "@/lib/api/booking-requests-api";

const EVENTO = "agenda-cloud:solicitacoes-alteradas";

export type EstadoSolicitacoes =
  | { status: "carregando" }
  | { status: "falha"; falha: FalhaPrivada }
  | { status: "carregada"; lista: ListaDeSolicitacoes };

export function avisarSolicitacoesAlteradas(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO));
}

export function useSolicitacoesPendentes(tenantId: string | null) {
  const [estado, setEstado] = useState<EstadoSolicitacoes>({ status: "carregando" });
  const [versao, setVersao] = useState(0);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  useEffect(() => {
    if (!tenantId) return;
    const controle = new AbortController();
    void listarSolicitacoes(tenantId, controle.signal).then((r) => {
      if (controle.signal.aborted) return;
      setEstado(r.ok ? { status: "carregada", lista: r.dados } : { status: "falha", falha: r.falha });
    });
    return () => controle.abort();
  }, [tenantId, versao]);

  useEffect(() => {
    window.addEventListener(EVENTO, recarregar);
    window.addEventListener("focus", recarregar);
    return () => {
      window.removeEventListener(EVENTO, recarregar);
      window.removeEventListener("focus", recarregar);
    };
  }, [recarregar]);

  return { estado, recarregar };
}

/** Quantas pendentes mostrar no menu: só com lista carregada. Falha ou
 * carregamento não viram "0" (zero afirmaria que não há nada). */
export function contagemVisivel(estado: EstadoSolicitacoes): number | null {
  return estado.status === "carregada" ? estado.lista.solicitacoes.length : null;
}
