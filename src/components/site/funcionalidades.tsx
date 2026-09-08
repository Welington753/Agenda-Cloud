import { CheckCircle2, Wrench } from "lucide-react";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FUNCIONALIDADES_DISPONIVEIS, FUNCIONALIDADES_EM_DESENVOLVIMENTO } from "@/lib/site/conteudo-comercial";

export function Funcionalidades() {
  return (
    <section id="funcionalidades" className="mx-auto max-w-5xl px-4 py-14 sm:px-8">
      <h2 className="text-center text-2xl font-bold text-ink sm:text-3xl">Funcionalidades</h2>

      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <CheckCircle2 size={18} className="text-[color:var(--color-success)]" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Disponível na demonstração</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FUNCIONALIDADES_DISPONIVEIS.map((f) => (
            <Cartao key={f.id}>
              <CartaoCorpo>
                <p className="font-semibold text-ink">{f.rotulo}</p>
                <p className="mt-1 text-sm text-ink-soft">{f.descricao}</p>
              </CartaoCorpo>
            </Cartao>
          ))}
        </div>
      </div>

      <div className="mt-12">
        <div className="mb-3 flex items-center gap-2">
          <Wrench size={18} className="text-[color:var(--color-info)]" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Em desenvolvimento para o piloto</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FUNCIONALIDADES_EM_DESENVOLVIMENTO.map((f) => (
            <Cartao key={f.id} className="border-dashed opacity-90">
              <CartaoCorpo>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-ink">{f.rotulo}</p>
                  <Badge cor="info">Em breve</Badge>
                </div>
                <p className="mt-1 text-sm text-ink-soft">{f.descricao}</p>
              </CartaoCorpo>
            </Cartao>
          ))}
        </div>
      </div>
    </section>
  );
}
