import { PartyPopper } from "lucide-react";
import { LinkBotao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { DIAS_TESTE_DEMONSTRACAO } from "@/lib/config";

export function EtapaPainel({ slug }: { slug: string | null }) {
  return (
    <div className="space-y-5 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-success-soft text-[color:var(--color-success)]">
        <PartyPopper size={28} />
      </div>
      <div>
        <h2 className="text-xl font-bold text-ink">Sua demonstração está pronta</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Você tem {DIAS_TESTE_DEMONSTRACAO} dias de período de demonstração — só um rótulo nesta etapa, sem
          assinatura, cobrança ou autorização real.
        </p>
      </div>

      {slug && (
        <Cartao className="border-dashed text-left">
          <CartaoCorpo>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Página pública</p>
            <p className="mt-1 truncate font-mono text-sm text-ink">/{slug}</p>
          </CartaoCorpo>
        </Cartao>
      )}

      <LinkBotao href="/painel" tamanho="lg" className="w-full sm:w-auto">
        Entrar no painel
      </LinkBotao>
    </div>
  );
}
