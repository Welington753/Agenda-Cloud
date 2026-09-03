import { useState } from "react";
import { agendamentoRepository, bloqueioRepository } from "@/lib/repositories";
import type { Agendamento, Permission, Servico, StatusAgendamento } from "@/lib/types";

interface UseAgendaSelecaoParams {
  podeAcessar: (permissao: Permission) => { permitido: boolean };
  notificar: (mensagem: string, tipo: "erro" | "sucesso") => void;
  recarregar: () => void;
}

/** Seleção de agendamento (modal de detalhe) e abertura dos modais de criar
 * agendamento/bloqueio, junto com as mutações que dependem de permissão —
 * extraído da página de agenda para isolar esse estado da renderização das
 * visões de dia/semana. */
export function useAgendaSelecao({ podeAcessar, notificar, recarregar }: UseAgendaSelecaoParams) {
  const [agendamentoSelecionado, setAgendamentoSelecionado] = useState<Agendamento | null>(null);
  const [modalNovo, setModalNovo] = useState<{ profissionalId?: string } | null>(null);
  const [modalBloqueio, setModalBloqueio] = useState<{ profissionalId?: string } | null>(null);

  function onMudarStatus(status: StatusAgendamento) {
    if (!agendamentoSelecionado) return;
    const permissaoNecessaria = status === "cancelado" ? "agendamento.cancelar" : "agendamento.editar";
    if (!podeAcessar(permissaoNecessaria).permitido) return;
    agendamentoRepository.atualizarStatus(agendamentoSelecionado.id, status, "dono");
    recarregar();
    setAgendamentoSelecionado(null);
  }

  function onRemarcar(novoInicio: Date, servico: Servico) {
    if (!agendamentoSelecionado) return;
    if (!podeAcessar("agendamento.editar").permitido) return;
    const fim = new Date(novoInicio.getTime() + servico.duracaoMinutos * 60_000);
    try {
      agendamentoRepository.remarcar(agendamentoSelecionado.id, novoInicio.toISOString(), fim.toISOString(), "dono");
      recarregar();
      setAgendamentoSelecionado(null);
    } catch (erro) {
      notificar(erro instanceof Error ? erro.message : "Não foi possível remarcar.", "erro");
    }
  }

  function onRemoverBloqueio(bloqueioId: string) {
    if (!podeAcessar("agenda.gerenciar").permitido) return;
    bloqueioRepository.remover(bloqueioId);
    recarregar();
  }

  return {
    agendamentoSelecionado,
    setAgendamentoSelecionado,
    modalNovo,
    setModalNovo,
    modalBloqueio,
    setModalBloqueio,
    onMudarStatus,
    onRemarcar,
    onRemoverBloqueio,
  };
}
