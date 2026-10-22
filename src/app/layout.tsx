import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth/auth-context";
import { RealAuthProvider } from "@/lib/auth/real-auth-context";
import { ToastProvider } from "@/components/ui/toast";
import { NOME_PRODUTO } from "@/lib/config";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: `${NOME_PRODUTO} — Agenda e gestão para pequenos negócios`,
  description:
    "Agenda e gestão simples para salões, clínicas, estúdios, pet shops, terapeutas, consultores e outros negócios com horário marcado.",
  // Aplicativo instalável (manifest.ts): no iPhone, "Adicionar à Tela de
  // Início" abre em tela cheia — e só assim o iOS permite notificações.
  appleWebApp: { capable: true, title: NOME_PRODUTO, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#1c1a17",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${jakarta.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <AuthProvider>
          <RealAuthProvider>
            <ToastProvider>{children}</ToastProvider>
          </RealAuthProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
