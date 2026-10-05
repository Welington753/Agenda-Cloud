"use client";

// Portal da conta REAL (Lote 6C.1) — separado por inteiro de `/painel`,
// `/master` e `/profissional` (todos ainda 100% demonstrativos, movidos pelos
// repositórios locais). Nenhuma página sob `/conta` importa
// `@/lib/repositories` nem `@/lib/auth/auth-context` — ver auditoria no
// relatório final do lote.
//
// O cabeçalho com a navegação (Agenda, Serviços, Profissionais, Minha conta)
// é comum a toda a área e só aparece DEPOIS de `RequireRealSession` confirmar
// a sessão: sem sessão, a pessoa vai para o login sem ver menu nenhum.
import type { ReactNode } from "react";
import { RequireRealSession } from "@/components/auth/require-real-session";
import { CabecalhoConta } from "@/components/conta/cabecalho-conta";

export default function ContaLayout({ children }: { children: ReactNode }) {
  return (
    <RequireRealSession>
      <div className="flex min-h-screen flex-col bg-paper">
        <CabecalhoConta />
        <div className="flex-1">{children}</div>
      </div>
    </RequireRealSession>
  );
}
