import { describe, expect, it } from "vitest";
import {
  ITENS_MENU_MAIS,
  ITENS_NAVEGACAO_CONTA,
  itemAtivo,
  itensDaNavegacao,
  rotuloDoSino,
} from "./navegacao";

describe("ITENS_NAVEGACAO_CONTA", () => {
  it("só aponta para a área real, na ordem do dia a dia", () => {
    expect(ITENS_NAVEGACAO_CONTA.map((i) => i.href)).toEqual([
      "/conta/visao-geral",
      "/conta/agendamentos",
      "/conta/solicitacoes",
      "/conta/clientes",
      "/conta/servicos",
      "/conta/profissionais",
      "/conta/equipe",
      "/conta",
    ]);
    expect(ITENS_NAVEGACAO_CONTA.map((i) => i.rotulo)).toEqual([
      "Visão geral",
      "Agenda",
      "Solicitações",
      "Clientes",
      "Serviços",
      "Profissionais",
      "Equipe e acessos",
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
    expect(ITENS_MENU_MAIS.map((i) => i.rotulo)).toEqual([
      "Solicitações",
      "Profissionais",
      "Equipe e acessos",
      "Minha conta",
    ]);
  });
});

describe("itensDaNavegacao", () => {
  const rotulos = (itens: ReturnType<typeof itensDaNavegacao>) => itens.map((i) => i.rotulo);

  it("sem acesso confirmado à plataforma, o menu é o de sempre", () => {
    expect(itensDaNavegacao({ comEstabelecimento: true, comAdministracao: false })).toBe(
      ITENS_NAVEGACAO_CONTA,
    );
  });

  it("com acesso, Administração vem por último, no grupo da plataforma e no Mais do celular", () => {
    const itens = itensDaNavegacao({ comEstabelecimento: true, comAdministracao: true });
    expect(rotulos(itens)).toEqual([...rotulos(ITENS_NAVEGACAO_CONTA), "Administração"]);
    expect(itens.at(-1)).toEqual({
      href: "/conta/administracao",
      rotulo: "Administração",
      noCelular: "mais",
      grupo: "plataforma",
    });
    // A barra do celular continua com as mesmas quatro áreas.
    expect(rotulos(itens.filter((i) => i.noCelular === "barra"))).toEqual([
      "Visão geral",
      "Agenda",
      "Clientes",
      "Serviços",
    ]);
  });

  it("administrador sem estabelecimento vê só Administração e Minha conta, na barra", () => {
    const itens = itensDaNavegacao({ comEstabelecimento: false, comAdministracao: true });
    expect(itens.map((i) => [i.href, i.noCelular])).toEqual([
      ["/conta/administracao", "barra"],
      ["/conta", "barra"],
    ]);
  });

  it("sem estabelecimento e sem acesso, não há menu", () => {
    expect(itensDaNavegacao({ comEstabelecimento: false, comAdministracao: false })).toEqual([]);
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
    expect(itemAtivo("/conta/administracao/estabelecimentos/t1", "/conta/administracao")).toBe(true);
    expect(itemAtivo("/conta/administracao/estabelecimentos", "/conta")).toBe(false);
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

describe("itensDaNavegacao por perfil", () => {
  it("funcionário: só Minha agenda e Minha conta, na barra do celular", () => {
    const itens = itensDaNavegacao({ comEstabelecimento: true, comAdministracao: false, perfil: "funcionario" });
    expect(itens.map((i) => [i.href, i.noCelular])).toEqual([
      ["/conta/minha-agenda", "barra"],
      ["/conta", "barra"],
    ]);
  });

  it("funcionário que também administra a plataforma vê a Administração", () => {
    const itens = itensDaNavegacao({ comEstabelecimento: true, comAdministracao: true, perfil: "funcionario" });
    expect(itens.map((i) => i.rotulo)).toEqual(["Minha agenda", "Minha conta", "Administração"]);
  });

  it("papel sem área: só Minha conta; nenhuma área do dono", () => {
    const itens = itensDaNavegacao({ comEstabelecimento: true, comAdministracao: false, perfil: "sem-area" });
    expect(itens.map((i) => i.href)).toEqual(["/conta"]);
  });
});
