import { describe, expect, it } from "vitest";
import {
  ehCatalogoDePrecos,
  ehListaDePagamentos,
  ehPrecoDoEstabelecimento,
  ehSemVencimento,
  ehSituacaoComercial,
} from "./contratos-validade";
import { consequenciaDaRetirada, origemDoValorDigitado, textoDoValor, validadeDepoisDaCorrecao } from "./validade";

describe("portal: preço do cliente", () => {
  const precos = {
    planId: "plan_pro",
    preferredCycle: "MONTHLY",
    cycles: [
      { cycle: "MONTHLY", catalogCents: 4990, contractCents: 3990, suggestedCents: 3990, source: "CONTRACT" },
      { cycle: "QUARTERLY", catalogCents: null, contractCents: null, suggestedCents: null, source: "PENDING" },
    ],
    contractHistory: [],
  };

  it("aceita contrato, catálogo e pendente; pendente nunca vem com valor", () => {
    expect(ehPrecoDoEstabelecimento(precos)).toBe(true);
    const pendenteComValor = { ...precos, cycles: [{ ...precos.cycles[1], suggestedCents: 0 }] };
    expect(ehPrecoDoEstabelecimento(pendenteComValor)).toBe(false);
    const semSugestao = { ...precos, cycles: [{ ...precos.cycles[0], suggestedCents: null }] };
    expect(ehPrecoDoEstabelecimento(semSugestao)).toBe(false);
  });

  it("origem do valor digitado: igual à sugestão ou ajuste só deste pagamento", () => {
    const contrato = precos.cycles[0] as Parameters<typeof origemDoValorDigitado>[1];
    expect(origemDoValorDigitado(3990, contrato)).toBe("CONTRACT");
    expect(origemDoValorDigitado(4990, contrato)).toBe("ADJUSTED");
    expect(origemDoValorDigitado(null, contrato)).toBeNull();
    const pendente = precos.cycles[1] as Parameters<typeof origemDoValorDigitado>[1];
    expect(origemDoValorDigitado(5000, pendente)).toBe("ADJUSTED");
  });

  it("valor no campo sem perder centavos (R$ 42,50 + R$ 25,00)", () => {
    expect(textoDoValor(4250)).toBe("42,50");
    expect(textoDoValor(2500)).toBe("25,00");
    expect(textoDoValor(6750)).toBe("67,50");
    expect(textoDoValor(5)).toBe("0,05");
  });

  it("catálogo e lista de pagamentos das assinaturas", () => {
    expect(
      ehCatalogoDePrecos({
        canManage: true,
        history: [],
        items: [
          {
            id: "plan_essencial",
            code: "essencial",
            name: "Básico",
            maxProfessionals: 2,
            prices: [
              { cycle: "MONTHLY", current: null },
              { cycle: "QUARTERLY", current: null },
            ],
          },
        ],
      }),
    ).toBe(true);
    expect(ehListaDePagamentos({ items: [], total: 0, page: 1, pageSize: 30 })).toBe(true);
    expect(ehListaDePagamentos({ items: [{ id: "x" }], total: 1, page: 1, pageSize: 30 })).toBe(false);
  });
});

describe("portal: sem vencimento", () => {
  it("situação NO_EXPIRY é aceita e descrita sem data", () => {
    const s = { state: "NO_EXPIRY", noExpiry: true, legacy: false, blocked: false, validUntil: null, lastDay: null, expiredAt: null, expiredKind: null };
    expect(ehSituacaoComercial(s)).toBe(true);
    expect(validadeDepoisDaCorrecao(s, "America/Sao_Paulo")).toBe("sem vencimento (concessão em vigor)");
  });

  it("consequência da retirada: segue pelos períodos, vencido ou sem período (bloqueia)", () => {
    expect(
      consequenciaDaRetirada({ state: "PAID", blocked: false, validUntil: "2027-03-01T03:00:00.000Z", lastDay: "2027-02-28", expiredAt: null }),
    ).toContain("até 28/02/2027");
    expect(
      consequenciaDaRetirada({ state: "EXPIRED", blocked: true, validUntil: null, lastDay: null, expiredAt: "2026-10-01T03:00:00.000Z" }),
    ).toContain("fica bloqueado");
    const semPeriodo = consequenciaDaRetirada({ state: "MISSING", blocked: true, validUntil: null, lastDay: null, expiredAt: null });
    expect(semPeriodo).toContain("não há período registrado");
    expect(semPeriodo).toContain("nenhum agendamento é cancelado");
  });

  it("valida o bloco de concessões", () => {
    const concessao = {
      id: "g1",
      grantedAt: "2026-11-01T12:00:00.000Z",
      grantedBy: { id: "u1", name: "Pessoa" },
      reason: "parceria",
      revoked: null,
    };
    expect(ehSemVencimento({ active: concessao, history: [concessao], revokePreview: { state: "MISSING", blocked: true, validUntil: null, lastDay: null, expiredAt: null } })).toBe(true);
    expect(ehSemVencimento({ active: null, history: [], revokePreview: null })).toBe(true);
    expect(ehSemVencimento({ active: { ...concessao, reason: 1 }, history: [], revokePreview: null })).toBe(false);
  });
});
