// "Produto": a prévia da agenda (metade sobre a faixa escura do topo) e o
// caminho de um pedido, em três passos sem cartões.
import { COMO_FUNCIONA } from "@/lib/site/conteudo-comercial";
import { PreviaAgenda } from "./previa-agenda";

export function ComoFunciona() {
  return (
    <section id="produto" aria-labelledby="titulo-como-funciona" className="scroll-mt-16 px-4 pb-16 sm:px-8 sm:pb-24">
      <div className="mx-auto -mt-28 max-w-5xl sm:-mt-36">
        <PreviaAgenda />
      </div>

      <div className="mx-auto mt-16 max-w-5xl sm:mt-24">
        <h2 id="titulo-como-funciona" className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Como funciona
        </h2>
        <ol className="mt-8 grid gap-8 sm:grid-cols-3 sm:gap-10">
          {COMO_FUNCIONA.map((etapa) => (
            <li key={etapa.numero} className="border-t-2 border-ink pt-4">
              <p className="text-sm font-semibold text-ink-muted tabular-nums">
                <span className="sr-only">Passo </span>
                {String(etapa.numero).padStart(2, "0")}
              </p>
              <h3 className="mt-2 text-lg font-bold text-ink">{etapa.titulo}</h3>
              <p className="mt-2 text-base text-ink-soft">{etapa.descricao}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
