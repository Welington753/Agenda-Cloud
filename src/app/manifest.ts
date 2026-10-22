// Manifesto do aplicativo instalável (PWA). Abre direto na área real da
// conta; o escopo é o site inteiro porque o login (/login) também precisa
// abrir dentro do aplicativo instalado. Instalar não liga notificação
// nenhuma: isso é o botão "Ativar notificações neste dispositivo".
import type { MetadataRoute } from "next";
import { NOME_PRODUTO } from "@/lib/config";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/conta/visao-geral",
    name: NOME_PRODUTO,
    short_name: NOME_PRODUTO,
    description: "Agenda, solicitações e avisos do seu estabelecimento.",
    start_url: "/conta/visao-geral",
    scope: "/",
    display: "standalone",
    background_color: "#faf7f2",
    theme_color: "#1c1a17",
    lang: "pt-BR",
    icons: [
      { src: "/icone-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icone-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icone-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
