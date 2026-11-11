import { describe, expect, it } from "vitest";
import {
  diasInclusivos,
  ehDataDeCalendario,
  intervaloDoMes,
  lerPeriodoDaUrl,
  MAX_DIAS_PERIODO,
  mesDoIntervalo,
  mesVizinho,
  parametrosDoPeriodo,
  periodoConfirmado,
  problemaDoPeriodo,
  textoDoPeriodo,
} from "./periodo";

const url = (busca: string) => new URLSearchParams(busca);

describe("período dos relatórios do portal", () => {
  it("datas reais, com bissexto", () => {
    expect(ehDataDeCalendario("2028-02-29")).toBe(true);
    expect(ehDataDeCalendario("2026-02-29")).toBe(false);
    expect(ehDataDeCalendario("2026-04-31")).toBe(false);
    expect(ehDataDeCalendario("31/10/2026")).toBe(false);
  });

  it("366 dias contando os dois extremos, igual ao servidor", () => {
    expect(MAX_DIAS_PERIODO).toBe(366);
    expect(diasInclusivos("2026-10-31", "2026-10-31")).toBe(1);
    expect(diasInclusivos("2028-01-01", "2028-12-31")).toBe(366);
    expect(problemaDoPeriodo("2028-01-01", "2028-12-31")).toBeNull();
    expect(problemaDoPeriodo("2026-01-01", "2027-01-01")).toBeNull();
    expect(problemaDoPeriodo("2026-01-01", "2027-01-02")).toMatch(/366 dias/);
    expect(problemaDoPeriodo("2026-10-02", "2026-10-01")).toMatch(/anterior ou igual/);
    expect(problemaDoPeriodo("", "2026-10-01")).toMatch(/data inicial e a data final/);
  });

  it("meses: intervalo, vizinhos na virada do ano, mês inteiro", () => {
    expect(intervaloDoMes("2026-10")).toEqual({ de: "2026-10-01", ate: "2026-10-31" });
    expect(intervaloDoMes("2028-02")).toEqual({ de: "2028-02-01", ate: "2028-02-29" });
    expect(mesVizinho("2026-12", 1)).toBe("2027-01");
    expect(mesVizinho("2026-01", -1)).toBe("2025-12");
    expect(mesDoIntervalo({ de: "2026-02-01", ate: "2026-02-28" })).toBe("2026-02");
    expect(mesDoIntervalo({ de: "2026-10-01", ate: "2026-10-30" })).toBeNull();
  });

  it("URL: mês, período personalizado, nada, e inválidos descartados sem virar consulta", () => {
    expect(lerPeriodoDaUrl(url(""))).toEqual({ intervalo: null, invalido: false });
    expect(lerPeriodoDaUrl(url("mes=2026-10"))).toEqual({ intervalo: { de: "2026-10-01", ate: "2026-10-31" }, invalido: false });
    expect(lerPeriodoDaUrl(url("de=2026-10-05&ate=2026-10-20"))).toEqual({
      intervalo: { de: "2026-10-05", ate: "2026-10-20" },
      invalido: false,
    });
    for (const busca of ["mes=2026-13", "de=2026-10-05", "de=2026-10-20&ate=2026-10-05", "de=2026-01-01&ate=2027-01-02", "de=x&ate=y"]) {
      expect(lerPeriodoDaUrl(url(busca)), busca).toEqual({ intervalo: null, invalido: true });
    }
    // Nomes próprios da lista de estabelecimentos, sem `mes`.
    expect(lerPeriodoDaUrl(url("cadastroDe=2026-10-01&cadastroAte=2026-10-31&mes=2026-01"), { de: "cadastroDe", ate: "cadastroAte" })).toEqual({
      intervalo: { de: "2026-10-01", ate: "2026-10-31" },
      invalido: false,
    });
    expect(lerPeriodoDaUrl(url("mes=2026-01"), { de: "cadastroDe", ate: "cadastroAte" }).intervalo).toBeNull();
  });

  it("só afirma o período que o servidor devolveu", () => {
    // Sem pedido: o padrão do servidor (relógio dele), nunca o do navegador.
    expect(periodoConfirmado(null, { from: "2026-11-01", to: "2026-11-30" })).toEqual({ de: "2026-11-01", ate: "2026-11-30" });
    expect(periodoConfirmado({ de: "2026-10-01", ate: "2026-10-31" }, { from: "2026-10-01", to: "2026-10-31" })).not.toBeNull();
    expect(periodoConfirmado({ de: "2026-10-01", ate: "2026-10-31" }, { from: "2026-11-01", to: "2026-11-30" })).toBeNull();
    expect(periodoConfirmado(null, { from: "ontem", to: "hoje" })).toBeNull();
  });

  it("textos e parâmetros", () => {
    expect(textoDoPeriodo({ de: "2026-10-01", ate: "2026-10-31" })).toBe("outubro de 2026");
    expect(textoDoPeriodo({ de: "2026-10-05", ate: "2026-11-04" })).toBe("05/10/2026 a 04/11/2026");
    expect(textoDoPeriodo({ de: "2026-10-31", ate: "2026-10-31" })).toBe("31/10/2026");
    expect(parametrosDoPeriodo(null)).toEqual({});
    expect(parametrosDoPeriodo({ de: "2026-10-01", ate: "2026-10-31" })).toEqual({ mes: "2026-10" });
    expect(parametrosDoPeriodo({ de: "2026-10-05", ate: "2026-10-20" })).toEqual({ de: "2026-10-05", ate: "2026-10-20" });
  });
});
