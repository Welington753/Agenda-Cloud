"use client";

// Navegação da página inicial, na faixa escura. Três destinos, sempre com o
// mesmo nome: "Entrar" leva à conta REAL; "Como obter acesso" leva à seção de
// contato desta página; "Ver demonstração" leva à demonstração local, com
// dados fictícios. A página não chama o backend (ver
// sem-chamadas-backend.test.ts): são só links.
import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { MarcaAgendaCloud } from "@/components/marca/marca";
import {
  HREF_COMO_OBTER_ACESSO,
  HREF_DEMONSTRACAO,
  HREF_ENTRAR,
  NAV_SITE,
} from "@/lib/site/conteudo-comercial";
import { FAIXA_ESCURA } from "./estilos";

const LINK_MENU = "text-sm font-medium text-chrome-ink-soft hover:text-chrome-ink";

export function SiteNav() {
  const [menuAberto, setMenuAberto] = useState(false);
  const fechar = () => setMenuAberto(false);

  return (
    <header className={`sticky top-0 z-40 border-b border-chrome-border ${FAIXA_ESCURA}`}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-8">
        <Link href="/" className="text-chrome-ink" aria-label="Página inicial">
          <MarcaAgendaCloud />
        </Link>

        <nav aria-label="Navegação principal" className="hidden items-center gap-6 lg:flex">
          {NAV_SITE.map((item) => (
            <a key={item.href} href={item.href} className={LINK_MENU}>
              {item.rotulo}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-5 lg:flex">
          <Link href={HREF_DEMONSTRACAO} className={LINK_MENU}>
            Ver demonstração
          </Link>
          <Link href={HREF_ENTRAR} className="text-sm font-semibold text-chrome-ink hover:underline">
            Entrar
          </Link>
          <a
            href={HREF_COMO_OBTER_ACESSO}
            className="inline-flex min-h-9 items-center rounded-[var(--radius-control)] bg-paper px-3 text-sm font-semibold text-ink hover:bg-paper-muted"
          >
            Como obter acesso
          </a>
        </div>

        {/* No celular, "Entrar" fica sempre visível ao lado do menu: é o que o
            dono procura todo dia, não pode depender de abrir o menu. */}
        <div className="flex items-center gap-1 lg:hidden">
          <Link
            href={HREF_ENTRAR}
            className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] px-3 text-sm font-semibold text-chrome-ink"
          >
            Entrar
          </Link>
          <button
            type="button"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-control)] text-chrome-ink hover:bg-chrome-hover"
            aria-expanded={menuAberto}
            aria-controls="menu-mobile-site"
            onClick={() => setMenuAberto((v) => !v)}
          >
            {menuAberto ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
            <span className="sr-only">{menuAberto ? "Fechar menu" : "Abrir menu"}</span>
          </button>
        </div>
      </div>

      {menuAberto && (
        <nav
          id="menu-mobile-site"
          aria-label="Navegação principal (celular)"
          className="border-t border-chrome-border px-4 py-3 lg:hidden"
        >
          <ul className="flex flex-col gap-1">
            {NAV_SITE.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  onClick={fechar}
                  className="flex min-h-11 items-center rounded-[var(--radius-control)] px-2 text-sm font-medium text-chrome-ink hover:bg-chrome-hover"
                >
                  {item.rotulo}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-col gap-2 border-t border-chrome-border pt-3">
            <a
              href={HREF_COMO_OBTER_ACESSO}
              onClick={fechar}
              className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] bg-paper px-3 text-sm font-semibold text-ink"
            >
              Como obter acesso
            </a>
            <Link
              href={HREF_DEMONSTRACAO}
              onClick={fechar}
              className="flex min-h-11 items-center rounded-[var(--radius-control)] px-2 text-sm font-medium text-chrome-ink-soft hover:bg-chrome-hover"
            >
              Ver demonstração (dados fictícios)
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
