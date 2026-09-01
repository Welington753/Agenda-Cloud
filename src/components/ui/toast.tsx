"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";

type TipoToast = "sucesso" | "erro" | "info";

interface Toast {
  id: string;
  tipo: TipoToast;
  mensagem: string;
}

interface ToastContextValue {
  notificar: (mensagem: string, tipo?: TipoToast) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const ESTILO_POR_TIPO: Record<TipoToast, { icone: typeof CheckCircle2; classe: string }> = {
  sucesso: { icone: CheckCircle2, classe: "border-success/30 bg-success-soft text-[color:var(--color-success)]" },
  erro: { icone: XCircle, classe: "border-danger/30 bg-danger-soft text-[color:var(--color-danger)]" },
  info: { icone: Info, classe: "border-info/30 bg-info-soft text-[color:var(--color-info)]" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notificar = useCallback((mensagem: string, tipo: TipoToast = "sucesso") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((atual) => [...atual, { id, tipo, mensagem }]);
    setTimeout(() => {
      setToasts((atual) => atual.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ notificar }}>
      {children}
      <div
        className="fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:right-4 sm:left-auto"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const { icone: Icone, classe } = ESTILO_POR_TIPO[t.tipo];
          return (
            <div
              key={t.id}
              className={`animar-toast flex w-full max-w-sm items-start gap-2 rounded-[var(--radius-control)] border px-4 py-3 shadow-lg ${classe}`}
            >
              <Icone size={18} className="mt-0.5 shrink-0" />
              <p className="flex-1 text-sm font-medium">{t.mensagem}</p>
              <button
                type="button"
                aria-label="Fechar notificação"
                onClick={() => setToasts((atual) => atual.filter((x) => x.id !== t.id))}
                className="shrink-0 opacity-60 hover:opacity-100"
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const contexto = useContext(ToastContext);
  if (!contexto) throw new Error("useToast precisa ser usado dentro de <ToastProvider>");
  return contexto;
}
