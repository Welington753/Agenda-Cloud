import { Info, ShieldCheck } from "lucide-react";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { NOME_PRODUTO } from "@/lib/config";

export function EtapaBoasVindas() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink">Vamos criar sua demonstração</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Em poucas perguntas você monta uma conta demonstrativa do {NOME_PRODUTO} com o seu tipo de negócio, e já
          entra no painel para explorar.
        </p>
      </div>

      <Cartao className="border-dashed">
        <CartaoCorpo className="flex items-start gap-3">
          <ShieldCheck size={20} className="mt-0.5 shrink-0 text-[color:var(--color-info)]" />
          <div className="text-sm text-ink-soft">
            <p className="font-semibold text-ink">Isto é uma demonstração local</p>
            <p className="mt-1">
              Os dados que você informar ficam guardados só neste navegador. Não existe criação de conta real, não é
              preciso senha, cartão ou documento verdadeiro.
            </p>
          </div>
        </CartaoCorpo>
      </Cartao>

      <Cartao className="border-dashed">
        <CartaoCorpo className="flex items-start gap-3">
          <Info size={20} className="mt-0.5 shrink-0 text-[color:var(--color-info)]" />
          <p className="text-sm text-ink-soft">
            Verificação de telefone e e-mail ainda não existe nesta demonstração — isso será implementado junto com o
            backend real.
          </p>
        </CartaoCorpo>
      </Cartao>
    </div>
  );
}
