import type { ReactNode } from "react";
import { MarcadorAparencia } from "@/components/aparencia/aparencia";

// Entrada da área real: segue a aparência escolhida (ou a do aparelho).
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <MarcadorAparencia />
      {children}
    </>
  );
}
