import { Check } from "lucide-react";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { LinkBotao } from "@/components/ui/button";
import { PLANOS_COMERCIAIS } from "@/lib/site/conteudo-comercial";

export function Planos() {
  return (
    <section id="planos" className="mx-auto max-w-5xl px-4 py-14 sm:px-8">
      <h2 className="text-center text-2xl font-bold text-ink sm:text-3xl">Planos</h2>
      <p className="mx-auto mt-2 max-w-xl text-center text-sm text-ink-soft">
        Os valores ainda estão em definição para o piloto. Comece pela demonstração para conhecer o que cada plano inclui.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {PLANOS_COMERCIAIS.map((plano) => (
          <Cartao key={plano.codigo} className={plano.codigo === "equipe" ? "border-accent" : undefined}>
            <CartaoCorpo className="flex h-full flex-col">
              <p className="font-bold text-ink">{plano.nome}</p>
              <p className="mt-1 text-sm text-ink-soft">{plano.descricaoCurta}</p>
              <p className="mt-4 text-sm font-semibold text-accent">{plano.precoTexto}</p>
              <ul className="mt-4 flex-1 space-y-2">
                {plano.destaques.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-ink-soft">
                    <Check size={16} className="mt-0.5 shrink-0 text-[color:var(--color-success)]" />
                    {item}
                  </li>
                ))}
              </ul>
              <LinkBotao href={plano.ctaHref} className="mt-6 w-full" variante={plano.codigo === "equipe" ? "primaria" : "secundaria"}>
                Testar grátis
              </LinkBotao>
            </CartaoCorpo>
          </Cartao>
        ))}
      </div>
    </section>
  );
}
