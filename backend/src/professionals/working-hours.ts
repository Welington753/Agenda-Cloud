// Regras puras dos horários semanais de trabalho (Lote 6D.3) — sem Nest, sem
// banco, para serem testáveis isoladas e nunca reimplementadas por controller
// nenhum (mesma disciplina de professional-access.ts).
//
// O QUE O MODELO REAL GUARDA (professional_schedules, já existente): uma
// linha por (tenant, profissional, weekday), com um par `startTime`/`endTime`
// e UMA pausa opcional (`lunchStart`/`lunchEnd`). Isso significa, na prática,
// no máximo DOIS intervalos por dia — manhã e tarde. Três ou mais exigiriam
// outra tabela; aqui a tentativa é recusada com mensagem explícita, nunca
// acomodada sobrecarregando coluna.
//
// HORA LOCAL RECORRENTE: `"HH:MM"` é sempre hora local do estabelecimento
// (ver `tenants.timezone`), nunca instante absoluto. Nada aqui converte fuso,
// aplica data ou usa o relógio do processo — comparações são feitas em
// minutos desde a meia-noite.
//
// A coluna é `VARCHAR` sem CHECK no banco, então o formato e a precisão são
// impostos AQUI: exatamente `HH:MM` 24h, com zero à esquerda, minuto a
// minuto. `"9:00"`, `"09:0"`, `"24:00"` e `"09:60"` são recusados.

/** Domingo = 0, igual à coluna `weekday` (ver professional-schedule.entity.ts). */
export const PRIMEIRO_DIA_DA_SEMANA = 0;
export const ULTIMO_DIA_DA_SEMANA = 6;

/** Limite estrutural do modelo: um par início/fim + uma pausa = 2 intervalos. */
export const MAXIMO_DE_INTERVALOS_POR_DIA = 2;

const FORMATO_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface Intervalo {
  start: string;
  end: string;
}

export interface DiaDeTrabalho {
  weekday: number;
  intervals: Intervalo[];
}

/** Erro de regra de horário, já com o dia em que aconteceu — o chamador
 * transforma em HTTP; esta camada nunca conhece Nest. */
export class ErroDeHorario extends Error {
  constructor(
    message: string,
    readonly weekday: number | null = null,
  ) {
    super(message);
    this.name = 'ErroDeHorario';
  }
}

export function ehHoraValida(valor: string): boolean {
  return FORMATO_HORA.test(valor);
}

/** Minutos desde a meia-noite. Só aceita `HH:MM` já validado. */
export function minutosDaHora(valor: string): number {
  if (!ehHoraValida(valor)) {
    throw new ErroDeHorario(`Hora inválida: use o formato HH:MM entre 00:00 e 23:59.`);
  }
  const [horas, minutos] = valor.split(':');
  return Number(horas) * 60 + Number(minutos);
}

const NOMES_DOS_DIAS = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
];

export function nomeDoDia(weekday: number): string {
  return NOMES_DOS_DIAS[weekday] ?? `dia ${weekday}`;
}

/**
 * Valida, ordena e normaliza os intervalos de UM dia.
 *
 * - `fim` maior que `início`, sempre. Um `fim` menor NUNCA é aceito como
 *   virada de dia — o modelo não tem como marcar isso, e aceitar em silêncio
 *   inventaria significado;
 * - ordenação determinística por horário de início;
 * - sobreposição é recusada; ADJACÊNCIA não é sobreposição: `09:00-12:00` e
 *   `12:00-18:00` viram um único `09:00-18:00`, porque é isso que o par
 *   início/fim sem pausa representa no modelo;
 * - depois de normalizar, no máximo dois intervalos (limite do modelo).
 */
