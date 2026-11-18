// Valores de exemplo (R$ 29,90 / 9,90 / 14,90), não preços aprovados.
import { describe, expect, it } from "vitest";
import {
  calcularEscolha,
  contratavel,
  ehCatalogoAssinatura,
  ehVisaoAssinatura,
  revisarAssinatura,
  validarLimite,
  type Adicional,
} from "./assinatura";

const adicionais: Adicional[] = [
  { code: "INDICADORES", name: "Indicadores avançados", description: "", featureKey: "RELATORIOS", availability: "AVAILABLE", priceCents: 990 },
  { code: "COMISSOES", name: "Comissões", description: "", featureKey: "COMISSOES", availability: "AVAILABLE", priceCents: null },
  { code: "ESTOQUE", name: "Controle de estoque", description: "", featureKey: null, availability: "PLANNED", priceCents: 1490 },
  { code: "WHATSAPP", name: "WhatsApp automático", description: "", featureKey: null, availability: "IN_DEVELOPMENT", priceCents: null },
];

describe("calcularEscolha", () => {
  it("soma base e adicionais disponíveis com preço", () => {
    const e = calcularEscolha(2990, adicionais, ["INDICADORES"]);
    expect(e).toMatchObject({ totalCatalogoCents: 3980, totalContratadoCents: 3980, negociado: false, pendencias: [] });
  });

  it("planejado e em desenvolvimento nunca entram no total, mesmo marcados", () => {
    expect(calcularEscolha(2990, adicionais, ["ESTOQUE", "WHATSAPP"]).totalCatalogoCents).toBe(2990);
    expect(contratavel(adicionais[2])).toBe(false);
    expect(contratavel(adicionais[3])).toBe(false);
  });

  it("preço pendente e motivo faltando impedem salvar", () => {
    expect(calcularEscolha(null, adicionais, []).pendencias[0]).toMatch(/Agendamento essencial/);
    expect(calcularEscolha(2990, adicionais, ["COMISSOES"]).pendencias[0]).toMatch(/Comissões/);
    // Com o nome atual do essencial, renomeado no catálogo.
    expect(calcularEscolha(null, adicionais, [], undefined, "Agenda base").pendencias[0]).toBe(
      "O preço de Agenda base ainda não foi definido em Planos e adicionais.",
    );
    const negociado = calcularEscolha(2990, adicionais, ["INDICADORES"], { centavos: 3500, motivo: "" });
    expect(negociado).toMatchObject({ negociado: true, totalContratadoCents: 3500 });
    expect(negociado.pendencias).toContain("Informe o motivo do valor negociado.");
    expect(calcularEscolha(2990, adicionais, ["INDICADORES"], { centavos: 3500, motivo: "Lançamento" }).pendencias).toEqual([]);
  });
});

describe("validarLimite", () => {
  const uso = { used: 3, activeAccesses: 2, pendingInvites: 1 };
  it("aceita zero e números inteiros dentro do uso", () => {
    expect(validarLimite("0", null)).toEqual({ valor: 0, erro: null });
    expect(validarLimite("5", uso)).toEqual({ valor: 5, erro: null });
  });
  it("recusa vazio, fração, negativo, acima de mil e abaixo do uso com o motivo", () => {
    expect(validarLimite("", uso).erro).toMatch(/número inteiro/);
    expect(validarLimite("1,5", uso).erro).toMatch(/número inteiro/);
    expect(validarLimite("-1", uso).erro).toMatch(/número inteiro/);
    expect(validarLimite("1001", uso).erro).toMatch(/máximo/);
    expect(validarLimite("2", uso).erro).toMatch(/2 acesso\(s\) ativo\(s\) e 1 reservado\(s\) por convite/);
  });
});

