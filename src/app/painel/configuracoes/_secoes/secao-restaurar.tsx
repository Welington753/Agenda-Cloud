import { RotateCcw } from "lucide-react";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import type { Terminologia } from "@/lib/verticals/terminologia";

interface SecaoRestaurarProps {
  terminologia: Terminologia;
  aoRestaurar: () => void;
}

export function SecaoRestaurar({ terminologia, aoRestaurar }: SecaoRestaurarProps) {
  return (
    <Cartao className="border-dashed">
      <CartaoCorpo className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-ink">Restaurar dados da demonstração</p>
          <p className="text-sm text-ink-soft">
            Restaura somente {terminologia.estabelecimento.artigo === "a" ? "esta" : "este"}{" "}
            {terminologia.estabelecimento.singular.toLowerCase()} para os dados simulados originais. Outros
            estabelecimentos não são afetados.
          </p>
        </div>
        <Botao variante="secundaria" onClick={aoRestaurar}>
          <RotateCcw size={16} className="mr-1.5" /> Restaurar
        </Botao>
      </CartaoCorpo>
    </Cartao>
  );
}
