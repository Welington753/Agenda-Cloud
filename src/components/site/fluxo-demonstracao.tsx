import { FLUXO_DEMONSTRACAO } from "@/lib/site/conteudo-comercial";

export function FluxoDemonstracao() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-14 sm:px-8">
      <h2 className="text-center text-2xl font-bold text-ink sm:text-3xl">Como funciona na prática</h2>
      <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FLUXO_DEMONSTRACAO.map((etapa, indice) => (
          <li key={etapa.numero} className="relative rounded-[var(--radius-card)] border border-border bg-card p-5">
            <span className="flex size-8 items-center justify-center rounded-full bg-accent text-sm font-bold text-white">
              {etapa.numero}
            </span>
            <p className="mt-3 font-semibold text-ink">{etapa.titulo}</p>
            <p className="mt-1 text-sm text-ink-soft">{etapa.descricao}</p>
            {indice < FLUXO_DEMONSTRACAO.length - 1 && (
              <span aria-hidden className="absolute top-9 -right-2 hidden text-ink-soft lg:block">
                →
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
