import type { ReactNode } from "react";
import { MarcadorAparelho } from "@/components/aparencia/aparencia";

// Agendamento público: segue SEMPRE a aparência do aparelho do cliente,
// mesmo que o dono tenha escolhido um tema na área privada deste navegador.
export default function AgendarLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <MarcadorAparelho />
      {children}
    </>
  );
}
