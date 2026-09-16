// Conversão entre hora LOCAL do estabelecimento e instante absoluto (Lote
// 6D.4) — funções puras, sem Nest, sem banco e sem relógio do processo.
//
// POR QUE `Intl` E NENHUMA DEPENDÊNCIA NOVA: o backend não tem biblioteca de
// data (ver backend/package.json) e o Node desta versão já embarca ICU com a
// base IANA completa. `Intl.DateTimeFormat` com `timeZone` conhece as regras
// históricas e futuras de cada fuso, inclusive as viradas de horário de
// verão. Trazer `date-fns-tz`/`luxon` só para isto acrescentaria dependência
// e superfície de atualização sem nenhum ganho de correção — o que essas
// bibliotecas fazem por baixo é exatamente o que está aqui.
//
// O QUE NÃO É IMPROVISADO: o deslocamento NUNCA é adivinhado por aritmética
// de `getTimezoneOffset()` do servidor nem por tabela própria. Ele é sempre
// perguntado ao ICU para um INSTANTE concreto, e a resolução de uma hora
// local usa o algoritmo de dois palpites (abaixo), que é o que torna
// possível distinguir hora inexistente de hora repetida.

/** Erro de fuso: o `timezone` gravado no estabelecimento não é um fuso IANA
 * válido. Nunca cair num fuso padrão inventado — isso deslocaria a agenda
 * inteira em silêncio. */
export class ErroDeFuso extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErroDeFuso';
  }
}

const FORMATADORES = new Map<string, Intl.DateTimeFormat>();

