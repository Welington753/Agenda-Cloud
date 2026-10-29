import { describe, expect, it } from "vitest";
import { ehPeriodoDeAcesso, ehSituacaoComercial } from "./contratos-validade";

const periodo = {
  id: "per_1",
  kind: "PAID",
  plan: { id: "plan_pro", name: "Max" },
  startsAt: "2026-10-29T03:00:00.000Z",
  endsAt: "2026-11-29T03:00:00.000Z",
  firstDay: "2026-10-29",
  lastDay: "2026-11-28",
  cycle: "MONTHLY",
  amountCents: 99999,
  currency: "BRL",
  paymentMethod: "PIX",
  receivedOn: "2026-10-29",
  reference: null,
  confirmationSource: "MANUAL",
  reason: null,
  recordedAt: "2026-10-29T15:00:00.000Z",
  recordedBy: { id: "user_1", name: "Pessoa" },
};

describe("contratos da validade do acesso", () => {
  it("situação: sem validade registrada e validade ainda não definida", () => {
    const situacao = { state: "MISSING", legacy: false, blocked: true, validUntil: null, lastDay: null, expiredAt: null, expiredKind: null };
    expect(ehSituacaoComercial(situacao)).toBe(true);
    expect(ehSituacaoComercial({ ...situacao, state: "UNTRACKED", legacy: true, blocked: false })).toBe(true);
    expect(ehSituacaoComercial({ ...situacao, legacy: "sim" })).toBe(false);
    expect(ehSituacaoComercial({ ...situacao, state: "ACTIVE" })).toBe(false);
  });

  it("registro anulado e prévia da correção; API anterior sem os campos novos é aceita", () => {
    expect(ehPeriodoDeAcesso(periodo)).toBe(true);
    const anulado = {
      ...periodo,
      canceled: { at: "2026-10-30T12:00:00.000Z", by: { id: "user_1", name: "Pessoa" }, reason: "valor errado" },
      correction: null,
    };
    expect(ehPeriodoDeAcesso(anulado)).toBe(true);
    expect(ehPeriodoDeAcesso({ ...anulado, canceled: { at: "ontem" } })).toBe(false);
    const previa = { allowed: true, after: { state: "EXPIRED", blocked: true, validUntil: null } };
    expect(ehPeriodoDeAcesso({ ...periodo, canceled: null, correction: previa })).toBe(true);
    expect(ehPeriodoDeAcesso({ ...periodo, correction: { allowed: false, blockedByPeriodId: "per_2" } })).toBe(true);
    expect(ehPeriodoDeAcesso({ ...periodo, correction: { allowed: true } })).toBe(false);
  });
});
