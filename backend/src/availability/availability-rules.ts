// Cálculo de horários disponíveis (Lote 6D.4) — função PURA: recebe os dados
// já carregados e devolve os horários. Não conhece Nest, banco, sessão nem o
// relógio do processo (o "agora" é sempre injetado). É por isso que os casos
// difíceis — virada de horário de verão, conflito que começa no dia anterior,
// jornada ausente — são testáveis sem subir nada.
//
// ESTE LOTE NÃO RESERVA NADA. O resultado é uma fotografia: entre a consulta
// e uma gravação futura, outro agendamento pode ocupar o mesmo horário. Quem
// garante a exclusividade é a constraint `appointments_no_overlap_excl` no
// banco, no momento da gravação — que não existe neste lote.
//
// ---------------------------------------------------------------------------
// REGRAS ADOTADAS E DE ONDE VÊM
//
// 1. DURAÇÃO — `services.duration_minutes`, coluna real e obrigatória. Não
//    existe duração por profissional no schema (`professional_services` só
//    tem o vínculo), então nenhuma é inventada.
//
// 2. BUFFER — `services.buffer_after_minutes` (coluna real, NOT NULL DEFAULT
//    0) do serviço CONSULTADO: o atendimento simulado ocupa
//    `[início, início + duração + buffer)`. Nenhum buffer é somado depois de
//    agendamentos JÁ EXISTENTES: não há coluna de buffer congelado em
//    `appointment_items`, e usar o buffer atual do catálogo reescreveria a
//    ocupação histórica de uma reserva antiga.
//    `booking_policies.default_buffer_minutes` NÃO é usado: a coluna do
//    serviço é NOT NULL com default 0, então é impossível distinguir "não
//    configurado" de "configurado como zero" — aplicar o padrão do
//    estabelecimento por cima seria mudar, sem pedido, o significado do zero.
//
// 3. ESPAÇAMENTO ENTRE INÍCIOS — não existe no schema nenhuma coluna de
//    "passo da grade". Regra PROPOSTA E ADOTADA por este lote: grade de 15
//    minutos ANCORADA NO INÍCIO DE CADA INTERVALO de trabalho (não na
//    meia-noite), de modo que uma jornada que começa 09:10 ofereça 09:10,
//    09:25, ... É deliberadamente diferente da duração do atendimento: um
//    serviço de 40 minutos continua podendo começar de 15 em 15.
//
// 4. FIM EXCLUÍDO — toda janela é `[início, fim)`. Um atendimento que termina
//    às 10:00 permite outro começar às 10:00; só um buffer explícito separa.
//
// 5. ESTADOS QUE OCUPAM — `PENDING | CONFIRMED | IN_PROGRESS | COMPLETED`.
//    `CANCELED | NO_SHOW` liberam (ver appointment-status.enum.ts e a
//    constraint anti-sobreposição, que também ignora `CANCELED`). A ocupação
//    é `[start_at, end_at)` PERSISTIDO, nunca recalculado pela duração atual
//    do catálogo.
//
// 6. BLOQUEIOS — `time_blocks` ocupa integralmente. A tabela não tem coluna
//    de ativação: bloqueio existente sempre bloqueia. Não existe no schema
//    tabela de férias, feriados ou exceção de agenda — nenhuma é simulada.
//
// 7. ANTECEDÊNCIA E LIMITE FUTURO — `booking_policies.min_lead_minutes` e
//    `max_future_days`, QUANDO a linha existir. O auto-cadastro atual não
//    cria essa linha, e este lote não inventa valor comercial nenhum: sem
//    política, não há antecedência mínima nem limite futuro. O corte de
//    horário JÁ PASSADO é independente disso e sempre vale.
import {
  deslocamentoEmMinutos,
  diaDaSemanaDe,
  diasEntre,
  horaLocalDe,
  partesLocais,
  resolverHoraLocal,
  rotuloDeDeslocamento,
  type DataLocal,
} from './time-zone.js';

/** Regra proposta por este lote (ver item 3 do cabeçalho). */
export const PASSO_PADRAO_MINUTOS = 15;