export function normalizarDia(dia: DiaDeTrabalho): Intervalo[] {
  const ordenados = [...dia.intervals].sort(
    (a, b) => minutosDaHora(a.start) - minutosDaHora(b.start),
  );

  const normalizados: Intervalo[] = [];
  for (const intervalo of ordenados) {
    const inicio = minutosDaHora(intervalo.start);
    const fim = minutosDaHora(intervalo.end);

    if (fim <= inicio) {
      throw new ErroDeHorario(
        `Em ${nomeDoDia(dia.weekday)}, o fim (${intervalo.end}) precisa ser depois do início (${intervalo.start}).`,
        dia.weekday,
      );
    }

    const anterior = normalizados[normalizados.length - 1];
    if (!anterior) {
      normalizados.push({ ...intervalo });
      continue;
    }

    const fimAnterior = minutosDaHora(anterior.end);
    if (inicio < fimAnterior) {
      throw new ErroDeHorario(
        `Em ${nomeDoDia(dia.weekday)}, os intervalos ${anterior.start}-${anterior.end} e ${intervalo.start}-${intervalo.end} se sobrepõem.`,
        dia.weekday,
      );
    }
    if (inicio === fimAnterior) {
      // Adjacentes: um período contínuo, não dois com pausa de zero minuto.
      anterior.end = intervalo.end;
      continue;
    }
    normalizados.push({ ...intervalo });
  }

  if (normalizados.length > MAXIMO_DE_INTERVALOS_POR_DIA) {
    throw new ErroDeHorario(
      `Em ${nomeDoDia(dia.weekday)}: são aceitos no máximo ${MAXIMO_DE_INTERVALOS_POR_DIA} intervalos por dia (um período de trabalho e uma pausa).`,
      dia.weekday,
    );
  }

  return normalizados;
}

/**
 * Normaliza a semana inteira. Dia sem intervalo nenhum é dia SEM ATENDIMENTO
 * e simplesmente não aparece no resultado — ausência de linha é a
 * representação de "não atende" no modelo, nunca "atende sem restrição".
 */
export function normalizarSemana(dias: readonly DiaDeTrabalho[]): DiaDeTrabalho[] {
  const vistos = new Set<number>();
  const resultado: DiaDeTrabalho[] = [];

  for (const dia of dias) {
    if (!Number.isInteger(dia.weekday) || dia.weekday < PRIMEIRO_DIA_DA_SEMANA || dia.weekday > ULTIMO_DIA_DA_SEMANA) {
      throw new ErroDeHorario(`Dia da semana inválido: ${String(dia.weekday)}.`);
    }
    if (vistos.has(dia.weekday)) {
      throw new ErroDeHorario(`${nomeDoDia(dia.weekday)} aparece mais de uma vez no envio.`, dia.weekday);
    }
    vistos.add(dia.weekday);

    const intervals = normalizarDia(dia);
    if (intervals.length > 0) resultado.push({ weekday: dia.weekday, intervals });
  }

  return resultado.sort((a, b) => a.weekday - b.weekday);
}

/**
 * Colunas de `professional_schedules` que este lote grava.
 *
 * `lunchStart`/`lunchEnd` saem como `undefined` (e não `null`) porque a
 * entidade declara as duas como opcionais — e porque estas linhas são SEMPRE
 * inseridas do zero, nunca atualizadas (a gravação apaga a semana e insere de
 * novo). A armadilha documentada em `service.entity.ts` (um `undefined` faz o
 * TypeORM PULAR a coluna) só vale para UPDATE; num INSERT a coluna omitida
 * entra como NULL, que é exatamente "sem pausa".
 */
export interface ColunasDeHorario {
  startTime: string;
  endTime: string;
  lunchStart: string | undefined;
  lunchEnd: string | undefined;
}

/** Intervalos normalizados -> colunas. Dois intervalos viram início/fim com
 * a pausa entre eles; um intervalo vira início/fim sem pausa. */
export function paraColunas(intervals: readonly Intervalo[]): ColunasDeHorario {
  const primeiro = intervals[0];
  const segundo = intervals[1];

  if (!primeiro) {
    throw new ErroDeHorario('Dia sem intervalo não vira linha de horário.');
  }
  if (!segundo) {
    return {
      startTime: primeiro.start,
      endTime: primeiro.end,
      lunchStart: undefined,
      lunchEnd: undefined,
    };
  }
  return {
    startTime: primeiro.start,
    endTime: segundo.end,
    lunchStart: primeiro.end,
    lunchEnd: segundo.start,
  };
}

/**
 * Colunas -> intervalos, para leitura. NUNCA valida nem corrige: uma linha
 * gravada por outro caminho (ou um turno que atravesse a meia-noite, que este
 * lote não sabe representar) é devolvida como está, para a tela mostrar o que
 * existe de verdade. Quem recusa dado inválido é a GRAVAÇÃO, e ela nomeia o
 * dia — assim nada é perdido em silêncio.
 */
export function paraIntervalos(colunas: {
  startTime: string;
  endTime: string;
  lunchStart?: string | null;
  lunchEnd?: string | null;
}): Intervalo[] {
  const { startTime, endTime, lunchStart, lunchEnd } = colunas;
  if (lunchStart && lunchEnd) {
    return [
      { start: startTime, end: lunchStart },
      { start: lunchEnd, end: endTime },
    ];
  }
  return [{ start: startTime, end: endTime }];
}
