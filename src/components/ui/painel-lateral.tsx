"use client";

// Painel sobreposto para formulários longos: entra pela direita no computador
// (altura toda, largura de formulário) e sobe de baixo no celular (quase a tela
// toda). Componente de apresentação puro — não conhece domínio nenhum.
//
// Acessibilidade: `role="dialog"` + `aria-modal`, foco movido para dentro ao
// abrir e devolvido a quem abriu ao fechar, Tab circula só dentro do painel e
// Escape fecha. `podeFechar={false}` (por exemplo, com um envio em voo)
// bloqueia Escape, o fundo e o X: fechar no meio de uma gravação esconderia
// o resultado dela.
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface PainelLateralProps {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  descricao?: string;
  podeFechar?: boolean;
  children: ReactNode;
  "data-testid"?: string;
}

const SELETOR_FOCAVEL =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function PainelLateral({
  aberto,
  aoFechar,
  titulo,
  descricao,
  podeFechar = true,
  children,
  "data-testid": testId,
}: PainelLateralProps) {
  const painelRef = useRef<HTMLDivElement>(null);
  // Lidos pelo listener de teclado sem precisar recriá-lo a cada render.
  const podeFecharRef = useRef(podeFechar);
  const aoFecharRef = useRef(aoFechar);
  useEffect(() => {
    podeFecharRef.current = podeFechar;
    aoFecharRef.current = aoFechar;
  });

  useEffect(() => {
    if (!aberto) return;
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    painelRef.current?.focus();

    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Num campo de busca com texto, o Escape do navegador limpa o campo;
        // fechar o painel junto descartaria o formulário inteiro.
        const alvo = e.target;
        const limpandoBusca =
          alvo instanceof HTMLInputElement && alvo.type === "search" && alvo.value !== "";
        if (podeFecharRef.current && !e.defaultPrevented && !limpandoBusca) aoFecharRef.current();
        return;
      }
      if (e.key !== "Tab" || !painelRef.current) return;
      const focaveis = [...painelRef.current.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL)];
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      const ativo = document.activeElement;
      if (e.shiftKey && (ativo === primeiro || ativo === painelRef.current)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && ativo === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }

    document.addEventListener("keydown", aoTeclar);
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = overflowAnterior;
      anterior?.focus();
    };
  }, [aberto]);

  if (!aberto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end sm:items-stretch">
      <button
        type="button"
        aria-label="Fechar painel"
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-black/40"
        onClick={() => podeFechar && aoFechar()}
      />
      <div
        ref={painelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="painel-lateral-titulo"
        tabIndex={-1}
        data-testid={testId}
        className="relative flex max-h-[92dvh] w-full flex-col rounded-t-[var(--radius-card)] bg-paper shadow-[var(--shadow-lift)] outline-none sm:max-h-none sm:max-w-xl sm:rounded-none sm:rounded-l-[var(--radius-card)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border bg-card px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id="painel-lateral-titulo" className="text-lg font-bold text-ink">
              {titulo}
            </h2>
            {descricao && <p className="text-sm text-ink-soft">{descricao}</p>}
          </div>
          <button
            type="button"
            aria-label="Fechar"
            onClick={aoFechar}
            disabled={!podeFechar}
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-paper-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">{children}</div>
      </div>
    </div>
  );
}
