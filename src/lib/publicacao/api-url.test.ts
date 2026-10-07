import { describe, expect, it } from "vitest";
import { erroDeApiUrlDePublicacao } from "./api-url";

describe("erroDeApiUrlDePublicacao", () => {
  it("fora da hospedagem não exige nada (desenvolvimento e CI)", () => {
    expect(erroDeApiUrlDePublicacao({})).toBeNull();
    expect(erroDeApiUrlDePublicacao({ NEXT_PUBLIC_API_URL: "http://localhost:3001" })).toBeNull();
  });

  it("no build da hospedagem, exige o valor", () => {
    expect(erroDeApiUrlDePublicacao({ RENDER: "true" })).toMatch(/NEXT_PUBLIC_API_URL/);
    expect(erroDeApiUrlDePublicacao({ RENDER: "true", NEXT_PUBLIC_API_URL: "" })).toMatch(/NEXT_PUBLIC_API_URL/);
  });

  it("aceita origem HTTPS exata no domínio próprio", () => {
    expect(
      erroDeApiUrlDePublicacao({ RENDER: "true", NEXT_PUBLIC_API_URL: "https://api.exemplo.test" }),
    ).toBeNull();
  });

  it.each([
    "http://api.exemplo.test",
    "https://api.exemplo.test/",
    "https://api.exemplo.test/v1",
    "http://localhost:3001",
    "nao-e-url",
  ])("recusa %s", (valor) => {
    expect(erroDeApiUrlDePublicacao({ RENDER: "true", NEXT_PUBLIC_API_URL: valor })).toMatch(
      /NEXT_PUBLIC_API_URL/,
    );
  });

  it("recusa *.onrender.com, onde o cookie de sessão não chegaria à API", () => {
    expect(
      erroDeApiUrlDePublicacao({ RENDER: "true", NEXT_PUBLIC_API_URL: "https://agenda-api.onrender.com" }),
    ).toMatch(/onrender\.com/);
  });

  it("nunca ecoa o valor recebido na mensagem", () => {
    const valor = "http://valor-que-nao-pode-aparecer.test/x";
    expect(erroDeApiUrlDePublicacao({ RENDER: "true", NEXT_PUBLIC_API_URL: valor })).not.toContain(valor);
  });
});
