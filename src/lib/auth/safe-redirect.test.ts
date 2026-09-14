import { describe, expect, it } from "vitest";
import { sanitizarDestinoInterno } from "./safe-redirect";

describe("sanitizarDestinoInterno", () => {
  it("aceita um caminho interno simples", () => {
    expect(sanitizarDestinoInterno("/conta")).toBe("/conta");
  });

  it("aceita um caminho interno com subrota", () => {
    expect(sanitizarDestinoInterno("/conta/selecionar-estabelecimento")).toBe(
      "/conta/selecionar-estabelecimento",
    );
  });

  it("rejeita ausência de valor", () => {
    expect(sanitizarDestinoInterno(null)).toBeNull();
    expect(sanitizarDestinoInterno(undefined)).toBeNull();
    expect(sanitizarDestinoInterno("")).toBeNull();
  });

  it("rejeita URL absoluta com protocolo", () => {
    expect(sanitizarDestinoInterno("https://evil.example.com/phish")).toBeNull();
  });

  it("rejeita protocol-relative (//host)", () => {
    expect(sanitizarDestinoInterno("//evil.example.com")).toBeNull();
  });

  it("rejeita disfarce com backslash (\\host, alguns navegadores normalizam para //)", () => {
    expect(sanitizarDestinoInterno("/\\evil.example.com")).toBeNull();
  });

  it("rejeita caminho que não começa com barra", () => {
    expect(sanitizarDestinoInterno("conta")).toBeNull();
  });

  it("rejeita valor com espaço embutido", () => {
    expect(sanitizarDestinoInterno("/conta algo")).toBeNull();
  });
});
