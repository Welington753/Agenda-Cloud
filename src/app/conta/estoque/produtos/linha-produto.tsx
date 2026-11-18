"use client";

// Um produto na lista: saldo atual, mínimo, aviso de estoque baixo e as ações
// de cadastro. Arquivar pede confirmação na própria linha, mostrando o saldo
// (que fica preservado, assim como o histórico).
import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Archive, History, Pencil, RotateCcw } from "lucide-react";
import type { ProdutoEstoque } from "@/lib/api/estoque-api";
import { formatarQuantidade } from "@/lib/estoque/quantidade";
import { ROTULO_FINALIDADE } from "@/lib/estoque/rotulos";
import { ROTA_ESTOQUE_MOVIMENTACOES } from "@/lib/conta/rotas";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";

export function LinhaProduto({
  produto,
  podeOperar,
  gravando,
  aoEditar,
  aoMudarSituacao,
}: {
  produto: ProdutoEstoque;
  podeOperar: boolean;
  gravando: boolean;
  aoEditar: () => void;
  aoMudarSituacao: (acao: "archive" | "reactivate") => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const categoria = produto.subcategoryName ? `${produto.categoryName} › ${produto.subcategoryName}` : produto.categoryName;

  return (
    <Cartao data-testid={`produto-${produto.id}`}>
      <CartaoCorpo className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-ink">{produto.name}</h2>
              {produto.archived && <Badge>Arquivado</Badge>}
              {produto.low && !produto.archived && (
                <Badge cor="aviso" data-testid="estoque-baixo">
                  <AlertTriangle size={12} aria-hidden="true" /> Estoque baixo
                </Badge>
              )}
            </div>
            <p className="text-sm text-ink-soft">
              {categoria} · {ROTULO_FINALIDADE[produto.purpose]}
              {produto.internalCode ? ` · Cód. ${produto.internalCode}` : ""}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-lg font-bold text-ink" data-testid="saldo">
              {formatarQuantidade(produto.balanceMilli, produto.unit)}
            </p>
            <p className="text-xs text-ink-soft">Mínimo: {formatarQuantidade(produto.minQuantityMilli, produto.unit)}</p>
          </div>
        </div>

        {confirmando ? (
          <div className="flex flex-col gap-2 rounded-[var(--radius-control)] bg-paper-muted p-3 sm:flex-row sm:items-center sm:justify-between" role="group" aria-label="Confirmar arquivamento">
            <p className="text-sm text-ink">
              Arquivar &quot;{produto.name}&quot;? O saldo de {formatarQuantidade(produto.balanceMilli, produto.unit)} e o histórico ficam preservados.
            </p>
            <div className="flex gap-2">
              <Botao variante="fantasma" tamanho="sm" onClick={() => setConfirmando(false)} disabled={gravando}>
                Cancelar
              </Botao>
              <Botao
                variante="perigo"
                tamanho="sm"
                disabled={gravando}
                onClick={() => {
                  setConfirmando(false);
                  aoMudarSituacao("archive");
                }}
              >
                Arquivar
              </Botao>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1">
            <Link
              href={`${ROTA_ESTOQUE_MOVIMENTACOES}?produto=${encodeURIComponent(produto.id)}`}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-sm font-semibold text-ink hover:bg-paper-muted"
            >
              <History size={14} aria-hidden="true" /> Histórico
            </Link>
            {podeOperar && !produto.archived && (
              <>
                <Botao variante="fantasma" tamanho="sm" onClick={aoEditar} disabled={gravando}>
                  <Pencil size={14} aria-hidden="true" /> Editar
                </Botao>
                <Botao variante="fantasma" tamanho="sm" onClick={() => setConfirmando(true)} disabled={gravando}>
                  <Archive size={14} aria-hidden="true" /> Arquivar
                </Botao>
              </>
            )}
            {podeOperar && produto.archived && (
              <Botao variante="fantasma" tamanho="sm" onClick={() => aoMudarSituacao("reactivate")} disabled={gravando}>
                <RotateCcw size={14} aria-hidden="true" /> Reativar
              </Botao>
            )}
          </div>
        )}
      </CartaoCorpo>
    </Cartao>
  );
}
