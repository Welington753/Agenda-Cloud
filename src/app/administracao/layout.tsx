import type { ReactNode } from "react";
import { RequireRealSession } from "@/components/auth/require-real-session";
import { AcessoAdministracao } from "@/components/administracao/acesso-administracao";

export default function AdministracaoLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <RequireRealSession>
      <AcessoAdministracao>{children}</AcessoAdministracao>
    </RequireRealSession>
  );
}
