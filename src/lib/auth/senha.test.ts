import { describe, expect, it } from "vitest";
import { contarDigitos, erroDaSenhaNova } from "./senha";

describe("senha nova", () => {
  it("só comprimento e confirmação, sem regra inventada", () => {
    expect(erroDaSenhaNova("curta", "curta")).toMatch(/pelo menos 10/);
    expect(erroDaSenhaNova("a".repeat(129), "a".repeat(129))).toMatch(/no máximo 128/);
    expect(erroDaSenhaNova("senhasemsimbolo", "senhasemsimbolX")).toMatch(/não são iguais/);
    expect(erroDaSenhaNova("senhasemsimbolo", "senhasemsimbolo")).toBeNull();
  });

  it("nunca apara espaços: a senha digitada é a credencial", () => {
    expect(erroDaSenhaNova(" senha com espaço ", " senha com espaço ")).toBeNull();
  });

  it("conta só dígitos", () => {
    expect(contarDigitos("(11) 99999-8888")).toBe(11);
  });
});
