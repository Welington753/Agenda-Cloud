import { describe, expect, it } from "vitest";
import { ITENS_NAVEGACAO_CONTA, itemAtivo } from "./navegacao";

describe("ITENS_NAVEGACAO_CONTA", () => {
  it("só aponta para a área real, na ordem do dia a dia", () => {
    expect(ITENS_NAVEGACAO_CONTA.map((i) => i.href)).toEqual([
      "/conta/agendamentos",
      "/conta/servicos",
      "/conta/profissionais",
      "/conta",
    ]);
    for (const item of ITENS_NAVEGACAO_CONTA) {
      expect(item.href.startsWith("/conta")).toBe(true);
    }
  });
});

describe("itemAtivo", () => {
  it("Minha conta só é ativa na própria página", () => {
    expect(itemAtivo("/conta", "/conta")).toBe(true);
    expect(itemAtivo("/conta/", "/conta")).toBe(true);
    expect(itemAtivo("/conta/servicos", "/conta")).toBe(false);
  });

  it("subpáginas mantêm o item do grupo ativo", () => {
    expect(itemAtivo("/conta/profissionais/p1/horarios", "/conta/profissionais")).toBe(true);
    expect(itemAtivo("/conta/profissionais", "/conta/profissionais")).toBe(true);
  });

  it("não confunde prefixos parecidos nem rota ausente", () => {
    expect(itemAtivo("/conta/servicos-antigos", "/conta/servicos")).toBe(false);
    expect(itemAtivo("/conta/agendamentos", "/conta/servicos")).toBe(false);
    expect(itemAtivo(null, "/conta")).toBe(false);
  });
});
