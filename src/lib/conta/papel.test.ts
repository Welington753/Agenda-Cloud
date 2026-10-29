import { describe, expect, it } from "vitest";
import { inicioDoPerfil, paginaForaDoEstabelecimento, perfilDoPapel, redirecionamentoDoPerfil, temArea } from "./papel";
import { acessoVencido } from "@/lib/api/auth-api";
import { itensDaNavegacao } from "./navegacao";

describe("perfil da área real por papel", () => {
  it("DONO opera, PROFISSIONAL é funcionário, GERENTE tem as áreas concedidas, os demais não têm área", () => {
    expect(perfilDoPapel("DONO")).toBe("dono");
    expect(perfilDoPapel("PROFISSIONAL")).toBe("funcionario");
    expect(perfilDoPapel("GERENTE")).toBe("gerente");
    expect(perfilDoPapel("RECEPCIONISTA")).toBe("sem-area");
    expect(perfilDoPapel(null)).toBe("sem-area");
  });

  it("cada perfil começa na sua página", () => {
    expect(inicioDoPerfil("dono")).toBe("/conta/visao-geral");
    expect(inicioDoPerfil("funcionario")).toBe("/conta/minha-agenda");
    expect(inicioDoPerfil("sem-area")).toBe("/conta/configuracoes");
  });
});

describe("redirecionamentoDoPerfil", () => {
  it("o funcionário que abre a operação do dono pelo endereço vai para a própria agenda", () => {
    for (const caminho of [
      "/conta/visao-geral",
      "/conta/agendamentos",
      "/conta/agendamentos/solicitacoes",
      "/conta/clientes",
    ]) {
      expect(redirecionamentoDoPerfil("funcionario", caminho), caminho).toBe("/conta/minha-agenda");
    }
    expect(redirecionamentoDoPerfil("funcionario", "/conta/minha-agenda")).toBeNull();
    expect(redirecionamentoDoPerfil("funcionario", "/conta")).toBeNull();
  });

  it("configurações do estabelecimento levam o funcionário às configurações dele", () => {
    for (const caminho of [
      "/conta/configuracoes/estabelecimento",
      "/conta/configuracoes/servicos/",
      "/conta/configuracoes/profissionais/abc/horarios",
      "/conta/configuracoes/equipe",
      "/conta/configuracoes/notificacoes",
    ]) {
      expect(redirecionamentoDoPerfil("funcionario", caminho), caminho).toBe("/conta/configuracoes");
      expect(redirecionamentoDoPerfil("sem-area", caminho), caminho).toBe("/conta/configuracoes");
      expect(redirecionamentoDoPerfil("dono", caminho), caminho).toBeNull();
    }
  });

  it("configurações pessoais valem para todos", () => {
    for (const perfil of ["dono", "funcionario", "sem-area"] as const) {
      for (const caminho of ["/conta/configuracoes", "/conta/configuracoes/aparencia", "/conta/configuracoes/perfil"]) {
        expect(redirecionamentoDoPerfil(perfil, caminho), `${perfil} ${caminho}`).toBeNull();
      }
    }
  });

  it("o dono não usa a agenda de funcionário; o resto continua dele", () => {
    expect(redirecionamentoDoPerfil("dono", "/conta/minha-agenda")).toBe("/conta/agendamentos");
    expect(redirecionamentoDoPerfil("dono", "/conta/agendamentos/solicitacoes")).toBeNull();
    expect(redirecionamentoDoPerfil("dono", "/conta/agendamentos")).toBeNull();
  });

  it("páginas comuns valem para todos, inclusive a administração da plataforma", () => {
    for (const perfil of ["dono", "funcionario", "sem-area"] as const) {
      for (const caminho of ["/conta", "/conta/selecionar-estabelecimento", "/conta/administracao/usuarios"]) {
        expect(redirecionamentoDoPerfil(perfil, caminho)).toBeNull();
      }
    }
    expect(redirecionamentoDoPerfil("sem-area", "/conta/agendamentos")).toBe("/conta/configuracoes");
    expect(redirecionamentoDoPerfil("sem-area", "/conta/minha-agenda")).toBe("/conta/configuracoes");
  });
});

