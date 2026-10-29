import { describe, expect, it } from "vitest";
import { centavosDe, diaBr, reais } from "./validade";

describe("validade do acesso: conversões", () => {
  it("valor digitado vira centavos inteiros, sem arredondar por float", () => {
    expect(centavosDe("89,90")).toBe(8990);
    expect(centavosDe("89.9")).toBe(8990);
    expect(centavosDe("R$ 404,90")).toBe(40490);
    expect(centavosDe("0,29")).toBe(29);
    expect(centavosDe("149")).toBe(14900);
  });

  it("recusa vazio, zero, negativo, três casas e separador de milhar", () => {
    for (const invalido of ["", "0", "0,00", "-10", "10,999", "1.234,56", "abc"]) {
      expect(centavosDe(invalido)).toBeNull();
    }
  });

  it("datas de calendário e moeda", () => {
    expect(diaBr("2027-02-28")).toBe("28/02/2027");
    expect(reais(8990).replace(/\s/g, " ")).toBe("R$ 89,90");
  });
});
