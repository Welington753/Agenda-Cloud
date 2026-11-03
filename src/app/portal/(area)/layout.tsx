"use client";

// Portal da plataforma: área PRÓPRIA, com entrada (`/portal`, fora deste
// grupo), cabeçalho e menu separados da operação dos estabelecimentos
// (`/conta`). Mesma sessão real, mas sem sessão a pessoa vai para a entrada
// do PORTAL e volta para cá depois do login. Não exige estabelecimento,
// vínculo, plano nem validade: só a leitura de acesso (`GET /platform/access`).
// O servidor autoriza de novo cada leitura e escrita: só o proprietário da
// plataforma.
import type { ReactNode } from "react";
import { RequireRealSession } from "@/components/auth/require-real-session";
import { MarcadorAparencia } from "@/components/aparencia/aparencia";
import { AcessoPlataformaProvider } from "@/lib/administracao/use-acesso-plataforma";
import { ShellPlataforma } from "@/components/administracao/shell-plataforma";
import { entradaDoPortal } from "@/lib/administracao/rotas";

export default function PlataformaLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <MarcadorAparencia />
      <RequireRealSession entrada={entradaDoPortal}>
        <AcessoPlataformaProvider>
          <ShellPlataforma>{children}</ShellPlataforma>
        </AcessoPlataformaProvider>
      </RequireRealSession>
    </>
  );
}