describe("revisarAssinatura", () => {
  const base = { ligadosHoje: [] as string[], adicionais, limiteAtual: null, conversao: null, atual: null };

  it("mostra o novo valor recorrente, o limite e que não há cobrança retroativa nem proporcional", () => {
    const r = revisarAssinatura({ ...base, escolha: calcularEscolha(2990, adicionais, ["INDICADORES"]), limite: 5 });
    expect(r.linhas).toContain("Agendamento essencial + Indicadores avançados.");
    const renomeado = revisarAssinatura({ ...base, escolha: calcularEscolha(2990, adicionais, ["INDICADORES"]), limite: 5, nomeEssencial: "Agenda base" });
    expect(renomeado.linhas).toContain("Agenda base + Indicadores avançados.");
    expect(r.linhas.join(" ")).toMatch(/Novo valor recorrente: R\$\s?39,80\/mês/);
    expect(r.linhas.join(" ")).toMatch(/Limite de usuários da equipe: 5\. O limite não muda a mensalidade/);
    expect(r.avisos[0]).toMatch(/sem cobrança retroativa nem proporcional|Não há cobrança retroativa nem proporcional/);
  });

  it("aponta a diferença para a versão atual e o que deixa de estar liberado", () => {
    const atual = {
      id: "v1", version: 1, effectiveAt: "", baseCatalogCents: 2990, catalogTotalCents: 4480, contractedTotalCents: 4480,
      negotiated: false, reason: null, teamUserLimit: 3, previousContract: null, recordedAt: "", recordedBy: "", items: [],
    };
    const r = revisarAssinatura({
      ...base,
      atual,
      ligadosHoje: ["INDICADORES", "COMISSOES"],
      escolha: calcularEscolha(2990, adicionais, ["INDICADORES"]),
      limite: 5,
      limiteAtual: 3,
    });
    expect(r.linhas.join(" ")).toMatch(/Redução de R\$\s?5,00\/mês/);
    expect(r.linhas.join(" ")).toMatch(/\(hoje 3\)/);
    expect(r.retirados).toEqual(["Comissões"]);
  });

  it("conversão trimestral explica o período pago e a troca para mensal", () => {
    const r = revisarAssinatura({
      ...base,
      escolha: calcularEscolha(2990, adicionais, []),
      limite: 2,
      conversao: {
        requiresCycleChange: true,
        previousContract: { planId: "plan_equipe", contractCycle: "QUARTERLY", contractCents: 9000, lastPaidCycle: "QUARTERLY", lastPaidCents: 9000, paidUntil: "2027-01-10T03:00:00.000Z" },
      },
    });
    expect(r.avisos.join(" ")).toMatch(/Contrato trimestral de R\$\s?90,00\/trimestre deixa de valer/);
    expect(r.avisos.join(" ")).toMatch(/continua válido até 10\/01\/2027/);
  });
});

describe("contratos", () => {
  it("aceita catálogo e visão válidos e recusa forma incompleta", () => {
    const essential = { planId: "plan_modular", name: "Agendamento essencial", description: "Agenda e equipe.", priceCents: null };
    expect(ehCatalogoAssinatura({ basePriceCents: null, basePlanId: "plan_modular", essential, addons: adicionais, history: [], canManage: true })).toBe(true);
    // Sem o essencial (API anterior a esta tela), a forma é recusada.
    expect(ehCatalogoAssinatura({ basePriceCents: null, basePlanId: "plan_modular", addons: adicionais, history: [], canManage: true })).toBe(false);
    expect(ehCatalogoAssinatura({ basePriceCents: -1, basePlanId: "x", addons: [], history: [], canManage: true })).toBe(false);
    const visao = {
      tenantId: "t1", updatedAt: "2026-11-17T00:00:00.000Z", status: "ACTIVE", modular: false,
      plan: { id: "plan_equipe", name: "Pro", maxProfessionals: 5 },
      teamUserLimit: { value: 5, source: "PLAN" },
      seats: { limit: 5, activeAccesses: 2, pendingInvites: 1, suspendedAccesses: 0, used: 3, available: 2 },
      enabledAddons: ["INDICADORES"], current: null, history: [],
      catalog: { basePriceCents: 2990, essential: { ...essential, priceCents: 2990 }, addons: adicionais }, conversion: null, canManage: true,
    };
    expect(ehVisaoAssinatura(visao)).toBe(true);
    expect(ehVisaoAssinatura({ ...visao, seats: { limit: 5 } })).toBe(false);
    expect(ehVisaoAssinatura({ ...visao, catalog: { basePriceCents: 2990, addons: adicionais } })).toBe(false);
  });
});