export interface IntervaloDeTrabalho {
  /** `"HH:MM"` local do estabelecimento. */
  start: string;
  end: string;
}

export interface JanelaOcupada {
  inicio: Date;
  fim: Date;
  /** Só para depuração/teste: o que gerou a ocupação. Nunca vai na resposta
   * da API — identidade de cliente jamais sai daqui. */
  origem: 'agendamento' | 'bloqueio';
}

export interface HorarioDisponivel {
  startAt: Date;
  /** Fim do ATENDIMENTO (início + duração). O buffer não entra aqui: ele é
   * espaçamento interno, não parte do que o cliente ocupa na cadeira. */
  endAt: Date;
  /** `"HH:MM"` local do estabelecimento. */
  localStart: string;
  localEnd: string;
  /** Deslocamento vigente naquele instante — é o que distingue dois horários
   * com a mesma hora local no dia em que o relógio volta. */
  offsetMinutes: number;
  offsetLabel: string;
}

/**
 * Por que a lista veio vazia. Nunca é `null` junto de lista vazia: "não tem
 * horário" precisa ser distinguível de falha, e cada motivo abaixo é uma
 * resposta legítima do domínio — erro de banco NUNCA chega aqui, ele sobe
 * como exceção.
 */
export type MotivoSemHorario =
  /** Nenhum intervalo de trabalho configurado (ou dia inativo) nesse dia. */
  | 'sem_jornada'
  /** A data pedida está além do limite futuro da política do estabelecimento. */
  | 'fora_da_janela_futura'
  /** Há jornada, mas tudo está ocupado, bloqueado, no passado ou curto demais. */
  | 'sem_horario_livre';

export interface EntradaDeCalculo {
  /** Data de calendário pedida, no fuso do estabelecimento. */
  data: DataLocal;
  timeZone: string;
  /** Intervalos de trabalho do dia pedido, em hora local. Lista vazia = não
   * atende — nunca "atende sem restrição". */
  intervalos: readonly IntervaloDeTrabalho[];
  duracaoMinutos: number;
  bufferMinutos: number;
  passoMinutos?: number;
  ocupados: readonly JanelaOcupada[];
  /** Relógio injetado — nenhuma função aqui chama `new Date()`. */
  agora: Date;
  /** `0` quando não há política de agendamento gravada. */
  antecedenciaMinimaMinutos: number;
  /** `null` = sem política gravada, portanto sem limite futuro. */
  limiteDiasFuturos: number | null;
}

export interface ResultadoDeCalculo {
  slots: HorarioDisponivel[];
  motivo: MotivoSemHorario | null;
}

function seSobrepoem(inicioA: Date, fimA: Date, inicioB: Date, fimB: Date): boolean {
  // Meia-aberto dos dois lados: encostar não é sobrepor.
  return inicioA.getTime() < fimB.getTime() && inicioB.getTime() < fimA.getTime();
}

function minutosDaHora(valor: string): { hora: number; minuto: number } {
  const [hora, minuto] = valor.split(':');
  return { hora: Number(hora), minuto: Number(minuto) };
}

/**
 * Fronteira de jornada em instante absoluto, com política EXPLÍCITA para os
 * dois casos de virada de fuso:
 *
 * - hora REPETIDA: o início usa a PRIMEIRA ocorrência e o fim a ÚLTIMA, para
 *   a jornada cobrir tudo o que o profissional entende como seu dia. Os
 *   horários gerados dentro dela continuam distinguíveis, porque cada um
 *   carrega instante e deslocamento;
 * - hora INEXISTENTE: usa o instante da virada (a hora pedida deslocada para
 *   a frente pelo salto). Assim a jornada não some nem gera instante
 *   inválido — ela apenas começa/termina quando o relógio local voltou a
 *   existir.
 */
