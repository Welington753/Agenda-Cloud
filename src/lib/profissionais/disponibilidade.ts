// Regras puras da tela de disponibilidade (Lote 6D.4) — sem React, sem
// fetch, sem relógio implícito (o "hoje" é sempre injetado). É aqui que ficam
// as redações e as decisões de apresentação, para nunca existirem duas
// versões da mesma frase e para tudo ser testável sem montar componente.
//
// O QUE ESTE MÓDULO NÃO FAZ: converter fuso. Os horários já chegam do backend
// com a hora local do estabelecimento (`localStart`/`localEnd`) e com o
// deslocamento vigente. Nada aqui usa o relógio do navegador para decidir que
// horas são — o navegador pode estar em outro fuso que o estabelecimento.
import type {
  DisponibilidadeReal,
  FalhaDisponibilidadeReal,
  HorarioReal,
  MotivoSemHorario,
} from "@/lib/api/availability-api";

export function mensagemFalhaDisponibilidade(falha: FalhaDisponibilidadeReal): string {
  switch (falha.tipo) {
    case "nao_autenticado":
      return "Sua sessão expirou. Entre novamente para continuar.";
    case "sem_acesso":
      return "Você não tem acesso a este estabelecimento.";
    case "sem_permissao":
      return "Você não tem permissão para consultar a agenda deste estabelecimento.";
    case "nao_consultavel":
      // A orientação certa depende do caso (serviço desativado, vínculo
      // ausente, duração inválida...) e quem sabe qual é o servidor.
      return falha.mensagem ?? "Não é possível consultar com estes dados. Revise a seleção.";
    case "falha_comunicacao":
      return "A conexão falhou antes de o servidor responder. Tente consultar de novo.";
    default:
      return "Não foi possível consultar agora. Tente novamente em instantes.";
  }
}

/**
 * Por que a lista veio vazia, em texto. Cada motivo tem uma AÇÃO diferente
 * por trás, então nunca são resumidos numa frase genérica do tipo "sem
 * horários".
 */
export function mensagemSemHorario(motivo: MotivoSemHorario): string {
  switch (motivo) {
    case "sem_jornada":
      return "Este profissional não atende neste dia. Configure os horários de trabalho para abrir a agenda.";
    case "fora_da_janela_futura":
      return "Esta data está além do limite de agendamento futuro do estabelecimento.";
    default:
      return "Não há horário livre neste dia: a agenda está ocupada, bloqueada ou o tempo restante é curto demais.";
  }
}

/** `YYYY-MM-DD` de uma data de CALENDÁRIO, montado com os componentes locais
 * — nunca por `toISOString()`, que converte para UTC e devolveria o dia
 * anterior em qualquer fuso a oeste de Greenwich. */
export function comoDataDeCalendario(data: Date): string {
  const ano = String(data.getFullYear()).padStart(4, "0");
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

/**
 * Data inicial do formulário: o "hoje" do NAVEGADOR.
 *
 * É uma aproximação declarada, não um descuido: o dia do estabelecimento pode
 * ser outro se os fusos diferirem. Serve só como ponto de partida editável —
 * quem decide o dia de verdade é a pessoa, e quem interpreta a data no fuso
 * do estabelecimento é sempre o servidor.
 */
export function dataInicial(agora: Date): string {
  return comoDataDeCalendario(agora);
}

/** `"2026-09-20"` em texto legível, com dia da semana. Aritmética em UTC de
 * propósito: é uma data de calendário, não um instante — lê-la no fuso do
 * navegador poderia exibir o dia anterior. */
export function rotuloDaData(data: string): string {
  const [ano, mes, dia] = data.split("-").map(Number);
  if (!ano || !mes || !dia) return data;
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(ano, mes - 1, dia)));
}

/** `30` -> `"30 min"`, `90` -> `"1 h 30 min"`. */
export function rotuloDeDuracao(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

/**
 * Horários com a MESMA hora local aparecem duas vezes no dia em que o relógio
 * volta. Marcar quais são ambíguos é o que permite a tela mostrar o
 * deslocamento só onde ele faz diferença, em vez de poluir todas as linhas.
 */
export function marcarAmbiguos(slots: readonly HorarioReal[]): (HorarioReal & { ambiguo: boolean })[] {
  const vezes = new Map<string, number>();
  for (const slot of slots) vezes.set(slot.localStart, (vezes.get(slot.localStart) ?? 0) + 1);
  return slots.map((slot) => ({ ...slot, ambiguo: (vezes.get(slot.localStart) ?? 0) > 1 }));
}

/**
 * Resumo das regras que o servidor DE FATO aplicou. Nada é inventado: o que
 * vier `null` (sem `booking_policies` gravada) simplesmente não é citado, em
 * vez de virar "0 minutos de antecedência", que afirmaria uma política que
 * não existe.
 */
export function regrasAplicadas(disponibilidade: DisponibilidadeReal): string[] {
  const regras = [
    `Duração do serviço: ${rotuloDeDuracao(disponibilidade.durationMinutes)}`,
    `Horários de ${disponibilidade.slotStepMinutes} em ${disponibilidade.slotStepMinutes} minutos`,
  ];

  if (disponibilidade.bufferAfterMinutes > 0) {
    regras.push(`Intervalo após o atendimento: ${rotuloDeDuracao(disponibilidade.bufferAfterMinutes)}`);
  }
  if (disponibilidade.minLeadMinutes !== null) {
    regras.push(`Antecedência mínima: ${rotuloDeDuracao(disponibilidade.minLeadMinutes)}`);
  }
  if (disponibilidade.maxFutureDays !== null) {
    regras.push(`Limite de agendamento futuro: ${disponibilidade.maxFutureDays} dias`);
  }
  return regras;
}
