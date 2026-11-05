// Layout de SERVIDOR do portal da plataforma (`/portal` e `/portal/**`): só
// troca os metadados do aplicativo instalável, sem mudar nada da tela (a
// entrada e a área continuam nos componentes client de cada segmento).
//
// - `manifest`: o do "Portal AC" (src/lib/pwa/manifest-portal.ts). Um
//   `metadata.manifest` num segmento filho substitui o `manifest.ts` da raiz
//   só nestas páginas; a operação, o login e o agendamento público continuam
//   com o manifest de sempre.
// - `appleWebApp`: o objeto inteiro (o Next substitui a chave, não mescla),
//   para o iPhone sugerir "Portal AC" ao adicionar à Tela de Início.
// - O `apple-touch-icon` vem de ./apple-icon.tsx, o mais próximo da folha.
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NOME_APP_PORTAL, ROTA_MANIFEST_PORTAL } from "@/lib/pwa/manifest-portal";

export const metadata: Metadata = {
  title: NOME_APP_PORTAL,
  manifest: ROTA_MANIFEST_PORTAL,
  appleWebApp: { capable: true, title: NOME_APP_PORTAL, statusBarStyle: "default" },
};

export default function PortalLayout({ children }: { children: ReactNode }) {
  return children;
}
