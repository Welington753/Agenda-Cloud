// Para quem: um parágrafo e os segmentos em texto corrido, sem cartões.
import { PARA_QUEM, SEGMENTOS } from "@/lib/site/conteudo-comercial";

export function Segmentos() {
  return (
    <section
      id="para-quem"
      aria-labelledby="titulo-para-quem"
      className="scroll-mt-16 border-t border-border px-4 py-16 sm:px-8 sm:py-24"
    >
      <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16">
        <div>
          <h2 id="titulo-para-quem" className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            {PARA_QUEM.titulo}
          </h2>
          <p className="mt-4 text-base text-ink-soft">{PARA_QUEM.texto}</p>
        </div>
        <ul className="flex flex-wrap content-start gap-x-2 gap-y-3 text-lg font-semibold text-ink lg:pt-1">
          {SEGMENTOS.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2">
              {s.rotulo}
              {i < SEGMENTOS.length - 1 && (
                <span aria-hidden="true" className="text-accent">
                  ·
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
