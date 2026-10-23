import { describe, expect, it } from "vitest";
import {
  ehAcesso,
  ehListaEstabelecimentos,
  ehDetalheEstabelecimento,
  precoCatalogo,
} from "./contratos";

const estabelecimento = {
  id: "t1",
  name: "Estúdio",
  slug: "estudio",
  category: "OTHER",
  timezone: "America/Sao_Paulo",
  status: "TRIAL",
  createdAt: "2026-10-01T12:00:00.000Z",
  owners: [
    {
      id: "u1",
      name: "Pessoa",
      email: "pessoa@example.test",
      phone: null,
      status: "ACTIVE",
    },
  ],
  plan: {
    id: "p1",
    code: "equipe",
    name: "Equipe",
    catalogPriceCents: null,
    maxProfessionals: 5,
    maxUnits: 1,
  },
};
const lista = {
  items: [estabelecimento],
  total: 1,
  page: 1,
  pageSize: 20,
  summary: { total: 10, active: 4, trial: 5, restricted: 1 },
  plans: [{ id: "p1", name: "Equipe" }],
};
describe("contrato da administração", () => {
  it("preço indefinido não é zero nem pagamento recebido", () => {
    expect(precoCatalogo(null)).toBe("Não definido");
    expect(precoCatalogo(0)).toMatch(/0,00/);
    expect(precoCatalogo(12345)).toMatch(/123,45/);
  });
  it("não aceita uma permissão textual ou ausente", () => {
    expect(ehAcesso({ canViewEstablishments: "true" })).toBe(false);
    expect(ehAcesso({})).toBe(false);
    expect(ehAcesso({ canViewEstablishments: false })).toBe(true);
    const caps = { viewDirectory: true, manageEstablishments: false, managePlatformAccess: false };
    expect(ehAcesso({ canViewEstablishments: true, capabilities: caps })).toBe(true);
    expect(ehAcesso({ canViewEstablishments: true, capabilities: { ...caps, managePlatformAccess: "sim" } })).toBe(false);
  });
  it("totais devem vir do servidor: página vazia não substitui total global", () => {
    expect(ehListaEstabelecimentos(lista)).toBe(true);
    expect(ehListaEstabelecimentos({ ...lista, items: [], total: 0 })).toBe(
      true,
    );
    expect(ehListaEstabelecimentos({ ...lista, summary: undefined })).toBe(
      false,
    );
    expect(ehListaEstabelecimentos({ ...lista, total: "1" })).toBe(false);
  });
  it("recusa resposta quebrada, preço negativo ou status desconhecido", () => {
    for (const item of [
      { ...estabelecimento, createdAt: "ontem" },
      { ...estabelecimento, status: "PAGO" },
      {
        ...estabelecimento,
        plan: { ...estabelecimento.plan, catalogPriceCents: -10 },
      },
    ]) {
      expect(ehListaEstabelecimentos({ ...lista, items: [item] })).toBe(false);
    }
  });
  it("detalhe só aceita uso e período válidos, com financeiro explicitamente indisponível", () => {
    const detail = {
      ...estabelecimento,
      units: [],
      usage: { professionals: 1, services: 2, consumers: 3 },
      trial: {
        trialStartAt: "2026-10-01T12:00:00Z",
        trialEndAt: "2026-10-15T12:00:00Z",
        durationDays: 14,
      },
      billing: { available: false },
    };
    expect(ehDetalheEstabelecimento(detail)).toBe(true);
    expect(
      ehDetalheEstabelecimento({ ...detail, billing: { available: true } }),
    ).toBe(false);
    expect(
      ehDetalheEstabelecimento({ ...detail, usage: { professionals: null } }),
    ).toBe(false);
  });
});
