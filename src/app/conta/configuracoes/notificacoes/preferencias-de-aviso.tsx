"use client";

// Cartão "Avisos de novas solicitações": explica até onde o aviso vai e
// deixa a pessoa ligar um som. O som é opcional, desligado por padrão e vale
// só neste navegador (ver som-dos-avisos.ts). Ligar é um clique, o gesto que
// o navegador exige para liberar áudio; se mesmo assim o navegador bloquear,
// o aviso visual continua igual.
import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import {
  lerPreferenciaDeSom,
  prepararSom,
  salvarPreferenciaDeSom,
  tocarSom,
} from "@/lib/agendamento-publico/som-dos-avisos";
import { Cartao, CartaoCorpo } from "@/components/ui/card";

export function PreferenciasDeAviso() {
  const [som, setSom] = useState(false);

  // localStorage só existe no navegador: lido depois de montar.
  useEffect(() => setSom(lerPreferenciaDeSom()), []);

  function alternar(ligado: boolean) {
    setSom(ligado);
    salvarPreferenciaDeSom(ligado);
    if (ligado) {
      prepararSom();
      tocarSom();
    }
  }

  return (
    <Cartao data-testid="preferencias-de-aviso">
      <CartaoCorpo className="space-y-3">
        <div className="flex items-start gap-3">
          <BellRing size={20} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0 space-y-1">
            <h3 className="text-base font-semibold text-ink">Avisos de novas solicitações</h3>
            <p className="text-sm text-ink-soft">
              Enquanto o sistema estiver aberto neste navegador, um pedido novo aparece como aviso em
              qualquer página da conta, e esta lista se atualiza sozinha. Com o navegador fechado
              nenhum aviso chega: os pedidos ficam guardados aqui até você responder.
            </p>
          </div>
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
          <input
            type="checkbox"
            checked={som}
            onChange={(e) => alternar(e.currentTarget.checked)}
            data-testid="som-dos-avisos"
            className="size-5 accent-[var(--color-accent)]"
          />
          Tocar um som junto com o aviso (só neste navegador)
        </label>
      </CartaoCorpo>
    </Cartao>
  );
}
