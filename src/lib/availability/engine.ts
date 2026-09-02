// Motor de disponibilidade: funções puras, sem dependência de React ou de storage,
// para que sejam fáceis de testar isoladamente (ver engine.test.ts).

import { addMinutes, getDay, isBefore, setHours, setMinutes, startOfDay } from "date-fns";
import type { Agendamento, DiaSemana, HorarioDia, StatusAgendamento } from "@/lib/types";

export interface JanelaOcupada {
  inicio: Date;
  fim: Date;
}

export interface OpcoesDisponibilidade {
  data: Date;
  horarios: HorarioDia[];
  duracaoServicoMinutos: number;
  /** Intervalo posterior do serviço sendo agendado agora — reserva esse tempo
   * depois do atendimento antes de liberar o próximo horário. Padrão 0 mantém
   * compatibilidade com chamadas existentes. */
  intervaloPosteriorMinutos?: number;
  ocupados: JanelaOcupada[];
  antecedenciaMinimaMinutos: number;
  limiteDiasFuturos: number;
  agora?: Date;
  passoMinutos?: number;
}

/** Status de agendamento que efetivamente ocupam um horário na agenda. Cancelamentos
 * e faltas liberam o horário para novos agendamentos. */
const STATUS_OCUPA_AGENDA: StatusAgendamento[] = ["pendente", "confirmado", "em_atendimento", "concluido"];

export function intervalosSeSobrepoem(inicioA: Date, fimA: Date, inicioB: Date, fimB: Date): boolean {
  return isBefore(inicioA, fimB) && isBefore(inicioB, fimA);
}

export function obterHorarioDoDia(horarios: HorarioDia[], diaSemana: DiaSemana): HorarioDia | undefined {
  return horarios.find((h) => h.diaSemana === diaSemana && h.ativo);
}

function diferencaEmMinutos(hhmmInicio: string, hhmmFim: string): number {
  const [hi, mi] = hhmmInicio.split(":").map(Number);
  const [hf, mf] = hhmmFim.split(":").map(Number);
  return hf * 60 + mf - (hi * 60 + mi);
}

/** Minutos de expediente de um profissional num dia da semana, descontando o
 * almoço. Usado para estimar a taxa de ocupação no dashboard. */
export function minutosDeExpedienteNoDia(horarios: HorarioDia[], diaSemana: DiaSemana): number {
  const horarioDia = obterHorarioDoDia(horarios, diaSemana);
  if (!horarioDia) return 0;
  const total = diferencaEmMinutos(horarioDia.inicio, horarioDia.fim);
  const almoco =
    horarioDia.almocoInicio && horarioDia.almocoFim ? diferencaEmMinutos(horarioDia.almocoInicio, horarioDia.almocoFim) : 0;
  return Math.max(0, total - almoco);
}

function horaParaDate(dia: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return setMinutes(setHours(startOfDay(dia), h), m);
}

/** Converte agendamentos em janelas ocupadas. Usa `dataHoraFim` como fim real do
 * atendimento (não recalcula a duração); só recai no fallback pela duração
 * cadastrada do serviço se `dataHoraFim` estiver ausente/inválido/não-posterior ao
 * início, protegendo dados malformados sem alterar o significado de `dataHoraFim`
 * para os dados válidos. Some o intervalo posterior do serviço depois do fim real.
 * Agendamentos cancelados ou com falta não geram janela. */
export function agendamentosParaOcupados(
  agendamentos: Agendamento[],
  duracaoPorServicoMinutos: Map<string, number>,
  intervaloPosteriorPorServicoMinutos: Map<string, number>
): JanelaOcupada[] {
  return agendamentos
    .filter((a) => STATUS_OCUPA_AGENDA.includes(a.status))
    .map((a) => {
      const inicio = new Date(a.dataHoraInicio);
      const fimRegistrado = new Date(a.dataHoraFim);
      const intervalo = intervaloPosteriorPorServicoMinutos.get(a.servicoId) ?? 0;
      const fimRegistradoValido = !Number.isNaN(fimRegistrado.getTime()) && isBefore(inicio, fimRegistrado);
      const fimReal = fimRegistradoValido
        ? fimRegistrado
        : addMinutes(inicio, duracaoPorServicoMinutos.get(a.servicoId) ?? 30);
      return { inicio, fim: addMinutes(fimReal, intervalo) };
    });
}

