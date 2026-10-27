"use client";

// Configurações → Aparência: claro, escuro ou seguir o aparelho. Vale só
// neste navegador e só para a área da conta; o agendamento público continua
// seguindo o aparelho, sem seletor.
import { PaginaConta } from "@/components/conta/pagina-conta";
import { SeletorAparencia } from "@/components/aparencia/aparencia";
import { Cartao, CartaoCorpo } from "@/components/ui/card";

export default function AparenciaPage() {
  return (
    <PaginaConta titulo="Aparência" descricao="Como a área da conta aparece neste navegador.">
      <Cartao>
        <CartaoCorpo className="space-y-2">
          <SeletorAparencia />
          <p className="text-xs text-ink-soft">
            A escolha fica guardada só neste navegador. A página pública de agendamento sempre segue o
            aparelho de quem agenda.
          </p>
        </CartaoCorpo>
      </Cartao>
    </PaginaConta>
  );
}
