import { describe, expect, it } from "vitest";
import { alternarServico, MAX_SERVICOS, profissionaisCompativeis, resumoDosServicos } from "./servicos-da-reserva";
import { parametroDosServicos } from "@/lib/api/availability-api";

const catalogo = [
  { id: "corte", name: "Corte", durationMinutes: 30, priceCents: 4250 },
  { id: "barba", name: "Barba", durationMinutes: 30, priceCents: 2500 },
  { id: "luzes", name: "Luzes", durationMinutes: 90, priceCents: null },
];

describe("vários serviços na reserva", () => {
  it("Corte R$ 42,50/30 min + Barba R$ 25,00/30 min = R$ 67,50/60 min", () => {
    expect(resumoDosServicos(["corte", "barba"], catalogo)).toEqual({
      itens: [
        { id: "corte", name: "Corte", durationMinutes: 30, priceCents: 4250 },
        { id: "barba", name: "Barba", durationMinutes: 30, priceCents: 2500 },
      ],
      rotulo: "Corte + Barba",
      totalMinutos: 60,
      totalCents: 6750,
    });
  });

  it("um serviço sob consulta deixa o total sob consulta; sem escolha, nada", () => {
    expect(resumoDosServicos(["corte", "luzes"], catalogo)).toMatchObject({
      totalMinutos: 120,
      totalCents: null,
    });
    expect(resumoDosServicos([], catalogo)).toMatchObject({
      itens: [],
      totalMinutos: null,
      totalCents: null,
    });
  });

  it("acrescenta no fim, retira mantendo a ordem e respeita o teto", () => {
    expect(alternarServico(["corte"], "barba")).toEqual(["corte", "barba"]);
    expect(alternarServico(["corte", "barba", "luzes"], "barba")).toEqual(["corte", "luzes"]);
    const cheio = Array.from({ length: MAX_SERVICOS }, (_, i) => `s${i}`);
    expect(alternarServico(cheio, "outro")).toEqual(cheio);
  });

  it("só profissionais que fazem todos os serviços escolhidos", () => {
    const ana = { id: "ana", serviceIds: ["corte", "barba"] };
    const bia = { id: "bia", serviceIds: ["corte"] };
    expect(profissionaisCompativeis([ana, bia], ["corte"])).toEqual([ana, bia]);
    expect(profissionaisCompativeis([ana, bia], ["corte", "barba"])).toEqual([ana]);
    expect(profissionaisCompativeis([ana, bia], [])).toEqual([ana, bia]);
  });

  it("consulta de horários: um serviço no formato de sempre, vários em lista", () => {
    expect(parametroDosServicos("corte")).toBe("serviceId=corte");
    expect(parametroDosServicos(["corte"])).toBe("serviceId=corte");
    expect(parametroDosServicos(["corte", "barba"])).toBe("serviceIds=corte,barba");
  });
});
