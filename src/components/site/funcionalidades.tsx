// Funcionalidades: três destaques e uma lista compacta. Só o que existe e já
// está publicado (conteudo-comercial.ts); nada de "em breve".
import { FUNCIONALIDADES_DESTAQUE, FUNCIONALIDADES_DISPONIVEIS } from "@/lib/site/conteudo-comercial";

export function Funcionalidades() {
  return (
    <section
      id="funcionalidades"
      aria-labelledby="titulo-funcionalidades"
      className="scroll-mt-16 border-t border-border bg-paper-muted/60 px-4 py-16 sm:px-8 sm:py-24"
    >
      <div className="mx-auto max-w-5xl">
        <h2 id="titulo-funcionalidades" className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          O que o dia a dia precisa
        </h2>
        <div className="mt-8 grid gap-8 lg:grid-cols-3 lg:gap-10">
          {FUNCIONALIDADES_DESTAQUE.map((item) => (
            <div key={item.id}>
              <h3 className="text-lg font-bold text-ink">{item.rotulo}</h3>
              <p className="mt-2 text-base text-ink-soft">{item.descricao}</p>
            </div>
          ))}
        </div>
        <dl className="mt-12 grid border-t border-border sm:grid-cols-2 sm:gap-x-10">
          {FUNCIONALIDADES_DISPONIVEIS.map((item) => (
            <div key={item.id} className="border-b border-border py-4">
              <dt className="font-semibold text-ink">{item.rotulo}</dt>
              <dd className="mt-1 text-sm text-ink-soft">{item.descricao}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
