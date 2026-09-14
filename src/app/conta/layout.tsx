"use client";

// Portal da conta REAL (Lote 6C.1) — separado por inteiro de `/painel`,
// `/master` e `/profissional` (todos ainda 100% demonstrativos, movidos pelos
// repositórios locais). Nenhuma página sob `/conta` importa
// `@/lib/repositories` nem `@/lib/auth/auth-context` — ver auditoria no
// relatório final do lote.
import type { ReactNode } from "react";
import { RequireRealSession } from "@/components/auth/require-real-session";

export default function ContaLayout({ children }: { children: ReactNode }) {
  return <RequireRealSession>{children}</RequireRealSession>;
}
