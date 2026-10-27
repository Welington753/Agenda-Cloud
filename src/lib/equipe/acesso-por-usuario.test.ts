import { describe, expect, it } from "vitest";
import { ehAcessoCriado, erroDoUsuario, sugestaoDeUsuario } from "./acesso-por-usuario";

describe("acesso por nome de usuário", () => {
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
    expect(erroDoUsuario("maria@salao")).toMatch(/não tem @/);
    expect(erroDoUsuario(".maria")).toMatch(/começando por letra ou número/);
    expect(erroDoUsuario("maría")).toMatch(/sem acento/);
    expect(erroDoUsuario("a".repeat(41))).not.toBeNull();
  });

  it("a resposta da criação traz a senha só quando criou", () => {
    expect(ehAcessoCriado({ created: true, membershipId: "m", userId: "u", username: "x", temporaryPassword: "abc" })).toBe(true);
    expect(ehAcessoCriado({ created: false, membershipId: "m", userId: "u", username: "x", temporaryPassword: null })).toBe(true);
    expect(ehAcessoCriado({ created: false, membershipId: "m", userId: "u", username: "x" })).toBe(false);
  });
});
