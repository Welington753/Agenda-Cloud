import { describe, expect, it } from "vitest";
import { erroDoPeriodo, mesDe, periodoDaEscolha, rotuloDoPeriodo } from "./inicio";

describe("período do Início", () => {
  it("Hoje e Este mês partem do hoje do estabelecimento", () => {
    const qualquer = { from: "", to: "" };
    expect(periodoDaEscolha("hoje", "2031-02-15", qualquer)).toEqual({ from: "2031-02-15", to: "2031-02-15" });
    expect(periodoDaEscolha("mes", "2031-02-15", qualquer)).toEqual({ from: "2031-02-01", to: "2031-02-28" });
    expect(mesDe("2032-02-10")).toEqual({ from: "2032-02-01", to: "2032-02-29" });
    expect(mesDe("2031-12-31")).toEqual({ from: "2031-12-01", to: "2031-12-31" });
  });

  it("personalizado: só datas reais, em ordem e com no máximo 366 dias", () => {
    expect(erroDoPeriodo({ from: "2031-01-01", to: "2031-01-31" })).toBeNull();
    expect(erroDoPeriodo({ from: "2031-02-30", to: "2031-03-01" })).toBe("Informe as duas datas.");
    expect(erroDoPeriodo({ from: "2031-03-02", to: "2031-03-01" })).toBe("A data final vem antes da inicial.");
    expect(erroDoPeriodo({ from: "2031-01-01", to: "2032-01-01" })).toBeNull();
    expect(erroDoPeriodo({ from: "2031-01-01", to: "2032-01-02" })).toBe("Escolha no máximo 366 dias.");
    expect(periodoDaEscolha("personalizado", "2031-01-01", { from: "x", to: "y" })).toBeNull();
  });

  it("o rótulo diz de quando é cada número", () => {
    expect(rotuloDoPeriodo({ from: "2031-08-15", to: "2031-08-15" })).toBe("15/08/2031");
    expect(rotuloDoPeriodo({ from: "2031-08-01", to: "2031-08-31" })).toBe("01/08/2031 a 31/08/2031");
  });
});
