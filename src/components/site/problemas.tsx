import { AlertCircle } from "lucide-react";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { PROBLEMAS } from "@/lib/site/conteudo-comercial";

export function Problemas() {
  return (
    <section className="border-y border-border bg-paper-muted/60 px-4 py-14 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-center text-2xl font-bold text-ink sm:text-3xl">O que atrapalha a agenda de um negócio pequeno</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {PROBLEMAS.map((p) => (
            <Cartao key={p.id}>
              <CartaoCorpo className="flex items-start gap-3">
                <AlertCircle size={20} className="mt-0.5 shrink-0 text-[color:var(--color-warning)]" />
                <div>
                  <p className="font-semibold text-ink">{p.titulo}</p>
                  <p className="mt-1 text-sm text-ink-soft">{p.descricao}</p>
                </div>
              </CartaoCorpo>
            </Cartao>
          ))}
        </div>
      </div>
    </section>
  );
}
