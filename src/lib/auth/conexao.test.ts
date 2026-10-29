import { describe, expect, it } from "vitest";
import type { SessaoRealContexto, TenantContextReal } from "@/lib/api/auth-api";
import { LIMIAR_RETORNO_MS, aplicarVerificacao, rotaDispensaSessao } from "./conexao";
import type { EstadoAutenticacaoReal } from "./real-session-state";

const CONTEXTO: TenantContextReal = {
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
};

function sessao(userId: string): SessaoRealContexto {
  return {
    user: { id: userId, name: "Maria Souza", email: "maria@example.com" },
    contexts: [CONTEXTO],
    activeContext: CONTEXTO,
    requiresTenantSelection: false,
    hasEstablishmentAccess: true,
  };
}

const AUTENTICADO: EstadoAutenticacaoReal = { status: "autenticado", sessao: sessao("user_1"), tenantIdAtivo: "tenant_1" };

describe("aplicarVerificacao (volta ao aplicativo / internet de volta)", () => {
  it("mesma pessoa, mas o acesso do estabelecimento pausou (ou voltou): adota a sessão nova", () => {
    const vencida = sessao("user_1");
    const contexto = { ...CONTEXTO, access: { state: "EXPIRED" as const, blocked: true, validUntil: null, expiredAt: null, expiredKind: null } };
    vencida.contexts = [contexto];
    vencida.activeContext = contexto;
    const r = aplicarVerificacao(AUTENTICADO, { ok: true, dados: vencida }, "tenant_1");
    expect(r.estado).not.toBe(AUTENTICADO);
    expect(r.estado).toMatchObject({ status: "autenticado", tenantIdAtivo: "tenant_1" });
    const volta = aplicarVerificacao(r.estado, { ok: true, dados: sessao("user_1") }, "tenant_1");
    expect(volta.estado).not.toBe(r.estado);
    // Sem mudança de bloqueio: o mesmo objeto.
    expect(aplicarVerificacao(r.estado, { ok: true, dados: vencida }, "tenant_1").estado).toBe(r.estado);
  });

  it("API sem resposta: mantém exatamente o estado atual e só sinaliza a conexão", () => {
    const r = aplicarVerificacao(AUTENTICADO, { ok: false, falha: { tipo: "falha_comunicacao" } }, null);
    expect(r.estado).toBe(AUTENTICADO);
    expect(r.conexao).toBe("sem_resposta");
  });

  it("erro da própria API: mantém o estado, sem aviso de servidor acordando", () => {
    const r = aplicarVerificacao(AUTENTICADO, { ok: false, falha: { tipo: "indisponivel" } }, null);
    expect(r.estado).toBe(AUTENTICADO);
    expect(r.conexao).toBe("ok");
  });

  it("mesma pessoa: o MESMO objeto de estado (nada que dependa dele é recriado)", () => {
    const r = aplicarVerificacao(AUTENTICADO, { ok: true, dados: sessao("user_1") }, null);
    expect(r.estado).toBe(AUTENTICADO);
    expect(r.conexao).toBe("ok");
  });

  it("sessão encerrada no servidor (401): vira não autenticado", () => {
    const r = aplicarVerificacao(AUTENTICADO, { ok: true, dados: null }, null);
    expect(r.estado).toEqual({ status: "nao_autenticado" });
  });

  it("outra pessoa no mesmo navegador: troca o estado", () => {
    const r = aplicarVerificacao(AUTENTICADO, { ok: true, dados: sessao("user_2") }, null);
    expect(r.estado).toMatchObject({ status: "autenticado", sessao: { user: { id: "user_2" } } });
  });

  it("mesma pessoa que acabou de trocar a senha temporária: adota a sessão nova", () => {
    const atual: EstadoAutenticacaoReal = {
      status: "autenticado",
      sessao: { ...sessao("user_1"), user: { ...sessao("user_1").user, mustChangePassword: true } },
      tenantIdAtivo: "tenant_1",
    };
    const novaSessao = { ...sessao("user_1"), user: { ...sessao("user_1").user, mustChangePassword: false } };
    const r = aplicarVerificacao(atual, { ok: true, dados: novaSessao }, null);
    expect(r.estado).toMatchObject({ status: "autenticado", sessao: { user: { id: "user_1", mustChangePassword: false } } });
  });

  it("login sem sessão continua igual quando a API responde 401", () => {
    const atual: EstadoAutenticacaoReal = { status: "nao_autenticado" };
    expect(aplicarVerificacao(atual, { ok: true, dados: null }, null).estado).toBe(atual);
  });
});

describe("rotaDispensaSessao", () => {
  it("só a página pública de agendamento dispensa a leitura de sessão", () => {
    expect(rotaDispensaSessao("/agendar/studio-bela")).toBe(true);
    expect(rotaDispensaSessao("/conta")).toBe(false);
    expect(rotaDispensaSessao("/login")).toBe(false);
    expect(rotaDispensaSessao("/agendar")).toBe(false);
    expect(rotaDispensaSessao(null)).toBe(false);
  });
});

describe("LIMIAR_RETORNO_MS", () => {
  it("fica abaixo dos 15 min que o Render gratuito espera antes de hibernar", () => {
    expect(LIMIAR_RETORNO_MS).toBeLessThan(15 * 60_000);
  });
});
