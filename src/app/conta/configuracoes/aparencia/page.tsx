"use client";

// Configurações → Aparência: claro, escuro, seguir o aparelho ou azul e
// branco. Vale só neste navegador. O agendamento público segue o aparelho de
// quem agenda, salvo "Azul e branco" escolhido neste navegador.
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
            A escolha fica guardada só neste navegador. A página pública de agendamento segue o aparelho
            de quem agenda; neste navegador, Azul e branco também vale nela.
          </p>
        </CartaoCorpo>
      </Cartao>
    </PaginaConta>
  );
}
