import { describe, expect, it } from "vitest";
import { itemAtivo, itensDaNavegacao, itensDoDono, rotuloDoSino } from "./navegacao";

const DONO_COM_COMISSOES = { role: "DONO" as const, areas: ["AGENDA_VER", "COMISSOES_VER", "COMISSOES_CONFIGURAR"] };
const DONO_SEM_COMISSOES = { role: "DONO" as const, areas: ["AGENDA_VER", "RECEBIMENTOS_VER"] };

describe("itensDoDono", () => {
  it("as áreas na ordem pedida, todas da área real, nos endereços de antes", () => {
    expect(itensDoDono(DONO_COM_COMISSOES).map((i) => [i.href, i.rotulo])).toEqual([
      ["/conta/visao-geral", "Dashboard"],
      ["/conta/agendamentos", "Agenda"],
      ["/conta/configuracoes/profissionais", "Profissionais"],
      ["/conta/configuracoes/servicos", "Serviços"],
      ["/conta/clientes", "Clientes"],
      ["/conta/configuracoes/equipe", "Equipe e acessos"],
      ["/conta/comissoes", "Comissões"],
      ["/conta/configuracoes", "Configurações"],
    ]);
  });

  it("quatro na barra do celular; as outras vão para o menu da conta", () => {
    const itens = itensDoDono(DONO_COM_COMISSOES);
    expect(itens.filter((i) => i.noCelular === "barra").map((i) => i.rotulo)).toEqual([
      "Dashboard",
      "Agenda",
      "Clientes",
      "Configurações",
    ]);
    expect(itens.filter((i) => i.noCelular === "menu").map((i) => i.rotulo)).toEqual([
      "Profissionais",
      "Serviços",
      "Equipe e acessos",
      "Comissões",
    ]);
  });

  it("Comissões só com a área que o servidor dá a quem tem o recurso no plano", () => {
    expect(itensDoDono(DONO_SEM_COMISSOES).map((i) => i.rotulo)).not.toContain("Comissões");
    // Sem a lista de áreas (API anterior) a tela não presume o plano.
    expect(itensDoDono({ role: "DONO" }).map((i) => i.rotulo)).not.toContain("Comissões");
    expect(itensDoDono(null).map((i) => i.rotulo)).not.toContain("Comissões");
    // A área de configurar, sozinha, não abre a página das comissões apuradas.
    expect(itensDoDono({ role: "DONO", areas: ["COMISSOES_CONFIGURAR"] }).map((i) => i.rotulo)).not.toContain("Comissões");
  });

  it("na barbearia, Profissionais aparece como Barbeiros, no mesmo endereço", () => {
    const itens = itensDoDono({ ...DONO_SEM_COMISSOES, tenantCategory: "BARBERSHOP" });
    expect(itens.map((i) => [i.href, i.rotulo])).toContainEqual(["/conta/configuracoes/profissionais", "Barbeiros"]);
    expect(itens.map((i) => i.rotulo)).not.toContain("Profissionais");
    expect(itensDoDono({ ...DONO_SEM_COMISSOES, tenantCategory: "CLINIC" }).map((i) => i.rotulo)).toContain("Profissionais");
  });

  it("não há Personalização: ela só existe na demonstração", () => {
    expect(itensDoDono(DONO_COM_COMISSOES).map((i) => i.rotulo)).not.toContain("Personalização");
  });
});

describe("itensDaNavegacao", () => {
  it("dono com estabelecimento: o menu do dono", () => {
    expect(itensDaNavegacao({ comEstabelecimento: true, contexto: DONO_COM_COMISSOES })).toEqual(itensDoDono(DONO_COM_COMISSOES));
  });

  it("o gerente não ganha Dashboard, Equipe e acessos nem Comissões, e o termo dele não muda", () => {
    const contexto = {
      role: "GERENTE" as const,
      areas: ["AGENDA_VER", "PROFISSIONAIS_VER", "COMISSOES_VER"],
      tenantCategory: "BARBERSHOP",
    };
    expect(itensDaNavegacao({ comEstabelecimento: true, perfil: "gerente", contexto }).map((i) => i.rotulo)).toEqual([
      "Agenda",
      "Profissionais",
      "Configurações",
    ]);
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
    expect(itemAtivo("/conta/configuracoes/notificacoes", "/conta/configuracoes")).toBe(true);
    expect(itemAtivo("/portal/estabelecimentos", "/conta/configuracoes")).toBe(false);
  });

  it("Serviços e Profissionais são áreas próprias, mesmo sob /conta/configuracoes", () => {
    expect(itemAtivo("/conta/configuracoes/profissionais/p1/horarios", "/conta/configuracoes")).toBe(false);
    expect(itemAtivo("/conta/configuracoes/profissionais/p1/horarios", "/conta/configuracoes/profissionais")).toBe(true);
    expect(itemAtivo("/conta/configuracoes/servicos", "/conta/configuracoes")).toBe(false);
    expect(itemAtivo("/conta/configuracoes/servicos", "/conta/configuracoes/servicos")).toBe(true);
  });

  it("Equipe e acessos é área própria; Comissões fica ativa com o período na busca", () => {
    expect(itemAtivo("/conta/configuracoes/equipe", "/conta/configuracoes")).toBe(false);
    expect(itemAtivo("/conta/configuracoes/equipe", "/conta/configuracoes/equipe")).toBe(true);
    expect(itemAtivo("/conta/comissoes", "/conta/comissoes")).toBe(true);
    expect(itemAtivo("/conta/minha-agenda/comissoes", "/conta/comissoes")).toBe(false);
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
