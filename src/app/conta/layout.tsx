"use client";

// Portal da conta REAL (Lote 6C.1) — separado por inteiro de `/painel`,
// `/master` e `/profissional` (todos ainda 100% demonstrativos, movidos pelos
// repositórios locais). Nenhuma página sob `/conta` importa
// `@/lib/repositories` nem `@/lib/auth/auth-context` — nem indiretamente
// (ver lib/servicos/sem-dados-demo.test.ts).
//
// A estrutura comum (menu lateral no computador, barras no celular, ver
// components/conta/shell-conta.tsx) só aparece DEPOIS de `RequireRealSession`
// confirmar a sessão: sem sessão, a pessoa vai para o login sem ver menu
// nenhum.
import type { ReactNode } from "react";
import { RequireRealSession } from "@/components/auth/require-real-session";
import { ShellConta } from "@/components/conta/shell-conta";

export default function ContaLayout({ children }: { children: ReactNode }) {
  return (
    <RequireRealSession>
      <ShellConta>{children}</ShellConta>
    </RequireRealSession>
  );
}
