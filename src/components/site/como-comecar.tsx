import { LinkBotao } from "@/components/ui/button";
import { COMO_COMECAR, HREF_TESTAR_GRATIS } from "@/lib/site/conteudo-comercial";

export function ComoComecar() {
  return (
    <section className="border-y border-border bg-paper-muted/60 px-4 py-14 sm:px-8">
      <div className="mx-auto max-w-4xl text-center">
        <h2 className="text-2xl font-bold text-ink sm:text-3xl">Como começar</h2>
        <div className="mt-8 grid gap-6 text-left sm:grid-cols-3">
          {COMO_COMECAR.map((etapa) => (
            <div key={etapa.numero}>
              <span className="flex size-8 items-center justify-center rounded-full border-2 border-accent text-sm font-bold text-accent">
                {etapa.numero}
              </span>
              <p className="mt-3 font-semibold text-ink">{etapa.titulo}</p>
              <p className="mt-1 text-sm text-ink-soft">{etapa.descricao}</p>
            </div>
          ))}
        </div>
        <LinkBotao href={HREF_TESTAR_GRATIS} tamanho="lg" className="mt-10">
          Testar grátis agora
        </LinkBotao>
      </div>
    </section>
  );
}
