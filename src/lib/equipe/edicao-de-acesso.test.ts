import { describe, expect, it } from "vitest";
import { corpoDaEdicao, ehAcessoEditado, resultadoDaEdicao, type EstadoDoAcesso } from "./edicao-de-acesso";

const profissional: EstadoDoAcesso = {
  role: "PROFISSIONAL",
  professionalId: "p1",
  granted: ["ATENDIMENTO_PROPRIO_INICIAR"],
};

describe("edição de perfil e profissional", () => {
  it("trocar para gerente sem profissional tira as ações próprias e não concede nada sozinha", () => {
    const r = resultadoDaEdicao(profissional, {
      perfil: "GERENTE",
      profissionalId: null,
      marcadas: profissional.granted,
    });
    expect(r).toMatchObject({
      valem: [],
      saem: ["ATENDIMENTO_PROPRIO_INICIAR"],
      entram: [],
      trocaPerfil: true,
      trocaProfissional: true,
      mudou: true,
      faltaProfissional: false,
    });
  });

  it("de gerente para profissional: as áreas do estabelecimento saem; só o que o dono marcar entra", () => {
    const gerente: EstadoDoAcesso = {
      role: "GERENTE",
      professionalId: null,
      granted: ["AGENDA_VISUALIZAR", "PROFISSIONAIS_VISUALIZAR"],
    };
    const semMarcar = resultadoDaEdicao(gerente, { perfil: "PROFISSIONAL", profissionalId: "p2", marcadas: gerente.granted });
    expect(semMarcar.valem).toEqual([]);
    expect(semMarcar.saem).toEqual(gerente.granted);
    const marcando = resultadoDaEdicao(gerente, {
      perfil: "PROFISSIONAL",
      profissionalId: "p2",
      marcadas: [...gerente.granted, "ATENDIMENTO_PROPRIO_CONCLUIR"],
    });
    expect(marcando.valem).toEqual(["ATENDIMENTO_PROPRIO_CONCLUIR"]);
    expect(marcando.entram).toEqual(["ATENDIMENTO_PROPRIO_CONCLUIR"]);
  });

  it("profissional sem profissional ligado não pode; nada mudou não é mudança", () => {
    expect(resultadoDaEdicao(profissional, { perfil: "PROFISSIONAL", profissionalId: null, marcadas: [] }).faltaProfissional).toBe(
      true,
    );
    expect(
      resultadoDaEdicao(profissional, { perfil: "PROFISSIONAL", profissionalId: "p1", marcadas: profissional.granted }).mudou,
    ).toBe(false);
  });

  it("o corpo leva o que a tela mostrava e o conjunto que vale depois", () => {
    expect(corpoDaEdicao(profissional, { perfil: "PROFISSIONAL", profissionalId: "p3", marcadas: profissional.granted })).toEqual({
      expected: { role: "PROFISSIONAL", professionalId: "p1", granted: ["ATENDIMENTO_PROPRIO_INICIAR"] },
      role: "PROFISSIONAL",
      professionalId: "p3",
      granted: ["ATENDIMENTO_PROPRIO_INICIAR"],
    });
  });

  it("confere a resposta do servidor", () => {
    expect(ehAcessoEditado({ membershipId: "m1", role: "GERENTE", professionalId: null, grantedPermissions: [] })).toBe(true);
    expect(ehAcessoEditado({ membershipId: "m1", role: "DONO", professionalId: null, grantedPermissions: [] })).toBe(false);
    expect(ehAcessoEditado(null)).toBe(false);
  });
});
