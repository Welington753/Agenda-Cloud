import { describe, expect, it } from "vitest";
import { ehListaDoDiretorio, ehRelatorioDoPeriodo } from "./contratos-diretorio";
import { ehListaDePagamentos } from "./contratos";

const relatorio = () => ({
  generatedAt: "2026-11-11T12:00:00.000Z",
  scope: "CLIENTS",
  timeZone: "America/Sao_Paulo",
  period: { from: "2026-10-01", to: "2026-10-31", month: "2026-10", days: 31 },
  currency: "BRL",
  payments: { count: 3, totalCents: 26000, canceledCount: 1 },
  byPlanCycle: [
    { planId: "p1", planName: "Plano fictício", cycle: "MONTHLY", count: 2, totalCents: 11000 },
    { planId: "p1", planName: "Plano fictício", cycle: "QUARTERLY", count: 1, totalCents: 15000 },
  ],
  registrations: { count: 2 },
});

describe("contrato do relatório por período", () => {
  it("aceita a resposta completa, inclusive período vazio", () => {
    expect(ehRelatorioDoPeriodo(relatorio())).toBe(true);
    expect(
      ehRelatorioDoPeriodo({ ...relatorio(), payments: { count: 0, totalCents: 0, canceledCount: 0 }, byPlanCycle: [] }),
    ).toBe(true);
  });

  it("resposta incompleta nunca vira zero: sem alcance, sem período ou sem campos é recusada", () => {
    const sem = (campo: string) => Object.fromEntries(Object.entries(relatorio()).filter(([k]) => k !== campo));
    for (const v of [sem("scope"), sem("period"), sem("registrations"), sem("payments"), {}, null, { ...relatorio(), currency: "USD" }]) {
      expect(ehRelatorioDoPeriodo(v)).toBe(false);
    }
  });

  it("detalhamento por plano e ciclo tem de somar o total", () => {
    const r = relatorio();
    r.byPlanCycle[0].totalCents = 10000;
    expect(ehRelatorioDoPeriodo(r)).toBe(false);
    const c = relatorio();
    c.byPlanCycle.pop();
    expect(ehRelatorioDoPeriodo(c)).toBe(false);
  });
});

describe("filtros ecoados pela API", () => {
  const lista = { items: [], total: 0, page: 1, pageSize: 30 };
  it("extrato: API anterior (sem eco) continua válida; eco nova validada", () => {
    expect(ehListaDePagamentos(lista)).toBe(true);
    expect(ehListaDePagamentos({ ...lista, from: "2026-10-01", to: "2026-10-31", scope: "CLIENTS", status: "RECEIVED" })).toBe(true);
    expect(ehListaDePagamentos({ ...lista, from: null, to: null, scope: "ALL", status: null })).toBe(true);
    expect(ehListaDePagamentos({ ...lista, scope: "TESTE" })).toBe(false);
    expect(ehListaDePagamentos({ ...lista, status: "PENDING" })).toBe(false);
  });

  it("lista: período de cadastro ecoado ou ausente", () => {
    const base = { items: [], total: 0, page: 1, pageSize: 20, summary: { total: 0, active: 0, trial: 0, restricted: 0 }, plans: [] };
    expect(ehListaDoDiretorio(base)).toBe(true);
    expect(ehListaDoDiretorio({ ...base, created: null })).toBe(true);
    expect(ehListaDoDiretorio({ ...base, created: { from: "2026-10-01", to: "2026-10-31", timeZone: "America/Sao_Paulo" } })).toBe(true);
    expect(ehListaDoDiretorio({ ...base, created: { from: "ontem" } })).toBe(false);
  });
});
