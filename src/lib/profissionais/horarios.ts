// Regras de horário semanal no cliente (Lote 6D.3) — ESPELHO das regras do
// servidor (backend/src/professionals/working-hours.ts), nunca a fonte da
// verdade. Existe para a pessoa ver o erro no campo antes de gastar uma ida
// à API; quem decide de fato é sempre o backend, e a mensagem dele continua
// sendo exibida quando chega.
import type { DiaDeTrabalhoReal, IntervaloReal } from "@/lib/api/working-hours-api";

export const DIAS_DA_SEMANA: { weekday: number; nome: string; curto: string }[] = [
  { weekday: 0, nome: "Domingo", curto: "Dom" },
  { weekday: 1, nome: "Segunda-feira", curto: "Seg" },
  { weekday: 2, nome: "Terça-feira", curto: "Ter" },
  { weekday: 3, nome: "Quarta-feira", curto: "Qua" },
  { weekday: 4, nome: "Quinta-feira", curto: "Qui" },
  { weekday: 5, nome: "Sexta-feira", curto: "Sex" },
  { weekday: 6, nome: "Sábado", curto: "Sáb" },
];

/** Limite estrutural do modelo real: um período de trabalho e uma pausa. */
export const MAXIMO_DE_INTERVALOS_POR_DIA = 2;

const FORMATO_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export function ehHoraValida(valor: string): boolean {
  return FORMATO_HORA.test(valor);
}

export function minutosDaHora(valor: string): number {
  const [horas, minutos] = valor.split(":");
  return Number(horas) * 60 + Number(minutos);
}

export type ErroDeCampo = { intervalo: number; campo: "start" | "end"; mensagem: string };

export interface ResultadoDoDia {
  /** Erros ligados a um campo específico, para aparecerem junto dele. */
  errosDeCampo: ErroDeCampo[];
  /** Erro do dia inteiro (sobreposição, excesso de intervalos). */
  erroDoDia: string | null;
  /** Intervalos normalizados (ordenados, adjacentes unidos) quando válido. */
  intervals: IntervaloReal[];
}

/**
 * Valida e normaliza um dia, com as mesmas regras do servidor: formato
 * `HH:MM`, fim depois do início (nunca virada de dia), sem sobreposição,
 * adjacentes unidos e no máximo dois intervalos.
 */
export function validarDia(intervals: readonly IntervaloReal[]): ResultadoDoDia {
  const errosDeCampo: ErroDeCampo[] = [];

  intervals.forEach((intervalo, indice) => {
    if (!ehHoraValida(intervalo.start)) {
      errosDeCampo.push({ intervalo: indice, campo: "start", mensagem: "Use HH:MM." });
    }
    if (!ehHoraValida(intervalo.end)) {
      errosDeCampo.push({ intervalo: indice, campo: "end", mensagem: "Use HH:MM." });
    }
    if (
      ehHoraValida(intervalo.start) &&
      ehHoraValida(intervalo.end) &&
      minutosDaHora(intervalo.end) <= minutosDaHora(intervalo.start)
    ) {
      errosDeCampo.push({
        intervalo: indice,
        campo: "end",
        mensagem: "O fim precisa ser depois do início.",
      });
    }
  });

  if (errosDeCampo.length > 0) return { errosDeCampo, erroDoDia: null, intervals: [] };

  const ordenados = [...intervals].sort((a, b) => minutosDaHora(a.start) - minutosDaHora(b.start));
  const normalizados: IntervaloReal[] = [];

  for (const intervalo of ordenados) {
    const anterior = normalizados[normalizados.length - 1];
    if (!anterior) {
      normalizados.push({ ...intervalo });
      continue;
    }
    const inicio = minutosDaHora(intervalo.start);
    const fimAnterior = minutosDaHora(anterior.end);

    if (inicio < fimAnterior) {
      return {
        errosDeCampo: [],
        erroDoDia: `Os intervalos ${anterior.start}-${anterior.end} e ${intervalo.start}-${intervalo.end} se sobrepõem.`,
        intervals: [],
      };
    }
    if (inicio === fimAnterior) {
      // Adjacente não é sobreposição: vira um período contínuo.
      anterior.end = intervalo.end;
      continue;
    }
    normalizados.push({ ...intervalo });
  }

  if (normalizados.length > MAXIMO_DE_INTERVALOS_POR_DIA) {
    return {
      errosDeCampo: [],
      erroDoDia: `São aceitos no máximo ${MAXIMO_DE_INTERVALOS_POR_DIA} intervalos por dia (um período de trabalho e uma pausa).`,
      intervals: [],
    };
  }

  return { errosDeCampo: [], erroDoDia: null, intervals: normalizados };
}

export type SemanaEditavel = Record<number, IntervaloReal[]>;

/** Semana vinda da API -> estado editável com os sete dias presentes (dia sem
 * atendimento fica com lista vazia). */
export function paraSemanaEditavel(days: readonly DiaDeTrabalhoReal[]): SemanaEditavel {
  const semana: SemanaEditavel = {};
  for (const { weekday } of DIAS_DA_SEMANA) semana[weekday] = [];
  for (const dia of days) {
    semana[dia.weekday] = dia.intervals.map((intervalo) => ({ ...intervalo }));
  }
  return semana;
}

export interface ValidacaoDaSemana {
  ok: boolean;
  /** Por dia da semana. */
  errosDeCampo: Record<number, ErroDeCampo[]>;
  erroDoDia: Record<number, string>;
  /** Pronto para o PUT: só os dias com atendimento. */
  days: DiaDeTrabalhoReal[];
}

export function validarSemana(semana: SemanaEditavel): ValidacaoDaSemana {
  const errosDeCampo: Record<number, ErroDeCampo[]> = {};
  const erroDoDia: Record<number, string> = {};
  const days: DiaDeTrabalhoReal[] = [];

  for (const { weekday } of DIAS_DA_SEMANA) {
    const intervals = semana[weekday] ?? [];
    if (intervals.length === 0) continue;

    const resultado = validarDia(intervals);
    if (resultado.errosDeCampo.length > 0) errosDeCampo[weekday] = resultado.errosDeCampo;
    if (resultado.erroDoDia) erroDoDia[weekday] = resultado.erroDoDia;
    if (resultado.intervals.length > 0) days.push({ weekday, intervals: resultado.intervals });
  }

  const ok = Object.keys(errosDeCampo).length === 0 && Object.keys(erroDoDia).length === 0;
  return { ok, errosDeCampo, erroDoDia, days: ok ? days : [] };
}
