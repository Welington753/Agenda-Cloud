"use client";

// Navegação do site comercial. Três destinos, sempre com o mesmo nome:
// "Entrar" e "Criar conta" levam à conta REAL; "Ver demonstração" leva à
// demonstração local, com dados fictícios. O site não chama o backend (ver
// sem-chamadas-backend.test.ts): são só links.
import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Botao, LinkBotao } from "@/components/ui/button";
import { NOME_PRODUTO } from "@/lib/config";
import {
  HREF_CRIAR_CONTA,
  HREF_DEMONSTRACAO,
  HREF_ENTRAR,
  NAV_SITE,
} from "@/lib/site/conteudo-comercial";

export function SiteNav() {
  const [menuAberto, setMenuAberto] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-8">
        <Link href="/" className="font-bold tracking-tight text-ink">
          {NOME_PRODUTO}
        </Link>

        <nav aria-label="Navegação principal" className="hidden items-center gap-6 lg:flex">
          {NAV_SITE.map((item) => (
            <a key={item.href} href={item.href} className="text-sm font-medium text-ink-soft hover:text-ink">
              {item.rotulo}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <Link href={HREF_DEMONSTRACAO} className="text-sm font-medium text-ink-soft hover:text-ink">
            Ver demonstração
          </Link>
          <Link href={HREF_ENTRAR} className="text-sm font-semibold text-ink-soft hover:text-ink">
            Entrar
          </Link>
          <LinkBotao href={HREF_CRIAR_CONTA} tamanho="sm">
            Criar conta
          </LinkBotao>
        </div>

        {/* No celular, "Entrar" fica sempre visível ao lado do menu: é o que o
            dono procura todo dia, não pode depender de abrir o menu. */}
        <div className="flex items-center gap-1 lg:hidden">
          <Link
            href={HREF_ENTRAR}
            className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] px-3 text-sm font-semibold text-ink"
          >
            Entrar
          </Link>
          <Botao
            variante="fantasma"
            tamanho="sm"
            className="min-h-11"
            aria-expanded={menuAberto}
            aria-controls="menu-mobile-site"
            onClick={() => setMenuAberto((v) => !v)}
          >
            {menuAberto ? <X size={20} /> : <Menu size={20} />}
            <span className="sr-only">{menuAberto ? "Fechar menu" : "Abrir menu"}</span>
          </Botao>
        </div>
      </div>

      {menuAberto && (
        <nav id="menu-mobile-site" aria-label="Navegação principal (celular)" className="border-t border-border px-4 py-3 lg:hidden">
          <ul className="flex flex-col gap-1">
            {NAV_SITE.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  onClick={() => setMenuAberto(false)}
                  className="block rounded-[var(--radius-control)] px-2 py-2 text-sm font-medium text-ink hover:bg-paper-muted"
                >
                  {item.rotulo}
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
            <LinkBotao href={HREF_CRIAR_CONTA} tamanho="sm" onClick={() => setMenuAberto(false)}>
              Criar conta
            </LinkBotao>
            <Link
              href={HREF_DEMONSTRACAO}
              onClick={() => setMenuAberto(false)}
              className="rounded-[var(--radius-control)] px-2 py-2 text-sm font-medium text-ink-soft hover:bg-paper-muted"
            >
              Ver demonstração (dados fictícios)
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
