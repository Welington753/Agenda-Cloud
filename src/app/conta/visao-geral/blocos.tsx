"use client";

// Blocos do Início (ver page.tsx): só apresentação dos números que o servidor
// contou. "Agendamentos de hoje" só junta as situações já contadas, sem os
// cancelados; nenhuma lista é somada aqui.
import Link from "next/link";
import {
  CalendarCheck,
  CheckCircle2,
  CircleDashed,
  Clock,
  Inbox,
  PlayCircle,
  Receipt,
  Undo2,
  Wallet,
  RefreshCw,
  UserCheck,
  Users,
} from "lucide-react";
import { ROTULO_STATUS } from "@/lib/profissionais/agendamentos";
import {
  SITUACOES_ATENDIMENTO,
  type PainelDoEstabelecimento,
  type ProximoAtendimentoDoPainel,
} from "@/lib/api/dashboard-api";
import { atendimentos, clientes, dataCurta } from "@/lib/conta/inicio";
import { ROTA_AGENDA, ROTA_EQUIPE, ROTA_PROFISSIONAIS, ROTA_RECEBIMENTOS, ROTA_SOLICITACOES } from "@/lib/conta/rotas";
import { formatarMoeda } from "@/lib/format";
import { StatusDoAtendimento } from "@/components/conta/cartao-atendimento";
import { Botao } from "@/components/ui/button";
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { EstadoVazio } from "@/components/ui/empty-state";
import { EstatisticaCard } from "@/components/ui/estatistica-card";
import { Skeleton } from "@/components/ui/skeleton";

export function Hoje({
  painel,
  aoAtualizar,
  atualizando,
}: {
  painel: PainelDoEstabelecimento;
  aoAtualizar: () => void;
  atualizando: boolean;
}) {
  const hoje = painel.todaySummary.appointmentsByStatus;
  const agendamentosHoje = SITUACOES_ATENDIMENTO.filter((s) => s !== "CANCELED").reduce((soma, s) => soma + hoje[s], 0);
  return (
    <section aria-labelledby="titulo-hoje" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="titulo-hoje" className="text-base font-semibold text-ink">
            Hoje
          </h2>
          <p className="text-sm text-ink-soft">{dataCurta(painel.today)}</p>
        </div>
        <Botao type="button" variante="fantasma" tamanho="sm" onClick={aoAtualizar} disabled={atualizando}>
          <RefreshCw size={14} aria-hidden="true" />
          {atualizando ? "Atualizando..." : "Atualizar"}
        </Botao>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <EstatisticaCard
          icone={Users}
          rotulo="Clientes previstos hoje"
          valor={String(painel.todaySummary.expectedClients)}
          testId="indicador-clientes-hoje"
        />
        <EstatisticaCard
          icone={CalendarCheck}
          rotulo="Agendamentos de hoje"
          valor={String(agendamentosHoje)}
          testId="indicador-agendamentos"
        />
        <EstatisticaCard
          icone={CircleDashed}
          rotulo="Aguardando confirmação hoje"
          valor={String(hoje.PENDING)}
          corIcone="warning"
          testId="indicador-aguardando"
        />
        <EstatisticaCard
          icone={PlayCircle}
          rotulo="Em atendimento"
          valor={String(hoje.IN_PROGRESS)}
          corIcone="info"
          testId="indicador-em-atendimento"
        />
        <EstatisticaCard
          icone={CheckCircle2}
          rotulo="Concluídos hoje"
          valor={String(hoje.COMPLETED)}
          corIcone="success"
          testId="indicador-concluidos"
        />
        <Link
          href={ROTA_SOLICITACOES}
          className="rounded-[var(--radius-card)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <EstatisticaCard
            icone={Inbox}
            rotulo="Solicitações aguardando resposta"
            valor={String(painel.pendingRequests)}
            corIcone="warning"
            testId="indicador-solicitacoes"
          />
        </Link>
      </div>
    </section>
  );
}

