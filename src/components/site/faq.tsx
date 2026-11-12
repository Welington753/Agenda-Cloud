import { PERGUNTAS_FREQUENTES } from "@/lib/site/conteudo-comercial";

export function Faq() {
  return (
    <section aria-labelledby="titulo-perguntas" className="border-t border-border px-4 py-16 sm:px-8 sm:py-24">
      <div className="mx-auto max-w-3xl">
        <h2 id="titulo-perguntas" className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Perguntas frequentes
        </h2>
        <div className="mt-8 divide-y divide-border border-y border-border">
          {PERGUNTAS_FREQUENTES.map((item) => (
            <details key={item.id} className="group">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-3 text-base font-semibold text-ink">
                {item.pergunta}
                <span aria-hidden="true" className="text-xl leading-none text-ink-muted group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="pb-4 text-base text-ink-soft">{item.resposta}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
