import { describe, expect, it } from "vitest";
import { ITENS_NAVEGACAO_CONTA, itemAtivo, itensDaNavegacao, rotuloDoSino } from "./navegacao";

describe("ITENS_NAVEGACAO_CONTA", () => {
  it("o dono tem seis áreas, na ordem do dia a dia, todas da área real", () => {
    expect(ITENS_NAVEGACAO_CONTA.map((i) => [i.href, i.rotulo])).toEqual([
      ["/conta/visao-geral", "Início"],
      ["/conta/agendamentos", "Agenda"],
      ["/conta/clientes", "Clientes"],
      ["/conta/configuracoes/servicos", "Serviços"],
      ["/conta/configuracoes/profissionais", "Profissionais"],
      ["/conta/configuracoes", "Configurações"],
    ]);
    // Quatro na barra do celular; Serviços e Profissionais vão para o menu da conta.
    expect(ITENS_NAVEGACAO_CONTA.filter((i) => i.noCelular === "barra").map((i) => i.rotulo)).toEqual([
      "Início",
      "Agenda",
      "Clientes",
      "Configurações",
    ]);
  });
});

describe("itensDaNavegacao", () => {
  it("dono com estabelecimento: só a operação", () => {
    expect(itensDaNavegacao({ comEstabelecimento: true })).toBe(ITENS_NAVEGACAO_CONTA);
  });

  it("nenhum perfil ganha atalho para o portal da plataforma nem grupo próprio", () => {
    const perfis = ["dono", "gerente", "funcionario", "sem-area"] as const;
    for (const perfil of perfis) {
      const contexto = { role: "GERENTE" as const, areas: ["AGENDA_VER", "CLIENTES_VER"] };
      const itens = itensDaNavegacao({ comEstabelecimento: true, perfil, contexto });
      expect(itens.every((i) => i.href.startsWith("/conta/"))).toBe(true);
      expect(itens.map((i) => i.rotulo)).not.toContain("Portal da plataforma");
      expect(itens.every((i) => Object.keys(i).sort().join() === "href,noCelular,rotulo")).toBe(true);
    }
  });

  it("sem estabelecimento, não há menu (nem para um proprietário da plataforma)", () => {
    expect(itensDaNavegacao({ comEstabelecimento: false })).toEqual([]);
  });
});

describe("itensDaNavegacao por perfil", () => {
  it("funcionário: Minha agenda e Configurações, na barra do celular", () => {
    const itens = itensDaNavegacao({ comEstabelecimento: true, perfil: "funcionario" });
    expect(itens.map((i) => [i.href, i.noCelular])).toEqual([
      ["/conta/minha-agenda", "barra"],
      ["/conta/configuracoes", "barra"],
    ]);
  });

  it("papel sem área: só Configurações; nenhuma área do dono", () => {
    const itens = itensDaNavegacao({ comEstabelecimento: true, perfil: "sem-area" });
    expect(itens.map((i) => i.href)).toEqual(["/conta/configuracoes"]);
  });
});

describe("itemAtivo", () => {
  it("a aba Solicitações mantém a Agenda ativa", () => {
    expect(itemAtivo("/conta/agendamentos/solicitacoes", "/conta/agendamentos")).toBe(true);
    expect(itemAtivo("/conta/agendamentos", "/conta/agendamentos")).toBe(true);
  });

  it("subpáginas de Configurações mantêm Configurações ativa", () => {
    expect(itemAtivo("/conta/configuracoes/perfil", "/conta/configuracoes")).toBe(true);
    expect(itemAtivo("/conta/configuracoes/equipe", "/conta/configuracoes")).toBe(true);
    expect(itemAtivo("/portal/estabelecimentos", "/conta/configuracoes")).toBe(false);
  });

  it("Serviços e Profissionais são áreas próprias, mesmo sob /conta/configuracoes", () => {
    expect(itemAtivo("/conta/configuracoes/profissionais/p1/horarios", "/conta/configuracoes")).toBe(false);
    expect(itemAtivo("/conta/configuracoes/profissionais/p1/horarios", "/conta/configuracoes/profissionais")).toBe(true);
    expect(itemAtivo("/conta/configuracoes/servicos", "/conta/configuracoes")).toBe(false);
    expect(itemAtivo("/conta/configuracoes/servicos", "/conta/configuracoes/servicos")).toBe(true);
  });

  it("não confunde prefixos parecidos nem rota ausente", () => {
    expect(itemAtivo("/conta/clientes-antigos", "/conta/clientes")).toBe(false);
    expect(itemAtivo("/conta/agendamentos", "/conta/clientes")).toBe(false);
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
