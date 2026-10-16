import { describe, expect, it } from "vitest";
import { ITENS_NAVEGACAO_CONTA, itemAtivo } from "./navegacao";

describe("ITENS_NAVEGACAO_CONTA", () => {
  it("só aponta para a área real, na ordem do dia a dia", () => {
    expect(ITENS_NAVEGACAO_CONTA.map((i) => i.href)).toEqual([
      "/conta/visao-geral",
      "/conta/agendamentos",
      "/conta/servicos",
      "/conta/profissionais",
      "/conta",
    ]);
    expect(ITENS_NAVEGACAO_CONTA.map((i) => i.rotulo)).toEqual([
      "Visão geral",
      "Agenda",
      "Serviços",
      "Profissionais",
      "Minha conta",
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

  it("Visão geral é ativa só nela, e nunca marca Minha conta junto", () => {
    expect(itemAtivo("/conta/visao-geral", "/conta/visao-geral")).toBe(true);
    expect(itemAtivo("/conta/visao-geral", "/conta")).toBe(false);
  });

  it("subpáginas mantêm o item do grupo ativo", () => {
    expect(itemAtivo("/conta/profissionais/p1/horarios", "/conta/profissionais")).toBe(true);
    expect(itemAtivo("/conta/profissionais/p1/disponibilidade", "/conta/profissionais")).toBe(true);
    expect(itemAtivo("/conta/profissionais", "/conta/profissionais")).toBe(true);
  });

  it("não confunde prefixos parecidos nem rota ausente", () => {
    expect(itemAtivo("/conta/servicos-antigos", "/conta/servicos")).toBe(false);
    expect(itemAtivo("/conta/agendamentos", "/conta/servicos")).toBe(false);
    expect(itemAtivo(null, "/conta")).toBe(false);
  });
});
