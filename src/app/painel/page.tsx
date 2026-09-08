"use client";

import { useState } from "react";
import Link from "next/link";
import { getDay, isSameDay, isAfter } from "date-fns";
import { CalendarPlus, CalendarX2, CheckCircle2, Clock3, DollarSign, Gauge, UserX2, XCircle } from "lucide-react";
import { useClientData } from "@/lib/hooks/use-client-data";
import { useTenant } from "@/lib/tenant/tenant-context";
import { RequirePermission } from "@/components/layout/require-permission";
import { agendamentoRepository, profissionalRepository, servicoRepository } from "@/lib/repositories";
import { minutosDeExpedienteNoDia } from "@/lib/availability/engine";
import { EstatisticaCard } from "@/components/painel/estatistica-card";
import { ChecklistPrimeirosPassos } from "@/components/painel/checklist-primeiros-passos";
import { checklistPrimeirosPassosVisivel } from "@/lib/onboarding/checklist-persistencia";
import { Cartao, CartaoCorpo, CartaoTitulo } from "@/components/ui/card";
import { Botao } from "@/components/ui/button";
import { BadgeStatusAgendamento } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatarHora, formatarMoeda } from "@/lib/format";
import type { DiaSemana } from "@/lib/types";

const STATUS_OCUPA = ["pendente", "confirmado", "em_atendimento", "concluido"] as const;

export default function PainelDashboardPage() {
  return (
    <RequirePermission permissao="dashboard.visualizar">
      <ConteudoDashboard />
    </RequirePermission>
  );
}

function ConteudoDashboard() {
  const { tenantId, terminologia, estabelecimento } = useTenant();
  const [mostrarChecklist, setMostrarChecklist] = useState(false);

  useClientData(() => {
    setMostrarChecklist(checklistPrimeirosPassosVisivel(tenantId));
    return null;
  }, [tenantId]);

  const { dados, carregando } = useClientData(() => {
    const agora = new Date();
    const agendamentos = agendamentoRepository.listarPorTenant(tenantId);
    const profissionais = profissionalRepository.listarPorTenant(tenantId).filter((p) => p.ativo);
    const servicos = servicoRepository.listarPorTenant(tenantId);
    const duracaoPorServico = new Map(servicos.map((s) => [s.id, s.duracaoMinutos]));

    const agendamentosHoje = agendamentos.filter((a) => isSameDay(new Date(a.dataHoraInicio), agora));
    const confirmados = agendamentosHoje.filter((a) => a.status === "confirmado").length;
    const cancelamentos = agendamentosHoje.filter((a) => a.status === "cancelado").length;
    const faltas = agendamentosHoje.filter((a) => a.status === "nao_compareceu").length;
    const faturamentoPrevistoCentavos = agendamentosHoje
      .filter((a) => (STATUS_OCUPA as readonly string[]).includes(a.status))
      .reduce((soma, a) => soma + (a.precoCentavos ?? 0), 0);

    const minutosOcupadosHoje = agendamentosHoje
      .filter((a) => (STATUS_OCUPA as readonly string[]).includes(a.status))
      .reduce((soma, a) => soma + (duracaoPorServico.get(a.servicoId) ?? 0), 0);
    const diaSemanaHoje = getDay(agora) as DiaSemana;
    const minutosDisponiveisHoje = profissionais.reduce(
      (soma, p) => soma + minutosDeExpedienteNoDia(p.horarios, diaSemanaHoje),
      0
    );
    const taxaOcupacao = minutosDisponiveisHoje > 0 ? Math.round((minutosOcupadosHoje / minutosDisponiveisHoje) * 100) : 0;

    const proximosAtendimentos = agendamentos
      .filter((a) => (a.status === "pendente" || a.status === "confirmado") && isAfter(new Date(a.dataHoraInicio), agora))
      .sort((a, b) => new Date(a.dataHoraInicio).getTime() - new Date(b.dataHoraInicio).getTime())
      .slice(0, 5);

    const nomePorProfissional = new Map(profissionalRepository.listarPorTenant(tenantId).map((p) => [p.id, p.nome]));
    const nomePorServico = new Map(servicos.map((s) => [s.id, s.nome]));

    return {
      agendamentosHojeTotal: agendamentosHoje.length,
      confirmados,
      cancelamentos,
      faltas,
      faturamentoPrevistoCentavos,
      taxaOcupacao,
      proximosAtendimentos,
      nomePorProfissional,
      nomePorServico,
    };
  }, [tenantId]);

  if (carregando || !dados) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold text-ink">Dashboard</h1>
          <p className="text-sm text-ink-soft">
            Resumo de hoje {terminologia.estabelecimento.artigo === "a" ? "na" : "no"}{" "}
            {terminologia.estabelecimento.singular.toLowerCase()}.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/painel/agenda">
            <Botao tamanho="sm" variante="secundaria">
              <CalendarX2 size={16} className="mr-1.5" /> Bloquear horário
            </Botao>
          </Link>
          <Link href="/painel/agenda">
            <Botao tamanho="sm">
              <CalendarPlus size={16} className="mr-1.5" /> Novo agendamento
            </Botao>
          </Link>
        </div>
      </div>

      {mostrarChecklist && estabelecimento && (
        <ChecklistPrimeirosPassos
          tenantId={tenantId}
          slug={estabelecimento.slug}
          aoDispensar={() => setMostrarChecklist(false)}
        />
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <EstatisticaCard icone={Clock3} rotulo={`${terminologia.agendamento.plural} hoje`} valor={String(dados.agendamentosHojeTotal)} />
        <EstatisticaCard
          icone={CheckCircle2}
          rotulo="Confirmados hoje"
          valor={String(dados.confirmados)}
          corIcone="success"
        />
        <EstatisticaCard icone={XCircle} rotulo="Cancelamentos hoje" valor={String(dados.cancelamentos)} corIcone="danger" />
        <EstatisticaCard icone={UserX2} rotulo="Faltas hoje" valor={String(dados.faltas)} corIcone="warning" />
        <EstatisticaCard
          icone={Gauge}
          rotulo="Ocupação de hoje"
          valor={`${dados.taxaOcupacao}%`}
          corIcone="info"
        />
        <EstatisticaCard
          icone={DollarSign}
          rotulo="Faturamento previsto hoje"
          valor={formatarMoeda(dados.faturamentoPrevistoCentavos)}
          corIcone="accent"
        />
      </div>

      <Cartao>
        <CartaoCorpo>
          <CartaoTitulo className="mb-3">Próximos {terminologia.agendamento.plural.toLowerCase()}</CartaoTitulo>
          {dados.proximosAtendimentos.length === 0 ? (
            <EstadoVazio icone={Clock3} titulo={`Nenhum ${terminologia.agendamento.singular.toLowerCase()} futuro`} />
          ) : (
            <ul className="divide-y divide-border">
              {dados.proximosAtendimentos.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{a.consumidorNome}</p>
                    <p className="truncate text-xs text-ink-soft">
                      {dados.nomePorServico.get(a.servicoId)} · {dados.nomePorProfissional.get(a.profissionalId)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-ink">{formatarHora(a.dataHoraInicio)}</p>
                    <BadgeStatusAgendamento status={a.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CartaoCorpo>
      </Cartao>
    </div>
  );
}
