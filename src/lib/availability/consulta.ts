// Ponte entre o motor puro de disponibilidade (engine.ts) e os repositórios. Fica
// separado do engine para que engine.ts continue sem dependências de storage e
// fácil de testar isoladamente.

import { agendamentosParaOcupados, bloqueiosParaOcupados, calcularHorariosDisponiveis } from "./engine";
import { agendamentoRepository, bloqueioRepository } from "@/lib/repositories";
import type { Estabelecimento, Profissional, Servico } from "@/lib/types";

export function horariosLivresDoProfissionalNoDia(
  profissional: Profissional,
  servico: Servico,
  dia: Date,
  estabelecimento: Estabelecimento,
  agendamentoIdExcluir?: string
): Date[] {
  const agendamentosProf = agendamentoRepository
    .listarPorProfissional(profissional.id)
    .filter((a) => a.tenantId === estabelecimento.tenantId && a.id !== agendamentoIdExcluir);
  const bloqueiosProf = bloqueioRepository.listarPorProfissional(profissional.id);
  const ocupados = [
    ...agendamentosParaOcupados(
      agendamentosProf,
      new Map([[servico.id, servico.duracaoMinutos]]),
      new Map([[servico.id, servico.intervaloPosteriorMinutos]])
    ),
    ...bloqueiosParaOcupados(bloqueiosProf),
  ];
  return calcularHorariosDisponiveis({
    data: dia,
    horarios: profissional.horarios,
    duracaoServicoMinutos: servico.duracaoMinutos,
    ocupados,
    antecedenciaMinimaMinutos: estabelecimento.regras.antecedenciaMinimaMinutos,
    limiteDiasFuturos: estabelecimento.regras.limiteDiasFuturos,
  });
}
