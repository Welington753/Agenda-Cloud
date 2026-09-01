"use client";

import type { ReactNode } from "react";
import { CalendarDays, ShieldAlert } from "lucide-react";
import { RequireRole } from "@/components/layout/require-role";
import { AdminShell, type ItemNavegacao } from "@/components/layout/admin-shell";
import { TenantProvider, useTenant } from "@/lib/tenant/tenant-context";

const ITENS: ItemNavegacao[] = [{ href: "/profissional/agenda", rotulo: "Minha agenda", icone: CalendarDays }];

export default function ProfissionalLayout({ children }: { children: ReactNode }) {
  return (
    <RequireRole papeisPermitidos={["profissional"]}>
      <TenantProvider>
        <ProfissionalShell>{children}</ProfissionalShell>
      </TenantProvider>
    </RequireRole>
  );
}

function ProfissionalShell({ children }: { children: ReactNode }) {
  const { terminologia, estabelecimento, carregando } = useTenant();
  const subtitulo = `Agenda ${terminologia.profissional.artigo === "a" ? "da" : "do"} ${terminologia.profissional.singular.toLowerCase()}`;

  const bloqueado = !carregando && estabelecimento && (estabelecimento.status === "suspenso" || estabelecimento.status === "cancelado");
  if (bloqueado && estabelecimento) {
    return (
      <AdminShell itens={ITENS} subtitulo={subtitulo}>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-danger-soft text-[color:var(--color-danger)]">
            <ShieldAlert size={28} />
          </div>
          <h1 className="text-lg font-bold text-ink">
            {terminologia.estabelecimento.singular} {estabelecimento.status === "suspenso" ? "suspenso(a)" : "cancelado(a)"} na plataforma
          </h1>
          <p className="max-w-sm text-sm text-ink-soft">
            {estabelecimento.motivoSuspensao ?? "O acesso está temporariamente bloqueado."}
          </p>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell itens={ITENS} subtitulo={subtitulo}>
      {children}
    </AdminShell>
  );
}
