"use client";

// Menu do usuário do portal da plataforma: quem está conectado, Aparência e
// "Sair". Mesmo padrão do menu da conta da operação (components/conta/
// menu-conta.tsx): painel de divulgação (botão + região), não `role="menu"`,
// porque tem rádios e botão. Escape devolve o foco ao botão; tocar fora ou
// navegar fecha. Sem atalho para a operação.
import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { LogOut, Settings2 } from "lucide-react";
import { SeletorAparencia } from "@/components/aparencia/aparencia";

const FOCO_NO_ESCURO = "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-chrome-focus";

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  const letras = partes.length > 1 ? partes[0][0] + partes[partes.length - 1][0] : (partes[0] ?? "").slice(0, 2);
  return letras.toLocaleUpperCase("pt-BR") || "?";
}

export function MenuUsuarioPortal({
  nome,
  identificacao,
  saindo,
  aoSair,
}: {
  nome: string;
  identificacao: string;
  saindo: boolean;
  aoSair: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const raizRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const idPainel = useId();

  useEffect(() => setAberto(false), [pathname]);

  useEffect(() => {
    if (!aberto) return;
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key !== "Escape") return;
      setAberto(false);
      botaoRef.current?.focus();
    }
    function aoTocarFora(evento: PointerEvent) {
      if (!raizRef.current?.contains(evento.target as Node)) setAberto(false);
    }
    document.addEventListener("keydown", aoTeclar);
    document.addEventListener("pointerdown", aoTocarFora);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      document.removeEventListener("pointerdown", aoTocarFora);
    };
  }, [aberto]);

  return (
    <div ref={raizRef} className="relative md:w-full">
      <button
        ref={botaoRef}
        type="button"
        aria-expanded={aberto}
        aria-controls={idPainel}
        onClick={() => setAberto((a) => !a)}
        data-testid="abrir-menu-usuario"
        className={clsx(
          "flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-1.5 text-left text-chrome-ink hover:bg-chrome-hover md:w-full md:px-3 md:py-2",
          aberto && "bg-chrome-selected",
          FOCO_NO_ESCURO,
        )}
      >
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-chrome-hover text-xs font-semibold">
          {iniciais(nome)}
        </span>
        <span className="sr-only">Menu do usuário</span>
        <span className="hidden min-w-0 flex-1 md:block">
          <span className="block text-xs text-chrome-ink-soft">Conectado como</span>
          <span className="block truncate text-sm font-medium">{nome}</span>
        </span>
        <Settings2 size={16} aria-hidden="true" className="hidden shrink-0 text-chrome-ink-soft md:block" />
      </button>

      {aberto && (
        <div
          id={idPainel}
          role="region"
          aria-label="Menu do usuário"
          data-testid="menu-usuario"
          className={clsx(
            "absolute top-full right-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] space-y-3 rounded-[var(--radius-card)] border border-border bg-card p-3 text-ink shadow-[var(--shadow-lift)]",
            "md:top-auto md:right-auto md:bottom-full md:left-0 md:mt-0 md:mb-2 md:w-72",
          )}
        >
          <div className="min-w-0 px-2">
            <p className="truncate text-sm font-semibold">{nome}</p>
            <p className="truncate text-xs text-ink-soft">{identificacao}</p>
          </div>
          <SeletorAparencia className="px-2" />
          <button
            type="button"
            onClick={aoSair}
            disabled={saindo}
            aria-busy={saindo}
            className="flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-control)] px-2 text-sm font-medium text-ink hover:bg-paper-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus disabled:opacity-50"
          >
            <LogOut size={16} aria-hidden="true" />
            Sair
          </button>
        </div>
      )}
    </div>
  );
}
