import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth/auth-context";
import { RealAuthProvider } from "@/lib/auth/real-auth-context";
import { ToastProvider } from "@/components/ui/toast";
import { NOME_PRODUTO } from "@/lib/config";
import { metadadosDaRaiz } from "@/lib/site/metadados-do-site";
import { lerConfiguracaoDoSite } from "@/lib/site/origem-do-site";
import { APARENCIA_PADRAO, SCRIPT_APARENCIA } from "@/lib/aparencia/tema";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

// Título, descrição, Open Graph, verificação do Search Console e a origem
// dos endereços absolutos (src/lib/site/metadados-do-site.ts). A origem vem
// só do ambiente do servidor, nunca de cabeçalho da requisição.
export const metadata: Metadata = {
  ...metadadosDaRaiz(lerConfiguracaoDoSite(process.env), process.env),
  // Aplicativo instalável (manifest.ts): no iPhone, "Adicionar à Tela de
  // Início" abre em tela cheia — e só assim o iOS permite notificações.
  appleWebApp: { capable: true, title: NOME_PRODUTO, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#1c1a17",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // `data-tema`: o servidor manda sempre o padrão; o script do <head> troca
    // pela escolha salva antes da pintura (ver lib/aparencia/tema.ts). O
    // atributo muda antes da hidratação, daí o suppressHydrationWarning — só
    // neste elemento, não no conteúdo.
    <html
      lang="pt-BR"
      data-tema={APARENCIA_PADRAO}
      suppressHydrationWarning
      className={`${jakarta.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_APARENCIA }} />
      </head>
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
