// Percurso da página pública de agendamento — regras puras, testadas em
// fluxo-publico.test.ts. A tela (app/agendar/[slug]/page.tsx) só guarda o
// estado e chama estas funções.
//
// Serviço → Profissional → Dia e horário → Seus dados → Revisar.
//
// - Um serviço e um profissional por pedido.
// - Trocar o serviço mantém o profissional só se ele ainda atende o serviço
//   novo; o horário escolhido sempre cai (a duração pode ser outra).
// - Trocar o profissional ou o dia derruba o horário escolhido.
// - A etapa "Profissional" é sempre mostrada. Com UM profissional válido
//   para o serviço, ele já vem escolhido (nome na tela) e a pessoa só
//   confirma; com nenhum, a etapa avisa e não deixa seguir. Nunca se escolhe
//   outro profissional por conta própria.
// - Nenhum horário fica "reservado" aqui: o servidor revalida tudo no envio.
import type { PaginaPublica } from "@/lib/api/public-booking-api";
import { nomePlausivel, whatsappPlausivel } from "./agendamento-publico";

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
  serviceId: string | null;
  professionalId: string | null;
  date: string | null;
  slot: HorarioEscolhido | null;
  nome: string;
  whatsapp: string;
}

export const ESCOLHAS_VAZIAS: Escolhas = {
  serviceId: null,
  professionalId: null,
  date: null,
  slot: null,
  nome: "",
  whatsapp: "",
};

export function profissionaisDoServico(pagina: PaginaPublica, serviceId: string | null) {
  if (!serviceId) return [];
  return pagina.professionals.filter((p) => p.serviceIds.includes(serviceId));
}

/** Escolhe o serviço (a etapa seguinte é sempre "Profissional"). Com
 * profissional único, ele já fica escolhido e o dia, se ainda não houver, é
 * `primeiroDia`. */
export function escolherServico(
  pagina: PaginaPublica,
  atual: Escolhas,
  serviceId: string,
  primeiroDia: string | null,
): Escolhas {
  const opcoes = profissionaisDoServico(pagina, serviceId);
  const unico = opcoes.length === 1 ? opcoes[0].id : null;
  const professionalId =
    unico ?? (atual.professionalId && opcoes.some((p) => p.id === atual.professionalId) ? atual.professionalId : null);
  return {
    ...atual,
    serviceId,
    professionalId,
    date: unico ? (atual.date ?? primeiroDia) : atual.date,
    slot: atual.serviceId === serviceId && professionalId === atual.professionalId ? atual.slot : null,
  };
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
  if (!e.serviceId || !pagina.services.some((s) => s.id === e.serviceId)) return ETAPA_SERVICO;
  if (!e.professionalId || !profissionaisDoServico(pagina, e.serviceId).some((p) => p.id === e.professionalId)) {
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
