import { describe, expect, it } from "vitest";
import {
  ETAPA_EQUIPE,
  ETAPA_ESTRUTURA,
  ETAPA_NEGOCIO,
  ETAPA_OBJETIVO,
  ETAPA_REVISAO,
  ETAPA_SEGMENTO,
  RESPOSTAS_ONBOARDING_INICIAIS,
  ULTIMA_ETAPA,
  etapaAnterior,
  planoSugerido,
  podeAvancar,
  proximaEtapa,
} from "./onboarding";

describe("podeAvancar", () => {
  it("bloqueia a etapa Negócio sem nome preenchido", () => {
    expect(podeAvancar(ETAPA_NEGOCIO, RESPOSTAS_ONBOARDING_INICIAIS)).toBe(false);
    expect(podeAvancar(ETAPA_NEGOCIO, { ...RESPOSTAS_ONBOARDING_INICIAIS, nomeNegocio: "  " })).toBe(false);
    expect(podeAvancar(ETAPA_NEGOCIO, { ...RESPOSTAS_ONBOARDING_INICIAIS, nomeNegocio: "Meu Negócio" })).toBe(true);
  });

  it("bloqueia Segmento, Estrutura, Equipe e Objetivo sem resposta escolhida", () => {
    expect(podeAvancar(ETAPA_SEGMENTO, RESPOSTAS_ONBOARDING_INICIAIS)).toBe(false);
    expect(podeAvancar(ETAPA_ESTRUTURA, RESPOSTAS_ONBOARDING_INICIAIS)).toBe(false);
    expect(podeAvancar(ETAPA_EQUIPE, RESPOSTAS_ONBOARDING_INICIAIS)).toBe(false);
    expect(podeAvancar(ETAPA_OBJETIVO, RESPOSTAS_ONBOARDING_INICIAIS)).toBe(false);
  });

  it("nunca bloqueia boas-vindas ou revisão", () => {
    expect(podeAvancar(0, RESPOSTAS_ONBOARDING_INICIAIS)).toBe(true);
    expect(podeAvancar(ETAPA_REVISAO, RESPOSTAS_ONBOARDING_INICIAIS)).toBe(true);
  });
});

describe("navegação entre etapas", () => {
  it("avança só quando a etapa atual está completa", () => {
    expect(proximaEtapa(ETAPA_NEGOCIO, RESPOSTAS_ONBOARDING_INICIAIS)).toBe(ETAPA_NEGOCIO);
    expect(proximaEtapa(ETAPA_NEGOCIO, { ...RESPOSTAS_ONBOARDING_INICIAIS, nomeNegocio: "Ok" })).toBe(ETAPA_NEGOCIO + 1);
  });

  it("nunca avança além da última etapa", () => {
    expect(proximaEtapa(ULTIMA_ETAPA, RESPOSTAS_ONBOARDING_INICIAIS)).toBe(ULTIMA_ETAPA);
  });

  it("nunca volta antes da primeira etapa", () => {
    expect(etapaAnterior(0)).toBe(0);
    expect(etapaAnterior(3)).toBe(2);
  });
});

describe("planoSugerido", () => {
  it("sugere essencial para um profissional só, estabelecimento único", () => {
    expect(planoSugerido({ estrutura: "unico", quantidadeProfissionais: "1" })).toBe("essencial");
  });

  it("sugere equipe para 2 a 5 profissionais", () => {
    expect(planoSugerido({ estrutura: "unico", quantidadeProfissionais: "2-5" })).toBe("equipe");
  });

  it("sugere pro para 6 ou mais profissionais", () => {
    expect(planoSugerido({ estrutura: "unico", quantidadeProfissionais: "6+" })).toBe("pro");
  });

  it("sempre sugere pro para rede, mesmo com poucos profissionais", () => {
    expect(planoSugerido({ estrutura: "rede", quantidadeProfissionais: "1" })).toBe("pro");
  });
});
