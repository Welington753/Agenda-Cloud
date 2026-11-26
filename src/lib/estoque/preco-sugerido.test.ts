import { describe, expect, it } from "vitest";
import { lerPrecoSugerido } from "./preco-sugerido";

describe("preço sugerido do produto", () => {
  it("vazio é sem preço, nunca zero", () => {
    expect(lerPrecoSugerido("")).toEqual({ ok: true, centavos: null });
    expect(lerPrecoSugerido("  ")).toEqual({ ok: true, centavos: null });
  });

  it("zero é recusado", () => {
    expect(lerPrecoSugerido("0").ok).toBe(false);
    expect(lerPrecoSugerido("0,00").ok).toBe(false);
  });

  it("aceita centavos exatos até o teto da venda", () => {
    expect(lerPrecoSugerido("19,99")).toEqual({ ok: true, centavos: 1999 });
    expect(lerPrecoSugerido("1000000")).toEqual({ ok: true, centavos: 100_000_000 });
    expect(lerPrecoSugerido("1000000,01").ok).toBe(false);
  });

  it("texto inválido traz o erro do campo", () => {
    expect(lerPrecoSugerido("abc")).toMatchObject({ ok: false });
  });
});
