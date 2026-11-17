import { describe, expect, it } from "vitest";
import {
  FILTRO_VAZIO,
  abaDaUrl,
  buscaDaLista,
  ehListaAdministradores,
  ehListaResponsaveis,
  erroDaBusca,
  perfilAdministrativo,
  rotuloDaAcao,
  tituloDaLista,
} from "./contas-e-acessos";

const conta = {
  id: "u1",
  name: "Marina Alves",
  email: "marina@example.test",
  status: "ACTIVE",
  emailVerified: true,
  hasPassword: true,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
};
const resumo = { total: 1, active: 1, invited: 0, suspended: 0 };
const estabelecimento = { tenantId: "t1", tenantName: "Barbearia Aurora", tenantStatus: "ACTIVE", relation: "OWNER", membershipStatus: "ACTIVE" };

describe("Contas e acessos: abas", () => {
  it("a aba de administradores só abre com a permissão confirmada", () => {
    expect(abaDaUrl("administradores", true)).toBe("administradores");
    expect(abaDaUrl("administradores", false)).toBe("estabelecimentos");
    expect(abaDaUrl(null, true)).toBe("estabelecimentos");
    expect(abaDaUrl("qualquer", true)).toBe("estabelecimentos");
  });

  it("a aba vai sempre ao servidor, com busca, situação e página", () => {
    expect(buscaDaLista("estabelecimentos", FILTRO_VAZIO)).toBe("/platform/users?scope=ESTABLISHMENTS&page=1&pageSize=20");
    expect(buscaDaLista("administradores", { q: "ana", status: "SUSPENDED", page: 2 })).toBe(
      "/platform/users?scope=ADMINS&page=2&pageSize=20&q=ana&status=SUSPENDED",
    );
  });

  it("busca de 1 caractere é recusada antes de ir ao servidor", () => {
    expect(erroDaBusca(" a ")).not.toBe("");
    expect(erroDaBusca("")).toBe("");
    expect(erroDaBusca("an")).toBe("");
  });

  it("títulos, perfil e ação da linha", () => {
    expect(tituloDaLista("estabelecimentos", 1)).toBe("1 conta de estabelecimento");
    expect(tituloDaLista("estabelecimentos", 3)).toBe("3 contas de estabelecimentos");
    expect(tituloDaLista("administradores", 2)).toBe("2 administradores");
    expect(perfilAdministrativo("MASTER_OWNER")).toBe("Proprietário da plataforma");
    expect(rotuloDaAcao("INVITED")).toBe("Ver convite");
    expect(rotuloDaAcao("ACTIVE")).toBe("Ver conta");
  });
});

describe("Contas e acessos: contratos", () => {
  const responsaveis = (item: unknown, extra: Record<string, unknown> = {}) => ({
    scope: "ESTABLISHMENTS",
    items: [item],
    total: 1,
    page: 1,
    pageSize: 20,
    summary: resumo,
    ...extra,
  });

  it("aceita a lista de responsáveis com estabelecimentos", () => {
    expect(ehListaResponsaveis(responsaveis({ ...conta, establishments: [estabelecimento] }))).toBe(true);
  });

  it("recusa responsável sem estabelecimento, com dado de plataforma ou de outra aba", () => {
    expect(ehListaResponsaveis(responsaveis({ ...conta, establishments: [] }))).toBe(false);
    expect(ehListaResponsaveis(responsaveis({ ...conta, establishments: [estabelecimento], platformRole: "MASTER_OWNER" }))).toBe(false);
    expect(ehListaResponsaveis(responsaveis({ ...conta, establishments: [estabelecimento] }, { scope: "ADMINS" }))).toBe(false);
    expect(ehListaResponsaveis(responsaveis({ ...conta, establishments: [estabelecimento] }, { summary: { total: 1 } }))).toBe(false);
  });

  it("aceita administradores só com papel conhecido", () => {
    const lista = (item: unknown) => ({ scope: "ADMINS", items: [item], total: 1, page: 1, pageSize: 20, summary: resumo });
    expect(ehListaAdministradores(lista({ ...conta, platformRole: "MASTER_OWNER" }))).toBe(true);
    expect(ehListaAdministradores(lista({ ...conta, platformRole: "OUTRO" }))).toBe(false);
    expect(ehListaAdministradores(lista(conta))).toBe(false);
  });
});
