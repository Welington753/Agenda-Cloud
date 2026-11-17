import Link from "next/link";
import { ROTA_AGENDA } from "@/lib/conta/rotas";
import { Cartao, CartaoCorpo } from "@/components/ui/card";

/** Sem o adicional "Indicadores avançados": aviso neutro no lugar do resumo
 * do período e do financeiro. A agenda e o resto da operação continuam. */
export function IndicadoresNaoContratados() {
  return (
    <Cartao data-testid="indicadores-nao-contratados">
      <CartaoCorpo className="space-y-2">
        <h2 className="text-base font-semibold text-ink">Indicadores avançados</h2>
        <p className="text-sm text-ink-soft">
          O resumo do período e o resumo financeiro fazem parte do adicional Indicadores avançados, que não está na
          assinatura deste estabelecimento. A agenda, as solicitações e os recebimentos continuam disponíveis. Para incluir,
          fale com a administração do TimVix.
        </p>
        <Link href={ROTA_AGENDA} className="inline-flex min-h-11 items-center text-sm font-semibold text-[color:var(--color-accent-hover)] underline">
          Abrir a agenda
        </Link>
      </CartaoCorpo>
    </Cartao>
  );
}
