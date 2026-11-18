"use client";

// Um produto na tabela: nome com código e categoria, finalidade, saldo,
// mínimo, situação (estoque baixo destaca a linha) e o menu de ações. No
// celular a linha vira cartão (components/estoque/comum.tsx, TABELA).
import clsx from "clsx";
import { Archive, History, Pencil, RotateCcw } from "lucide-react";
import type { ProdutoEstoque } from "@/lib/api/estoque-api";
import { detalheDoProduto, ROTULO_SITUACAO, situacaoVisual } from "@/lib/estoque/apresentacao";
import { formatarQuantidade } from "@/lib/estoque/quantidade";
import { ROTULO_FINALIDADE } from "@/lib/estoque/rotulos";
import { ROTA_ESTOQUE_MOVIMENTACOES } from "@/lib/conta/rotas";
import { Badge } from "@/components/ui/badge-base";
import { MenuDeAcoes, RotuloNoCelular, TABELA, type ItemDoMenu } from "@/components/estoque/comum";

export function LinhaProduto({
  produto,
  podeOperar,
  gravando,
  aoEditar,
  aoArquivar,
  aoReativar,
}: {
  produto: ProdutoEstoque;
  podeOperar: boolean;
  gravando: boolean;
  aoEditar: () => void;
  aoArquivar: () => void;
  aoReativar: () => void;
}) {
  const situacao = situacaoVisual(produto);
  const itens: ItemDoMenu[] = [
    { rotulo: "Ver histórico", icone: History, href: `${ROTA_ESTOQUE_MOVIMENTACOES}?produto=${encodeURIComponent(produto.id)}` },
  ];
  if (podeOperar && !produto.archived) {
    itens.push({ rotulo: "Editar", icone: Pencil, aoEscolher: aoEditar, desabilitado: gravando });
    itens.push({ rotulo: "Arquivar", icone: Archive, aoEscolher: aoArquivar, desabilitado: gravando, perigo: true });
  }
  if (podeOperar && produto.archived) itens.push({ rotulo: "Reativar", icone: RotateCcw, aoEscolher: aoReativar, desabilitado: gravando });

  return (
    <tr data-testid={`produto-${produto.id}`} className={clsx(TABELA.linha, situacao === "baixo" && "bg-warning-soft")}>
      <td className={clsx(TABELA.td, "min-w-0")}>
        <p className="font-semibold text-ink">{produto.name}</p>
        <p className="text-xs text-ink-soft">{detalheDoProduto(produto)}</p>
      </td>
      <td className={clsx(TABELA.td, "max-md:col-start-1 max-md:row-start-2")}>
        <Badge cor={produto.purpose === "CONSUMO_INTERNO" ? "neutro" : "destaque"}>{ROTULO_FINALIDADE[produto.purpose]}</Badge>
      </td>
      <td className={clsx(TABELA.td, "md:text-right max-md:col-start-1 max-md:row-start-3")}>
        <RotuloNoCelular>Saldo</RotuloNoCelular>
        <span className="font-bold text-ink tabular-nums" data-testid="saldo">
          {formatarQuantidade(produto.balanceMilli, produto.unit)}
        </span>
      </td>
      <td className={clsx(TABELA.td, "text-ink-soft tabular-nums md:text-right max-md:col-start-2 max-md:row-start-3 max-md:text-right")}>
        <RotuloNoCelular>Mínimo</RotuloNoCelular>
        {formatarQuantidade(produto.minQuantityMilli, produto.unit)}
      </td>
      <td className={clsx(TABELA.td, "max-md:col-start-2 max-md:row-start-2 max-md:text-right")}>
        <Badge cor={situacao === "baixo" ? "aviso" : "neutro"} data-testid={situacao === "baixo" ? "estoque-baixo" : `situacao-${situacao}`}>
          {ROTULO_SITUACAO[situacao]}
        </Badge>
      </td>
      <td className={clsx(TABELA.td, "w-12 text-right max-md:col-start-2 max-md:row-start-1")}>
        <MenuDeAcoes rotulo={`Ações de ${produto.name}`} itens={itens} />
      </td>
    </tr>
  );
}
