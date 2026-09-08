import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ativarChecklistPrimeirosPassos,
  checklistPrimeirosPassosVisivel,
  dispensarChecklistPrimeirosPassos,
} from "./checklist-persistencia";

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

describe("checklist de primeiros passos", () => {
  it("fica oculto por padrão para um tenant que nunca passou pelo onboarding", () => {
    expect(checklistPrimeirosPassosVisivel("tenant-nao-onboarded")).toBe(false);
  });

  it("fica visível depois de ativado para aquele tenant", () => {
    ativarChecklistPrimeirosPassos("tenant-x");
    expect(checklistPrimeirosPassosVisivel("tenant-x")).toBe(true);
    expect(checklistPrimeirosPassosVisivel("outro-tenant")).toBe(false);
  });

  it("fica oculto de novo depois de dispensado", () => {
    ativarChecklistPrimeirosPassos("tenant-y");
    dispensarChecklistPrimeirosPassos("tenant-y");
    expect(checklistPrimeirosPassosVisivel("tenant-y")).toBe(false);
  });
});
