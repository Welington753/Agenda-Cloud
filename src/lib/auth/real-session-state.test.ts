import { describe, expect, it } from "vitest";
import {
  encontrarContextoPorTenantId,
  podeAplicarResultado,
  reduzirResultadoSessao,
  resolverTenantAtivo,
  selecionarTenant,
  type EstadoAutenticacaoReal,
} from "./real-session-state";
import type { SessaoRealContexto, TenantContextReal } from "@/lib/api/auth-api";

function contexto(overrides: Partial<TenantContextReal> = {}): TenantContextReal {
  return {
    membershipId: "membership_1",
    tenantId: "tenant_1",
    tenantName: "Studio Bela",
    tenantSlug: "studio-bela",
    role: "DONO",
    unit: { id: "unit_1", name: "Studio Bela", isPrimary: true },
    planCode: "equipe",
    planName: "Gestão",
    trial: { trialStartAt: "2026-09-10T12:00:00.000Z", trialEndAt: "2026-09-24T12:00:00.000Z", durationDays: 14 },
    tenantStatus: "TRIAL",
    ...overrides,
  };
}

function sessao(overrides: Partial<SessaoRealContexto> = {}): SessaoRealContexto {
  return {
    user: { id: "user_1", name: "Maria Souza", email: "maria@example.com" },
    contexts: [],
    activeContext: null,
    requiresTenantSelection: false,
    hasEstablishmentAccess: false,
    ...overrides,
  };
}

describe("resolverTenantAtivo", () => {
  it("devolve null quando não há nenhum contexto (conta sem estabelecimento)", () => {
    expect(resolverTenantAtivo(sessao(), "qualquer-id")).toBeNull();
  });

  it("usa o activeContext do backend quando há exatamente um contexto, ignorando a preferência salva", () => {
    const c = contexto({ tenantId: "tenant_unico" });
    const s = sessao({ contexts: [c], activeContext: c });
    expect(resolverTenantAtivo(s, "outro-tenant-qualquer")).toBe("tenant_unico");
  });

  it("com vários contextos, aceita a preferência salva só se ela existir na lista atual", () => {
    const c1 = contexto({ tenantId: "tenant_1" });
    const c2 = contexto({ tenantId: "tenant_2" });
    const s = sessao({ contexts: [c1, c2], activeContext: null, requiresTenantSelection: true });
    expect(resolverTenantAtivo(s, "tenant_2")).toBe("tenant_2");
  });

  it("rejeita preferência salva que não corresponde a nenhum contexto atual (vínculo removido/suspenso)", () => {
    const c1 = contexto({ tenantId: "tenant_1" });
    const c2 = contexto({ tenantId: "tenant_2" });
    const s = sessao({ contexts: [c1, c2], activeContext: null, requiresTenantSelection: true });
    expect(resolverTenantAtivo(s, "tenant_removido")).toBeNull();
  });

  it("sem preferência salva e vários contextos, nunca escolhe o primeiro sozinho", () => {
    const c1 = contexto({ tenantId: "tenant_1" });
    const c2 = contexto({ tenantId: "tenant_2" });
    const s = sessao({ contexts: [c1, c2], activeContext: null, requiresTenantSelection: true });
    expect(resolverTenantAtivo(s, null)).toBeNull();
  });
});

describe("encontrarContextoPorTenantId", () => {
  it("acha o contexto pelo tenantId", () => {
    const c = contexto({ tenantId: "tenant_x" });
    expect(encontrarContextoPorTenantId(sessao({ contexts: [c] }), "tenant_x")).toEqual(c);
  });

  it("devolve null para um tenantId fora da lista", () => {
    const c = contexto({ tenantId: "tenant_x" });
    expect(encontrarContextoPorTenantId(sessao({ contexts: [c] }), "tenant_y")).toBeNull();
  });
});

describe("reduzirResultadoSessao", () => {
  it("falha de comunicação vira status falha_comunicacao, nunca nao_autenticado", () => {
    const estado = reduzirResultadoSessao({ ok: false, falha: { tipo: "falha_comunicacao" } }, null);
    expect(estado).toEqual({ status: "falha_comunicacao" });
  });

  it("dados nulos (401 em /auth/me) viram nao_autenticado, nunca falha_comunicacao", () => {
    const estado = reduzirResultadoSessao({ ok: true, dados: null }, null);
    expect(estado).toEqual({ status: "nao_autenticado" });
  });

  it("sessão válida vira autenticado com o tenant ativo resolvido", () => {
    const c = contexto({ tenantId: "tenant_unico" });
    const s = sessao({ contexts: [c], activeContext: c, hasEstablishmentAccess: true });
    const estado = reduzirResultadoSessao({ ok: true, dados: s }, null);
    expect(estado).toEqual({ status: "autenticado", sessao: s, tenantIdAtivo: "tenant_unico" });
  });
});

describe("podeAplicarResultado", () => {
  it("aceita quando a geração não mudou desde o início da chamada", () => {
    expect(podeAplicarResultado(3, 3)).toBe(true);
  });

  it("rejeita quando algo mais novo (logout/login/refresh) já mudou a geração", () => {
    expect(podeAplicarResultado(4, 3)).toBe(false);
  });
});

describe("selecionarTenant", () => {
  it("aceita um tenantId presente em contexts e atualiza tenantIdAtivo", () => {
    const c1 = contexto({ tenantId: "tenant_1" });
    const c2 = contexto({ tenantId: "tenant_2" });
    const s = sessao({ contexts: [c1, c2], requiresTenantSelection: true });
    const estado: EstadoAutenticacaoReal = { status: "autenticado", sessao: s, tenantIdAtivo: null };

    const proximo = selecionarTenant(estado, "tenant_2");
    expect(proximo).toEqual({ status: "autenticado", sessao: s, tenantIdAtivo: "tenant_2" });
  });

  it("rejeita um tenantId ausente de contexts (nunca aceita ID vindo da UI sem checar a lista do backend)", () => {
    const c1 = contexto({ tenantId: "tenant_1" });
    const s = sessao({ contexts: [c1] });
    const estado: EstadoAutenticacaoReal = { status: "autenticado", sessao: s, tenantIdAtivo: null };

    const proximo = selecionarTenant(estado, "tenant_de_outro_usuario");
    expect(proximo).toBe(estado);
  });

  it("é no-op quando o estado não está autenticado", () => {
    const estado: EstadoAutenticacaoReal = { status: "carregando" };
    expect(selecionarTenant(estado, "tenant_1")).toBe(estado);
  });
});
