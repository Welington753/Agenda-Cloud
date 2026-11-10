import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MarcadorAparencia } from "@/components/aparencia/aparencia";
import { NOME_PRODUTO } from "@/lib/config";

// Fora da busca pelo `X-Robots-Tag` (src/lib/site/cabecalhos.ts).
export const metadata: Metadata = { title: `Redefinir senha · ${NOME_PRODUTO}` };

// Entrada da área real: segue a aparência escolhida (ou a do aparelho).
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <MarcadorAparencia />
      {children}
    </>
  );
}