export function Periodo({ painel }: { painel: PainelDoEstabelecimento }) {
  const resumo = painel.periodSummary;
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <EstatisticaCard
        icone={UserCheck}
        rotulo="Clientes atendidos no período"
        valor={String(resumo.servedClients)}
        corIcone="success"
        testId="indicador-clientes-atendidos"
      />
      <Cartao data-testid="atendimentos-por-situacao">
        <CartaoCorpo className="space-y-2">
          <p className="text-xs font-medium text-ink-soft">
            Atendimentos no período por situação · {atendimentos(resumo.appointmentsTotal)}
          </p>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]">
            {SITUACOES_ATENDIMENTO.map((situacao) => (
              <div key={situacao} className="contents" data-testid={`situacao-${situacao}`}>
                <dt className="text-ink-soft">{ROTULO_STATUS[situacao]}</dt>
                <dd className="text-right font-semibold text-ink tabular-nums">{resumo.appointmentsByStatus[situacao]}</dd>
              </div>
            ))}
          </dl>
        </CartaoCorpo>
      </Cartao>
    </div>
  );
}

/** Dinheiro do período: só os recebimentos registrados à mão em
 * Recebimentos. Sem registro, mostra zero recebido e ticket "—" (nunca um
 * valor tirado do preço das reservas). */
export function Financeiro({ painel }: { painel: PainelDoEstabelecimento }) {
  const { finance, period } = painel;
  return (
    <div className="space-y-2" data-testid="financeiro">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <EstatisticaCard icone={Wallet} rotulo="Recebido no período" valor={formatarMoeda(finance.receivedCents)} corIcone="success" testId="indicador-recebido" />
        <EstatisticaCard icone={Undo2} rotulo="Estornado no período" valor={formatarMoeda(finance.refundedCents)} corIcone="warning" testId="indicador-estornado" />
        <EstatisticaCard icone={Wallet} rotulo="Líquido no período" valor={formatarMoeda(finance.netCents)} testId="indicador-liquido" />
        <EstatisticaCard
          icone={Receipt}
          rotulo={`Ticket médio · ${finance.paidAppointments} pago(s)`}
          valor={finance.averageTicketCents === null ? "—" : formatarMoeda(finance.averageTicketCents)}
          corIcone="info"
          testId="indicador-ticket"
        />
      </div>
      <Link
        href={`${ROTA_RECEBIMENTOS}?de=${period.from}&ate=${period.to}`}
        className="inline-flex min-h-11 items-center text-sm font-semibold text-[color:var(--color-accent-hover)] underline"
        data-testid="ver-recebimentos"
      >
        Ver e registrar recebimentos
      </Link>
    </div>
  );
}

export function Proximos({ painel }: { painel: PainelDoEstabelecimento }) {
  return (
    <section aria-labelledby="titulo-proximos" className="space-y-3">
      <h2 id="titulo-proximos" className="text-base font-semibold text-ink">
        Próximos atendimentos
      </h2>
      {painel.upcoming.length === 0 ? (
        <div data-testid="sem-proximos">
          <EstadoVazio
            icone={Clock}
            titulo="Nenhum atendimento por vir."
            descricao="Os que já começaram ou terminaram ficam na agenda."
          />
        </div>
      ) : (
        <Cartao>
          <ul data-testid="proximos-atendimentos" className="divide-y divide-border">
            {painel.upcoming.map((a) => (
              <LinhaProximo key={a.id} atendimento={a} hoje={painel.today} />
            ))}
          </ul>
          <p className="border-t border-border px-4 py-3 text-sm text-ink-soft sm:px-5">
            Os demais estão na{" "}
            <Link href={ROTA_AGENDA} className="font-semibold text-[color:var(--color-accent-hover)] underline">
              agenda
            </Link>
            .
          </p>
        </Cartao>
      )}
    </section>
  );
}

function LinhaProximo({ atendimento, hoje }: { atendimento: ProximoAtendimentoDoPainel; hoje: string }) {
  return (
    <li
      className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-5 sm:px-5"
      data-testid="proximo-atendimento"
    >
      <p className="row-span-2 w-16 shrink-0 tabular-nums sm:row-span-1">
        <span className="block text-lg leading-tight font-bold text-ink">{atendimento.localStart}</span>
        <span className="block text-xs text-ink-soft">
          {atendimento.localDate === hoje ? "hoje" : dataCurta(atendimento.localDate).slice(0, 5)}
        </span>
      </p>
      <div className="min-w-0">
        <p className="font-semibold break-words text-ink" data-testid="proximo-cliente">
          {atendimento.consumer.name}
        </p>
        <p className="truncate text-sm text-ink-soft">
          {atendimento.service.name} · com {atendimento.professional.name}
        </p>
      </div>
      <div className="col-start-2 sm:col-start-3 sm:row-start-1">
        <StatusDoAtendimento status={atendimento.status} />
      </div>
    </li>
  );
}

