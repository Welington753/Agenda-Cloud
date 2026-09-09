import { describe, expect, it } from "vitest";
import { DEFINICOES_PLANO, obterDefinicaoPlano } from "./planos";

describe("DEFINICOES_PLANO", () => {
  it("mantém os códigos internos estáveis essencial/equipe/pro", () => {
    expect(Object.keys(DEFINICOES_PLANO).sort()).toEqual(["equipe", "essencial", "pro"].sort());
  });

  it("cada definição carrega o próprio código em `codigo`", () => {
    for (const [chave, definicao] of Object.entries(DEFINICOES_PLANO)) {
      expect(definicao.codigo).toBe(chave);
    }
  });

  it("nomes comerciais são Essencial/Gestão/Rede para essencial/equipe/pro", () => {
    expect(DEFINICOES_PLANO.essencial.nome).toBe("Essencial");
    expect(DEFINICOES_PLANO.equipe.nome).toBe("Gestão");
    expect(DEFINICOES_PLANO.pro.nome).toBe("Rede");
  });

  it("preço de todo plano é null — ainda não aprovado comercialmente, nunca zero", () => {
    for (const definicao of Object.values(DEFINICOES_PLANO)) {
      expect(definicao.precoCentavos).toBeNull();
      expect(definicao.precoCentavos).not.toBe(0);
    }
  });

  it("preserva limites e features de cada plano", () => {
    expect(DEFINICOES_PLANO.essencial.limites).toEqual({ maxProfissionais: 2, maxUnidades: 1 });
    expect(DEFINICOES_PLANO.equipe.limites).toEqual({ maxProfissionais: 5, maxUnidades: 1 });
    expect(DEFINICOES_PLANO.pro.limites).toEqual({ maxProfissionais: 20, maxUnidades: 5 });
    expect(DEFINICOES_PLANO.pro.features).toContain("multiplasUnidades");
  });
});

describe("obterDefinicaoPlano", () => {
  it("retorna a definição correspondente ao código pedido", () => {
    expect(obterDefinicaoPlano("equipe")).toBe(DEFINICOES_PLANO.equipe);
  });
});