export function bloqueiosParaOcupados(bloqueios: { inicio: string; fim: string }[]): JanelaOcupada[] {
  return bloqueios.map((b) => ({ inicio: new Date(b.inicio), fim: new Date(b.fim) }));
}

/** Gera os horários de início candidatos (grade de 15 em 15 minutos por padrão) em
 * que o serviço cabe inteiramente dentro do expediente, sem cruzar o almoço. */
export function calcularHorariosDisponiveis(opcoes: OpcoesDisponibilidade): Date[] {
  const passo = opcoes.passoMinutos ?? 15;
  const intervaloPosterior = opcoes.intervaloPosteriorMinutos ?? 0;
  const horarioDia = obterHorarioDoDia(opcoes.horarios, getDay(opcoes.data) as DiaSemana);
  if (!horarioDia) return [];

  const agora = opcoes.agora ?? new Date();
  const limiteMaximo = addMinutes(startOfDay(agora), opcoes.limiteDiasFuturos * 24 * 60);
  if (isBefore(limiteMaximo, startOfDay(opcoes.data))) return [];

  const aberturaDia = horaParaDate(opcoes.data, horarioDia.inicio);
  const fechamentoDia = horaParaDate(opcoes.data, horarioDia.fim);
  const almocoInicio = horarioDia.almocoInicio ? horaParaDate(opcoes.data, horarioDia.almocoInicio) : null;
  const almocoFim = horarioDia.almocoFim ? horaParaDate(opcoes.data, horarioDia.almocoFim) : null;
  const inicioMinimoPorAntecedencia = addMinutes(agora, opcoes.antecedenciaMinimaMinutos);

  const disponiveis: Date[] = [];
  let cursor = aberturaDia;
  while (isBefore(cursor, fechamentoDia)) {
    const fimServico = addMinutes(cursor, opcoes.duracaoServicoMinutos);
    const fimComIntervalo = addMinutes(fimServico, intervaloPosterior);
    const cabeNoExpediente = !isBefore(fechamentoDia, fimComIntervalo);
    const cruzaAlmoco =
      almocoInicio && almocoFim ? intervalosSeSobrepoem(cursor, fimComIntervalo, almocoInicio, almocoFim) : false;
    const respeitaAntecedencia = !isBefore(cursor, inicioMinimoPorAntecedencia);
    const temConflito = opcoes.ocupados.some((o) => intervalosSeSobrepoem(cursor, fimComIntervalo, o.inicio, o.fim));

    if (cabeNoExpediente && !cruzaAlmoco && respeitaAntecedencia && !temConflito) {
      disponiveis.push(cursor);
    }
    cursor = addMinutes(cursor, passo);
  }
  return disponiveis;
}

export interface CandidatoProfissional {
  profissionalId: string;
  opcoes: OpcoesDisponibilidade;
}

export interface ResultadoEscolhaProfissional {
  profissionalId: string;
  horarios: Date[];
}

/** Para o fluxo "qualquer profissional": retorna o primeiro profissional capacitado
 * que tenha ao menos um horário livre no dia, junto com seus horários disponíveis. */
export function encontrarProfissionalDisponivel(
  candidatos: CandidatoProfissional[]
): ResultadoEscolhaProfissional | undefined {
  for (const candidato of candidatos) {
    const horarios = calcularHorariosDisponiveis(candidato.opcoes);
    if (horarios.length > 0) {
      return { profissionalId: candidato.profissionalId, horarios };
    }
  }
  return undefined;
}

/** Reconfirma, no momento da submissão, que um horário específico ainda está livre —
 * protege contra corridas entre a listagem de horários e a confirmação do agendamento. */
export function horarioAindaDisponivel(opcoes: OpcoesDisponibilidade, inicioDesejado: Date): boolean {
  return calcularHorariosDisponiveis(opcoes).some((h) => h.getTime() === inicioDesejado.getTime());
}
