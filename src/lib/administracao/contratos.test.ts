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
      usage: {
        professionals: 1,
        services: 2,
        consumers: 3,
        units: 1,
        staffSeats: { limit: 3, activeAccesses: 1, pendingInvites: 0, suspendedAccesses: 0, used: 1, available: 2 },
      },
      trial: {
        trialStartAt: "2026-10-01T12:00:00Z",
        trialEndAt: "2026-10-15T12:00:00Z",
        durationDays: 14,
      },
      access: {
        state: "PAID",
        blocked: false,
        validUntil: "2026-11-29T03:00:00.000Z",
        lastDay: "2026-11-28",
        expiredAt: null,
        expiredKind: null,
      },
      accessPeriods: [
        {
          id: "per_1",
          kind: "PAID",
          plan: { id: "plan_1", name: "Básico" },
          startsAt: "2026-10-29T03:00:00.000Z",
          endsAt: "2026-11-29T03:00:00.000Z",
          firstDay: "2026-10-29",
          lastDay: "2026-11-28",
          cycle: "MONTHLY",
          amountCents: 4990,
          currency: "BRL",
          paymentMethod: "PIX",
          receivedOn: "2026-10-29",
          reference: null,
          confirmationSource: "MANUAL",
          reason: null,
          recordedAt: "2026-10-29T15:00:00.000Z",
          recordedBy: { id: "user_1", name: "Pessoa" },
        },
      ],
      updatedAt: "2026-10-20T12:00:00Z",
      restoreStatus: null,
      suspensionReason: null,
      taxDocument: null,
      planOptions: [
        {
          id: "plan_1",
          code: "essencial",
          name: "Essencial",
          catalogPriceCents: null,
          maxProfessionals: 1,
          maxUnits: 1,
          excess: [{ kind: "PROFESSIONALS", used: 2, limit: 1, action: "Desative 1 profissional." }],
        },
      ],
      allowedActions: {
        edit: true,
        suspend: true,
        archive: true,
        reactivate: false,
        changePlan: true,
        recordPayment: true,
        extendTrial: false,
        grantCourtesy: true,
      },
    };
    expect(ehDetalheEstabelecimento(detail)).toBe(true);
    expect(ehDetalheEstabelecimento({ ...detail, status: "ARCHIVED" })).toBe(true);
    expect(ehDetalheEstabelecimento({ ...detail, allowedActions: { edit: true } })).toBe(false);
    expect(
      ehDetalheEstabelecimento({ ...detail, usage: { ...detail.usage, staffSeats: { used: 1 } } }),
    ).toBe(false);
    // Validade e histórico são obrigatórios e conferidos campo a campo.
    expect(ehDetalheEstabelecimento({ ...detail, access: undefined })).toBe(false);
    expect(ehDetalheEstabelecimento({ ...detail, access: { ...detail.access, state: "ACTIVE" } })).toBe(false);
    expect(
      ehDetalheEstabelecimento({
        ...detail,
        accessPeriods: [{ ...detail.accessPeriods[0], confirmationSource: "BANCO" }],
      }),
    ).toBe(false);
    expect(
      ehDetalheEstabelecimento({ ...detail, accessPeriods: [{ ...detail.accessPeriods[0], lastDay: "28/11/2026" }] }),
    ).toBe(false);
    expect(
      ehDetalheEstabelecimento({ ...detail, usage: { professionals: null } }),
    ).toBe(false);
  });
});
