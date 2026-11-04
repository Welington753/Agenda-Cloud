import { describe, expect, it } from "vitest";
import { ehListaDoDiretorio, ehVisaoGeral, type CondicaoComercial } from "./contratos-diretorio";
import {
  ehFiltroDoDiretorio,
  linhaCatalogo,
  linhasContratadas,
  textoDiasRestantes,
  textoMes,
  textoModalidade,
  textoSituacao,
  textoValidade,
} from "./diretorio";

const SP = "America/Sao_Paulo";

const condicao = (cycles: CondicaoComercial["cycles"], agreedCycle: CondicaoComercial["agreedCycle"] = null): CondicaoComercial => ({
  agreedCycle,
  cycles,
  contractPending: cycles.every((c) => c.contractCents === null),
});

describe("textos da listagem", () => {
  it("situação do cadastro separada da modalidade: teste gratuito não é conta inativa", () => {
    expect(textoSituacao("TRIAL", "ACTIVE")).toBe("Em operação");
    expect(textoSituacao("ACTIVE", "ACTIVE")).toBe("Em operação");
    expect(textoSituacao("SUSPENDED", "INACTIVE")).toBe("Suspenso");
    expect(textoSituacao("ARCHIVED", "INACTIVE")).toBe("Arquivado");
    expect(textoModalidade("TRIAL")).toBe("Teste gratuito");
    expect(textoModalidade("EXPIRED", "PAID")).toBe("Vencido (último: período pago)");
  });

  it("validade só mostra data quando existe uma", () => {
    expect(textoValidade({ state: "PAID", lastDay: "2027-03-15", daysLeft: 5, expiredAt: null }, SP)).toBe("Até 15/03/2027 · faltam 5 dias");
    expect(textoValidade({ state: "TRIAL", lastDay: "2027-03-10", daysLeft: 0, expiredAt: null }, SP)).toBe(
      "Até 10/03/2027 · termina hoje",
    );
    expect(textoValidade({ state: "NO_EXPIRY", lastDay: null, daysLeft: null, expiredAt: null }, SP)).toBe(
      "Não vence enquanto a concessão estiver em vigor",
    );
    expect(textoValidade({ state: "UNTRACKED", lastDay: null, daysLeft: null, expiredAt: null }, SP)).toBe(
      "Opera como antes até a regularização",
    );
    expect(textoValidade({ state: "MISSING", lastDay: null, daysLeft: null, expiredAt: null }, SP)).toBe(
      "Sem período registrado: acesso pausado",
    );
    // Fim exclusivo à meia-noite de 16/03 em SP: o último dia coberto é 15/03.
    expect(
      textoValidade({ state: "EXPIRED", lastDay: null, daysLeft: null, expiredAt: "2027-03-16T03:00:00.000Z" }, SP),
    ).toBe("Acesso até 15/03/2027: pausado");
    expect(textoDiasRestantes(1)).toBe("termina amanhã");
  });

  it("mensal e trimestral contratados aparecem os dois; o trimestral é o total de 3 meses", () => {
    const c = condicao(
      [
        { cycle: "MONTHLY", catalogCents: 9900, contractCents: 8900, suggestedCents: 8900, source: "CONTRACT" },
        { cycle: "QUARTERLY", catalogCents: null, contractCents: 24900, suggestedCents: 24900, source: "CONTRACT" },
      ],
      "QUARTERLY",
    );
    expect(linhasContratadas(c).map((l) => l.replace(/\s/g, " "))).toEqual([
      "Mensal: R$ 89,00",
      "Trimestral: R$ 249,00 (total de 3 meses)",
    ]);
    expect(linhaCatalogo(c).replace(/\s/g, " ")).toBe("Catálogo: mensal R$ 99,00 · trimestral pendente");
  });

  it("sem contrato: nenhuma linha contratada (pendente) e o catálogo à parte, nunca zero", () => {
    const c = condicao([
      { cycle: "MONTHLY", catalogCents: null, contractCents: null, suggestedCents: null, source: "PENDING" },
      { cycle: "QUARTERLY", catalogCents: null, contractCents: null, suggestedCents: null, source: "PENDING" },
    ]);
    expect(linhasContratadas(c)).toEqual([]);
    expect(linhaCatalogo(c)).toBe("Catálogo: mensal pendente · trimestral pendente");
    expect(linhaCatalogo(c)).not.toMatch(/0,00|grátis|gratuito/i);
  });

  it("só filtros conhecidos vêm da URL; o mês sai por extenso", () => {
    expect(ehFiltroDoDiretorio("EXPIRING_SOON")).toBe(true);
    expect(ehFiltroDoDiretorio("toString")).toBe(false);
    expect(ehFiltroDoDiretorio(null)).toBe(false);
    expect(textoMes("2027-03")).toBe("março de 2027");
  });
});

