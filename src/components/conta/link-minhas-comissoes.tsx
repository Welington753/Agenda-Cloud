"use client";

// Atalho da agenda própria para as próprias comissões, só quando o dono
// liberou a consulta em "Equipe e acessos" (o servidor confere de novo).
import Link from "next/link";
import { Wallet } from "lucide-react";
import { useAreas } from "@/lib/conta/use-areas";
import { ROTA_MINHAS_COMISSOES } from "@/lib/conta/rotas";

export function LinkMinhasComissoes() {
  if (!useAreas()("AGENDA_PROPRIA_COMISSOES")) return null;
  return (
    <Link
      href={ROTA_MINHAS_COMISSOES}
      className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-border-strong bg-card px-4 text-sm font-medium text-ink hover:bg-paper-muted"
      data-testid="minhas-comissoes"
    >
      <Wallet size={16} aria-hidden="true" />
      Minhas comissões
    </Link>
  );
}
