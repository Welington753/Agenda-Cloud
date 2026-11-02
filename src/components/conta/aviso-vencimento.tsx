"use client";

// Faixa, dentro do aplicativo, para o DONO quando o acesso está a 7, 3 ou 1
// dia do fim (ver lib/conta/aviso-vencimento.ts). Sem e-mail, WhatsApp ou
// push. O relógio é o do aparelho; a data mostrada é o último dia coberto.
import { CalendarClock } from "lucide-react";
import type { ValidadeDoAcessoReal } from "@/lib/api/auth-api";
import { avisoDeVencimento } from "@/lib/conta/aviso-vencimento";

const O_QUE_VALE = { TRIAL: "O teste gratuito", PAID: "O período pago", COURTESY: "A cortesia" } as const;
const PRAZO = { 7: "em até 7 dias", 3: "em até 3 dias", 1: "em até 1 dia" } as const;

export function AvisoDeVencimento({ acesso }: { acesso: ValidadeDoAcessoReal | undefined }) {
  const aviso = avisoDeVencimento(acesso, new Date());
  if (!aviso) return null;
  const ultimoDia = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(Date.parse(aviso.validUntil) - 1));
  return (
    <div
      role="status"
      data-testid="aviso-vencimento"
      data-faixa={aviso.faixa}
      className="mb-4 flex items-start gap-2 rounded-lg border border-border-strong bg-card p-3 text-sm"
    >
      <CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0 text-[color:var(--color-warning)]" />
      <p>
        <strong>O acesso vence {PRAZO[aviso.faixa]}.</strong> {O_QUE_VALE[aviso.tipo]} vale até {ultimoDia} (último dia).
        Para continuar sem pausa, fale com a administração do Agenda Cloud pelo mesmo canal do seu cadastro. Nada é
        apagado no vencimento.
      </p>
    </div>
  );
}
