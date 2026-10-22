import type { ReactNode } from "react";
import { MarcadorAparencia } from "@/components/aparencia/aparencia";

// Agendamento público: página adaptável (claro, escuro ou seguir aparelho).
export default function AgendarLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <MarcadorAparencia />
      {children}
    </>
  );
}
