"use client";

// Leitura dos indicadores do Início. Uma leitura por pedido (abrir a página,
// trocar o período, "Atualizar"): sem consulta periódica — as solicitações já
// têm a sua (SolicitacoesProvider), e o Início não cria outra.
//
// A leitura mais recente vence: trocar de período ou de estabelecimento
// aborta a anterior, e uma resposta atrasada nunca sobrescreve a atual.
import { useCallback, useEffect, useRef, useState } from "react";
import { obterPainel, type FalhaPainel, type PainelDoEstabelecimento } from "@/lib/api/dashboard-api";
import type { PeriodoLocal } from "./inicio";

export type EstadoPainel =
  | { status: "carregando"; anterior: PainelDoEstabelecimento | null }
  | { status: "pronto"; painel: PainelDoEstabelecimento }
  | { status: "falha"; falha: FalhaPainel };

export function usePainel(tenantId: string | null, periodo: PeriodoLocal | null) {
  const [estado, setEstado] = useState<EstadoPainel>({ status: "carregando", anterior: null });
  const sequenciaRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const de = periodo?.from ?? null;
  const ate = periodo?.to ?? null;

  const carregar = useCallback(() => {
    if (!tenantId) return;
    sequenciaRef.current += 1;
    const sequencia = sequenciaRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setEstado((atual) => ({ status: "carregando", anterior: atual.status === "pronto" ? atual.painel : null }));
    void (async () => {
      const resultado = await obterPainel(tenantId, de && ate ? { from: de, to: ate } : null, controller.signal);
      if (sequencia !== sequenciaRef.current) return;
      controllerRef.current = null;
      setEstado(resultado.ok ? { status: "pronto", painel: resultado.dados } : { status: "falha", falha: resultado.falha });
    })();
  }, [tenantId, de, ate]);

  // Troca de estabelecimento: nada do anterior fica na tela.
  useEffect(() => {
    setEstado({ status: "carregando", anterior: null });
  }, [tenantId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { estado, recarregar: carregar };
}