function fronteira(
  data: DataLocal,
  valor: string,
  timeZone: string,
  extremo: 'inicio' | 'fim',
): Date | null {
  const { hora, minuto } = minutosDaHora(valor);
  const resolucao = resolverHoraLocal(data, hora, minuto, timeZone);

  if (resolucao.tipo === 'inexistente') return resolucao.aposLacuna;
  return extremo === 'inicio'
    ? resolucao.instantes[0]
    : resolucao.instantes[resolucao.instantes.length - 1];
}

/**
 * Horários em que o atendimento INTEIRO cabe num intervalo permitido, sem
 * atravessar a pausa (cada intervalo é avaliado sozinho, então a pausa entre
 * eles é intransponível por construção) e sem conflitar com nada.
 *
 * A grade avança em tempo ABSOLUTO a partir do início do intervalo. Isso é o
 * que mantém o cálculo correto numa virada de fuso: nenhum instante
 * inexistente é gerado, e o dia em que o relógio volta produz naturalmente
 * dois horários com a mesma hora local — e instantes diferentes.
 */
export function calcularHorariosDisponiveis(entrada: EntradaDeCalculo): ResultadoDeCalculo {
  const passo = entrada.passoMinutos ?? PASSO_PADRAO_MINUTOS;

  if (entrada.intervalos.length === 0) {
    return { slots: [], motivo: 'sem_jornada' };
  }

  if (entrada.limiteDiasFuturos !== null) {
    const hoje = diaLocalDoInstante(entrada.agora, entrada.timeZone);
    if (diasEntre(hoje, entrada.data) > entrada.limiteDiasFuturos) {
      return { slots: [], motivo: 'fora_da_janela_futura' };
    }
  }

  const ocupacaoMs = (entrada.duracaoMinutos + entrada.bufferMinutos) * 60_000;
  const atendimentoMs = entrada.duracaoMinutos * 60_000;
  const inicioMinimo = new Date(
    entrada.agora.getTime() + entrada.antecedenciaMinimaMinutos * 60_000,
  );

  const encontrados = new Map<number, HorarioDisponivel>();

  for (const intervalo of entrada.intervalos) {
    const inicio = fronteira(entrada.data, intervalo.start, entrada.timeZone, 'inicio');
    const fim = fronteira(entrada.data, intervalo.end, entrada.timeZone, 'fim');
    // Intervalo que a virada de fuso reduziu a nada (ou menos que nada) não
    // gera horário nenhum — e nunca gera horário invertido.
    if (!inicio || !fim || fim.getTime() <= inicio.getTime()) continue;

    for (
      let candidato = inicio.getTime();
      candidato + ocupacaoMs <= fim.getTime();
      candidato += passo * 60_000
    ) {
      const startAt = new Date(candidato);
      if (startAt.getTime() < inicioMinimo.getTime()) continue;

      const fimDaOcupacao = new Date(candidato + ocupacaoMs);
      const conflita = entrada.ocupados.some((ocupado) =>
        seSobrepoem(startAt, fimDaOcupacao, ocupado.inicio, ocupado.fim),
      );
      if (conflita) continue;

      if (encontrados.has(candidato)) continue;
      const deslocamento = deslocamentoEmMinutos(startAt, entrada.timeZone);
      const endAt = new Date(candidato + atendimentoMs);
      encontrados.set(candidato, {
        startAt,
        endAt,
        localStart: horaLocalDe(startAt, entrada.timeZone),
        localEnd: horaLocalDe(endAt, entrada.timeZone),
        offsetMinutes: deslocamento,
        offsetLabel: rotuloDeDeslocamento(deslocamento),
      });
    }
  }

  const slots = [...encontrados.values()].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  );
  return { slots, motivo: slots.length === 0 ? 'sem_horario_livre' : null };
}

/** Data de calendário de um instante, no fuso do estabelecimento — é assim
 * que "hoje" é decidido, nunca pelo relógio do servidor. */
export function diaLocalDoInstante(instante: Date, timeZone: string): DataLocal {
  const { year, month, day } = partesLocais(instante, timeZone);
  return { year, month, day };
}

/** Dia da semana (0 = domingo) da data pedida — reexportado para o serviço
 * escolher a linha de `professional_schedules` sem reimplementar a conta. */
export { diaDaSemanaDe };
