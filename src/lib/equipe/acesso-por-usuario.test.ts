import { describe, expect, it } from "vitest";
import { ehAcessoCriado, erroDoUsuario, sugestaoDeUsuario } from "./acesso-por-usuario";

describe("acesso por login interno", () => {
  it("sugere primeiro e último nome, sem acento nem partículas", () => {
    expect(sugestaoDeUsuario("Maria José da Silva")).toBe("maria.silva");
    expect(sugestaoDeUsuario("João")).toBe("joao");
    expect(sugestaoDeUsuario("  Ana   Lúcia d'Ávila ")).toBe("ana.avila");
    expect(sugestaoDeUsuario("!!!")).toBe("");
  });

  it("confere o formato como o servidor", () => {
    expect(erroDoUsuario("maria.silva")).toBeNull();
    expect(erroDoUsuario("Maria.Silva")).toBeNull();
    expect(erroDoUsuario("ab")).toBe("Use pelo menos 3 caracteres.");
    // Aparência de e-mail é aceita: não precisa ser um e-mail real.
    expect(erroDoUsuario("maria@salao")).toBeNull();
    expect(erroDoUsuario("Recepcao@Barbearia.com")).toBeNull();
    expect(erroDoUsuario("maria@")).toMatch(/Depois da @/);
    expect(erroDoUsuario("a@b@c")).toMatch(/no máximo uma @/);
    expect(erroDoUsuario("maria silva")).toMatch(/espaço/);
    expect(erroDoUsuario(".maria")).toMatch(/começando por letra ou número/);
    expect(erroDoUsuario("maría")).toMatch(/sem acento/);
    expect(erroDoUsuario("a".repeat(80))).toBeNull();
    expect(erroDoUsuario("a".repeat(81))).not.toBeNull();
  });

  it("a resposta da criação traz a senha só quando criou", () => {
    expect(ehAcessoCriado({ created: true, membershipId: "m", userId: "u", username: "x", temporaryPassword: "abc" })).toBe(true);
    expect(ehAcessoCriado({ created: false, membershipId: "m", userId: "u", username: "x", temporaryPassword: null })).toBe(true);
    expect(ehAcessoCriado({ created: false, membershipId: "m", userId: "u", username: "x" })).toBe(false);
  });
});
