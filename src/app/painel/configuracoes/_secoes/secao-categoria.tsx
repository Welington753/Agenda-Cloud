import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import { CATEGORIAS_NEGOCIO } from "@/lib/verticals/terminologia";
import type { Terminologia } from "@/lib/verticals/terminologia";
import type { CategoriaNegocio } from "@/lib/types";
import type { EstadoConfiguracoes } from "../page";
import { Campo } from "./campo";

interface SecaoCategoriaProps {
  categoria: EstadoConfiguracoes["categoria"];
  terminologia: Terminologia;
  setForm: (atualizar: (f: EstadoConfiguracoes) => EstadoConfiguracoes) => void;
}

export function SecaoCategoria({ categoria, terminologia, setForm }: SecaoCategoriaProps) {
  return (
    <Cartao>
      <CartaoCorpo className="space-y-4">
        <CartaoTitulo>Categoria do negócio</CartaoTitulo>
        <Campo rotulo="Categoria">
          <select
            value={categoria}
            onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value as CategoriaNegocio }))}
            className="w-full rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
          >
            {CATEGORIAS_NEGOCIO.map((c) => (
              <option key={c.valor} value={c.valor}>
                {c.rotulo}
              </option>
            ))}
          </select>
        </Campo>
        <p className="text-xs text-ink-soft">
          Define os termos usados na interface (ex.: {terminologia.profissional.singular.toLowerCase()},{" "}
          {terminologia.consumidor.singular.toLowerCase()}, {terminologia.agendamento.singular.toLowerCase()}).
        </p>
      </CartaoCorpo>
    </Cartao>
  );
}
