"use client";

// Tratamento do RESULTADO das ações sobre reservas já existentes (cancelar,
// remarcar, confirmar, iniciar, concluir, registrar falta). Saiu de page.tsx
// sem mudar comportamento quando a página ganhou a barra da agenda e o painel
// de nova reserva e passou do limite de linhas do projeto.
//
// Cancelamento, remarcação e mudanças de status compartilham o tratamento:
//
// - sucesso: avisa; a agenda já foi recarregada pelo hook;
// - 409 (horário ocupado, ou reserva alterada por outra tela) e 400 (já
//   começou, já cancelada): recarrega, para a pessoa ver o estado REAL que
//   causou a recusa em vez de continuar olhando o desatualizado. Nunca
//   reenvia: a nova tentativa é uma nova confirmação, com os dados novos;
// - falha de comunicação: NÃO recarrega e NÃO reenvia. A mensagem diz que a
//   operação PODE ter acontecido e manda consultar a reserva — afirmar que não
//   aconteceu seria mentira, e reenviar às cegas poderia cancelar ou mover
//   algo que já foi gravado.
import { useCallback, useState } from "react";
import type { AcaoDeStatusReal } from "@/lib/api/appointment-status-api";
import type { FalhaAgendamentoReal } from "@/lib/api/appointments-api";
import {
  mensagemFalhaCancelamento,
  mensagemFalhaRemarcacao,
} from "@/lib/profissionais/agendamentos";
import { mensagemFalhaStatus, mensagemSucessoStatus } from "@/lib/profissionais/andamento";
import type { AgendamentosReaisControlados } from "@/lib/profissionais/use-agendamentos-reais";

type Notificar = (mensagem: string, tipo: "sucesso") => void;

export function useAcoesDaAgenda(
  agendamentos: Pick<
    AgendamentosReaisControlados,
    "cancelar" | "alterarStatus" | "remarcar" | "recarregar"
  >,
  notificar: Notificar,
) {
  const { cancelar, alterarStatus, remarcar, recarregar } = agendamentos;
  /** Erro das ações sobre uma reserva JÁ existente, separado do erro da nova
   * reserva: misturar os dois mostraria a falha do cancelamento dentro do
   * formulário de criação. */
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const tratarFalha = useCallback(
    (falha: FalhaAgendamentoReal, mensagem: string) => {
      setErroAcao(mensagem);
      if (falha.tipo === "horario_ocupado" || falha.tipo === "nao_agendavel") recarregar();
    },
    [recarregar],
  );

  const aoCancelar = useCallback(
    async (appointmentId: string, expectedStartAt: string): Promise<boolean> => {
      setErroAcao(null);
      const resultado = await cancelar(appointmentId, { expectedStartAt });
      if (resultado.ok) {
        notificar("Reserva cancelada. O horário voltou a ficar livre.", "sucesso");
        return true;
      }
      tratarFalha(resultado.falha, mensagemFalhaCancelamento(resultado.falha));
      return false;
    },
    [cancelar, notificar, tratarFalha],
  );

  /** Confirmar, iniciar, concluir e registrar falta (Lote 6D.7). */
  const aoAlterarStatus = useCallback(
    async (
      appointmentId: string,
      acao: AcaoDeStatusReal,
      expectedStartAt: string,
    ): Promise<boolean> => {
      setErroAcao(null);
      const resultado = await alterarStatus(appointmentId, acao, { expectedStartAt });
      if (resultado.ok) {
        notificar(mensagemSucessoStatus(acao, resultado.dados), "sucesso");
        return true;
      }
      tratarFalha(resultado.falha, mensagemFalhaStatus(acao, resultado.falha));
      return false;
    },
    [alterarStatus, notificar, tratarFalha],
  );

  const aoRemarcar = useCallback(
    async (
      appointmentId: string,
      dados: { startAt: string; expectedStartAt: string },
    ): Promise<boolean> => {
      setErroAcao(null);
      const resultado = await remarcar(appointmentId, dados);
      if (resultado.ok) {
        notificar(`Reserva remarcada para ${resultado.dados.localStart}.`, "sucesso");
        return true;
      }
      tratarFalha(resultado.falha, mensagemFalhaRemarcacao(resultado.falha));
      return false;
    },
    [remarcar, notificar, tratarFalha],
  );

  return { erroAcao, setErroAcao, aoCancelar, aoAlterarStatus, aoRemarcar };
}
