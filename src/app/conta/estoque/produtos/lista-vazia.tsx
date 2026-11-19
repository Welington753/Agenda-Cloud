"use client";

// Lista de produtos vazia: o texto vem de `listaVaziaDeProdutos`
// (lib/estoque/apresentacao.ts); "Cadastrar primeiro produto" abre o mesmo
// painel de "Novo produto".
import { Package, Plus } from "lucide-react";
import type { ListaVaziaDeProdutos } from "@/lib/estoque/apresentacao";
import { Botao } from "@/components/ui/button";
import { EstadoVazio } from "@/components/ui/empty-state";

export function ListaVazia({ vazia, aoCadastrar }: { vazia: ListaVaziaDeProdutos; aoCadastrar: () => void }) {
  return (
    <div className="p-4" data-testid="lista-produtos-vazia">
      <EstadoVazio
        icone={Package}
        titulo={vazia.titulo}
        descricao={vazia.descricao}
        acao={
          vazia.primeiroCadastro && (
            <Botao onClick={aoCadastrar}>
              <Plus size={16} aria-hidden="true" /> Cadastrar primeiro produto
            </Botao>
          )
        }
      />
    </div>
  );
}
