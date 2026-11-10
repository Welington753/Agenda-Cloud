// Imagem de compartilhamento (Open Graph, 1200×630): só a marca do produto,
// nada de estabelecimento nem de cliente. Rota própria em vez da convenção
// `opengraph-image`: assim os metadados só a citam com uma origem confiável
// (IMAGEM_DE_COMPARTILHAMENTO em src/lib/site/metadados-do-site.ts), e nunca
// sai um `og:image` com endereço local.
import { imagemDeCompartilhamento } from "@/lib/pwa/imagem-de-compartilhamento";

export const dynamic = "force-static";

export function GET() {
  return imagemDeCompartilhamento({ width: 1200, height: 630 });
}
