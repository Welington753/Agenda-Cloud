import { ShieldCheck } from "lucide-react";
import { LinkBotao } from "@/components/ui/button";
import { HREF_TESTAR_GRATIS } from "@/lib/site/conteudo-comercial";

export function CtaFinal() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-14 sm:px-8">
      <div className="rounded-[var(--radius-card)] bg-ink px-6 py-12 text-center text-white sm:px-12">
        <h2 className="text-2xl font-bold sm:text-3xl">Organize sua agenda hoje mesmo</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-white/70">
          Crie uma demonstração com o seu negócio em poucos minutos — sem cartão e sem senha real.
        </p>
        <LinkBotao href={HREF_TESTAR_GRATIS} tamanho="lg" className="mt-6">
          Testar grátis
        </LinkBotao>
        <p className="mx-auto mt-4 flex max-w-md items-center justify-center gap-2 text-xs text-white/50">
          <ShieldCheck size={14} /> Dados de demonstração ficam só no seu navegador.
        </p>
      </div>
    </section>
  );
}