describe("gerente: só as áreas que o servidor liberou", () => {
  const gerente = (areas: string[]) => ({ role: "GERENTE" as const, areas });

  it("sem área nenhuma: só Configurações; um gerente antigo sem a lista também", () => {
    expect(inicioDoPerfil("gerente", gerente([]))).toBe("/conta/configuracoes");
    expect(temArea({ role: "GERENTE" }, "AGENDA_VER")).toBe(false);
    expect(redirecionamentoDoPerfil("gerente", "/conta/agendamentos", gerente([]))).toBe("/conta/configuracoes");
    expect(
      itensDaNavegacao({ comEstabelecimento: true, comAdministracao: false, perfil: "gerente", contexto: gerente([]) }).map((i) => i.rotulo),
    ).toEqual(["Configurações"]);
  });

  it("menu e começo seguem as áreas; a URL de uma área não concedida leva ao começo", () => {
    const g = gerente(["AGENDA_VER", "PROFISSIONAIS_VER", "SOLICITACOES_VER", "RECEBIMENTOS_VER", "AGENDA_PROPRIA_VER"]);
    expect(inicioDoPerfil("gerente", g)).toBe("/conta/agendamentos");
    const itens = itensDaNavegacao({ comEstabelecimento: true, comAdministracao: false, perfil: "gerente", contexto: g });
    expect(itens.map((i) => i.rotulo)).toEqual(["Agenda", "Minha agenda", "Recebimentos", "Profissionais", "Configurações"]);
    expect(itens.filter((i) => i.noCelular === "barra").map((i) => i.rotulo)).toEqual([
      "Agenda",
      "Minha agenda",
      "Recebimentos",
      "Configurações",
    ]);
    for (const livre of ["/conta/agendamentos", "/conta/agendamentos/solicitacoes", "/conta/recebimentos", "/conta/minha-agenda"]) {
      expect(redirecionamentoDoPerfil("gerente", livre, g), livre).toBeNull();
    }
    for (const fechada of [
      "/conta/visao-geral",
      "/conta/clientes",
      "/conta/configuracoes/servicos",
      "/conta/configuracoes/equipe",
      "/conta/configuracoes/estabelecimento",
    ]) {
      expect(redirecionamentoDoPerfil("gerente", fechada, g), fechada).toBe("/conta/agendamentos");
    }
    // Personais continuam de todos.
    expect(redirecionamentoDoPerfil("gerente", "/conta/configuracoes/perfil", g)).toBeNull();
  });

  it("só solicitações: o item próprio no menu, e a agenda geral fica fechada", () => {
    const g = gerente(["SOLICITACOES_VER"]);
    expect(inicioDoPerfil("gerente", g)).toBe("/conta/agendamentos/solicitacoes");
    expect(redirecionamentoDoPerfil("gerente", "/conta/agendamentos/solicitacoes", g)).toBeNull();
    expect(redirecionamentoDoPerfil("gerente", "/conta/agendamentos", g)).toBe("/conta/agendamentos/solicitacoes");
    expect(
      itensDaNavegacao({ comEstabelecimento: true, comAdministracao: false, perfil: "gerente", contexto: g }).map((i) => i.rotulo),
    ).toEqual(["Solicitações", "Configurações"]);
  });
});

describe("acesso do estabelecimento vencido", () => {
  it("só o bloqueio informado pelo servidor conta; API anterior (sem a validade) não vence", () => {
    expect(acessoVencido({ access: { state: "EXPIRED", blocked: true, validUntil: null, expiredAt: null, expiredKind: "TRIAL" } })).toBe(true);
    expect(acessoVencido({ access: { state: "PAID", blocked: false, validUntil: null, expiredAt: null, expiredKind: null } })).toBe(false);
    expect(acessoVencido({})).toBe(false);
    expect(acessoVencido(null)).toBe(false);
  });

  it("continuam abertas: administração, escolha de estabelecimento e configurações pessoais", () => {
    for (const aberta of ["/conta/administracao", "/conta/administracao/estabelecimentos/x", "/conta/selecionar-estabelecimento", "/conta/configuracoes/perfil", "/conta/configuracoes"]) {
      expect(paginaForaDoEstabelecimento(aberta)).toBe(true);
    }
    for (const doEstabelecimento of ["/conta", "/conta/agendamentos", "/conta/clientes", "/conta/recebimentos", "/conta/visao-geral", "/conta/configuracoes/estabelecimento", "/conta/configuracoes/equipe"]) {
      expect(paginaForaDoEstabelecimento(doEstabelecimento)).toBe(false);
    }
  });
});
