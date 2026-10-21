// Política de QUANDO cada mensagem automática deve sair — função pura, sem
// banco e sem relógio implícito (`agora` é sempre parâmetro).
//
// Regras (ver docs/plans/agendamento-publico-e-notificacoes.md, Lote E):
//
//  - CONFIRMAÇÃO: sai assim que a reserva passa a CONFIRMED — na criação que
//    já nasce confirmada ou na ação "confirmar". Uma por reserva (a chave de
//    deduplicação não inclui o horário).
//
//  - LEMBRETE DA VÉSPERA: às 09:00 do dia ANTERIOR, no fuso do
//    estabelecimento. "Véspera" é a data de CALENDÁRIO local menos um dia —
//    nunca "início menos 24 horas" (numa virada de horário de verão as duas
//    contas discordam, e um atendimento às 00:30 tem véspera no dia anterior
//    mesmo estando a 30 minutos dele). Não é programado quando a reserva
//    ficou confirmada na própria véspera ou no dia do atendimento: quem
//    acabou de combinar não precisa de "lembrete de amanhã".
//
//  - LEMBRETE PRÓXIMO: 2 horas antes do início. Se esse instante já passou
//    no momento de programar, não é programado — nunca sai um lembrete
//    atrasado colado na confirmação.
//
// O "momento de referência" é `agora` de quem programa: a criação já
// confirmada, a confirmação ou a remarcação. Na remarcação a confirmação não
// é repetida (ver `planejarNotificacoes`, opção `incluirConfirmacao`).
//
// Cada tarefa tem um PRAZO (`prazo`): depois dele, o executor não envia. Um
// executor parado por horas (serviço hibernado) não pode mandar "seu
// atendimento é amanhã" à noite, nem "daqui a 2 horas" depois do horário.
import {
  diasEntre,
  partesLocais,
  resolverHoraLocal,
  type DataLocal,
} from '../availability/time-zone.js';

export const TIPOS_DE_NOTIFICACAO = ['CONFIRMATION', 'REMINDER_DAY_BEFORE', 'REMINDER_2H'] as const;
export type TipoDeNotificacao = (typeof TIPOS_DE_NOTIFICACAO)[number];

/** Hora local do lembrete da véspera. */
export const HORA_DO_LEMBRETE_DA_VESPERA = { hora: 9, minuto: 0 } as const;
/** Antecedência do lembrete próximo. */
export const ANTECEDENCIA_DO_LEMBRETE_PROXIMO_MIN = 120;
/** Atraso máximo tolerado para o lembrete da véspera (até 15:00 locais). */
export const ATRASO_MAXIMO_DA_VESPERA_MIN = 360;
/** O lembrete próximo vale até 30 min antes do início. */
export const FOLGA_FINAL_DO_LEMBRETE_PROXIMO_MIN = 30;

const MINUTO_MS = 60_000;

export interface TarefaPlanejada {
  tipo: TipoDeNotificacao;
  programadaPara: Date;
  /** Depois disto, a mensagem não é mais enviada. */
  prazo: Date;
}

export interface EntradaDoPlanejamento {
  /** Início VIGENTE da reserva. */
  inicio: Date;
  /** Fuso do estabelecimento (`tenants.timezone`). */
  timezone: string;
  /** Momento em que a reserva ficou confirmada ou foi remarcada. */
  agora: Date;
  /** `false` na remarcação: o novo horário já foi combinado com o cliente. */
  incluirConfirmacao: boolean;
}

function dataLocal(instante: Date, timezone: string): DataLocal {
  const { year, month, day } = partesLocais(instante, timezone);
  return { year, month, day };
}

function diaAnterior(data: DataLocal): DataLocal {
  const d = new Date(Date.UTC(data.year, data.month - 1, data.day - 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * 09:00 locais da véspera como instante. Hora repetida (relógio voltou): a
 * primeira ocorrência. Hora inexistente (relógio pulou): o primeiro instante
 * válido depois do salto.
 */
export function instanteDoLembreteDaVespera(inicio: Date, timezone: string): Date {
  const vespera = diaAnterior(dataLocal(inicio, timezone));
  const resolucao = resolverHoraLocal(
    vespera,
    HORA_DO_LEMBRETE_DA_VESPERA.hora,
    HORA_DO_LEMBRETE_DA_VESPERA.minuto,
    timezone,
  );
  return resolucao.instantes[0] ?? (resolucao.aposLacuna as Date);
}

const menor = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);

export function planejarNotificacoes(entrada: EntradaDoPlanejamento): TarefaPlanejada[] {
  const { inicio, timezone, agora, incluirConfirmacao } = entrada;
  // Reserva que já começou não recebe nada.
  if (inicio.getTime() <= agora.getTime()) return [];

  const tarefas: TarefaPlanejada[] = [];

  if (incluirConfirmacao) {
    tarefas.push({ tipo: 'CONFIRMATION', programadaPara: agora, prazo: inicio });
  }

  // Véspera: só quando a confirmação/remarcação aconteceu ANTES da véspera
  // (pelo calendário local do estabelecimento).
  const diasAteOAtendimento = diasEntre(dataLocal(agora, timezone), dataLocal(inicio, timezone));
  if (diasAteOAtendimento >= 2) {
    const quando = instanteDoLembreteDaVespera(inicio, timezone);
    if (quando.getTime() > agora.getTime()) {
      tarefas.push({
        tipo: 'REMINDER_DAY_BEFORE',
        programadaPara: quando,
        prazo: menor(new Date(quando.getTime() + ATRASO_MAXIMO_DA_VESPERA_MIN * MINUTO_MS), inicio),
      });
    }
  }

  const proximo = new Date(inicio.getTime() - ANTECEDENCIA_DO_LEMBRETE_PROXIMO_MIN * MINUTO_MS);
  if (proximo.getTime() > agora.getTime()) {
    tarefas.push({
      tipo: 'REMINDER_2H',
      programadaPara: proximo,
      prazo: new Date(inicio.getTime() - FOLGA_FINAL_DO_LEMBRETE_PROXIMO_MIN * MINUTO_MS),
    });
  }

  return tarefas;
}

/**
 * Chave de deduplicação. A confirmação é uma por reserva; os lembretes são
 * um por reserva E por início — remarcar gera chaves novas, e voltar ao
 * horário anterior reaproveita a linha antiga (ver o repositório).
 */
export function chaveDeDeduplicacao(
  appointmentId: string,
  tipo: TipoDeNotificacao,
  inicio: Date,
): string {
  return tipo === 'CONFIRMATION'
    ? `${appointmentId}:${tipo}`
    : `${appointmentId}:${tipo}:${inicio.toISOString()}`;
}
