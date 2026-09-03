"use client";

import { useMemo, useState } from "react";
import { addDays, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useClientData } from "@/lib/hooks/use-client-data";
import { useTenant } from "@/lib/tenant/tenant-context";
import { RequirePermission } from "@/components/layout/require-permission";
import {
  agendamentoRepository,
  bloqueioRepository,
  estabelecimentoRepository,
  profissionalRepository,
  servicoRepository,
} from "@/lib/repositories";
import { Botao } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ModalDetalheAgendamento } from "@/components/painel/modal-agendamento";
import { ModalNovoAgendamento } from "@/components/painel/modal-novo-agendamento";
import { ModalBloqueio } from "@/components/painel/modal-bloqueio";
import { formatarDataLonga } from "@/lib/format";
import type { StatusAgendamento } from "@/lib/types";
import clsx from "clsx";
import { useAgendaSelecao } from "./use-agenda-selecao";
import { VisaoSemana } from "./_visao/visao-semana";
import { VisaoDia } from "./_visao/visao-dia";

type ModoVisualizacao = "dia" | "semana";

const OPCOES_STATUS: { valor: StatusAgendamento | "todos"; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos os status" },
  { valor: "pendente", rotulo: "Pendente" },
  { valor: "confirmado", rotulo: "Confirmado" },
  { valor: "em_atendimento", rotulo: "Em atendimento" },
  { valor: "concluido", rotulo: "Concluído" },
  { valor: "cancelado", rotulo: "Cancelado" },
  { valor: "nao_compareceu", rotulo: "Não compareceu" },
];

export default function PainelAgendaPage() {
  return (
    <RequirePermission permissao="agenda.visualizar">
      <ConteudoAgenda />
    </RequirePermission>
  );
}

