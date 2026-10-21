// Regras puras da VISUALIZAÇÃO da agenda do dia — sem React, sem fetch, sem
// relógio implícito (`agora` é sempre parâmetro).
//
// Nada aqui decide regra de negócio: o que pode ser feito com cada reserva
// continua em andamento.ts (cópia de apresentação das regras do servidor), e
// os horários exibidos continuam sendo os `localStart`/`localServiceEnd`
// devolvidos pelo backend no fuso do estabelecimento.
import type { AgendamentoReal, FalhaAgendamentoReal } from "@/lib/api/appointments-api";
import type { ProfissionalReal } from "@/lib/api/professionals-api";
import { mensagemFalhaAgendamento } from "./agendamentos";

/** Valor do filtro que mostra a agenda de todos os profissionais. */
export const TODOS_OS_PROFISSIONAIS = "todos";

/**
 * "Hoje" (`YYYY-MM-DD`) no fuso do ESTABELECIMENTO, a partir de um instante.
 *
 * O navegador pode estar em outro fuso (ou com o relógio errado): por isso o
 * fuso é o que o backend devolveu com a agenda, nunca o do sistema. Fuso
 * inválido devolve `null` — quem chama mantém a data que já tinha em vez de
 * inventar uma.
 */
export function hojeNoFuso(timezone: string, agora: Date): string | null {
  try {
    const partes = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(agora);
    const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value;
    const ano = valor("year");
    const mes = valor("month");
    const dia = valor("day");
    return ano && mes && dia ? `${ano}-${mes}-${dia}` : null;
  } catch {
    return null;
  }
}

/** Soma `dias` a uma data de CALENDÁRIO (`YYYY-MM-DD`). Aritmética em UTC de
 * propósito: é um dia do calendário, não um instante, e assim a troca de
 * horário de verão nunca pula ou repete um dia. Data malformada volta igual. */
export function deslocarData(data: string, dias: number): string {
  const [ano, mes, dia] = data.split("-").map(Number);
  if (!ano || !mes || !dia) return data;
  const resultado = new Date(Date.UTC(ano, mes - 1, dia + dias));
  return resultado.toISOString().slice(0, 10);
}

/** Reservas em ordem cronológica pelo INSTANTE de início (UTC, inequívoco).
 * Não muta a lista recebida. Empate: a criada primeiro vem antes. */
