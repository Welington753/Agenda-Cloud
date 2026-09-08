"use client";

import Link from "next/link";
import { Circle, Copy, X } from "lucide-react";
import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { CHECKLIST_PRIMEIROS_PASSOS } from "@/lib/onboarding/checklist";
import { dispensarChecklistPrimeirosPassos } from "@/lib/onboarding/checklist-persistencia";

interface ChecklistPrimeirosPassosProps {
  tenantId: string;
  slug: string;
  aoDispensar: () => void;
}

export function ChecklistPrimeirosPassos({ tenantId, slug, aoDispensar }: ChecklistPrimeirosPassosProps) {
  const { notificar } = useToast();

  async function copiarLink() {
    const link = `${window.location.origin}/${slug}`;
    try {
      await navigator.clipboard.writeText(link);
      notificar("Link copiado.", "sucesso");
    } catch {
      notificar(`Não foi possível copiar automaticamente. Link: ${link}`, "info");
    }
  }

  function dispensar() {
    dispensarChecklistPrimeirosPassos(tenantId);
    aoDispensar();
  }

  return (
    <Cartao className="border-dashed">
      <CartaoCorpo className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <CartaoTitulo>Primeiros passos</CartaoTitulo>
          <button
            type="button"
            onClick={dispensar}
            aria-label="Dispensar checklist de primeiros passos"
            className="text-ink-soft hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
        <ul className="space-y-1">
          {CHECKLIST_PRIMEIROS_PASSOS.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] px-2 py-1.5 text-sm hover:bg-paper-muted"
            >
              <span className="flex items-center gap-2 text-ink">
                <Circle size={14} className="shrink-0 text-ink-soft" /> {item.titulo}
              </span>
              {item.tipo === "rota" && item.rotaDestino && (
                <Link href={item.rotaDestino} className="shrink-0 text-xs font-semibold text-accent hover:underline">
                  Ir
                </Link>
              )}
              {item.tipo === "copiar-link" && (
                <button
                  type="button"
                  onClick={() => void copiarLink()}
                  className="flex shrink-0 items-center gap-1 text-xs font-semibold text-accent hover:underline"
                >
                  <Copy size={12} /> Copiar
                </button>
              )}
              {item.tipo === "rota-publica" && (
                <Link href={`/${slug}/agendar`} className="shrink-0 text-xs font-semibold text-accent hover:underline">
                  Testar
                </Link>
              )}
            </li>
          ))}
        </ul>
      </CartaoCorpo>
    </Cartao>
  );
}
