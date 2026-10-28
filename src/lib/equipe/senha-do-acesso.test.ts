import { describe, expect, it } from "vitest";
import { problemaDaSenha, senhaPronta } from "./senha-do-acesso";

describe("senha escolhida pelo dono", () => {
  it("campos vazios não mostram erro, mas não estão prontos", () => {
    expect(problemaDaSenha("", "")).toBeNull();
    expect(senhaPronta("", "")).toBe(false);
  });

  it("segue a política do servidor: de 10 a 128 caracteres", () => {
    expect(problemaDaSenha("curta", "")).toMatch(/pelo menos 10/);
    expect(senhaPronta("123456789", "123456789")).toBe(false);
    expect(senhaPronta("1234567890", "1234567890")).toBe(true);
    const longa = "a".repeat(129);
    expect(problemaDaSenha(longa, longa)).toMatch(/até 128/);
    expect(senhaPronta(longa, longa)).toBe(false);
  });

  it("a confirmação precisa ser igual", () => {
    expect(problemaDaSenha("senha-forte-1", "senha-forte-2")).toMatch(/confirmação/);
    expect(senhaPronta("senha-forte-1", "senha-forte-2")).toBe(false);
    expect(senhaPronta("senha-forte-1", "senha-forte-1")).toBe(true);
  });
});
