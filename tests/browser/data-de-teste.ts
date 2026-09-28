// Data de calendário usada pelos fluxos de agenda no navegador — DERIVADA do
// relógio a cada execução, nunca fixada no código.
//
// POR QUE ISTO EXISTE: os specs de disponibilidade e de agendamentos fixavam
// `DATA = "2026-09-20"` com o comentário "domingo, bem no futuro". A data
// passou, e a partir daí o motor de disponibilidade passou a fazer exatamente
// o que deve fazer: cortar todo horário já vencido (ver
// `calcularHorariosDisponiveis`, corte por `inicioMinimo`). A consulta
// respondia lista vazia com `emptyReason: "sem_horario_livre"` e os dois
// specs falhavam por dado de teste apodrecido, não por regressão da
// aplicação. Derivar a data elimina a classe inteira de falha, em vez de
// empurrar o prazo de validade para frente.
//
// O fuso é o do ESTABELECIMENTO (`tenants.timezone`, `America/Sao_Paulo` no
// auto-cadastro), o MESMO em que o backend resolve a jornada semanal e devolve
// `localStart`/`localEnd`. Nunca o do runner: uma máquina em outro fuso pode
// estar em outro dia do calendário, e aí a jornada gravada para o dia da
// semana X não cobriria a data consultada.
//
// Nenhuma asserção fica mais fraca por causa disto: os specs continuam
// exigindo a grade completa de horários, a hora local exata e os instantes
// UTC exatos — só param de depender de uma data que envelhece.

const TIMEZONE_DO_TENANT = "America/Sao_Paulo";

/** Dia da semana da jornada configurada pelos specs: domingo. */
const DOMINGO = 0;

/**
 * Folga mínima entre hoje e a data escolhida. Não é "esperar por esperar": a
 * data precisa estar inteiramente no futuro no fuso do estabelecimento mesmo
 * que a suíte rode perto da virada do dia, senão o corte de horário já
 * passado voltaria a esvaziar a lista — exatamente a falha que esta função
 * existe para impedir.
 */
const DIAS_DE_FOLGA = 7;

const UM_DIA_MS = 86_400_000;

