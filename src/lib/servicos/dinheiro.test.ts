import { describe, expect, it } from "vitest";
import { centavosParaCampo, formatarPrecoServico, precoParaCentavos } from "./dinheiro";

describe("precoParaCentavos", () => {
  it("campo vazio é `null` (sob consulta), nunca zero", () => {
    expect(precoParaCentavos("")).toEqual({ ok: true, centavos: null });
    expect(precoParaCentavos("   ")).toEqual({ ok: true, centavos: null });
  });

  it("zero é um preço legítimo, distinto de vazio", () => {
    expect(precoParaCentavos("0")).toEqual({ ok: true, centavos: 0 });
    expect(precoParaCentavos("0,00")).toEqual({ ok: true, centavos: 0 });
  });

  it("converte com vírgula, ponto e sem decimais", () => {
    expect(precoParaCentavos("85,50")).toEqual({ ok: true, centavos: 8550 });
    expect(precoParaCentavos("85.50")).toEqual({ ok: true, centavos: 8550 });
    expect(precoParaCentavos("85")).toEqual({ ok: true, centavos: 8500 });
  });

  it("uma casa decimal é décimo, nunca centésimo (85,5 = R$ 85,50)", () => {
    expect(precoParaCentavos("85,5")).toEqual({ ok: true, centavos: 8550 });
    expect(precoParaCentavos("85,05")).toEqual({ ok: true, centavos: 8505 });
  });

  // O ponto central deste módulo: `parseFloat("x,yz".replace(",",".")) * 100`
  // erra em vários destes valores (ex.: 1.005 * 100 = 100.49999999999999).
  it.each([
    ["0,07", 7],
    ["1,01", 101],
    ["1,10", 110],
    ["8,15", 815],
    ["10,05", 1005],
    ["29,90", 2990],
    ["70,07", 7007],
    ["1234,56", 123456],
  ])("converte %s exatamente, sem erro de ponto flutuante", (texto, esperado) => {
    expect(precoParaCentavos(texto)).toEqual({ ok: true, centavos: esperado });
  });

  it("devolve sempre inteiro", () => {
    for (const texto of ["0,01", "3,33", "66,66", "999,99"]) {
      const resultado = precoParaCentavos(texto);
      expect(resultado.ok).toBe(true);
      if (resultado.ok) expect(Number.isInteger(resultado.centavos)).toBe(true);
    }
  });

  it("recusa texto não numérico, sinal e mais de duas casas", () => {
    expect(precoParaCentavos("abc").ok).toBe(false);
    expect(precoParaCentavos("-5").ok).toBe(false);
    expect(precoParaCentavos("85,509").ok).toBe(false);
    expect(precoParaCentavos("1,2,3").ok).toBe(false);
  });

  it("recusa separador de milhar — '1.500' seria ambíguo", () => {
    expect(precoParaCentavos("1.500").ok).toBe(false);
  });

  it("recusa valor acima do limite de INTEGER da coluna", () => {
    expect(precoParaCentavos("21474836,48").ok).toBe(false);
    expect(precoParaCentavos("21474836,47")).toEqual({ ok: true, centavos: 2_147_483_647 });
  });
});

describe("centavosParaCampo", () => {
  it("null vira campo vazio, nunca 0,00", () => {
    expect(centavosParaCampo(null)).toBe("");
  });

  it("formata sempre com duas casas", () => {
    expect(centavosParaCampo(0)).toBe("0,00");
    expect(centavosParaCampo(7)).toBe("0,07");
    expect(centavosParaCampo(8550)).toBe("85,50");
    expect(centavosParaCampo(123456)).toBe("1234,56");
  });

  it("é o inverso exato de precoParaCentavos", () => {
    for (const centavos of [0, 1, 7, 99, 100, 8505, 8550, 123456]) {
      const texto = centavosParaCampo(centavos);
      expect(precoParaCentavos(texto)).toEqual({ ok: true, centavos });
    }
  });
});

describe("formatarPrecoServico", () => {
  it("null é 'Sob consulta', nunca R$ 0,00", () => {
    expect(formatarPrecoServico(null)).toBe("Sob consulta");
    expect(formatarPrecoServico(0)).not.toBe("Sob consulta");
  });

  it("formata em reais", () => {
    expect(formatarPrecoServico(8550).replace(/ /g, " ")).toBe("R$ 85,50");
  });
});
