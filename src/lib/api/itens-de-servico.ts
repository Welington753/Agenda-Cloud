// Os serviços de UMA reserva como a API devolve (`services` do agendamento):
// um item por serviço, na ordem do atendimento, com os valores contratados.
// Os totais ficam no próprio agendamento (`durationMinutes`, `priceCents`).

export interface ItemDeServicoReal {
  id: string;
  name: string;
  /** `null` = sob consulta, ou escondido de quem não vê preço. */
  priceCents: number | null;
  durationMinutes: number;
}

/** `undefined` vale (API anterior, sem itens); presente, cada item confere. */
export function ehItensDeServico(valor: unknown): valor is ItemDeServicoReal[] | undefined {
  if (valor === undefined) return true;
  return (
    Array.isArray(valor) &&
    valor.every((item: unknown) => {
      if (typeof item !== "object" || item === null) return false;
      const i = item as Record<string, unknown>;
      return (
        typeof i.id === "string" &&
        typeof i.name === "string" &&
        typeof i.durationMinutes === "number" &&
        (i.priceCents === null || typeof i.priceCents === "number")
      );
    })
  );
}
