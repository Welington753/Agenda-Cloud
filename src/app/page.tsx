import { SiteNav } from "@/components/site/site-nav";
import { Hero } from "@/components/site/hero";
import { Problemas } from "@/components/site/problemas";
import { Funcionalidades } from "@/components/site/funcionalidades";
import { Segmentos } from "@/components/site/segmentos";
import { FluxoDemonstracao } from "@/components/site/fluxo-demonstracao";
import { ComoComecar } from "@/components/site/como-comecar";
import { Planos } from "@/components/site/planos";
import { Faq } from "@/components/site/faq";
import { CtaFinal } from "@/components/site/cta-final";
import { SiteFooter } from "@/components/site/site-footer";

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteNav />
      <main className="flex-1">
        <Hero />
        <Problemas />
        <Funcionalidades />
        <Segmentos />
        <FluxoDemonstracao />
        <ComoComecar />
        <Planos />
        <Faq />
        <CtaFinal />
      </main>
      <SiteFooter />
    </div>
  );
}
