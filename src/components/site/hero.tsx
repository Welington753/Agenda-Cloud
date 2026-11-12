// Topo da página inicial, na faixa escura: o que é, para quem, e as três
// chamadas. A prévia da agenda vem logo abaixo (previa-agenda.tsx), metade
// sobre a faixa escura e metade sobre o creme.
import Link from "next/link";
import { HREF_COMO_OBTER_ACESSO, HREF_DEMONSTRACAO, HREF_ENTRAR, TOPO } from "@/lib/site/conteudo-comercial";
import { BOTAO_CLARO, BOTAO_CONTORNO_ESCURO, FAIXA_ESCURA, LINK_ESCURO } from "./estilos";

export function Hero() {
  return (
    <section className={`${FAIXA_ESCURA} px-4 pt-14 pb-40 sm:px-8 sm:pt-20 sm:pb-48`}>
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-sm font-semibold text-chrome-ink-soft">{TOPO.selo}</p>
        <h1 className="mt-4 text-4xl leading-[1.1] font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
          {TOPO.titulo}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-pretty text-chrome-ink-soft sm:text-lg">{TOPO.texto}</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <a href={HREF_COMO_OBTER_ACESSO} className={BOTAO_CLARO}>
            Como obter acesso
          </a>
          <Link href={HREF_ENTRAR} className={BOTAO_CONTORNO_ESCURO}>
            Entrar
          </Link>
        </div>
        <p className="mt-5 text-sm text-chrome-ink-soft">
          <Link href={HREF_DEMONSTRACAO} className={LINK_ESCURO}>
            Ver demonstração
          </Link>{" "}
          — {TOPO.notaDemonstracao}
        </p>
      </div>
    </section>
  );
}
