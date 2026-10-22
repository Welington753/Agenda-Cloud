import type { ReactNode } from "react";
import { RequireRealSession } from "@/components/auth/require-real-session";
import { AcessoAdministracao } from "@/components/administracao/acesso-administracao";
import { MarcadorAparencia } from "@/components/aparencia/aparencia";

export default function AdministracaoLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      <MarcadorAparencia />
      <RequireRealSession>
        <AcessoAdministracao>{children}</AcessoAdministracao>
      </RequireRealSession>
    </>
  );
}
