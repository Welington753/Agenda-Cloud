// Percurso da página pública de agendamento — regras puras, testadas em
// fluxo-publico.test.ts. A tela (app/agendar/[slug]/page.tsx) só guarda o
// estado e chama estas funções.
//
// Serviço → Profissional → Dia e horário → Seus dados → Revisar.
//
// - Um ou mais serviços e UM profissional por pedido, que faça todos eles
//   (ver docs/plans/agendamento-multiplos-servicos.md). Tocar no cartão
//   escolhe só aquele serviço (o caminho rápido de sempre); "Adicionar" monta
//   a combinação.
// - Mudar os serviços mantém o profissional só se ele ainda atende todos;
//   o horário escolhido sempre cai (a duração pode ser outra).
// - Trocar o profissional ou o dia derruba o horário escolhido.
// - A etapa "Profissional" é sempre mostrada. Com UM profissional válido
//   para o serviço, ele já vem escolhido (nome na tela) e a pessoa só
//   confirma; com nenhum, a etapa avisa e não deixa seguir. Nunca se escolhe
//   outro profissional por conta própria.
// - Nenhum horário fica "reservado" aqui: o servidor revalida tudo no envio.
import type { PaginaPublica } from "@/lib/api/public-booking-api";
import { nomePlausivel, precoPublico, whatsappPlausivel } from "./agendamento-publico";
import { alternarServico, profissionaisCompativeis } from "@/lib/profissionais/servicos-da-reserva";

export const ETAPAS = ["Serviço", "Profissional", "Dia e horário", "Seus dados", "Revisar"] as const;
export type Etapa = 0 | 1 | 2 | 3 | 4;

export const ETAPA_SERVICO: Etapa = 0;
export const ETAPA_PROFISSIONAL: Etapa = 1;
export const ETAPA_HORARIO: Etapa = 2;
export const ETAPA_DADOS: Etapa = 3;
export const ETAPA_REVISAR: Etapa = 4;

export interface HorarioEscolhido {
  startAt: string;
  localStart: string;
}

export interface Escolhas {
  /** Na ordem em que a pessoa escolheu (a ordem do atendimento). */
  serviceIds: string[];
  professionalId: string | null;
  date: string | null;
  slot: HorarioEscolhido | null;
  nome: string;
  whatsapp: string;
}

export const ESCOLHAS_VAZIAS: Escolhas = {
  serviceIds: [],
  professionalId: null,
  date: null,
  slot: null,
  nome: "",
  whatsapp: "",
};

/** Profissionais que fazem TODOS os serviços escolhidos. */
export function profissionaisDoServico(pagina: PaginaPublica, servicos: readonly string[] | string | null) {
  const lista = servicos === null ? [] : typeof servicos === "string" ? [servicos] : servicos;
  if (lista.length === 0) return [];
  return profissionaisCompativeis(pagina.professionals, lista);
}

/** Aplica uma nova lista de serviços: o profissional fica só se fizer todos
 * (ou é o único que faz); o horário cai se a lista mudou. */
function comServicos(pagina: PaginaPublica, atual: Escolhas, serviceIds: string[], primeiroDia: string | null): Escolhas {
  const opcoes = profissionaisDoServico(pagina, serviceIds);
  const unico = opcoes.length === 1 ? opcoes[0].id : null;
  const professionalId =
    unico ?? (atual.professionalId && opcoes.some((p) => p.id === atual.professionalId) ? atual.professionalId : null);
  const mesmaLista = serviceIds.length === atual.serviceIds.length && serviceIds.every((id, i) => atual.serviceIds[i] === id);
  return {
    ...atual,
    serviceIds,
    professionalId,
    date: unico ? (atual.date ?? primeiroDia) : atual.date,
    slot: mesmaLista && professionalId === atual.professionalId ? atual.slot : null,
  };
}

