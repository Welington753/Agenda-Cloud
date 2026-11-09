import { describe, expect, it } from "vitest";
import {
  ROTULO_ORIGEM_APURADA,
  ehRegrasDoProfissional,
  ehRelatorioDeComissoes,
  ehResumoDeRecebeComissao,
  percentualParaPontosBase,
  pontosBaseParaCampo,
  rotuloDaEfetiva,
  rotuloDaRegra,
} from "./comissoes-api";

describe("percentual em pontos-base", () => {
  it("converte sem ponto flutuante e recusa zero, acima de 100% e mais de duas casas", () => {
    expect(percentualParaPontosBase("12,5")).toEqual({ ok: true, pontos: 1250 });
    expect(percentualParaPontosBase("40")).toEqual({ ok: true, pontos: 4000 });
    expect(percentualParaPontosBase("0,01")).toEqual({ ok: true, pontos: 1 });
    expect(percentualParaPontosBase("100")).toEqual({ ok: true, pontos: 10000 });
    expect(percentualParaPontosBase("33.33")).toEqual({ ok: true, pontos: 3333 });
    expect(percentualParaPontosBase("0")).toMatchObject({ ok: false });
    expect(percentualParaPontosBase("")).toMatchObject({ ok: false });
    expect(percentualParaPontosBase("100,01")).toMatchObject({ ok: false });
    expect(percentualParaPontosBase("12,345")).toMatchObject({ ok: false });
    expect(percentualParaPontosBase("abc")).toMatchObject({ ok: false });
  });

  it("volta para o campo e para o rótulo", () => {
    expect(pontosBaseParaCampo(1250)).toBe("12,5");
    expect(pontosBaseParaCampo(4000)).toBe("40");
    expect(pontosBaseParaCampo(1)).toBe("0,01");
    expect(pontosBaseParaCampo(3333)).toBe("33,33");
    expect(rotuloDaRegra(null)).toBe("Não configurada");
    expect(rotuloDaRegra({ kind: "NONE", value: null })).toBe("Sem comissão");
    expect(rotuloDaRegra({ kind: "PERCENTAGE", value: 1250 })).toBe("12,5%");
    expect(rotuloDaRegra({ kind: "FIXED", value: 990 }).replace(/\s/g, " ")).toBe("R$ 9,90 fixo");
  });
});

describe("forma das respostas", () => {
  it("regras do profissional", () => {
    const servico = {
      service: { id: "s", name: "Corte", priceCents: null, active: true },
      linked: true,
      rule: null,
      effective: { source: "DEFAULT", rule: { kind: "FIXED", value: 1000 } },
      updatedAt: null,
    };
    const ok = {
      professional: { id: "p", name: "Ana", active: true },
      settings: { receivesCommission: false, defaultRule: { kind: "FIXED", value: 1000 } },
      services: [servico],
    };
    expect(ehRegrasDoProfissional(ok)).toBe(true);
    expect(ehRegrasDoProfissional({ ...ok, services: [{ ...servico, rule: { kind: "OUTRO", value: 1 } }] })).toBe(false);
    // Sem a configuração, ou com "sem comissão" como regra geral: formato inválido.
    expect(ehRegrasDoProfissional({ ...ok, settings: undefined })).toBe(false);
    expect(ehRegrasDoProfissional({ ...ok, settings: { receivesCommission: true, defaultRule: { kind: "NONE", value: null } } })).toBe(false);
    // Origem e regra vêm juntas.
    expect(ehRegrasDoProfissional({ ...ok, services: [{ ...servico, effective: { source: null, rule: null } }] })).toBe(true);
    expect(ehRegrasDoProfissional({ ...ok, services: [{ ...servico, effective: { source: null, rule: { kind: "FIXED", value: 1 } } }] })).toBe(false);
    expect(ehRegrasDoProfissional({ ...ok, services: [{ ...servico, effective: { source: "SERVICE", rule: null } }] })).toBe(false);
    expect(ehRegrasDoProfissional({ ...ok, services: [{ ...servico, effective: undefined }] })).toBe(false);
  });

  it("etiqueta da regra que vale e origem do item apurado", () => {
    expect(rotuloDaEfetiva({ source: "SERVICE", rule: { kind: "NONE", value: null } })).toBe("Exceção · Sem comissão");
    expect(rotuloDaEfetiva({ source: "DEFAULT", rule: { kind: "PERCENTAGE", value: 4000 } })).toBe("Regra geral · 40%");
    expect(rotuloDaEfetiva({ source: null, rule: null })).toBe("Não configurada");
    // Regra antiga por serviço não é chamada de exceção.
    expect(ROTULO_ORIGEM_APURADA.LEGACY_SERVICE).toBe("regra por serviço");
    expect(ROTULO_ORIGEM_APURADA.SERVICE).toBe("exceção do serviço");
  });

  it("resumo de quem recebe comissão", () => {
    expect(ehResumoDeRecebeComissao({ professionals: [{ professionalId: "p", receivesCommission: false }] })).toBe(true);
    expect(ehResumoDeRecebeComissao({ professionals: [{ professionalId: "p" }] })).toBe(false);
    expect(ehResumoDeRecebeComissao({})).toBe(false);
  });

  it("relatório: comissão apurada, nunca pagamento", () => {
    const ok = {
      timezone: "America/Sao_Paulo",
      period: { from: "2026-09-01", to: "2026-09-30" },
      basis: "APURADA_NA_CONCLUSAO",
      totalAccruedCents: 0,
      professionals: [],
      appointments: [],
      appointmentsComplete: true,
    };
    expect(ehRelatorioDeComissoes(ok)).toBe(true);
    expect(ehRelatorioDeComissoes({ ...ok, basis: "PAGA" })).toBe(false);
    expect(ehRelatorioDeComissoes({ ...ok, totalAccruedCents: "0" })).toBe(false);
  });
});
