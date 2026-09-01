"use client";

import { useMemo, useState } from "react";
import { addDays, isSameDay, startOfWeek } from "date-fns";
import { CalendarDays, CalendarX2, ChevronLeft, ChevronRight, Plus, UserRound } from "lucide-react";
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
import { Cartao, CartaoCorpo } from "@/components/ui/card";
import { BadgeStatusAgendamento } from "@/components/ui/badge";
import { EstadoVazio } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ModalDetalheAgendamento } from "@/components/painel/modal-agendamento";
import { ModalNovoAgendamento } from "@/components/painel/modal-novo-agendamento";
import { ModalBloqueio } from "@/components/painel/modal-bloqueio";
import { formatarDataLonga, formatarHora, formatarMoeda } from "@/lib/format";
import type { Agendamento, StatusAgendamento } from "@/lib/types";
import clsx from "clsx";

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
  const [modo, setModo] = useState<ModoVisualizacao>("dia");
  const [dataAtual, setDataAtual] = useState(() => new Date());
  const [filtroProfissionalId, setFiltroProfissionalId] = useState("todos");
  const [filtroStatus, setFiltroStatus] = useState<StatusAgendamento | "todos">("todos");
  const [agendamentoSelecionado, setAgendamentoSelecionado] = useState<Agendamento | null>(null);
  const [modalNovo, setModalNovo] = useState<{ profissionalId?: string } | null>(null);
  const [modalBloqueio, setModalBloqueio] = useState<{ profissionalId?: string } | null>(null);

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

  function agendamentosDoDia(profissionalId: string, dia: Date) {
    return agendamentos
      .filter(
        (a) =>
          a.profissionalId === profissionalId &&
          isSameDay(new Date(a.dataHoraInicio), dia) &&
          (filtroStatus === "todos" || a.status === filtroStatus)
      )
      .sort((a, b) => new Date(a.dataHoraInicio).getTime() - new Date(b.dataHoraInicio).getTime());
  }

  function bloqueiosDoDia(profissionalId: string, dia: Date) {
    return bloqueios
      .filter((b) => b.profissionalId === profissionalId && isSameDay(new Date(b.inicio), dia))
      .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime());
  }

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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {diasDaSemana.map((dia) => {
            const totalDia = profissionaisExibidos.reduce((soma, p) => soma + agendamentosDoDia(p.id, dia).length, 0);
            const faturamentoDia = profissionaisExibidos.reduce(
              (soma, p) =>
                soma +
                agendamentosDoDia(p.id, dia)
                  .filter((a) => a.status !== "cancelado" && a.status !== "nao_compareceu")
                  .reduce((s, a) => s + (a.precoCentavos ?? 0), 0),
              0
            );
            return (
              <button
                key={dia.toISOString()}
                type="button"
                onClick={() => {
                  setDataAtual(dia);
                  setModo("dia");
                }}
                className={clsx(
                  "rounded-[var(--radius-card)] border p-3 text-left transition-colors hover:border-accent",
                  isSameDay(dia, new Date()) ? "border-accent bg-accent-soft/40" : "border-border bg-card"
                )}
              >
                <p className="text-xs font-semibold uppercase text-ink-soft">
                  {dia.toLocaleDateString("pt-BR", { weekday: "short" })}
                </p>
                <p className="text-lg font-bold text-ink">{dia.getDate()}</p>
                <p className="mt-1 text-xs text-ink-soft">
                  {totalDia} {totalDia === 1 ? terminologia.agendamento.singular.toLowerCase() : terminologia.agendamento.plural.toLowerCase()}
                </p>
                <p className="text-xs font-semibold text-accent">{formatarMoeda(faturamentoDia)}</p>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {profissionaisExibidos.map((prof) => {
            const itensAgendamento = agendamentosDoDia(prof.id, dataAtual);
            const itensBloqueio = bloqueiosDoDia(prof.id, dataAtual);
            const semItens = itensAgendamento.length === 0 && itensBloqueio.length === 0;
            return (
              <Cartao key={prof.id}>
                <CartaoCorpo className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                        style={{ backgroundColor: prof.corAvatar }}
                      >
                        {prof.avatarIniciais}
                      </div>
                      <p className="font-semibold text-ink">{prof.nome}</p>
                    </div>
                    <div className="flex gap-1">
                      {podeAcessar("agendamento.criar").permitido && (
                        <button
                          type="button"
                          aria-label={`${terminologia.agendamento.artigo === "a" ? "Nova" : "Novo"} ${terminologia.agendamento.singular.toLowerCase()} para ${prof.nome}`}
                          onClick={() => setModalNovo({ profissionalId: prof.id })}
                          className="flex size-8 items-center justify-center rounded-full border border-border hover:bg-paper-muted"
                        >
                          <Plus size={16} />
                        </button>
                      )}
                      {podeAcessar("agenda.gerenciar").permitido && (
                        <button
                          type="button"
                          aria-label={`Bloquear horário de ${prof.nome}`}
                          onClick={() => setModalBloqueio({ profissionalId: prof.id })}
                          className="flex size-8 items-center justify-center rounded-full border border-border hover:bg-paper-muted"
                        >
                          <CalendarX2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>

                  {semItens ? (
                    <EstadoVazio icone={CalendarDays} titulo="Nenhum item neste dia" />
                  ) : (
                    <ul className="space-y-2">
                      {itensBloqueio.map((b) => (
                        <li
                          key={b.id}
                          className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] bg-paper-muted px-3 py-2 text-sm"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink-soft">{b.motivo}</p>
                            <p className="text-xs text-ink-soft">
                              {formatarHora(b.inicio)} – {formatarHora(b.fim)}
                            </p>
                          </div>
                          {podeAcessar("agenda.gerenciar").permitido && (
                            <button
                              type="button"
                              onClick={() => {
                                if (!podeAcessar("agenda.gerenciar").permitido) return;
                                bloqueioRepository.remover(b.id);
                                recarregar();
                              }}
                              className="shrink-0 text-xs font-semibold text-[color:var(--color-danger)] hover:underline"
                            >
                              Remover
                            </button>
                          )}
                        </li>
                      ))}
                      {itensAgendamento.map((a) => {
                        const servico = servicoPorId.get(a.servicoId);
                        return (
                          <li key={a.id}>
                            <button
                              type="button"
                              onClick={() => setAgendamentoSelecionado(a)}
                              className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border px-3 py-2 text-left text-sm hover:border-accent"
                            >
                              <div className="min-w-0">
                                <p className="truncate font-medium text-ink">{a.consumidorNome}</p>
                                <p className="truncate text-xs text-ink-soft">{servico?.nome}</p>
                              </div>
                              <div className="shrink-0 text-right">
                                <p className="text-sm font-semibold text-ink">{formatarHora(a.dataHoraInicio)}</p>
                                <BadgeStatusAgendamento status={a.status} />
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CartaoCorpo>
              </Cartao>
            );
          })}
          {profissionaisExibidos.length === 0 && (
            <EstadoVazio icone={UserRound} titulo={`Nenhum${terminologia.profissional.artigo === "a" ? "a" : ""} ${terminologia.profissional.singular.toLowerCase()} cadastrad${terminologia.profissional.artigo === "a" ? "a" : "o"}`} />
          )}
        </div>
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
              onMudarStatus={(status) => {
                const permissaoNecessaria = status === "cancelado" ? "agendamento.cancelar" : "agendamento.editar";
                if (!podeAcessar(permissaoNecessaria).permitido) return;
                agendamentoRepository.atualizarStatus(agendamentoSelecionado.id, status, "dono");
                recarregar();
                setAgendamentoSelecionado(null);
              }}
              onRemarcar={(novoInicio) => {
                if (!podeAcessar("agendamento.editar").permitido) return;
                const fim = new Date(novoInicio.getTime() + servico.duracaoMinutos * 60_000);
                agendamentoRepository.remarcar(agendamentoSelecionado.id, novoInicio.toISOString(), fim.toISOString(), "dono");
                recarregar();
                setAgendamentoSelecionado(null);
              }}
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
