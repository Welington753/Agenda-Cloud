"use client";

// Resumo do pedido (etapa Revisar) e recibo depois do envio. PENDING diz,
// com todas as letras, que ainda falta a confirmação do estabelecimento.
import type { ReactNode } from "react";
import { Clock } from "lucide-react";
import type { ReciboPedido } from "@/lib/api/public-booking-api";
import { dataPorExtenso, estadoDoRecibo, tituloDoRecibo } from "@/lib/agendamento-publico/agendamento-publico";
import { Cartao, CartaoCorpo } from "@/components/ui/card";

export interface LinhaResumo {
  rotulo: string;
  valor: ReactNode;
  testId?: string;
}

export function Resumo({ linhas, testId }: { linhas: LinhaResumo[]; testId?: string }) {
  return (
    <dl className="divide-y divide-border text-sm" data-testid={testId}>
      {linhas.map((l) => (
        <div key={l.rotulo} className="grid grid-cols-[7.5rem_1fr] gap-3 py-2.5">
          <dt className="text-ink-soft">{l.rotulo}</dt>
          <dd className="min-w-0 font-medium break-words text-ink" data-testid={l.testId}>
            {l.valor}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Recibo({
  recibo: r,
  preco,
  nome,
  whatsapp,
}: {
  recibo: ReciboPedido;
  preco: string | null;
  nome: string;
  whatsapp: string;
}) {
  return (
    <Cartao data-testid="recibo-pedido">
      <CartaoCorpo className="space-y-4">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-ink">
            <Clock size={20} />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg leading-snug font-semibold text-ink" data-testid="recibo-titulo">
              {tituloDoRecibo(r.status)}
            </h2>
            <p className="text-sm font-medium text-ink-soft" data-testid="recibo-status">
              {estadoDoRecibo(r.status)}
            </p>
          </div>
        </div>
        {r.replayed && (
          <p className="text-sm text-ink" data-testid="recibo-repetido">
            Este pedido já tinha sido recebido. Nada foi enviado em dobro.
          </p>
        )}
        <Resumo
          linhas={[
            { rotulo: "Estabelecimento", valor: r.establishmentName },
            { rotulo: "Serviço", valor: r.serviceName },
            { rotulo: "Profissional", valor: r.professionalName },
            { rotulo: "Data", valor: dataPorExtenso(r.localDate), testId: "recibo-data" },
            { rotulo: "Horário", valor: r.localStart, testId: "recibo-hora" },
            ...(preco ? [{ rotulo: "Preço", valor: preco }] : []),
            { rotulo: "Nome", valor: nome },
            { rotulo: "WhatsApp", valor: whatsapp },
          ]}
        />
        {r.status === "PENDING" && (
          <p className="rounded-[var(--radius-control)] bg-paper-muted p-3 text-sm text-ink">
            Isto ainda <strong>não é um agendamento confirmado</strong>. O estabelecimento vai analisar e responder
            pelo contato informado. Enquanto isso, o horário fica separado para você.
          </p>
        )}
        <p className="text-xs text-ink-soft">Horários no fuso do estabelecimento ({r.timezone}).</p>
      </CartaoCorpo>
    </Cartao>
  );
}
