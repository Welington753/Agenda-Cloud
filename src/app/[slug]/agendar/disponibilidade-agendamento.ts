import { addDays, getDay, startOfDay } from "date-fns";
import { horariosLivresDoProfissionalNoDia } from "@/lib/availability/consulta";
import { QUALQUER_PROFISSIONAL } from "@/components/agendamento/etapa-profissional";
import type { DiaSemana, Estabelecimento, Profissional, Servico } from "@/lib/types";

export type EscolhaProfissional = string | typeof QUALQUER_PROFISSIONAL | null;

/** Dias, a partir de hoje, em que pelo menos um dos profissionais relevantes
 * tem algum horário de expediente ativo — usado para popular o seletor de
 * data (máximo `maxDiasExibidos`, buscando até `limiteDiasFuturos + 5` dias
 * à frente para achar candidatos suficientes mesmo com agenda esparsa). */
export function calcularDiasCandidatos(
  estabelecimento: Estabelecimento,
  profissionaisRelevantes: Profissional[],
  maxDiasExibidos: number
): Date[] {
  const dias: Date[] = [];
  let cursor = 0;
  while (dias.length < maxDiasExibidos && cursor < estabelecimento.regras.limiteDiasFuturos + 5) {
    const candidato = addDays(startOfDay(new Date()), cursor);
    const diaSemana = getDay(candidato) as DiaSemana;
    const algumProfissionalAtende = profissionaisRelevantes.some((p) =>
      p.horarios.some((h) => h.diaSemana === diaSemana && h.ativo)
    );
    if (algumProfissionalAtende) dias.push(candidato);
    cursor += 1;
  }
  return dias;
}

export function calcularHorariosDoProfissional(
  profissional: Profissional,
  servico: Servico | null,
  estabelecimento: Estabelecimento,
  dia: Date
): Date[] {
  if (!servico) return [];
  return horariosLivresDoProfissionalNoDia(profissional, servico, dia, estabelecimento);
}

/** Horários livres no dia selecionado. Com um profissional específico
 * escolhido, é a disponibilidade dele só; com "qualquer profissional", é a
 * união dos horários de todos os capacitados, deduplicada por instante (o
 * profissional dono de cada horário é resolvido depois, na confirmação, via
 * `resolverProfissionalParaHorario`). */
export function calcularHorariosDisponiveis(
  profissionaisCapacitados: Profissional[],
  escolhaProfissional: EscolhaProfissional,
  servico: Servico | null,
  estabelecimento: Estabelecimento,
  dataSelecionada: Date
): Date[] {
  if (escolhaProfissional !== QUALQUER_PROFISSIONAL) {
    const profissional = profissionaisCapacitados.find((p) => p.id === escolhaProfissional);
    if (!profissional) return [];
    return calcularHorariosDoProfissional(profissional, servico, estabelecimento, dataSelecionada);
  }

  const mapaHorarios = new Map<number, string>();
  for (const profissional of profissionaisCapacitados) {
    for (const horario of calcularHorariosDoProfissional(profissional, servico, estabelecimento, dataSelecionada)) {
      if (!mapaHorarios.has(horario.getTime())) mapaHorarios.set(horario.getTime(), profissional.id);
    }
  }
  return Array.from(mapaHorarios.keys())
    .sort((a, b) => a - b)
    .map((t) => new Date(t));
}

/** Quando "qualquer profissional" foi escolhido, descobre qual profissional
 * capacitado realmente tem aquele instante livre — o primeiro que aparecer
 * com esse horário na própria checagem de disponibilidade. */
export function resolverProfissionalParaHorario(
  profissionaisCapacitados: Profissional[],
  escolhaProfissional: EscolhaProfissional,
  hora: Date,
  servico: Servico | null,
  estabelecimento: Estabelecimento
): string | undefined {
  if (escolhaProfissional !== QUALQUER_PROFISSIONAL) return escolhaProfissional ?? undefined;
  return profissionaisCapacitados.find((p) =>
    calcularHorariosDoProfissional(p, servico, estabelecimento, hora).some((h) => h.getTime() === hora.getTime())
  )?.id;
}
