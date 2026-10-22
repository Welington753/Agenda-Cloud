import { describe, expect, it } from "vitest";
import { ITENS_MENU_MAIS, ITENS_NAVEGACAO_CONTA, itemAtivo, rotuloDoSino } from "./navegacao";

describe("ITENS_NAVEGACAO_CONTA", () => {
  it("só aponta para a área real, na ordem do dia a dia", () => {
    expect(ITENS_NAVEGACAO_CONTA.map((i) => i.href)).toEqual([
      "/conta/visao-geral",
      "/conta/agendamentos",
      "/conta/solicitacoes",
      "/conta/clientes",
      "/conta/servicos",
      "/conta/profissionais",
      "/conta",
    ]);
    expect(ITENS_NAVEGACAO_CONTA.map((i) => i.rotulo)).toEqual([
      "Visão geral",
      "Agenda",
      "Solicitações",
      "Clientes",
      "Serviços",
      "Profissionais",
      "Minha conta",
    ]);
    for (const item of ITENS_NAVEGACAO_CONTA) {
      expect(item.href.startsWith("/conta")).toBe(true);
    }
  });
});

describe("celular", () => {
  it("a barra inferior tem quatro áreas e o resto fica em Mais", () => {
    const naBarra = ITENS_NAVEGACAO_CONTA.filter((i) => i.noCelular === "barra");
    expect(naBarra.map((i) => i.rotulo)).toEqual(["Visão geral", "Agenda", "Clientes", "Serviços"]);
    expect(ITENS_MENU_MAIS.map((i) => i.rotulo)).toEqual(["Solicitações", "Profissionais", "Minha conta"]);
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

describe("rotuloDoSino", () => {
  it("diz o número real de pendentes, e nada quando a lista não carregou", () => {
    expect(rotuloDoSino(null)).toBe("Notificações");
    expect(rotuloDoSino(0)).toBe("Notificações: nenhuma solicitação pendente");
    expect(rotuloDoSino(1)).toBe("Notificações: 1 solicitação pendente");
    expect(rotuloDoSino(7)).toBe("Notificações: 7 solicitações pendentes");
  });
});