export function Plano({ painel }: { painel: PainelDoEstabelecimento }) {
  const { plan } = painel;
  return (
    <section aria-labelledby="titulo-plano" className="space-y-3">
      <h2 id="titulo-plano" className="text-base font-semibold text-ink">
        Plano e uso
      </h2>
      <Cartao data-testid="plano-e-uso">
        <CartaoCorpo className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium text-ink-soft">Plano</p>
            <p className="font-semibold text-ink">{plan.name}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-ink-soft">Profissionais ativos</p>
            <p className="font-semibold text-ink" data-testid="uso-profissionais">
              {plan.activeProfessionals} de {plan.maxProfessionals}
            </p>
            <Link href={ROTA_PROFISSIONAIS} className="text-sm text-[color:var(--color-accent-hover)] hover:underline">
              Profissionais
            </Link>
          </div>
          <div>
            <p className="text-xs font-medium text-ink-soft">Acessos da equipe</p>
            <p className="font-semibold text-ink" data-testid="uso-acessos">
              {plan.staffSeats.used} de {plan.staffSeats.limit}
              {plan.staffSeats.pending > 0 && (
                <span className="font-normal text-ink-soft"> ({plan.staffSeats.pending} pendente{plan.staffSeats.pending === 1 ? "" : "s"})</span>
              )}
            </p>
            <Link href={ROTA_EQUIPE} className="text-sm text-[color:var(--color-accent-hover)] hover:underline">
              Equipe e acessos
            </Link>
          </div>
        </CartaoCorpo>
      </Cartao>
    </section>
  );
}

export function ComoCalculamos() {
  return (
    <details className="rounded-[var(--radius-card)] border border-border bg-card p-4 text-sm" data-testid="como-calculamos">
      <summary className="min-h-11 cursor-pointer content-center font-semibold text-ink">
        Como os números são calculados
      </summary>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-ink-soft">
        <li>
          Datas e horas seguem o fuso do estabelecimento. Um atendimento conta no dia em que começa.
        </li>
        <li>
          <strong className="text-ink">Clientes</strong> contam pessoas diferentes;{" "}
          <strong className="text-ink">atendimentos</strong> contam cada horário marcado. Uma pessoa com três
          atendimentos é {clientes(1)} e {atendimentos(3)}.
        </li>
        <li>
          <strong className="text-ink">Clientes previstos hoje</strong>: pessoas com atendimento hoje confirmado,
          em andamento ou concluído. Pedidos ainda sem confirmação e cancelados ficam de fora.
        </li>
        <li>
          <strong className="text-ink">Clientes atendidos no período</strong>: pessoas com pelo menos um
          atendimento concluído no período.
        </li>
        <li>
          <strong className="text-ink">Solicitações aguardando resposta</strong>: pedidos que ainda não começaram e
          esperam sua confirmação, de qualquer data.
        </li>
        <li>
          <strong className="text-ink">Recebido</strong>: soma dos recebimentos registrados em Recebimentos com data no
          período. <strong className="text-ink">Estornado</strong>: soma dos estornos feitos no período, mesmo de um
          recebimento antigo. <strong className="text-ink">Líquido</strong>: recebido menos estornado.
        </li>
        <li>
          <strong className="text-ink">Ticket médio</strong>: soma dos recebimentos do período que não foram estornados ÷
          quantidade desses atendimentos. Estornar um recebimento de outro período não muda a média deste.
        </li>
        <li>Todos os totais são contados no servidor sobre o período inteiro, não só sobre o que a tela mostra.</li>
        <li>Valores de reserva não aparecem aqui como dinheiro recebido: só o que foi registrado como recebimento.</li>
      </ul>
    </details>
  );
}

export function Carregando() {
  return (
    <div className="space-y-6" aria-busy="true" data-testid="visao-geral-carregando">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
