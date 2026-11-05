// Manifesto do aplicativo instalável do PORTAL da plataforma ("Portal AC"),
// separado do aplicativo da operação (src/app/manifest.ts, que não muda).
// Servido em /portal/manifest.webmanifest (src/app/portal/manifest.webmanifest)
// e ligado só às páginas do portal pelo layout src/app/portal/layout.tsx.
//
// - `id` estável e diferente do da operação: o navegador trata os dois como
//   aplicativos distintos. Não mude o `id` depois de publicado (quem já
//   instalou ganharia um aplicativo "novo").
// - `scope: "/portal"` inclui a entrada (`/portal`, com `?next=`) e toda a área
//   (`/portal/**`). O escopo de um manifest é comparado POR PREFIXO de texto
//   (também casaria um hipotético `/portalx`) e só decide o que abre dentro do
//   aplicativo instalado: NÃO é isolamento de segurança. Quem entra continua
//   sendo decidido pelo portão do portal e pelo servidor (só `MASTER_OWNER`
//   ativo, backend/src/platform/platform-access.ts) e o retorno pós-login
//   continua passando por `sanitizarDestinoInterno` + `destinoNoPortal`.
import type { MetadataRoute } from "next";
import { ROTA_ADMINISTRACAO, ROTA_VISAO_GERAL } from "@/lib/administracao/rotas";

export const NOME_APP_PORTAL = "Portal AC";
export const ROTA_MANIFEST_PORTAL = `${ROTA_ADMINISTRACAO}/manifest.webmanifest`;

export function manifestDoPortal(): MetadataRoute.Manifest {
  return {
    id: ROTA_VISAO_GERAL,
    name: NOME_APP_PORTAL,
    short_name: NOME_APP_PORTAL,
    description: "Portal da plataforma Agenda Cloud: estabelecimentos, acessos, planos e pagamentos.",
    start_url: ROTA_VISAO_GERAL,
    scope: ROTA_ADMINISTRACAO,
    display: "standalone",
    background_color: "#faf7f2",
    theme_color: "#1c1a17",
    lang: "pt-BR",
    icons: [
      { src: `${ROTA_ADMINISTRACAO}/icone-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${ROTA_ADMINISTRACAO}/icone-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${ROTA_ADMINISTRACAO}/icone-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
