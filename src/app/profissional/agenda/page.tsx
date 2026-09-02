"use client";

import { useState } from "react";
import { addDays, isSameDay } from "date-fns";
import { CalendarDays, CalendarX2, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
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
import { useToast } from "@/components/ui/toast";
import { ModalDetalheAgendamento } from "@/components/painel/modal-agendamento";
import { ModalBloqueio } from "@/components/painel/modal-bloqueio";
import { formatarDataLonga, formatarHora } from "@/lib/format";
import type { Agendamento } from "@/lib/types";

export default function AgendaProfissionalPage() {
  return (
    <RequirePermission permissao="agenda.visualizar">
      <ConteudoAgendaProfissional />
    </RequirePermission>
  );
}

function ConteudoAgendaProfissional() {
  const { usuario } = useAuth();
  const { terminologia, podeAcessar } = useTenant();
  const { notificar } = useToast();
  const profissionalId = usuario?.profissionalId ?? "";
  const [dataAtual, setDataAtual] = useState(() => new Date());
  const [agendamentoSelecionado, setAgendamentoSelecionado] = useState<Agendamento | null>(null);
  const [modalBloqueioAberto, setModalBloqueioAberto] = useState(false);

  const { dados, carregando, recarregar } = useClientData(() => {
    const profissional = profissionalRepository.obterPorId(profissionalId);
    if (!profissional) return null;
    const estabelecimento = estabelecimentoRepository.obterPorTenantId(profissional.tenantId);
    if (!estabelecimento) return null;
    return {
      profissional,
      estabelecimento,
      servicos: servicoRepository.listarPorTenant(profissional.tenantId),
      agendamentos: agendamentoRepository.listarPorProfissional(profissionalId),
      bloqueios: bloqueioRepository.listarPorProfissional(profissionalId),
    };
  }, [profissionalId]);

  if (carregando || !dados) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const { profissional, estabelecimento, servicos, agendamentos, bloqueios } = dados;
  const servicoPorId = new Map(servicos.map((s) => [s.id, s]));

  const agendamentosDoDia = agendamentos
    .filter((a) => isSameDay(new Date(a.dataHoraInicio), dataAtual))
    .sort((a, b) => new Date(a.dataHoraInicio).getTime() - new Date(b.dataHoraInicio).getTime());
  const bloqueiosDoDia = bloqueios
    .filter((b) => isSameDay(new Date(b.inicio), dataAtual))
    .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime());

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-bold text-ink">Minha agenda</h1>
          <p className="text-sm text-ink-soft">
            Olá, {profissional.nome}. Aqui você só vê {terminologia.agendamento.artigo === "a" ? "suas" : "seus"} próprios{" "}
            {terminologia.agendamento.plural.toLowerCase()}.
          </p>
        </div>
        {podeAcessar("agenda.gerenciar").permitido && (
          <Botao tamanho="sm" variante="secundaria" onClick={() => setModalBloqueioAberto(true)}>
            <CalendarX2 size={16} className="mr-1.5" /> Bloquear horário
          </Botao>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Dia anterior"
          onClick={() => setDataAtual((d) => addDays(d, -1))}
          className="flex size-9 items-center justify-center rounded-full border border-border hover:bg-paper-muted"
        >
          <ChevronLeft size={18} />
        </button>
        <p className="min-w-[11rem] text-center text-sm font-semibold text-ink sm:text-left">
          {formatarDataLonga(dataAtual)}
        </p>
        <button
          type="button"
          aria-label="Próximo dia"
          onClick={() => setDataAtual((d) => addDays(d, 1))}
          className="flex size-9 items-center justify-center rounded-full border border-border hover:bg-paper-muted"
        >
          <ChevronRight size={18} />
        </button>
        <Botao tamanho="sm" variante="fantasma" onClick={() => setDataAtual(new Date())}>
          Hoje
        </Botao>
      </div>

      <Cartao>
        <CartaoCorpo>
          {agendamentosDoDia.length === 0 && bloqueiosDoDia.length === 0 ? (
            <EstadoVazio icone={CalendarDays} titulo="Nenhum item neste dia" />
          ) : (
            <ul className="space-y-2">
              {bloqueiosDoDia.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] bg-paper-muted px-3 py-2.5 text-sm"
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
              {agendamentosDoDia.map((a) => {
                const servico = servicoPorId.get(a.servicoId);
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setAgendamentoSelecionado(a)}
                      className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border px-3 py-2.5 text-left text-sm hover:border-accent"
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

      {agendamentoSelecionado &&
        (() => {
          const servico = servicoPorId.get(agendamentoSelecionado.servicoId);
          if (!servico) return null;
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
                agendamentoRepository.atualizarStatus(agendamentoSelecionado.id, status, "profissional");
                recarregar();
                setAgendamentoSelecionado(null);
              }}
              onRemarcar={(novoInicio) => {
                if (!podeAcessar("agendamento.editar").permitido) return;
                const fim = new Date(novoInicio.getTime() + servico.duracaoMinutos * 60_000);
                try {
                  agendamentoRepository.remarcar(agendamentoSelecionado.id, novoInicio.toISOString(), fim.toISOString(), "profissional");
                  recarregar();
                  setAgendamentoSelecionado(null);
                } catch (erro) {
                  notificar(erro instanceof Error ? erro.message : "Não foi possível remarcar.", "erro");
                }
              }}
            />
          );
        })()}

      {podeAcessar("agenda.gerenciar").permitido && (
        <ModalBloqueio
          aberto={modalBloqueioAberto}
          aoFechar={() => setModalBloqueioAberto(false)}
          tenantId={profissional.tenantId}
          profissionais={[profissional]}
          dia={dataAtual}
          profissionalPreSelecionadoId={profissional.id}
          terminologia={terminologia}
          onCriado={recarregar}
        />
      )}
    </div>
  );
}
