// Regras puras do Calendário da agenda (mês, semana e dia) — sem React, sem
// fetch e sem relógio ou fuso do navegador. Tudo trabalha com datas de
// CALENDÁRIO `YYYY-MM-DD` do estabelecimento; quem informa "hoje" é a agenda
// (fuso do estabelecimento), e cada reserva já vem com a sua data local.
//
// A semana começa no domingo, como nos calendários de parede no Brasil.

export type VisaoDoCalendario = "mes" | "semana" | "dia";

export interface PeriodoDoCalendario {
  from: string;
  to: string;
}

const doisDigitos = (n: number) => String(n).padStart(2, "0");

function paraUtc(data: string): Date {
  const [ano, mes, dia] = data.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function deUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${doisDigitos(d.getUTCMonth() + 1)}-${doisDigitos(d.getUTCDate())}`;
}

export function somarDias(data: string, dias: number): string {
  const d = paraUtc(data);
  d.setUTCDate(d.getUTCDate() + dias);
  return deUtc(d);
}

/** 0 = domingo ... 6 = sábado. */
export function diaDaSemana(data: string): number {
  return paraUtc(data).getUTCDay();
}

export function inicioDaSemana(data: string): string {
  return somarDias(data, -diaDaSemana(data));
}

export function diasDaSemana(data: string): string[] {
  const inicio = inicioDaSemana(data);
  return Array.from({ length: 7 }, (_, i) => somarDias(inicio, i));
}

/** Mesmo mês de calendário? */
export function mesmoMes(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/** Grade do mês: semanas completas (domingo a sábado) do dia 1 ao último dia,
 * de 4 a 6 semanas; dias de fora do mês preenchem as pontas. */
export function semanasDoMes(data: string): string[][] {
  const primeiro = `${data.slice(0, 7)}-01`;
  const [ano, mes] = data.split("-").map(Number);
  const ultimo = deUtc(new Date(Date.UTC(ano, mes, 0)));
  const semanas: string[][] = [];
  for (let inicio = inicioDaSemana(primeiro); inicio <= ultimo; inicio = somarDias(inicio, 7)) {
    semanas.push(diasDaSemana(inicio));
  }
  return semanas;
}

/** Período a pedir ao servidor para cada visão (no máximo 42 dias). */
export function periodoDaVisao(visao: VisaoDoCalendario, data: string): PeriodoDoCalendario {
  if (visao === "dia") return { from: data, to: data };
  if (visao === "semana") {
    const dias = diasDaSemana(data);
    return { from: dias[0], to: dias[6] };
  }
  const semanas = semanasDoMes(data);
  return { from: semanas[0][0], to: semanas[semanas.length - 1][6] };
}

/** Anterior/próximo: um dia, uma semana ou um mês. No mês, o dia escolhido
 * vira o dia 1, para nunca "pular" um mês curto (31/01 + 1 mês). */
export function deslocar(visao: VisaoDoCalendario, data: string, sentido: 1 | -1): string {
  if (visao === "dia") return somarDias(data, sentido);
  if (visao === "semana") return somarDias(data, 7 * sentido);
  const [ano, mes] = data.split("-").map(Number);
  return deUtc(new Date(Date.UTC(ano, mes - 1 + sentido, 1)));
}

const NOMES_DOS_MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

export const DIAS_DA_SEMANA_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export const DIAS_DA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** Título do período: "outubro de 2026", "25 a 31 de outubro de 2026",
 * "27 de outubro de 2026". */
export function tituloDoPeriodo(visao: VisaoDoCalendario, data: string): string {
  const [ano, mes, dia] = data.split("-").map(Number);
  if (visao === "mes") return `${NOMES_DOS_MESES[mes - 1]} de ${ano}`;
  if (visao === "dia") return `${dia} de ${NOMES_DOS_MESES[mes - 1]} de ${ano}`;
  const dias = diasDaSemana(data);
  const [a1, m1, d1] = dias[0].split("-").map(Number);
  const [a2, m2, d2] = dias[6].split("-").map(Number);
  if (a1 !== a2) return `${d1} de ${NOMES_DOS_MESES[m1 - 1]} de ${a1} a ${d2} de ${NOMES_DOS_MESES[m2 - 1]} de ${a2}`;
  if (m1 !== m2) return `${d1} de ${NOMES_DOS_MESES[m1 - 1]} a ${d2} de ${NOMES_DOS_MESES[m2 - 1]} de ${a2}`;
  return `${d1} a ${d2} de ${NOMES_DOS_MESES[m2 - 1]} de ${a2}`;
}

/** Agrupa por data local, mantendo a ordem de chegada (o servidor já ordena
 * por horário). */
export function porData<T extends { localDate: string }>(itens: readonly T[]): Map<string, T[]> {
  const grupos = new Map<string, T[]>();
  for (const item of itens) {
    const lista = grupos.get(item.localDate);
    if (lista) lista.push(item);
    else grupos.set(item.localDate, [item]);
  }
  return grupos;
}

/** Situação em texto curto, para as células estreitas do calendário (a cor
 * nunca é o único sinal). */
export const ROTULO_CURTO_DA_SITUACAO: Record<string, string> = {
  PENDING: "Aguardando",
  CONFIRMED: "Confirmado",
  IN_PROGRESS: "Em atendimento",
  COMPLETED: "Concluído",
  CANCELED: "Cancelado",
  NO_SHOW: "Faltou",
};
