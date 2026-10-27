import { describe, expect, it } from "vitest";
import { inicioDoPerfil, perfilDoPapel, redirecionamentoDoPerfil } from "./papel";

describe("perfil da área real por papel", () => {
  it("DONO opera, PROFISSIONAL é funcionário, os demais não têm área", () => {
    expect(perfilDoPapel("DONO")).toBe("dono");
    expect(perfilDoPapel("PROFISSIONAL")).toBe("funcionario");
    expect(perfilDoPapel("GERENTE")).toBe("sem-area");
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
