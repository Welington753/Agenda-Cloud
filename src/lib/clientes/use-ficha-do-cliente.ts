"use client";

// Estado da ficha do cliente: dados, resumo "neste cadastro" e histórico
// paginado. Mesmas garantias da lista (use-clientes-reais.ts):
//  - leitura mais recente vence (sequência + abort);
//  - troca de estabelecimento ou de cliente descarta o que era do anterior;
//  - nenhuma escrita mora aqui: edição e unificação são da página, e depois
//    delas a ficha é relida.
import { useCallback, useEffect, useRef, useState } from "react";
import * as clientesApi from "@/lib/api/consumers-api";
import type { FalhaClientesReal, FichaDoCliente, ItemDoHistorico } from "@/lib/api/consumers-api";

export type EstadoDaFicha =
  | { status: "carregando" }
  | { status: "pronta"; ficha: FichaDoCliente }
  | { status: "falha"; falha: FalhaClientesReal };

export type EstadoDoHistorico =
  | { status: "carregando" }
  | {
      status: "pronto";
      itens: ItemDoHistorico[];
      proximoCursor: string | null;
      carregandoMais: boolean;
      falhaAoCarregarMais: FalhaClientesReal | null;
    }
  | { status: "falha"; falha: FalhaClientesReal };

export function useFichaDoCliente(tenantId: string | null, clienteId: string | null) {
  const [ficha, setFicha] = useState<EstadoDaFicha>({ status: "carregando" });
  const [historico, setHistorico] = useState<EstadoDoHistorico>({ status: "carregando" });
  const sequenciaRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const historicoRef = useRef(historico);
  useEffect(() => {
    historicoRef.current = historico;
  }, [historico]);

  const recarregar = useCallback(() => {
    if (!tenantId || !clienteId) return;
    sequenciaRef.current += 1;
    const sequencia = sequenciaRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setFicha({ status: "carregando" });
    setHistorico({ status: "carregando" });

    void (async () => {
      const [lida, pagina] = await Promise.all([
        clientesApi.lerFichaDoCliente(tenantId, clienteId, controller.signal),
        clientesApi.lerHistoricoDoCliente(tenantId, clienteId, null, controller.signal),
      ]);
      if (sequencia !== sequenciaRef.current) return;
      setFicha(lida.ok ? { status: "pronta", ficha: lida.dados } : { status: "falha", falha: lida.falha });
      setHistorico(
        pagina.ok
          ? { status: "pronto", itens: pagina.dados.itens, proximoCursor: pagina.dados.proximoCursor, carregandoMais: false, falhaAoCarregarMais: null }
          : { status: "falha", falha: pagina.falha },
      );
    })();
  }, [tenantId, clienteId]);

  useEffect(() => {
    recarregar();
  }, [recarregar]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const carregarMais = useCallback(() => {
    const atual = historicoRef.current;
    if (!tenantId || !clienteId || atual.status !== "pronto" || !atual.proximoCursor || atual.carregandoMais) return;
    const sequencia = sequenciaRef.current;
    setHistorico({ ...atual, carregandoMais: true, falhaAoCarregarMais: null });
    void (async () => {
      const pagina = await clientesApi.lerHistoricoDoCliente(tenantId, clienteId, atual.proximoCursor);
      if (sequencia !== sequenciaRef.current) return;
      setHistorico((anterior) => {
        if (anterior.status !== "pronto") return anterior;
        if (!pagina.ok) return { ...anterior, carregandoMais: false, falhaAoCarregarMais: pagina.falha };
        const vistos = new Set(anterior.itens.map((i) => i.id));
        return {
          ...anterior,
          itens: [...anterior.itens, ...pagina.dados.itens.filter((i) => !vistos.has(i.id))],
          proximoCursor: pagina.dados.proximoCursor,
          carregandoMais: false,
          falhaAoCarregarMais: null,
        };
      });
    })();
  }, [tenantId, clienteId]);

  return { ficha, historico, recarregar, carregarMais };
}
