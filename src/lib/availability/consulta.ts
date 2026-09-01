// Ponte entre o motor puro de disponibilidade (engine.ts) e os repositórios. Fica
// separado do engine para que engine.ts continue sem dependências de storage e
// fácil de testar isoladamente.

import { agendamentosParaOcupados, bloqueiosParaOcupados, calcularHorariosDisponiveis } from "./engine";
import { agendamentoRepository, bloqueioRepository, servicoRepository } from "@/lib/repositories";
import type { Estabelecimento, Profissional, Servico } from "@/lib/types";

export function horariosLivresDoProfissionalNoDia(
  profissional: Profissional,
  servico: Servico,
  dia: Date,
  estabelecimento: Estabelecimento,
  agendamentoIdExcluir?: string
): Date[] {
  const servicosTenant = servicoRepository.listarPorTenant(estabelecimento.tenantId);
  const duracaoPorServico = new Map(servicosTenant.map((s) => [s.id, s.duracaoMinutos]));
  const intervaloPorServico = new Map(servicosTenant.map((s) => [s.id, s.intervaloPosteriorMinutos]));
  // Garante entrada mesmo se o serviço em uso não estiver na listagem padrão do tenant.
  duracaoPorServico.set(servico.id, servico.duracaoMinutos);
  intervaloPorServico.set(servico.id, servico.intervaloPosteriorMinutos);

  const agendamentosProf = agendamentoRepository
    .listarPorProfissional(profissional.id)
    .filter((a) => a.tenantId === estabelecimento.tenantId && a.id !== agendamentoIdExcluir);
  const bloqueiosProf = bloqueioRepository.listarPorProfissional(profissional.id);
  const ocupados = [
    ...agendamentosParaOcupados(agendamentosProf, duracaoPorServico, intervaloPorServico),
    ...bloqueiosParaOcupados(bloqueiosProf),
  ];
  return calcularHorariosDisponiveis({
    data: dia,
    horarios: profissional.horarios,
    duracaoServicoMinutos: servico.duracaoMinutos,
    intervaloPosteriorMinutos: servico.intervaloPosteriorMinutos,
    ocupados,
    antecedenciaMinimaMinutos: estabelecimento.regras.antecedenciaMinimaMinutos,
    limiteDiasFuturos: estabelecimento.regras.limiteDiasFuturos,
  });
}

/** Reconfirma, imediatamente antes de gravar, que um horário específico ainda está
 * livre para este profissional — mesma regra central usada para listar horários,
 * nunca uma checagem paralela. Usar em TODO fluxo de criação/remarcação (público,
 * painel, agenda do profissional) para proteger contra a janela de tempo entre a
 * listagem de horários e a confirmação. */
export function horarioAindaDisponivelParaProfissional(
  profissional: Profissional,
  servico: Servico,
  horario: Date,
  estabelecimento: Estabelecimento,
  agendamentoIdExcluir?: string
): boolean {
  return horariosLivresDoProfissionalNoDia(profissional, servico, horario, estabelecimento, agendamentoIdExcluir).some(
    (h) => h.getTime() === horario.getTime()
  );
}
