// Planos: comparação compacta, sem preço (o valor é combinado na liberação do
// acesso) e com uma única chamada.
import { HREF_COMO_OBTER_ACESSO, NOTA_DOS_PLANOS, PLANOS_COMERCIAIS } from "@/lib/site/conteudo-comercial";
import { BOTAO_PRINCIPAL } from "./estilos";

export function Planos() {
  return (
    <section
      id="planos"
      aria-labelledby="titulo-planos"
      className="scroll-mt-16 border-t border-border bg-paper-muted/60 px-4 py-16 sm:px-8 sm:py-24"
    >
      <div className="mx-auto max-w-5xl">
        <h2 id="titulo-planos" className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Planos
        </h2>
        <p className="mt-3 max-w-2xl text-base text-ink-soft">{NOTA_DOS_PLANOS}</p>
        <div className="mt-8 grid border-t border-border md:grid-cols-3 md:divide-x md:divide-border">
          {PLANOS_COMERCIAIS.map((plano) => (
            <div key={plano.codigo} className="border-b border-border py-6 md:border-b-0 md:px-6 md:first:pl-0 md:last:pr-0">
              <h3 className="text-xl font-bold text-ink">{plano.nome}</h3>
              <p className="mt-1 text-sm text-ink-soft">{plano.descricaoCurta}</p>
              <ul className="mt-4 space-y-2">
                {plano.destaques.map((item) => (
                  <li key={item} className="flex gap-2 text-base text-ink">
                    <span aria-hidden="true" className="text-accent">
                      —
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <a href={HREF_COMO_OBTER_ACESSO} className={`${BOTAO_PRINCIPAL} mt-8 w-full sm:w-auto`}>
          Como obter acesso
        </a>
      </div>
    </section>
  );
}
