import { describe, expect, it } from "vitest";
import type { PermissaoDeGerenteNoCatalogo, PermissaoGerente } from "./contratos";
import { ajustarAoPerfil, alternarArea, areasDoCatalogo, catalogoDoPerfil, exigidaPor, ofereceRecepcionista, resumoDasPermissoes } from "./permissoes";

const item = (permission: PermissaoGerente, area: string, requires: PermissaoGerente[] = []): PermissaoDeGerenteNoCatalogo => ({
  permission,
  area,
  areaLabel: area === "AGENDA" ? "Agenda do estabelecimento" : area,
  label: permission,
  detail: "",
  requires,
  grantable: true,
});

const CATALOGO = [
  item("AGENDA_VISUALIZAR", "AGENDA", ["PROFISSIONAIS_VISUALIZAR"]),
  item("AGENDAMENTO_CRIAR", "AGENDA", ["AGENDA_VISUALIZAR", "PROFISSIONAIS_VISUALIZAR", "SERVICOS_VISUALIZAR", "CONSUMIDORES_VISUALIZAR"]),
  item("CONSUMIDORES_VISUALIZAR", "CLIENTES"),
  item("SERVICOS_VISUALIZAR", "SERVICOS"),
  item("PROFISSIONAIS_VISUALIZAR", "PROFISSIONAIS"),
];

describe("escolha de permissões do gerente", () => {
  it("marcar traz as dependências; desmarcar uma dependência tira o que dependia dela", () => {
    const comCriar = alternarArea(CATALOGO, [], "AGENDAMENTO_CRIAR", true);
    expect(comCriar).toEqual([
      "AGENDA_VISUALIZAR",
      "AGENDAMENTO_CRIAR",
      "CONSUMIDORES_VISUALIZAR",
      "SERVICOS_VISUALIZAR",
      "PROFISSIONAIS_VISUALIZAR",
    ]);
    expect(exigidaPor(CATALOGO, comCriar, "CONSUMIDORES_VISUALIZAR").map((c) => c.permission)).toEqual(["AGENDAMENTO_CRIAR"]);
    // Sem profissionais, cai a agenda e, por ela, criar reservas.
    expect(alternarArea(CATALOGO, comCriar, "PROFISSIONAIS_VISUALIZAR", false)).toEqual([
      "CONSUMIDORES_VISUALIZAR",
      "SERVICOS_VISUALIZAR",
    ]);
  });

  it("o perfil decide o que vale: áreas só no gerente; ações próprias só com profissional", () => {
    const marcadas = ["AGENDA_VISUALIZAR", "ATENDIMENTO_PROPRIO_INICIAR"] as const;
    expect(ajustarAoPerfil(marcadas, "PROFISSIONAL", true)).toEqual(["ATENDIMENTO_PROPRIO_INICIAR"]);
    expect(ajustarAoPerfil(marcadas, "GERENTE", false)).toEqual(["AGENDA_VISUALIZAR"]);
    expect(ajustarAoPerfil(marcadas, "GERENTE", true)).toEqual(marcadas);
  });

  it("o resumo lista por área exatamente o que será concedido", () => {
    expect(areasDoCatalogo(CATALOGO).map((g) => g.area)).toEqual(["AGENDA", "CLIENTES", "SERVICOS", "PROFISSIONAIS"]);
    expect(
      resumoDasPermissoes(CATALOGO, [{ permission: "ATENDIMENTO_PROPRIO_INICIAR", label: "Iniciar os próprios atendimentos" }], [
        "AGENDA_VISUALIZAR",
        "PROFISSIONAIS_VISUALIZAR",
        "ATENDIMENTO_PROPRIO_INICIAR",
      ]),
    ).toEqual([
      "Agenda do estabelecimento: agenda_visualizar",
      "PROFISSIONAIS: profissionais_visualizar",
      "Próprios atendimentos: iniciar os próprios atendimentos",
    ]);
  });
});

describe("perfil Recepcionista", () => {
  const VENDAS = [
    item("ESTOQUE_VISUALIZAR", "ESTOQUE"),
    item("VENDAS_REGISTRAR", "VENDAS"),
    item("VENDAS_RECEBER", "VENDAS", ["VENDAS_REGISTRAR"]),
    item("VENDAS_ALTERAR_PRECO", "VENDAS", ["VENDAS_REGISTRAR"]),
    item("VENDAS_VISUALIZAR", "VENDAS"),
    item("VENDAS_CANCELAR", "VENDAS", ["VENDAS_VISUALIZAR"]),
  ];
  const visao = { managerPermissions: [...CATALOGO, ...VENDAS], receptionistPermissions: ["VENDAS_REGISTRAR", "VENDAS_RECEBER", "VENDAS_ALTERAR_PRECO"] as PermissaoGerente[] };

  it("só as três áreas de vendas dela, nunca estoque, agenda ou consulta geral", () => {
    expect(catalogoDoPerfil(visao, "RECEPCIONISTA").map((c) => c.permission)).toEqual(["VENDAS_REGISTRAR", "VENDAS_RECEBER", "VENDAS_ALTERAR_PRECO"]);
    expect(catalogoDoPerfil(visao, "GERENTE")).toHaveLength(CATALOGO.length + VENDAS.length);
    expect(catalogoDoPerfil(visao, "PROFISSIONAL")).toEqual([]);
  });

  it("trocar para Recepcionista tira o que não se aplica", () => {
    expect(
      ajustarAoPerfil(["AGENDA_VISUALIZAR", "ESTOQUE_VISUALIZAR", "VENDAS_REGISTRAR", "VENDAS_VISUALIZAR", "ATENDIMENTO_PROPRIO_INICIAR"], "RECEPCIONISTA", true),
    ).toEqual(["VENDAS_REGISTRAR"]);
  });

  it("receber traz junto registrar; cada uma é marcada em separado", () => {
    const catalogo = catalogoDoPerfil(visao, "RECEPCIONISTA");
    expect(alternarArea(catalogo, [], "VENDAS_RECEBER", true)).toEqual(["VENDAS_REGISTRAR", "VENDAS_RECEBER"]);
    expect(alternarArea(catalogo, [], "VENDAS_REGISTRAR", true)).toEqual(["VENDAS_REGISTRAR"]);
  });

  it("a tela só oferece o perfil com a API que o conhece", () => {
    expect(ofereceRecepcionista(visao)).toBe(true);
    expect(ofereceRecepcionista({})).toBe(false);
  });
});
