"use client";

// Portal da plataforma: área PRÓPRIA, com entrada, cabeçalho e menu
// separados da operação dos estabelecimentos (`/conta`). Mesma sessão real
// (`RequireRealSession`: sem sessão, vai para o login e volta para cá), mesma
// aparência e a mesma leitura de acesso (`GET /platform/access`). O servidor
// autoriza de novo cada leitura e escrita: só o proprietário da plataforma.
import type { ReactNode } from "react";
import { RequireRealSession } from "@/components/auth/require-real-session";
import { MarcadorAparencia } from "@/components/aparencia/aparencia";
import { AcessoPlataformaProvider } from "@/lib/administracao/use-acesso-plataforma";
import { ShellPlataforma } from "@/components/administracao/shell-plataforma";

export default function PlataformaLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <MarcadorAparencia />
      <RequireRealSession>
        <AcessoPlataformaProvider>
          <ShellPlataforma>{children}</ShellPlataforma>
        </AcessoPlataformaProvider>
      </RequireRealSession>
    </>
  );
}
