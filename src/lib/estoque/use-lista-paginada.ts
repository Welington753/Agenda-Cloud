"use client";

// Lista paginada por cursor (produtos, movimentações, conferências): recarrega
// quando a consulta muda, acrescenta a próxima página sob pedido e descarta
// respostas atrasadas (troca de estabelecimento ou de filtro).
import { useCallback, useEffect, useRef, useState } from "react";
import type { FalhaEstoque, ResultadoEstoque } from "@/lib/api/estoque-api";

export type EstadoLista<T> =
  | { status: "carregando" }
  | { status: "carregada"; itens: T[]; proximo: string | null; carregandoMais: boolean }
  | { status: "falha"; falha: FalhaEstoque };

export function useListaPaginada<T extends { id: string }>(
  chave: string | null,
  buscar: (cursor: string | null, signal: AbortSignal) => Promise<ResultadoEstoque<{ itens: T[]; proximo: string | null }>>,
) {
  const [estado, setEstado] = useState<EstadoLista<T>>({ status: "carregando" });
  const controle = useRef<AbortController | null>(null);
  const buscarRef = useRef(buscar);
  // Antes do efeito que recarrega (os efeitos rodam na ordem declarada).
  useEffect(() => {
    buscarRef.current = buscar;
  }, [buscar]);

  const recarregar = useCallback(async () => {
    controle.current?.abort();
    if (!chave) return;
    const atual = new AbortController();
    controle.current = atual;
    setEstado({ status: "carregando" });
    const r = await buscarRef.current(null, atual.signal);
    if (atual.signal.aborted) return;
    setEstado(r.ok ? { status: "carregada", itens: r.dados.itens, proximo: r.dados.proximo, carregandoMais: false } : { status: "falha", falha: r.falha });
  }, [chave]);

  useEffect(() => {
    void recarregar();
    return () => controle.current?.abort();
  }, [recarregar]);

  const carregarMais = useCallback(async () => {
    if (estado.status !== "carregada" || !estado.proximo || estado.carregandoMais) return;
    const atual = controle.current ?? new AbortController();
    setEstado({ ...estado, carregandoMais: true });
    const r = await buscarRef.current(estado.proximo, atual.signal);
    if (atual.signal.aborted) return;
    setEstado((e) => {
      if (e.status !== "carregada") return e;
      if (!r.ok) return { ...e, carregandoMais: false };
      const vistos = new Set(e.itens.map((i) => i.id));
      return { status: "carregada", itens: [...e.itens, ...r.dados.itens.filter((i) => !vistos.has(i.id))], proximo: r.dados.proximo, carregandoMais: false };
    });
  }, [estado]);

  /** Troca (ou acrescenta no topo) um item devolvido por uma gravação. */
  const substituir = useCallback((item: T, noTopo = false) => {
    setEstado((e) => {
      if (e.status !== "carregada") return e;
      const existe = e.itens.some((i) => i.id === item.id);
      if (existe) return { ...e, itens: e.itens.map((i) => (i.id === item.id ? item : i)) };
      return { ...e, itens: noTopo ? [item, ...e.itens] : [...e.itens, item] };
    });
  }, []);

  return { estado, recarregar, carregarMais, substituir };
}
