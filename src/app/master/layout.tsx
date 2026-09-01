"use client";

import type { ReactNode } from "react";
import { Building2, LayoutDashboard, ShieldCheck } from "lucide-react";
import { RequireRole } from "@/components/layout/require-role";
import { AdminShell, type ItemNavegacao } from "@/components/layout/admin-shell";

const ITENS: ItemNavegacao[] = [
  { href: "/master", rotulo: "Dashboard", icone: LayoutDashboard },
  { href: "/master/estabelecimentos", rotulo: "Estabelecimentos", icone: Building2 },
  { href: "/master/administradores", rotulo: "Administradores", icone: ShieldCheck },
];

export default function MasterLayout({ children }: { children: ReactNode }) {
  return (
    <RequireRole papeisPermitidos={["MASTER_OWNER", "MASTER_ADMIN", "MASTER_SUPPORT"]}>
      <AdminShell itens={ITENS} subtitulo="Administração master">
        {children}
      </AdminShell>
    </RequireRole>
  );
}
