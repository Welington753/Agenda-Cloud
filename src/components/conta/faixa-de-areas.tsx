"use client";

// Faixa das áreas da conta (components/conta/shell-conta.tsx).
//
// - Celular: barra inferior com TODAS as áreas liberadas, rolando na
//   horizontal só dentro da faixa (a página não desliza para o lado). A área
//   atual é trazida para o centro a cada troca de página. Degradê e seta nas
//   bordas avisam que há mais áreas; são só visuais (`aria-hidden`): o leitor
//   de tela percorre a lista inteira, e o Tab leva o foco a cada link (o
//   navegador rola a faixa até ele).
// - Computador: bloco comum do menu lateral, sem rolagem horizontal.
//
// Os itens vêm prontos (mesma definição do menu, ver lib/conta/navegacao.ts).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";

/** Folga, em px, para considerar que a faixa chegou a uma ponta. */
const FOLGA = 4;

export function FaixaDeAreas({ children }: { children: ReactNode }) {
  const faixa = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const [pontas, setPontas] = useState({ antes: false, depois: false });

  const medir = useCallback(() => {
    const el = faixa.current;
    if (!el) return;
    const antes = el.scrollLeft > FOLGA;
    const depois = el.scrollLeft + el.clientWidth < el.scrollWidth - FOLGA;
    setPontas((p) => (p.antes === antes && p.depois === depois ? p : { antes, depois }));
  }, []);

  // Área atual no centro da faixa. Só a faixa rola (nada de scrollIntoView,
  // que também rolaria a página).
  useEffect(() => {
    const el = faixa.current;
    if (!el || el.scrollWidth <= el.clientWidth) {
      medir();
      return;
    }
    const atual = el.querySelector<HTMLElement>('[aria-current="page"]');
    if (atual) {
      const caixa = el.getBoundingClientRect();
      const item = atual.getBoundingClientRect();
      const desvio = item.left + item.width / 2 - (caixa.left + caixa.width / 2);
      el.scrollTo({ left: el.scrollLeft + desvio });
    }
    medir();
  }, [pathname, medir]);

  useEffect(() => {
    const el = faixa.current;
    if (!el) return;
    el.addEventListener("scroll", medir, { passive: true });
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => {
      el.removeEventListener("scroll", medir);
      observador.disconnect();
    };
  }, [medir]);

  return (
    <div className="relative md:static">
      <div
        ref={faixa}
        data-testid="faixa-de-areas"
        className={clsx(
          "flex snap-x overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          "md:block md:snap-none md:overflow-visible",
        )}
      >
        {children}
      </div>
      <Borda lado="antes" visivel={pontas.antes} />
      <Borda lado="depois" visivel={pontas.depois} />
    </div>
  );
}

/** Degradê com seta na ponta da faixa que ainda tem áreas escondidas. */
function Borda({ lado, visivel }: { lado: "antes" | "depois"; visivel: boolean }) {
  const Seta = lado === "antes" ? ChevronLeft : ChevronRight;
  return (
    <div
      aria-hidden="true"
      data-testid={`faixa-mais-${lado}`}
      data-visivel={visivel}
      className={clsx(
        "pointer-events-none absolute inset-y-0 flex w-8 items-center text-chrome-ink-soft transition-opacity md:hidden",
        lado === "antes" ? "left-0 justify-start pl-0.5" : "right-0 justify-end pr-0.5",
        visivel ? "opacity-100" : "opacity-0",
      )}
      style={{ backgroundImage: `linear-gradient(to ${lado === "antes" ? "right" : "left"}, var(--color-chrome) 35%, transparent)` }}
    >
      <Seta size={16} />
    </div>
  );
}