function ConteudoAgenda() {
  const { tenantId, terminologia, podeAcessar } = useTenant();
  const { notificar } = useToast();
  const [modo, setModo] = useState<ModoVisualizacao>("dia");
  const [dataAtual, setDataAtual] = useState(() => new Date());
  const [filtroProfissionalId, setFiltroProfissionalId] = useState("todos");
  const [filtroStatus, setFiltroStatus] = useState<StatusAgendamento | "todos">("todos");

  const { dados, carregando, recarregar } = useClientData(() => {
    const estabelecimento = estabelecimentoRepository.obterPorTenantId(tenantId);
    if (!estabelecimento) return null;
    return {
      estabelecimento,
      profissionais: profissionalRepository.listarPorTenant(tenantId).filter((p) => p.ativo),
      servicos: servicoRepository.listarPorTenant(tenantId),
      agendamentos: agendamentoRepository.listarPorTenant(tenantId),
      bloqueios: bloqueioRepository.listarPorTenant(tenantId),
    };
  }, [tenantId]);

  const {
    agendamentoSelecionado,
    setAgendamentoSelecionado,
    modalNovo,
    setModalNovo,
    modalBloqueio,
    setModalBloqueio,
    onMudarStatus,
    onRemarcar,
    onRemoverBloqueio,
  } = useAgendaSelecao({ podeAcessar, notificar, recarregar });

  const diasDaSemana = useMemo(() => {
    const inicio = startOfWeek(dataAtual, { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(inicio, i));
  }, [dataAtual]);

  if (carregando || !dados) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const { estabelecimento, profissionais, servicos, agendamentos, bloqueios } = dados;
  const servicoPorId = new Map(servicos.map((s) => [s.id, s]));
  const profissionalPorId = new Map(profissionais.map((p) => [p.id, p]));
  const profissionaisExibidos =
    filtroProfissionalId === "todos" ? profissionais : profissionais.filter((p) => p.id === filtroProfissionalId);

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold text-ink">Agenda</h1>
          <p className="text-sm text-ink-soft">Organize os atendimentos da sua equipe.</p>
        </div>
        <div className="flex overflow-hidden rounded-[var(--radius-control)] border border-border">
          <button
            type="button"
            onClick={() => setModo("dia")}
            className={clsx("px-4 py-2 text-sm font-semibold", modo === "dia" ? "bg-ink text-white" : "bg-card text-ink-soft")}
          >
            Dia
          </button>
          <button
            type="button"
            onClick={() => setModo("semana")}
            className={clsx("px-4 py-2 text-sm font-semibold", modo === "semana" ? "bg-ink text-white" : "bg-card text-ink-soft")}
          >
            Semana
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Dia anterior"
            onClick={() => setDataAtual((d) => addDays(d, modo === "dia" ? -1 : -7))}
            className="flex size-9 items-center justify-center rounded-full border border-border hover:bg-paper-muted"
          >
            <ChevronLeft size={18} />
          </button>
          <p className="min-w-[11rem] text-center text-sm font-semibold text-ink sm:text-left">
            {modo === "dia" ? formatarDataLonga(dataAtual) : `Semana de ${formatarDataLonga(diasDaSemana[0])}`}
          </p>
          <button
            type="button"
            aria-label="Próximo dia"
            onClick={() => setDataAtual((d) => addDays(d, modo === "dia" ? 1 : 7))}
            className="flex size-9 items-center justify-center rounded-full border border-border hover:bg-paper-muted"
          >
            <ChevronRight size={18} />
          </button>
          <Botao tamanho="sm" variante="fantasma" onClick={() => setDataAtual(new Date())}>
            Hoje
          </Botao>
        </div>

        <div className="flex flex-wrap gap-2">
          <select
            value={filtroProfissionalId}
            onChange={(e) => setFiltroProfissionalId(e.target.value)}
            className="rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
          >
            <option value="todos">{`Todos ${terminologia.profissional.artigo === "a" ? "as" : "os"} ${terminologia.profissional.plural.toLowerCase()}`}</option>
            {profissionais.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
          <select
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value as StatusAgendamento | "todos")}
            className="rounded-[var(--radius-control)] border border-border bg-card px-3 py-2 text-sm text-ink"
          >
            {OPCOES_STATUS.map((op) => (
              <option key={op.valor} value={op.valor}>
                {op.rotulo}
              </option>
            ))}
          </select>
        </div>
      </div>

      {modo === "semana" ? (
        <VisaoSemana
          diasDaSemana={diasDaSemana}
          profissionaisExibidos={profissionaisExibidos}
          agendamentos={agendamentos}
          filtroStatus={filtroStatus}
          terminologia={terminologia}
          aoSelecionarDia={(dia) => {
            setDataAtual(dia);
            setModo("dia");
          }}
        />
      ) : (
        <VisaoDia
          dataAtual={dataAtual}
          profissionaisExibidos={profissionaisExibidos}
          agendamentos={agendamentos}
          bloqueios={bloqueios}
          filtroStatus={filtroStatus}
          servicoPorId={servicoPorId}
          podeAcessar={podeAcessar}
          terminologia={terminologia}
          aoSelecionarAgendamento={setAgendamentoSelecionado}
          aoNovoAgendamento={(profissionalId) => setModalNovo({ profissionalId })}
          aoNovoBloqueio={(profissionalId) => setModalBloqueio({ profissionalId })}
          aoRemoverBloqueio={onRemoverBloqueio}
        />
      )}

      {agendamentoSelecionado &&
        (() => {
          const servico = servicoPorId.get(agendamentoSelecionado.servicoId);
          const profissional = profissionalPorId.get(agendamentoSelecionado.profissionalId);
          if (!servico || !profissional) return null;
          return (
            <ModalDetalheAgendamento
              aberto={Boolean(agendamentoSelecionado)}
              aoFechar={() => setAgendamentoSelecionado(null)}
              agendamento={agendamentoSelecionado}
              servico={servico}
              profissional={profissional}
              estabelecimento={estabelecimento}
              terminologia={terminologia}
              podeEditar={podeAcessar("agendamento.editar").permitido}
              podeCancelar={podeAcessar("agendamento.cancelar").permitido}
              onMudarStatus={onMudarStatus}
              onRemarcar={(novoInicio) => onRemarcar(novoInicio, servico)}
            />
          );
        })()}

      {modalNovo && podeAcessar("agendamento.criar").permitido && (
        <ModalNovoAgendamento
          aberto={Boolean(modalNovo)}
          aoFechar={() => setModalNovo(null)}
          estabelecimento={estabelecimento}
          profissionais={profissionais}
          servicos={servicos}
          dia={dataAtual}
          profissionalPreSelecionadoId={modalNovo.profissionalId}
          onCriado={recarregar}
          terminologia={terminologia}
        />
      )}

      {modalBloqueio && podeAcessar("agenda.gerenciar").permitido && (
        <ModalBloqueio
          aberto={Boolean(modalBloqueio)}
          aoFechar={() => setModalBloqueio(null)}
          tenantId={tenantId}
          profissionais={profissionais}
          dia={dataAtual}
          profissionalPreSelecionadoId={modalBloqueio.profissionalId}
          onCriado={recarregar}
          terminologia={terminologia}
        />
      )}
    </div>
  );
}
