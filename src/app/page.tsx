import { SiteNav } from "@/components/site/site-nav";
import { Hero } from "@/components/site/hero";
import { Funcionalidades } from "@/components/site/funcionalidades";
import { Segmentos } from "@/components/site/segmentos";
import { ComoFunciona } from "@/components/site/como-funciona";
import { Planos } from "@/components/site/planos";
import { Faq } from "@/components/site/faq";
import { CtaFinal } from "@/components/site/cta-final";
import { SiteFooter } from "@/components/site/site-footer";
import type { Metadata } from "next";
import { serializarJsonLd, jsonLdDaPlataforma } from "@/lib/site/dados-estruturados";
import {
  DESCRICAO_DO_SITE,
  IMAGEM_DE_COMPARTILHAMENTO,
  OPEN_GRAPH_COMUM,
  TITULO_DO_SITE,
} from "@/lib/site/metadados-do-site";
import { lerConfiguracaoDoSite } from "@/lib/site/origem-do-site";

// Página inicial: a única página do site comercial e a única do sitemap.
// Endereço canônico e dados estruturados só com origem confiável
// (src/lib/site/origem-do-site.ts).
const site = lerConfiguracaoDoSite(process.env);

export const metadata: Metadata = {
  alternates: site.indexavel && site.origem ? { canonical: "/" } : undefined,
  openGraph: {
    ...OPEN_GRAPH_COMUM,
    url: site.origem ? "/" : undefined,
    title: TITULO_DO_SITE,
    description: DESCRICAO_DO_SITE,
    images: site.origem ? [IMAGEM_DE_COMPARTILHAMENTO] : undefined,
  },
};

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      {site.origem && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializarJsonLd(jsonLdDaPlataforma(site.origem)) }}
        />
      )}
      <SiteNav />
      <main className="flex-1">
        <Hero />
        <ComoFunciona />
        <Funcionalidades />
        <Segmentos />
        <Planos />
        <Faq />
        <CtaFinal />
      </main>
      <SiteFooter />
    </div>
  );
}
