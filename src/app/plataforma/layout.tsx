// Administração da plataforma dentro da área real: o menu, o cabeçalho, a
// aparência e o menu da conta vêm do layout de `/conta`; aqui só o portão
// de acesso (confirmado pelo backend) e a faixa do modo de uso.
import type { ReactNode } from "react";
import { PortaoAdministracao } from "@/components/administracao/acesso-administracao";

export default function AdministracaoLayout({ children }: { children: ReactNode }) {
  return <PortaoAdministracao>{children}</PortaoAdministracao>;
}