export function ordenarPorHorario(agendamentos: readonly AgendamentoReal[]): AgendamentoReal[] {
  return [...agendamentos].sort(
    (a, b) =>
      Date.parse(a.startAt) - Date.parse(b.startAt) ||
      Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
}

/** Só as reservas do profissional escolhido (ou todas). */
export function filtrarPorProfissional(
  agendamentos: readonly AgendamentoReal[],
  professionalId: string,
): AgendamentoReal[] {
  if (professionalId === TODOS_OS_PROFISSIONAIS) return [...agendamentos];
  return agendamentos.filter((a) => a.professional.id === professionalId);
}

export interface OpcaoDeProfissional {
  id: string;
  nome: string;
}

/**
 * Opções do filtro: os profissionais cadastrados (inativos marcados, porque
 * ainda podem ter reservas no dia) mais quem aparece na agenda e não veio na
 * lista — por exemplo, se a lista de profissionais falhou ao carregar. Ordem
 * alfabética, para a pessoa achar o nome sem procurar.
 */
export function opcoesDeProfissional(
  profissionais: readonly ProfissionalReal[],
  agendamentos: readonly AgendamentoReal[],
): OpcaoDeProfissional[] {
  const porId = new Map<string, OpcaoDeProfissional>();
  for (const p of profissionais) {
    porId.set(p.id, { id: p.id, nome: p.active ? p.name : `${p.name} (inativo)` });
  }
  for (const a of agendamentos) {
    if (!porId.has(a.professional.id)) {
      porId.set(a.professional.id, { id: a.professional.id, nome: a.professional.name });
    }
  }
  return [...porId.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

const STATUS_ENCERRADOS: ReadonlySet<AgendamentoReal["status"]> = new Set([
  "COMPLETED",
  "CANCELED",
  "NO_SHOW",
]);

/**
 * A reserva está no horário AGORA (entre o início e o fim do atendimento) e
 * ainda não foi encerrada? Serve só para destacar a linha — o relógio é o do
 * navegador e pode estar errado, então nunca decide ação nenhuma.
 */
export function estaNoHorario(agendamento: AgendamentoReal, agora: Date): boolean {
  if (STATUS_ENCERRADOS.has(agendamento.status)) return false;
  const instante = agora.getTime();
  return (
    Date.parse(agendamento.startAt) <= instante && instante < Date.parse(agendamento.serviceEndAt)
  );
}

export interface ResumoDoDia {
  /** Reservas que ainda contam no dia: tudo menos canceladas. */
  atendimentos: number;
  emAtendimento: number;
  canceladas: number;
}

export function resumoDoDia(agendamentos: readonly AgendamentoReal[]): ResumoDoDia {
  let canceladas = 0;
  let emAtendimento = 0;
  for (const a of agendamentos) {
    if (a.status === "CANCELED") canceladas += 1;
    if (a.status === "IN_PROGRESS") emAtendimento += 1;
  }
  return { atendimentos: agendamentos.length - canceladas, emAtendimento, canceladas };
}

/** `"3 atendimentos · 1 em atendimento · 1 cancelado"` — partes zeradas somem,
 * menos a contagem principal. */
export function rotuloDoResumo(resumo: ResumoDoDia): string {
  const partes = [
    resumo.atendimentos === 1 ? "1 atendimento" : `${resumo.atendimentos} atendimentos`,
  ];
  if (resumo.emAtendimento > 0) partes.push(`${resumo.emAtendimento} em atendimento`);
  if (resumo.canceladas > 0) {
    partes.push(resumo.canceladas === 1 ? "1 cancelado" : `${resumo.canceladas} cancelados`);
  }
  return partes.join(" · ");
}

/**
 * Falha ao CARREGAR a agenda do dia. Não reaproveita a frase da criação para
 * falha de comunicação ("a reserva pode ter sido criada"), que não faz sentido
 * numa leitura; nem a de permissão, que fala em "agendar".
 */
export function mensagemFalhaAgenda(falha: FalhaAgendamentoReal): string {
  if (falha.tipo === "falha_comunicacao") {
    return "Não foi possível carregar a agenda: a conexão falhou. Confira a internet e tente novamente.";
  }
  if (falha.tipo === "sem_permissao") {
    return "Você não tem permissão para ver a agenda deste estabelecimento.";
  }
  return mensagemFalhaAgendamento(falha);
}

export type VisualizacaoAgenda = "lista" | "profissional";

export interface GrupoDeProfissional {
  professionalId: string;
  nome: string;
  /** Inativo no catálogo atual — as reservas dele continuam aparecendo. */
  inativo: boolean;
  /** Em ordem cronológica. Vazio só para profissional ATIVO sem reserva num
   * dia com a lista COMPLETA — sem reserva não quer dizer horário livre. */
  agendamentos: AgendamentoReal[];
}

/**
 * Agrupa as reservas JÁ carregadas (e já filtradas) por profissional, para a
 * visualização "Por profissional". Não perde nem duplica nada: cada reserva
 * entra exatamente no grupo do `professional.id` que o backend devolveu,
 * inclusive de profissional inativo ou ausente do catálogo (o nome vem da
 * própria reserva).
 *
 * Profissionais ativos sem reserva só viram grupo vazio quando
 * `incluirSemReserva` — quem chama passa `true` apenas com a lista do dia
 * COMPLETA e sem filtro; numa lista cortada, "sem reserva" seria um palpite.
 *
 * Grupos em ordem alfabética; reservas de cada grupo em ordem cronológica.
 */
export function agruparPorProfissional(
  agendamentos: readonly AgendamentoReal[],
  profissionais: readonly ProfissionalReal[],
  incluirSemReserva: boolean,
): GrupoDeProfissional[] {
  const catalogo = new Map(profissionais.map((p) => [p.id, p]));
  const grupos = new Map<string, GrupoDeProfissional>();

  for (const agendamento of ordenarPorHorario(agendamentos)) {
    const { id, name } = agendamento.professional;
    let grupo = grupos.get(id);
    if (!grupo) {
      const doCatalogo = catalogo.get(id);
      grupo = {
        professionalId: id,
        nome: doCatalogo?.name ?? name,
        inativo: doCatalogo ? !doCatalogo.active : false,
        agendamentos: [],
      };
      grupos.set(id, grupo);
    }
    grupo.agendamentos.push(agendamento);
  }

  if (incluirSemReserva) {
    for (const p of profissionais) {
      if (p.active && !grupos.has(p.id)) {
        grupos.set(p.id, { professionalId: p.id, nome: p.name, inativo: false, agendamentos: [] });
      }
    }
  }

  return [...grupos.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}
