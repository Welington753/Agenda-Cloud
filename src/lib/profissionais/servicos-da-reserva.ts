// Escolha de vários serviços num agendamento (interno e público), com o
// MESMO profissional. Regras puras da tela: a lista na ordem em que a pessoa
// escolheu, os profissionais que fazem todos, e o resumo (itens, total e
// duração). O servidor recalcula e confere tudo ao gravar; o resumo aqui é só
// o que mostrar antes (ver docs/plans/agendamento-multiplos-servicos.md).

/** Mesmo teto do servidor (`MAX_SERVICOS_POR_AGENDAMENTO`). */
export const MAX_SERVICOS = 6;

/** Acrescenta (no fim) ou retira um serviço, mantendo a ordem do resto. */
export function alternarServico(escolhidos: readonly string[], id: string): string[] {
  if (escolhidos.includes(id)) return escolhidos.filter((x) => x !== id);
  if (escolhidos.length >= MAX_SERVICOS) return [...escolhidos];
  return [...escolhidos, id];
}

/** Profissionais que fazem TODOS os serviços escolhidos (sem escolha, todos). */
export function profissionaisCompativeis<P extends { serviceIds: readonly string[] }>(
  profissionais: readonly P[],
  escolhidos: readonly string[],
): P[] {
  return profissionais.filter((p) => escolhidos.every((id) => p.serviceIds.includes(id)));
}

export interface ItemDoResumo {
  id: string;
  name: string;
  durationMinutes: number | null;
  /** `null` = sob consulta, preço escondido ou desconhecido. */
  priceCents: number | null;
}

export interface ResumoDosServicos {
  itens: ItemDoResumo[];
  /** "Corte + Barba". */
  rotulo: string;
  /** `null` se alguma duração não é conhecida. */
  totalMinutos: number | null;
  /** `null` se algum preço é sob consulta ou não pode ser mostrado. Nunca
   * soma parcial: mostraria menos do que será cobrado. */
  totalCents: number | null;
}

export function resumoDosServicos(
  escolhidos: readonly string[],
  catalogo: readonly {
    id: string;
    name: string;
    durationMinutes?: number | null;
    priceCents?: number | null;
  }[],
): ResumoDosServicos {
  const itens = escolhidos
    .map((id) => catalogo.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => ({
      id: s.id,
      name: s.name,
      durationMinutes: s.durationMinutes ?? null,
      priceCents: s.priceCents ?? null,
    }));
  const soma = (valores: (number | null)[]) =>
    valores.length > 0 && valores.every((v) => v !== null) ? valores.reduce<number>((t, v) => t + (v ?? 0), 0) : null;
  return {
    itens,
    rotulo: itens.map((i) => i.name).join(" + "),
    totalMinutos: soma(itens.map((i) => i.durationMinutes)),
    totalCents: soma(itens.map((i) => i.priceCents)),
  };
}
