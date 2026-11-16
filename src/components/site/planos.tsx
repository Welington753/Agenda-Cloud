// Planos: comparação compacta, com o preço mensal em destaque, a opção
// trimestral abaixo (total dos três meses) e uma única chamada. Não há
// checkout: a chamada leva à seção de contato.
import {
  HREF_COMO_OBTER_ACESSO,
  NOTA_DOS_PLANOS,
  PLANOS_COMERCIAIS,
  ROTULOS_DE_PRECO,
  precosExibidos,
} from "@/lib/site/conteudo-comercial";
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
              <p className="mt-4 flex flex-wrap items-baseline gap-x-2">
                <span className="text-3xl font-bold tracking-tight text-ink">{precosExibidos(plano).mensal}</span>
                <span className="text-base text-ink-soft">{ROTULOS_DE_PRECO.porMes}</span>
              </p>
              <p className="mt-1 text-base text-ink">
                ou <span className="font-semibold">{precosExibidos(plano).trimestral}</span> {ROTULOS_DE_PRECO.porTrimestre}
              </p>
              <p className="text-sm text-ink-soft">{ROTULOS_DE_PRECO.totalDoTrimestre}</p>
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
