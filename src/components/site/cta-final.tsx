// Seção de contato (#contato), na faixa escura: o destino de todos os "Como
// obter acesso" da página. Explica o convite e traz o e-mail público.
import Link from "next/link";
import {
  CONTATO,
  EMAIL_CONTATO,
  HREF_DEMONSTRACAO,
  HREF_EMAIL_CONTATO,
  HREF_ENTRAR,
} from "@/lib/site/conteudo-comercial";
import { BOTAO_CLARO, BOTAO_CONTORNO_ESCURO, FAIXA_ESCURA, LINK_ESCURO } from "./estilos";

export function CtaFinal() {
  return (
    <section
      id="contato"
      aria-labelledby="titulo-contato"
      className={`${FAIXA_ESCURA} scroll-mt-16 px-4 py-16 sm:px-8 sm:py-24`}
    >
      <div className="mx-auto max-w-3xl">
        <h2 id="titulo-contato" className="text-3xl font-bold tracking-tight sm:text-4xl">
          {CONTATO.titulo}
        </h2>
        <p className="mt-4 text-base text-chrome-ink-soft sm:text-lg">{CONTATO.texto}</p>
        <p className="mt-3 text-base text-chrome-ink-soft sm:text-lg">{CONTATO.pedido}</p>
        <p className="mt-6 text-xl font-semibold break-words sm:text-2xl">
          <a href={HREF_EMAIL_CONTATO} className={LINK_ESCURO}>
            {EMAIL_CONTATO}
          </a>
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a href={HREF_EMAIL_CONTATO} className={BOTAO_CLARO}>
            Enviar e-mail
          </a>
          <Link href={HREF_ENTRAR} className={BOTAO_CONTORNO_ESCURO}>
            Já tenho conta: entrar
          </Link>
        </div>
        <p className="mt-6 text-sm text-chrome-ink-soft">
          Recebeu um convite? Abra o link do e-mail; ele vale por 24 horas. Para conhecer antes,{" "}
          <Link href={HREF_DEMONSTRACAO} className={LINK_ESCURO}>
            veja a demonstração
          </Link>{" "}
          com dados fictícios.
        </p>
      </div>
    </section>
  );
}
