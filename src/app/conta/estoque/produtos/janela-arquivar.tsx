"use client";

// Confirmação de "Arquivar" de um produto: saldo e histórico ficam.
import type { ProdutoEstoque } from "@/lib/api/estoque-api";
import { formatarQuantidade } from "@/lib/estoque/quantidade";
import { Botao } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

export function JanelaArquivar({
  produto,
  gravando,
  aoConfirmar,
  aoFechar,
}: {
  produto: ProdutoEstoque | null;
  gravando: boolean;
  aoConfirmar: (produto: ProdutoEstoque) => void;
  aoFechar: () => void;
}) {
  return (
    <Modal
      aberto={produto !== null}
      aoFechar={() => !gravando && aoFechar()}
      titulo="Arquivar produto"
      rodape={
        <>
          <Botao variante="secundaria" onClick={aoFechar} disabled={gravando}>
            Cancelar
          </Botao>
          <Botao variante="perigo" onClick={() => produto && aoConfirmar(produto)} disabled={gravando}>
            Arquivar
          </Botao>
        </>
      }
    >
      {produto && (
        <p className="text-ink">
          Arquivar &quot;{produto.name}&quot;? O saldo de {formatarQuantidade(produto.balanceMilli, produto.unit)} e o histórico ficam preservados. Produto
          arquivado não recebe movimentação nem entra na conferência.
        </p>
      )}
    </Modal>
  );
}
