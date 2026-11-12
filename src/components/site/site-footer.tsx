import Link from "next/link";
import { MarcaTimVix } from "@/components/marca/marca";
import {
  EMAIL_CONTATO,
  HREF_COMO_OBTER_ACESSO,
  HREF_DEMONSTRACAO,
  HREF_EMAIL_CONTATO,
  HREF_ENTRAR,
} from "@/lib/site/conteudo-comercial";
import { FAIXA_ESCURA } from "./estilos";

const LINK = "text-chrome-ink-soft hover:text-chrome-ink";

export function SiteFooter() {
  return (
    <footer className={`${FAIXA_ESCURA} border-t border-chrome-border px-4 py-8 sm:px-8`}>
      <div className="mx-auto flex max-w-5xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <MarcaTimVix className="text-chrome-ink" tamanho={20} />
        <nav aria-label="Rodapé">
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <li>
              <Link href={HREF_ENTRAR} className={LINK}>
                Entrar
              </Link>
            </li>
            <li>
              <a href={HREF_COMO_OBTER_ACESSO} className={LINK}>
                Como obter acesso
              </a>
            </li>
            <li>
              <Link href={HREF_DEMONSTRACAO} className={LINK}>
                Demonstração
              </Link>
            </li>
            <li>
              <a href={HREF_EMAIL_CONTATO} className={LINK}>
                {EMAIL_CONTATO}
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
