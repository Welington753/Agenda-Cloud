"use client";

// Relatório de comissões APURADAS (dono e funcionário). Só apresentação do
// que o servidor calculou na conclusão de cada atendimento: nenhuma conta é
// refeita aqui. Comissão apurada não é pagamento ao profissional, e o
// recebimento do cliente aparece à parte (só para o dono).
import { AlertTriangle, CheckCircle2, CircleSlash, Info, Wallet } from "lucide-react";
import {
  ROTULO_ORIGEM_APURADA,
  ROTULO_RECEBIMENTO,
  ROTULO_SITUACAO,
  rotuloDaRegra,
  type RelatorioDeComissoes,
  type RecebimentoDoCliente,
} from "@/lib/api/comissoes-api";
import { dataCurta } from "@/lib/conta/inicio";
import { formatarMoeda } from "@/lib/format";
import { formatarPrecoServico } from "@/lib/servicos/dinheiro";
import { Badge, type CorBadge } from "@/components/ui/badge-base";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { EstatisticaCard } from "@/components/ui/estatistica-card";

const COR_RECEBIMENTO: Record<RecebimentoDoCliente, CorBadge> = {
  RECEBIDO: "sucesso",
  SEM_RECEBIMENTO: "neutro",
  ESTORNADO: "aviso",
};

export function AvisoDeApuracao() {
  return (
    <p className="flex items-start gap-2 rounded-[var(--radius-control)] border border-border bg-paper-muted p-3 text-sm text-ink" data-testid="aviso-apuracao">
      <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>
        Comissão <strong>apurada</strong> na conclusão de cada atendimento, com a regra e o preço daquele momento.
        Não é pagamento ao profissional: os repasses não são registrados aqui.
      </span>
    </p>
  );
}

export function RelatorioComissoes({ relatorio, visaoDoDono }: { relatorio: RelatorioDeComissoes; visaoDoDono: boolean }) {
  const conferir = relatorio.professionals.reduce(
    (soma, p) =>
      soma + p.review.notConfigured + p.review.withoutPrice + p.review.abovePrice + (p.review.refundedPayment ?? 0) + p.review.outOfTotal,
    0,
  );
  return (
    <div className="space-y-6">
      <section aria-label="Total do período" className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="resumo-comissoes">
        <EstatisticaCard icone={Wallet} rotulo="Comissão apurada no período" valor={formatarMoeda(relatorio.totalAccruedCents)} testId="total-apurado" />
        <EstatisticaCard
          icone={conferir > 0 ? AlertTriangle : CheckCircle2}
          rotulo="Pontos para conferir"
          valor={String(conferir)}
          corIcone="neutro"
          testId="total-conferir"
        />
      </section>

      {visaoDoDono && (
        <section aria-labelledby="titulo-por-profissional" className="space-y-3">
          <h2 id="titulo-por-profissional" className="text-base font-semibold text-ink">
            Por profissional
          </h2>
          {relatorio.professionals.length === 0 ? (
            <p className="text-sm text-ink-soft">Nenhuma comissão apurada neste período.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="comissoes-por-profissional">
              {relatorio.professionals.map((p) => (
                <li key={p.professional.id}>
                  <Cartao>
                    <CartaoCorpo className="space-y-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-semibold break-words text-ink">
                          {p.professional.name}
                          {!p.professional.active && <span className="text-ink-soft"> (inativo)</span>}
                        </p>
                        <p className="text-lg font-bold text-ink tabular-nums">{formatarMoeda(p.accruedCents)}</p>
                      </div>
                      <p className="text-xs text-ink-soft">
                        {p.appointments} atendimento(s) · {p.items} serviço(s)
                      </p>
                      <Pendencias review={p.review} />
                    </CartaoCorpo>
                  </Cartao>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="titulo-atendimentos-apurados" className="space-y-3">
        <h2 id="titulo-atendimentos-apurados" className="text-base font-semibold text-ink">
          Atendimentos apurados
        </h2>
        {relatorio.appointments.length === 0 ? (
          <p className="text-sm text-ink-soft" data-testid="sem-comissoes">
            Nenhum atendimento concluído com comissão apurada neste período.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="atendimentos-apurados">
            {relatorio.appointments.map((a) => (
              <li key={a.id} className="space-y-2 rounded-[var(--radius-card)] border border-border bg-card p-4" data-testid="atendimento-apurado">
                <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold break-words text-ink">{a.consumerName}</p>
                    <p className="text-ink-soft">
                      {dataCurta(a.localDate)} · {a.localStart}
                      {visaoDoDono ? ` · ${a.professional.name}` : ""}
                    </p>
                  </div>
                  <p className={`font-bold tabular-nums ${a.counted ? "text-ink" : "text-ink-soft line-through"}`}>
                    {formatarMoeda(a.commissionCents)}
                  </p>
                </div>
                <ul className="space-y-1 text-sm">
                  {a.items.map((item, i) => (
                    <li key={i} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                      <span className="min-w-0 break-words text-ink">
                        {item.serviceName}
                        <span className="text-ink-soft">
                          {" "}
                          · {formatarPrecoServico(item.priceCents)} · {rotuloDaRegra(item.rule)}
                          {item.ruleSource !== null && ` (${ROTULO_ORIGEM_APURADA[item.ruleSource]})`}
                        </span>
                      </span>
                      <span className="tabular-nums text-ink">{item.commissionCents === null ? "—" : formatarMoeda(item.commissionCents)}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  {a.clientPayment && (
                    <Badge cor={COR_RECEBIMENTO[a.clientPayment]}>
                      {a.clientPayment === "RECEBIDO" ? <CheckCircle2 size={12} aria-hidden="true" /> : <CircleSlash size={12} aria-hidden="true" />}
                      {ROTULO_RECEBIMENTO[a.clientPayment]}
                    </Badge>
                  )}
                  {a.flags.map((f) => (
                    <Badge key={f} cor="aviso" data-testid="sinal-conferencia">
                      <AlertTriangle size={12} aria-hidden="true" />
                      {ROTULO_SITUACAO[f] ?? f}
                    </Badge>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
        {!relatorio.appointmentsComplete && (
          <p className="text-xs text-ink-soft">Mostrando os mais recentes: os totais contam o período inteiro.</p>
        )}
      </section>

      <p className="text-xs text-ink-soft">
        Período pela data do atendimento. Percentual calculado sobre o preço registrado em cada serviço da reserva,
        arredondado ao centavo; o total é a soma dos serviços. Cancelamentos e faltas não geram comissão. Mudar uma regra
        vale só para as próximas conclusões.
      </p>
    </div>
  );
}

function Pendencias({ review }: { review: RelatorioDeComissoes["professionals"][number]["review"] }) {
  const itens = [
    { n: review.notConfigured, rotulo: "serviço(s) sem regra na conclusão" },
    { n: review.withoutPrice, rotulo: "percentual(is) sem preço registrado" },
    { n: review.abovePrice, rotulo: "comissão(ões) maior(es) que o preço" },
    { n: review.refundedPayment ?? 0, rotulo: "recebimento(s) do cliente estornado(s)" },
    { n: review.outOfTotal, rotulo: "atendimento(s) fora do total" },
  ].filter((i) => i.n > 0);
  if (itens.length === 0) {
    return (
      <Badge cor="sucesso">
        <CheckCircle2 size={12} aria-hidden="true" />
        Nada a conferir
      </Badge>
    );
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {itens.map((i) => (
        <li key={i.rotulo}>
          <Badge cor="aviso">
            <AlertTriangle size={12} aria-hidden="true" />
            {i.n} {i.rotulo}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