/** "Adicionar"/"Retirar" um serviço da combinação, sem avançar de etapa. */
export function alternarServicoNaEscolha(
  pagina: PaginaPublica,
  atual: Escolhas,
  serviceId: string,
  primeiroDia: string | null,
): Escolhas {
  return comServicos(pagina, atual, alternarServico(atual.serviceIds, serviceId), primeiroDia);
}

/** Escolhe SÓ este serviço (a etapa seguinte é sempre "Profissional"). Com
 * profissional único, ele já fica escolhido e o dia, se ainda não houver, é
 * `primeiroDia`. */
export function escolherServico(
  pagina: PaginaPublica,
  atual: Escolhas,
  serviceId: string,
  primeiroDia: string | null,
): Escolhas {
  return comServicos(pagina, atual, [serviceId], primeiroDia);
}

/** Escolhe o profissional; o dia, se ainda não houver, é o primeiro oferecido. */
export function escolherProfissional(atual: Escolhas, professionalId: string, primeiroDia: string | null): Escolhas {
  return {
    ...atual,
    professionalId,
    date: atual.date ?? primeiroDia,
    slot: professionalId === atual.professionalId ? atual.slot : null,
  };
}

export function escolherDia(atual: Escolhas, date: string): Escolhas {
  return { ...atual, date, slot: date === atual.date ? atual.slot : null };
}

/** O horário escolhido continua na lista mais recente? Se não, cai. */
export function conferirHorario(atual: Escolhas, livres: readonly { startAt: string }[]): Escolhas {
  if (!atual.slot) return atual;
  const slot = atual.slot;
  return livres.some((s) => s.startAt === slot.startAt) ? atual : { ...atual, slot: null };
}

export function dadosCompletos(e: Escolhas): boolean {
  return nomePlausivel(e.nome) && whatsappPlausivel(e.whatsapp);
}

/** Etapa mais adiantada que as escolhas atuais permitem abrir. */
export function etapaMaxima(pagina: PaginaPublica, e: Escolhas): Etapa {
  if (e.serviceIds.length === 0 || !e.serviceIds.every((id) => pagina.services.some((s) => s.id === id))) {
    return ETAPA_SERVICO;
  }
  if (!e.professionalId || !profissionaisDoServico(pagina, e.serviceIds).some((p) => p.id === e.professionalId)) {
    return ETAPA_PROFISSIONAL;
  }
  if (!e.date || !e.slot) return ETAPA_HORARIO;
  if (!dadosCompletos(e)) return ETAPA_DADOS;
  return ETAPA_REVISAR;
}

/** Etapa anterior ao voltar: sempre a imediatamente antes, sem pular nenhuma. */
export function etapaAnterior(etapa: Etapa): Etapa {
  return etapa === ETAPA_SERVICO ? ETAPA_SERVICO : ((etapa - 1) as Etapa);
}

/** Os serviços escolhidos, na ordem, como a página os mostra. */
export function servicosEscolhidos(pagina: PaginaPublica, e: Pick<Escolhas, "serviceIds">) {
  return e.serviceIds
    .map((id) => pagina.services.find((s) => s.id === id))
    .filter((s): s is PaginaPublica["services"][number] => !!s);
}

/** Resumo do pedido antes de enviar: nomes, duração total e preço. Um
 * serviço: o preço dele, como sempre. Vários: a soma só quando todos mostram
 * preço; senão "Sob consulta" (nunca uma soma parcial). O servidor recalcula
 * tudo com os valores congelados na reserva. */
export function resumoPublico(servicos: readonly PaginaPublica["services"][number][]) {
  const rotulo = servicos.map((s) => s.name).join(" + ");
  const minutos = servicos.reduce((t, s) => t + s.durationMinutes, 0);
  if (servicos.length === 1) return { rotulo, minutos, preco: precoPublico(servicos[0].priceCents, servicos[0].priceVisible) };
  const visiveis = servicos.length > 0 && servicos.every((s) => s.priceVisible && s.priceCents !== null);
  const total = servicos.reduce((t, s) => t + (s.priceCents ?? 0), 0);
  return { rotulo, minutos, preco: visiveis ? precoPublico(total, true) : "Sob consulta" };
}
