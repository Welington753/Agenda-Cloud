"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  children: ReactNode;
  rodape?: ReactNode;
}

export function Modal({ aberto, aoFechar, titulo, children, rodape }: ModalProps) {
  useEffect(() => {
    if (!aberto) return;
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") aoFechar();
    }
    document.addEventListener("keydown", aoTeclar);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = "";
    };
  }, [aberto, aoFechar]);

  if (!aberto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Fechar"
        className="absolute inset-0 cursor-default"
        onClick={aoFechar}
        tabIndex={-1}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-titulo"
        className="relative w-full max-w-md rounded-t-[var(--radius-card)] border border-border bg-card p-5 shadow-[var(--shadow-lift)] sm:rounded-[var(--radius-card)]"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id="modal-titulo" className="text-lg font-bold text-ink">
            {titulo}
          </h2>
          <button
            type="button"
            aria-label="Fechar"
            onClick={aoFechar}
            className="shrink-0 rounded-full p-1 text-ink-soft hover:bg-paper-muted"
          >
            <X size={20} />
          </button>
        </div>
        <div className="text-sm text-ink-soft">{children}</div>
        {rodape && <div className="mt-5 flex justify-end gap-2">{rodape}</div>}
      </div>
    </div>
  );
}
