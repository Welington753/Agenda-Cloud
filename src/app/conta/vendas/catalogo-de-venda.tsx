"use client";

// Catálogo de venda: produtos ativos de finalidade Venda ou Ambos, com preço
// sugerido e "disponível" ou "sem saldo". O saldo numérico só aparece para
// quem vê o estoque (o servidor decide e manda `balanceMilli` só então).
import { useEffect, useState } from "react";
import { PackageSearch, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge-base";
import { Botao } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CLASSE_CAMPO } from "@/components/estoque/comum";
import { useLeituraPlataforma } from "@/lib/administracao/use-leitura-plataforma";
import { caminhoCatalogo, ehCatalogoDeVenda, type ProdutoParaVenda } from "@/lib/api/vendas-api";
import { formatarQuantidade } from "@/lib/estoque/quantidade";
import { formatarMoeda } from "@/lib/format";

export function CatalogoDeVenda({
  tenantId,
  desativado,
  noCarrinho,
  aoAdicionar,
}: {
  tenantId: string;
  desativado: boolean;
  noCarrinho: readonly string[];
  aoAdicionar: (p: ProdutoParaVenda) => void;
}) {
  const [busca, setBusca] = useState("");
  const [consulta, setConsulta] = useState("");
  useEffect(() => {
    const espera = setTimeout(() => setConsulta(busca.trim()), 350);
    return () => clearTimeout(espera);
  }, [busca]);
  const { estado, recarregar } = useLeituraPlataforma(caminhoCatalogo(tenantId, consulta), ehCatalogoDeVenda);

  return (
    <section aria-labelledby="titulo-catalogo" className="space-y-3">
      <h2 id="titulo-catalogo" className="text-base font-semibold text-ink">
        Produtos à venda
      </h2>
      <div className="relative">
        <Search size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft" />
        <input
          aria-label="Procurar produto"
          className={`min-h-11 pl-9 ${CLASSE_CAMPO}`}
          value={busca}
          maxLength={80}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Procurar produto pelo nome"
          disabled={desativado}
        />
      </div>
      {estado.status === "carregando" && <Skeleton className="h-24 w-full" />}
      {estado.status === "erro" && (
        <div role="alert" className="space-y-2 text-sm text-ink">
          <p>
            {estado.motivo === "permissao"
              ? "Novas vendas não estão disponíveis para sua conta neste estabelecimento agora. As vendas já registradas continuam em Minhas operações."
              : "Não foi possível carregar os produtos."}
          </p>
          <Botao type="button" variante="secundaria" className="min-h-11" onClick={recarregar}>
            Tentar novamente
          </Botao>
        </div>
      )}
      {estado.status === "pronto" && estado.dados.products.length === 0 && (
        <p className="flex items-center gap-2 rounded-[var(--radius-card)] border border-border bg-card p-4 text-sm text-ink-soft" data-testid="catalogo-vazio">
          <PackageSearch size={16} aria-hidden="true" className="shrink-0" />
          {consulta ? "Nenhum produto à venda com esse nome." : "Nenhum produto à venda. Os produtos vêm do Estoque, com finalidade Venda ou Ambos."}
        </p>
      )}
      {estado.status === "pronto" && estado.dados.products.length > 0 && (
        <>
          <ul className="grid gap-2 sm:grid-cols-2" data-testid="catalogo">
            {estado.dados.products.map((p) => {
              const ja = noCarrinho.includes(p.id);
              return (
                <li key={p.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-card)] border border-border bg-card p-3" data-testid="produto-venda">
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold break-words text-ink">{p.name}</p>
                    <p className="text-ink-soft">
                      {p.salePriceCents === null ? "Sem preço sugerido" : `${formatarMoeda(p.salePriceCents)} / ${p.unit}`}
                    </p>
                    <p className="mt-1">
                      {p.available ? (
                        <Badge cor="sucesso">
                          {p.balanceMilli !== undefined ? `Disponível: ${formatarQuantidade(p.balanceMilli, p.unit)}` : "Disponível"}
                        </Badge>
                      ) : (
                        <Badge cor="neutro">Sem saldo</Badge>
                      )}
                    </p>
                  </div>
                  <Botao type="button" variante="secundaria" className="min-h-11 shrink-0" disabled={desativado || ja} onClick={() => aoAdicionar(p)} aria-label={`Adicionar ${p.name}`}>
                    <Plus size={16} aria-hidden="true" />
                    {ja ? "Na venda" : "Adicionar"}
                  </Botao>
                </li>
              );
            })}
          </ul>
          {estado.dados.nextCursor && <p className="text-xs text-ink-soft">Mostrando os primeiros produtos. Procure pelo nome para achar outros.</p>}
          <p className="text-xs text-ink-soft">
            A disponibilidade é só indicação: a quantidade é conferida no estoque quando a venda é confirmada.
          </p>
        </>
      )}
    </section>
  );
}
