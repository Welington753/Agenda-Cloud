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
  const rotulos = (itens: ReturnType<typeof itensDaNavegacao>) => itens.map((i) => i.rotulo);

  it("sem acesso confirmado à plataforma, o menu é o de sempre", () => {
    expect(itensDaNavegacao({ comEstabelecimento: true, comAdministracao: false })).toBe(ITENS_NAVEGACAO_CONTA);
  });

  it("com acesso, Administração vem por último, num grupo próprio e fora da barra do celular", () => {
    const itens = itensDaNavegacao({ comEstabelecimento: true, comAdministracao: true });
    expect(rotulos(itens)).toEqual([
      "Início",
      "Agenda",
      "Clientes",
      "Serviços",
      "Profissionais",
      "Configurações",
      "Administração",
    ]);
    expect(itens.at(-1)).toEqual({
      href: "/conta/administracao",
      rotulo: "Administração",
      noCelular: "menu",
      grupo: "plataforma",
    });
    expect(rotulos(itens.filter((i) => i.noCelular === "barra"))).toEqual(["Início", "Agenda", "Clientes", "Configurações"]);
  });

  it("administrador sem estabelecimento: Administração e Configurações, na barra", () => {
    const itens = itensDaNavegacao({ comEstabelecimento: false, comAdministracao: true });
    expect(itens.map((i) => [i.href, i.noCelular])).toEqual([
      ["/conta/administracao", "barra"],
      ["/conta/configuracoes", "barra"],
    ]);
  });

  it("sem estabelecimento e sem acesso, não há menu", () => {
    expect(itensDaNavegacao({ comEstabelecimento: false, comAdministracao: false })).toEqual([]);
  });
});

describe("itensDaNavegacao por perfil", () => {
  it("funcionário: Minha agenda e Configurações, na barra do celular", () => {
    const itens = itensDaNavegacao({ comEstabelecimento: true, comAdministracao: false, perfil: "funcionario" });
    expect(itens.map((i) => [i.href, i.noCelular])).toEqual([
      ["/conta/minha-agenda", "barra"],
      ["/conta/configuracoes", "barra"],
    ]);
  });

  it("funcionário que também administra a plataforma vê a Administração", () => {
    const itens = itensDaNavegacao({ comEstabelecimento: true, comAdministracao: true, perfil: "funcionario" });
    expect(itens.map((i) => i.rotulo)).toEqual(["Minha agenda", "Configurações", "Administração"]);
  });

  it("papel sem área: só Configurações; nenhuma área do dono", () => {
    const itens = itensDaNavegacao({ comEstabelecimento: true, comAdministracao: false, perfil: "sem-area" });
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
    expect(itemAtivo("/conta/administracao/estabelecimentos/t1", "/conta/administracao")).toBe(true);
    expect(itemAtivo("/conta/administracao/estabelecimentos", "/conta/configuracoes")).toBe(false);
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