function formatador(timeZone: string): Intl.DateTimeFormat {
  const existente = FORMATADORES.get(timeZone);
  if (existente) return existente;

  let criado: Intl.DateTimeFormat;
  try {
    criado = new Intl.DateTimeFormat('en-US', {
      timeZone,
      // `hourCycle: 'h23'` (e nunca `hour12: false` sozinho) garante
      // meia-noite como `00`, não `24`.
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    throw new ErroDeFuso(`Fuso horário inválido: ${timeZone}.`);
  }

  FORMATADORES.set(timeZone, criado);
  return criado;
}

export interface PartesLocais {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Como o relógio de parede daquele fuso mostra este instante. */
export function partesLocais(instante: Date, timeZone: string): PartesLocais {
  const partes = formatador(timeZone).formatToParts(instante);
  const numero = (tipo: Intl.DateTimeFormatPartTypes): number => {
    const parte = partes.find((p) => p.type === tipo);
    if (!parte) throw new ErroDeFuso(`Fuso ${timeZone} não devolveu a parte "${tipo}".`);
    return Number(parte.value);
  };

  return {
    year: numero('year'),
    month: numero('month'),
    day: numero('day'),
    hour: numero('hour'),
    minute: numero('minute'),
    second: numero('second'),
  };
}

/** Milissegundos do instante representado por estas partes, lidas como se
 * fossem UTC. Só faz sentido combinado com `deslocamentoEmMinutos`. */
function comoUtc(partes: PartesLocais): number {
  return Date.UTC(
    partes.year,
    partes.month - 1,
    partes.day,
    partes.hour,
    partes.minute,
    partes.second,
  );
}

/**
 * Deslocamento do fuso, em minutos, VIGENTE NAQUELE INSTANTE (positivo a
 * leste de Greenwich). Ex.: `-180` para America/Sao_Paulo.
 *
 * É calculado perguntando ao ICU como o relógio local mostra o instante e
 * comparando com o próprio instante — por isso vale para qualquer data
 * passada ou futura, com ou sem horário de verão.
 */
export function deslocamentoEmMinutos(instante: Date, timeZone: string): number {
  // Segundos inteiros dos dois lados: `Date.UTC` não tem milissegundo, e um
  // instante com ms geraria um deslocamento fracionário falso.
  const instanteEmSegundos = Math.floor(instante.getTime() / 1000) * 1000;
  return (comoUtc(partesLocais(instante, timeZone)) - instanteEmSegundos) / 60_000;
}

/** `-180` -> `"-03:00"`. Rótulo estável para a resposta e para a tela
 * distinguirem dois instantes com a MESMA hora local. */
export function rotuloDeDeslocamento(minutos: number): string {
  const sinal = minutos < 0 ? '-' : '+';
  const absoluto = Math.abs(minutos);
  const horas = String(Math.floor(absoluto / 60)).padStart(2, '0');
  const restante = String(absoluto % 60).padStart(2, '0');
  return `${sinal}${horas}:${restante}`;
}

export interface DataLocal {
  year: number;
  month: number;
  day: number;
}

export interface ResolucaoDeHoraLocal {
  /**
   * - `normal` — existe exatamente um instante;
   * - `repetida` — o relógio local voltou e a mesma hora acontece DUAS vezes;
   * - `inexistente` — o relógio local pulou por cima dela.
   */
  tipo: 'normal' | 'repetida' | 'inexistente';
  /** Instantes VÁLIDOS, em ordem crescente: 0 (inexistente), 1 ou 2. */
  instantes: Date[];
  /**
   * Só quando `inexistente`: o instante que o relógio local passou a mostrar
   * no lugar da hora pedida (a hora pedida + o tamanho do salto). É um
   * instante REAL — nunca um instante inválido —, oferecido para quem
   * precisa de uma fronteira de jornada mesmo assim.
   */
  aposLacuna: Date | null;
}

/**
 * Resolve uma hora de relógio local em instante(s) absoluto(s).
 *
 * ALGORITMO: a hora local pedida é lida como se fosse UTC e corrigida por
 * CADA deslocamento plausível; cada candidato é conferido de volta (só entra
 * quem realmente mostra aquela hora local naquele fuso).
 *
 * Os deslocamentos plausíveis são os vigentes 24h antes, no próprio instante
 * e 24h depois. Sondar os dois lados é o que importa: em volta de uma virada
 * existem DOIS deslocamentos, e perguntar só pelo instante-alvo acharia
 * apenas um deles — a hora repetida passaria por hora comum.
 *
 * Numa lacuna, todos os candidatos falham a conferência: o MAIOR deles é
 * exatamente a hora pedida deslocada para a frente pelo tamanho do salto
 * (02:30 inexistente vira 03:30), e é ele que sai em `aposLacuna`.
 */
export function resolverHoraLocal(
  data: DataLocal,
  hora: number,
  minuto: number,
  timeZone: string,
): ResolucaoDeHoraLocal {
  const alvoComoUtc = comoUtc({ ...data, hour: hora, minute: minuto, second: 0 });

  const validos: Date[] = [];
  const invalidos: Date[] = [];
  const avaliar = (deslocamento: number): void => {
    const candidato = new Date(alvoComoUtc - deslocamento * 60_000);
    const lista =
      comoUtc(partesLocais(candidato, timeZone)) === alvoComoUtc ? validos : invalidos;
    if (lista.some((j) => j.getTime() === candidato.getTime())) return;
    lista.push(candidato);
  };

  const UM_DIA_MS = 86_400_000;
  const deslocamentosPlausiveis = new Set(
    [alvoComoUtc - UM_DIA_MS, alvoComoUtc, alvoComoUtc + UM_DIA_MS].map((sonda) =>
      deslocamentoEmMinutos(new Date(sonda), timeZone),
    ),
  );
  for (const deslocamento of deslocamentosPlausiveis) avaliar(deslocamento);

  validos.sort((a, b) => a.getTime() - b.getTime());

  if (validos.length === 0) {
    const aposLacuna = invalidos.reduce<Date | null>(
      (maior, atual) => (maior && maior.getTime() >= atual.getTime() ? maior : atual),
      null,
    );
    return { tipo: 'inexistente', instantes: [], aposLacuna };
  }

  return {
    tipo: validos.length > 1 ? 'repetida' : 'normal',
    instantes: validos,
    aposLacuna: null,
  };
}

/** Só os instantes válidos da hora local — `[]` quando ela não existe. */
export function instantesDaHoraLocal(
  data: DataLocal,
  hora: number,
  minuto: number,
  timeZone: string,
): Date[] {
  return resolverHoraLocal(data, hora, minuto, timeZone).instantes;
}

/** `"HH:MM"` daquele instante naquele fuso — a hora que a pessoa vê no
 * relógio, nunca a do servidor. */
export function horaLocalDe(instante: Date, timeZone: string): string {
  const { hour, minute } = partesLocais(instante, timeZone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** `"YYYY-MM-DD"` daquele instante naquele fuso. */
export function dataLocalDe(instante: Date, timeZone: string): string {
  const { year, month, day } = partesLocais(instante, timeZone);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Dia da semana (0 = domingo) de uma data de CALENDÁRIO — aritmética pura,
 * sem fuso nenhum envolvido: 2026-09-20 é domingo em qualquer lugar. */
export function diaDaSemanaDe(data: DataLocal): number {
  return new Date(Date.UTC(data.year, data.month - 1, data.day)).getUTCDay();
}

/** Dias inteiros de diferença entre duas datas de calendário (b - a). */
export function diasEntre(a: DataLocal, b: DataLocal): number {
  const diaEmMs = 86_400_000;
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / diaEmMs,
  );
}

/** Maior deslocamento existente na base IANA (Kiribati, +14). Usado só para
 * folgar a janela de carregamento de conflitos — nunca para converter hora. */
const FOLGA_DE_FUSO_MS = 14 * 60 * 60_000;

/**
 * Janela de instantes que com CERTEZA contém o dia local inteiro.
 *
 * É de propósito um SUPERCONJUNTO (folga de 14h de cada lado): serve só para
 * o `WHERE` que carrega conflitos do banco, onde trazer alguns registros a
 * mais é inofensivo e trazer de menos seria um horário oferecido em cima de
 * um agendamento existente. O recorte exato é feito depois, comparando
 * instante a instante — e é por isso que nenhuma suposição de "todo dia tem
 * 24 horas" é necessária aqui.
 */
export function janelaDeCarregamento(data: DataLocal): { inicio: Date; fim: Date } {
  const meiaNoite = Date.UTC(data.year, data.month - 1, data.day);
  return {
    inicio: new Date(meiaNoite - FOLGA_DE_FUSO_MS),
    fim: new Date(meiaNoite + 86_400_000 + FOLGA_DE_FUSO_MS),
  };
}