const acesso = {
  state: "PAID",
  legacy: false,
  noExpiry: false,
  blocked: false,
  validUntil: "2027-04-01T03:00:00.000Z",
  lastDay: "2027-03-31",
  daysLeft: 21,
  expiredAt: null,
  expiredKind: null,
  operational: "ACTIVE",
  effective: "ALLOWED",
};
const item = {
  id: "t1",
  name: "Estabelecimento fictício",
  slug: "ficticio",
  category: "OTHER",
  timezone: SP,
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  plan: { id: "p", code: "p", name: "Plano", catalogPriceCents: null, maxProfessionals: 1, maxUnits: 1 },
  owners: [],
  operational: "ACTIVE",
  access: acesso,
  commercial: {
    agreedCycle: null,
    contractPending: true,
    cycles: [{ cycle: "MONTHLY", catalogCents: null, contractCents: null, suggestedCents: null, source: "PENDING" }],
  },
};
const lista = {
  items: [item],
  total: 1,
  page: 1,
  pageSize: 20,
  summary: { total: 1, active: 1, trial: 0, restricted: 0 },
  plans: [],
};

describe("conferência das respostas", () => {
  it("lista com os campos comerciais", () => {
    expect(ehListaDoDiretorio(lista)).toBe(true);
    expect(ehListaDoDiretorio({ ...lista, items: [{ ...item, access: { ...acesso, effective: "TALVEZ" } }] })).toBe(false);
    const semPreco = { ...item.commercial, cycles: [{ ...item.commercial.cycles[0], suggestedCents: 0 }] };
    // Pendente com valor sugerido seria um zero disfarçado: recusado.
    expect(ehListaDoDiretorio({ ...lista, items: [{ ...item, commercial: semPreco }] })).toBe(false);
    // API anterior (sem os campos novos) não passa por esta tela.
    const novos = ["access", "commercial", "operational"];
    const anterior = Object.fromEntries(Object.entries(item).filter(([k]) => !novos.includes(k)));
    expect(ehListaDoDiretorio({ ...lista, items: [anterior] })).toBe(false);
  });

  it("visão geral completa; falta de contagem nunca vira zero", () => {
    const estados = { NO_EXPIRY: 0, UNTRACKED: 0, MISSING: 0, TRIAL: 1, PAID: 0, COURTESY: 0, EXPIRED: 0 };
    const visao = {
      generatedAt: "2027-03-10T15:00:00.000Z",
      establishments: {
        total: 1,
        allowed: 1,
        blocked: 0,
        blockedByStatus: 0,
        blockedByValidity: 0,
        expiringSoon: 1,
        validityBlocked: 0,
        suspended: 0,
        contractPending: 1,
        byState: estados,
      },
      payments: {
        timeZone: SP,
        month: "2027-03",
        from: "2027-03-01",
        to: "2027-03-31",
        currency: "BRL",
        count: 0,
        totalCents: 0,
        canceledCount: 0,
      },
      attention: {
        total: 1,
        byReason: { VALIDITY_BLOCKED: 0, EXPIRING_SOON: 1 },
        items: [
          {
            tenant: { id: "t1", name: "Fictício", timezone: SP },
            reason: "EXPIRING_SOON",
            state: "TRIAL",
            lastDay: "2027-03-12",
            daysLeft: 2,
            expiredAt: null,
          },
        ],
      },
    };
    expect(ehVisaoGeral(visao)).toBe(true);
    const semLiberados = Object.fromEntries(Object.entries(visao.establishments).filter(([k]) => k !== "allowed"));
    expect(ehVisaoGeral({ ...visao, establishments: semLiberados })).toBe(false);
    expect(ehVisaoGeral({ ...visao, payments: { ...visao.payments, totalCents: null } })).toBe(false);
  });
});
