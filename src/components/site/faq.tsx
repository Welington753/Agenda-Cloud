import { PERGUNTAS_FREQUENTES } from "@/lib/site/conteudo-comercial";

export function Faq() {
  return (
    <section className="border-y border-border bg-paper-muted/60 px-4 py-14 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-center text-2xl font-bold text-ink sm:text-3xl">Perguntas frequentes</h2>
        <div className="mt-8 space-y-3">
          {PERGUNTAS_FREQUENTES.map((item) => (
            <details key={item.id} className="rounded-[var(--radius-card)] border border-border bg-card">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                {item.pergunta}
              </summary>
              <div className="border-t border-border px-4 py-3 text-sm text-ink-soft">{item.resposta}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
