import { horarioAindaDisponivelParaProfissional } from "@/lib/availability/consulta";
import { agendamentoRepository, consumidorRepository } from "@/lib/repositories";
import type { Estabelecimento, Profissional, Servico } from "@/lib/types";

export interface ConfirmarAgendamentoInput {
  estabelecimento: Estabelecimento;
  servico: Servico;
  horarioSelecionado: Date;
  profissional: Profissional;
  nome: string;
  whatsapp: string;
}

export type ConfirmarAgendamentoResultado =
  | { sucesso: true; agendamentoId: string }
  | { sucesso: false; motivo: "horario_indisponivel" };

/** Reconfirma a disponibilidade imediatamente antes de gravar (o horário
 * pode ter sido preenchido por outra pessoa entre a seleção e o clique em
 * confirmar) e só então cria o agendamento. */
export function executarConfirmacaoAgendamento(input: ConfirmarAgendamentoInput): ConfirmarAgendamentoResultado {
  const { estabelecimento, servico, horarioSelecionado, profissional, nome, whatsapp } = input;

  const aindaDisponivel = horarioAindaDisponivelParaProfissional(profissional, servico, horarioSelecionado, estabelecimento);
  if (!aindaDisponivel) {
    return { sucesso: false, motivo: "horario_indisponivel" };
  }

  const consumidor = consumidorRepository.obterOuCriarPorWhatsapp(estabelecimento.tenantId, nome.trim(), whatsapp);
  const fim = new Date(horarioSelecionado.getTime() + servico.duracaoMinutos * 60_000);
  const novoAgendamento = agendamentoRepository.criar({
    tenantId: estabelecimento.tenantId,
    consumidorId: consumidor.id,
    consumidorNome: nome.trim(),
    consumidorWhatsapp: whatsapp,
    profissionalId: profissional.id,
    servicoId: servico.id,
    dataHoraInicio: horarioSelecionado.toISOString(),
    dataHoraFim: fim.toISOString(),
    status: estabelecimento.regras.confirmacaoAutomatica && !servico.exigeConfirmacaoManual ? "confirmado" : "pendente",
    precoCentavos: servico.precoCentavos,
  });

  return { sucesso: true, agendamentoId: novoAgendamento.id };
}
