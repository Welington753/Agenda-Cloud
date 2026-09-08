import { beforeEach, describe, expect, it, vi } from "vitest";
import { ESTADO_ONBOARDING_INICIAL, lerEstadoOnboarding, reiniciarOnboarding, salvarEstadoOnboarding } from "./onboarding-persistencia";

function criarLocalStorageFake() {
  const dados = new Map<string, string>();
  return {
    getItem: (chave: string) => (dados.has(chave) ? (dados.get(chave) as string) : null),
    setItem: (chave: string, valor: string) => {
      dados.set(chave, valor);
    },
    removeItem: (chave: string) => {
      dados.delete(chave);
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: criarLocalStorageFake() });
});

describe("persistência do onboarding", () => {
  it("começa no estado inicial quando nada foi salvo ainda", () => {
    expect(lerEstadoOnboarding()).toEqual(ESTADO_ONBOARDING_INICIAL);
  });

  it("mantém o progresso entre leituras (simula recarregar a página)", () => {
    const estado = {
      ...ESTADO_ONBOARDING_INICIAL,
      etapaAtual: 3,
      respostas: { ...ESTADO_ONBOARDING_INICIAL.respostas, nomeNegocio: "Espaço Vida" },
    };
    salvarEstadoOnboarding(estado);
    expect(lerEstadoOnboarding()).toEqual(estado);
  });

  it("reiniciar a demonstração volta ao estado inicial", () => {
    salvarEstadoOnboarding({ ...ESTADO_ONBOARDING_INICIAL, etapaAtual: 5 });
    const reiniciado = reiniciarOnboarding();
    expect(reiniciado).toEqual(ESTADO_ONBOARDING_INICIAL);
    expect(lerEstadoOnboarding()).toEqual(ESTADO_ONBOARDING_INICIAL);
  });
});
