"use client";

// Histórico da validade do acesso na ficha do estabelecimento: cada teste,
// período pago e cortesia, com o valor contratado e quem registrou. Nunca é
// editado nem apagado.
import { Clock, Gift, ReceiptText } from "lucide-react";
import { dataCadastro, type PeriodoDeAcesso, type TipoDePeriodo } from "@/lib/administracao/contratos";
import { CICLOS, diaBr, FORMAS_DE_PAGAMENTO, reais } from "@/lib/administracao/validade";

const TIPO: Record<TipoDePeriodo, string> = { TRIAL: "Teste gratuito", PAID: "Período pago", COURTESY: "Cortesia" };

export function HistoricoDeValidade({ periodos }: { periodos: PeriodoDeAcesso[] }) {
  if (!periodos.length) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Histórico</h3>
      <ul className="space-y-2" data-testid="historico-validade">
        {periodos.map((p) => (
          <li key={p.id} className="rounded-lg border border-border p-3 text-sm">
            <p className="flex flex-wrap items-center gap-2 font-medium">
              {p.kind === "PAID" ? <ReceiptText aria-hidden className="size-4" /> : p.kind === "COURTESY" ? <Gift aria-hidden className="size-4" /> : <Clock aria-hidden className="size-4" />}
              {TIPO[p.kind]} · {diaBr(p.firstDay)} a {diaBr(p.lastDay)}
            </p>
            <p className="mt-1 break-words text-xs text-ink-soft">
              Plano {p.plan.name}
              {p.cycle && ` · ${CICLOS[p.cycle]}`}
              {p.amountCents !== null && ` · ${reais(p.amountCents)} contratado`}
              {p.paymentMethod && ` · ${FORMAS_DE_PAGAMENTO[p.paymentMethod] ?? p.paymentMethod}`}
              {p.receivedOn && `, recebido em ${diaBr(p.receivedOn)}`}
              {p.reference && ` · ref. ${p.reference}`}
            </p>
            {p.confirmationSource === "MANUAL" && (
              <p className="text-xs text-ink-soft">Confirmado manualmente pela administração (sem confirmação automática).</p>
            )}
            {p.reason && <p className="break-words text-xs text-ink-soft">Motivo: {p.reason}</p>}
            <p className="text-xs text-ink-soft">
              Registrado por {p.recordedBy.name} em {dataCadastro(p.recordedAt)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
