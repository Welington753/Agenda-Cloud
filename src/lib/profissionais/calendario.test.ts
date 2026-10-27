import { describe, expect, it } from "vitest";
import {
  deslocar,
  diasDaSemana,
  periodoDaVisao,
  porData,
  semanasDoMes,
  tituloDoPeriodo,
} from "./calendario";

describe("grade do calendário", () => {
  it("semana de domingo a sábado, atravessando o mês e o ano", () => {
    expect(diasDaSemana("2026-10-27")).toEqual([
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
    ]);
    expect(diasDaSemana("2027-01-01")[0]).toBe("2026-12-27");
  });

  it("mês com semanas completas, de 4 a 6, sempre dentro de 42 dias", () => {
    // Fevereiro de 2026 começa no domingo e tem 28 dias: 4 semanas exatas.
    expect(semanasDoMes("2026-02-10")).toHaveLength(4);
    // Agosto de 2026 começa no sábado e tem 31 dias: 6 semanas.
    const agosto = semanasDoMes("2026-08-20");
    expect(agosto).toHaveLength(6);
    expect(agosto[0][0]).toBe("2026-07-26");
    expect(agosto[5][6]).toBe("2026-09-05");
    expect(periodoDaVisao("mes", "2026-08-20")).toEqual({ from: "2026-07-26", to: "2026-09-05" });
  });

  it("períodos de semana e dia", () => {
    expect(periodoDaVisao("semana", "2026-10-27")).toEqual({ from: "2026-10-25", to: "2026-10-31" });
    expect(periodoDaVisao("dia", "2026-10-27")).toEqual({ from: "2026-10-27", to: "2026-10-27" });
  });

  it("anterior e próximo sem pular meses curtos", () => {
    expect(deslocar("mes", "2027-01-31", 1)).toBe("2027-02-01");
    expect(deslocar("mes", "2027-01-15", -1)).toBe("2026-12-01");
    expect(deslocar("semana", "2026-12-30", 1)).toBe("2027-01-06");
    expect(deslocar("dia", "2026-12-31", 1)).toBe("2027-01-01");
  });

  it("títulos legíveis em português", () => {
    expect(tituloDoPeriodo("mes", "2026-10-27")).toBe("outubro de 2026");
    expect(tituloDoPeriodo("dia", "2026-10-07")).toBe("7 de outubro de 2026");
    expect(tituloDoPeriodo("semana", "2026-10-27")).toBe("25 a 31 de outubro de 2026");
    expect(tituloDoPeriodo("semana", "2026-11-02")).toBe("1 a 7 de novembro de 2026");
    expect(tituloDoPeriodo("semana", "2026-09-30")).toBe("27 de setembro a 3 de outubro de 2026");
    expect(tituloDoPeriodo("semana", "2026-12-30")).toBe("27 de dezembro de 2026 a 2 de janeiro de 2027");
  });

  it("agrupa pela data local que veio do servidor", () => {
    const grupos = porData([
      { id: "a", localDate: "2026-10-27" },
      { id: "b", localDate: "2026-10-28" },
      { id: "c", localDate: "2026-10-27" },
    ]);
    expect(grupos.get("2026-10-27")?.map((x) => x.id)).toEqual(["a", "c"]);
    expect(grupos.get("2026-10-29")).toBeUndefined();
  });
});
