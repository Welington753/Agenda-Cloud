// sitemap.xml: só páginas públicas, canônicas e feitas para busca. Hoje é só
// a página inicial (regra e motivo em src/lib/site/indexacao.ts).
import type { MetadataRoute } from "next";
import { entradasDoSitemap } from "@/lib/site/indexacao";
import { lerConfiguracaoDoSite } from "@/lib/site/origem-do-site";

export default function sitemap(): MetadataRoute.Sitemap {
  return entradasDoSitemap(lerConfiguracaoDoSite(process.env));
}