const FORMATADOR = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE_DO_TENANT,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface PartesLocais {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Hora de parede no fuso do estabelecimento, sem depender do fuso do runner. */
function partesLocais(instante: Date): PartesLocais {
  const encontradas: Record<string, number> = {};
  for (const parte of FORMATADOR.formatToParts(instante)) {
    if (parte.type !== "literal") encontradas[parte.type] = Number(parte.value);
  }
  return {
    year: encontradas.year,
    month: encontradas.month,
    day: encontradas.day,
    // `hour12: false` pode formatar meia-noite como 24 em alguns ambientes.
    hour: encontradas.hour % 24,
    minute: encontradas.minute,
    second: encontradas.second,
  };
}

function comoDataIso({ year, month, day }: PartesLocais): string {
  const doisDigitos = (valor: number) => String(valor).padStart(2, "0");
  return `${year}-${doisDigitos(month)}-${doisDigitos(day)}`;
}

/** Dia da semana de uma data de CALENDÁRIO (0 = domingo) — independente de
 * fuso, porque a data já foi resolvida no fuso do estabelecimento. */
function diaDaSemanaDe({ year, month, day }: PartesLocais): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function partesDeDataIso(data: string): PartesLocais {
  const [year, month, day] = data.split("-").map(Number);
  return { year, month, day, hour: 0, minute: 0, second: 0 };
}

/**
 * Deslocamento do fuso do estabelecimento naquele instante, em minutos
 * (`-180` para UTC-3). Medido, nunca assumido: se o Brasil voltar a ter
 * horário de verão, `instanteLocalDe` corrige sozinho em vez de mirar a hora
 * errada silenciosamente.
 */
function deslocamentoEmMinutos(instante: Date): number {
  const partes = partesLocais(instante);
  const comoSeFosseUtc = Date.UTC(
    partes.year,
    partes.month - 1,
    partes.day,
    partes.hour,
    partes.minute,
    partes.second,
  );
  return (comoSeFosseUtc - instante.getTime()) / 60_000;
}

function proximoDomingoNoFusoDoTenant(agora: Date): string {
  const base = agora.getTime() + DIAS_DE_FOLGA * UM_DIA_MS;
  for (let adiante = 0; adiante < 7; adiante += 1) {
    const partes = partesLocais(new Date(base + adiante * UM_DIA_MS));
    if (diaDaSemanaDe(partes) === DOMINGO) return comoDataIso(partes);
  }
  // Inalcançável: sete dias consecutivos sempre contêm um domingo.
  throw new Error("nenhum domingo encontrado na janela de sete dias");
}

/**
 * Domingo no futuro, no fuso do estabelecimento. Substitui a constante fixa
 * que apodreceu: `WEEKDAY_DA_DATA` é DERIVADO dela logo abaixo, então data e
 * dia da semana não podem mais divergir.
 */
export const DATA = proximoDomingoNoFusoDoTenant(new Date());

/** Dia da semana de `DATA` (0 = domingo) — é o que os specs gravam em
 * `professional_schedules`. Derivado, nunca digitado à mão. */
export const WEEKDAY_DA_DATA = diaDaSemanaDe(partesDeDataIso(DATA));

/** Aritmética de CALENDÁRIO puro (nada de fuso): a data ancorada ao meio-dia
 * UTC, mais 24 h, lida de volta em UTC. Ancorar ao meio-dia é o que impede
 * que somar um dia escorregue para dois em qualquer deslocamento. */
function diaSeguinteDe(data: string): string {
  const { year, month, day } = partesDeDataIso(data);
  const seguinte = new Date(Date.UTC(year, month - 1, day, 12) + UM_DIA_MS);
  return comoDataIso({
    year: seguinte.getUTCFullYear(),
    month: seguinte.getUTCMonth() + 1,
    day: seguinte.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  });
}

/** O dia seguinte a `DATA`. Serve aos casos que precisam de OUTRA data para
 * provar que mudar a seleção invalida o resultado que está na tela. */
export const DATA_SEGUINTE = diaSeguinteDe(DATA);

/**
 * Instante UTC (ISO 8601, mesmo formato de `Date.prototype.toISOString`) da
 * hora de parede `"HH:MM"` do estabelecimento em `DATA`. É o que os specs
 * usam para falar com a API por instante (`startAt`) e para localizar um
 * horário na tela pelo `data-inicio` que o backend devolveu.
 *
 * Confere o resultado em vez de confiar na conta: se a hora local de volta
 * não for exatamente a pedida (virada de fuso, data inexistente), falha alto
 * em vez de mirar outro horário.
 */
export function instanteLocalDe(horaLocal: string): string {
  const [hora, minuto] = horaLocal.split(":").map(Number);
  const { year, month, day } = partesDeDataIso(DATA);
  const comoSeFosseUtc = Date.UTC(year, month - 1, day, hora, minuto);

  // Duas passadas: a primeira usa o deslocamento medido no instante ingênuo,
  // a segunda o remede já no instante corrigido — é o que acerta o caso em
  // que a própria virada de fuso acontece entre os dois.
  let instante = new Date(comoSeFosseUtc - deslocamentoEmMinutos(new Date(comoSeFosseUtc)) * 60_000);
  instante = new Date(comoSeFosseUtc - deslocamentoEmMinutos(instante) * 60_000);

  const conferido = partesLocais(instante);
  if (
    comoDataIso(conferido) !== DATA ||
    conferido.hour !== hora ||
    conferido.minute !== minuto
  ) {
    throw new Error(
      `hora local ${horaLocal} de ${DATA} não existe em ${TIMEZONE_DO_TENANT} ` +
        `(resolveu para ${comoDataIso(conferido)} ${conferido.hour}:${conferido.minute})`,
    );
  }
  return instante.toISOString();
}
