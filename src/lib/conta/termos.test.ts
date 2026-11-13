import { describe, expect, it } from "vitest";
import { rotuloDosProfissionais } from "./termos";

describe("rotuloDosProfissionais", () => {
  it("barbearia usa Barbeiros", () => {
    expect(rotuloDosProfissionais("BARBERSHOP")).toBe("Barbeiros");
  });

  it("os outros segmentos, um valor desconhecido ou a ausência dele ficam com Profissionais", () => {
    for (const segmento of ["HAIR_SALON", "CLINIC", "OTHER", "barbershop", "", null, undefined]) {
      expect(rotuloDosProfissionais(segmento)).toBe("Profissionais");
    }
  });
});
