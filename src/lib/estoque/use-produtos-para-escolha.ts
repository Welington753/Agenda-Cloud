"use client";

// Produtos para os seletores (movimentação, filtro do histórico e
// conferência): percorre as páginas da API até o fim (teto de 20 páginas).
import { useCallback, useEffect, useRef, useState } from "react";
import { listarProdutos, type FalhaEstoque, type ProdutoEstoque } from "@/lib/api/estoque-api";

const PAGINAS_NO_MAXIMO = 20;

export type EstadoProdutos = { status: "carregando" } | { status: "carregada"; produtos: ProdutoEstoque[] } | { status: "falha"; falha: FalhaEstoque };

export function useProdutosParaEscolha(tenantId: string | null, situacao: "ACTIVE" | "ALL" = "ACTIVE") {
  const [estado, setEstado] = useState<EstadoProdutos>({ status: "carregando" });
  const controle = useRef<AbortController | null>(null);

  const recarregar = useCallback(async () => {
    controle.current?.abort();
    if (!tenantId) return;
    const atual = new AbortController();
    controle.current = atual;
    const produtos: ProdutoEstoque[] = [];
    let cursor: string | null = null;
    for (let pagina = 0; pagina < PAGINAS_NO_MAXIMO; pagina += 1) {
      const consulta: string = `status=${situacao}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const r = await listarProdutos(tenantId, consulta, atual.signal);
      if (atual.signal.aborted) return;
      if (!r.ok) {
        setEstado({ status: "falha", falha: r.falha });
        return;
      }
      produtos.push(...r.dados.itens);
      cursor = r.dados.proximo;
      if (!cursor) break;
    }
    setEstado({ status: "carregada", produtos });
  }, [tenantId, situacao]);

  useEffect(() => {
    setEstado({ status: "carregando" });
    void recarregar();
    return () => controle.current?.abort();
  }, [recarregar]);

  /** Atualiza um produto (saldo novo depois de uma movimentação). */
  const atualizarSaldo = useCallback((productId: string, balanceMilli: number) => {
    setEstado((e) =>
      e.status === "carregada"
        ? { status: "carregada", produtos: e.produtos.map((p) => (p.id === productId ? { ...p, balanceMilli, balanceVersion: p.balanceVersion + 1 } : p)) }
        : e,
    );
  }, []);

  return { estado, recarregar, atualizarSaldo };
}
