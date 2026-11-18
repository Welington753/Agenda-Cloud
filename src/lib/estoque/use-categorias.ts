"use client";

// Categorias do estabelecimento ativo, carregadas uma vez por tela (filtros,
// formulário de produto e a própria página de Categorias). Uma resposta
// atrasada de outro estabelecimento nunca chega à tela (aborto na troca).
import { useCallback, useEffect, useRef, useState } from "react";
import { listarCategorias, type CategoriaEstoque, type FalhaEstoque } from "@/lib/api/estoque-api";

export type EstadoCategorias =
  | { status: "carregando" }
  | { status: "carregada"; categorias: CategoriaEstoque[] }
  | { status: "falha"; falha: FalhaEstoque };

export function useCategorias(tenantId: string | null) {
  const [estado, setEstado] = useState<EstadoCategorias>({ status: "carregando" });
  const controle = useRef<AbortController | null>(null);

  const recarregar = useCallback(async () => {
    controle.current?.abort();
    if (!tenantId) return;
    const atual = new AbortController();
    controle.current = atual;
    const r = await listarCategorias(tenantId, atual.signal);
    if (atual.signal.aborted) return;
    setEstado(r.ok ? { status: "carregada", categorias: r.dados } : { status: "falha", falha: r.falha });
  }, [tenantId]);

  useEffect(() => {
    setEstado({ status: "carregando" });
    void recarregar();
    return () => controle.current?.abort();
  }, [recarregar]);

  /** Troca a categoria devolvida por uma gravação, sem recarregar tudo. */
  const substituir = useCallback((categoria: CategoriaEstoque) => {
    setEstado((e) => {
      if (e.status !== "carregada") return e;
      const existe = e.categorias.some((c) => c.id === categoria.id);
      const categorias = existe ? e.categorias.map((c) => (c.id === categoria.id ? categoria : c)) : [...e.categorias, categoria];
      return { status: "carregada", categorias };
    });
  }, []);

  return { estado, recarregar, substituir };
}
