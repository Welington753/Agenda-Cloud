import { describe, expect, it } from "vitest";
import { novoRascunho } from "./conferencia";
import {
  apagarOutrosContextos,
  apagarRascunho,
  apagarTodosOsRascunhos,
  chaveDoRascunho,
  gravarRascunho,
  lerRascunho,
  type Armazenamento,
} from "./rascunho-conferencia";

function memoria(): Armazenamento & { mapa: Map<string, string> } {
  const mapa = new Map<string, string>();
  return {
    mapa,
    get length() {
      return mapa.size;
    },
    key: (i) => [...mapa.keys()][i] ?? null,
    getItem: (k) => mapa.get(k) ?? null,
    setItem: (k, v) => void mapa.set(k, v),
    removeItem: (k) => void mapa.delete(k),
  };
}

const produto = [{ id: "a", name: "Pomada", unit: "UN" as const, balanceMilli: 1000, balanceVersion: 1, archived: false }];

describe("rascunho da conferência, isolado por usuário e estabelecimento", () => {
  it("grava e lê só no mesmo contexto", () => {
    const m = memoria();
    gravarRascunho(m, novoRascunho("u1", "t1", produto));
    expect(lerRascunho(m, "u1", "t1")?.itens).toHaveLength(1);
    expect(lerRascunho(m, "u2", "t1")).toBeNull();
    expect(lerRascunho(m, "u1", "t2")).toBeNull();
  });

  it("rascunho de outro contexto gravado na chave errada é descartado na leitura", () => {
    const m = memoria();
    m.setItem(chaveDoRascunho("u1", "t1"), JSON.stringify(novoRascunho("u2", "t9", produto)));
    expect(lerRascunho(m, "u1", "t1")).toBeNull();
    expect(m.mapa.size).toBe(0);
  });

  it("ao abrir num contexto, os outros contextos são apagados; no logout, todos", () => {
    const m = memoria();
    m.setItem("outra-chave", "fica");
    gravarRascunho(m, novoRascunho("u1", "t1", produto));
    gravarRascunho(m, novoRascunho("u1", "t2", produto));
    gravarRascunho(m, novoRascunho("u2", "t1", produto));
    apagarOutrosContextos(m, "u1", "t2");
    expect([...m.mapa.keys()].sort()).toEqual([chaveDoRascunho("u1", "t2"), "outra-chave"].sort());
    apagarTodosOsRascunhos(m);
    expect([...m.mapa.keys()]).toEqual(["outra-chave"]);
  });

  it("armazenamento indisponível ou que falha não derruba a tela", () => {
    const quebrado: Armazenamento = {
      length: 1,
      key: () => {
        throw new Error("bloqueado");
      },
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("cheio");
      },
      removeItem: () => {
        throw new Error("bloqueado");
      },
    };
    expect(() => gravarRascunho(quebrado, novoRascunho("u1", "t1", produto))).not.toThrow();
    expect(lerRascunho(quebrado, "u1", "t1")).toBeNull();
    expect(() => apagarRascunho(quebrado, "u1", "t1")).not.toThrow();
    expect(() => apagarOutrosContextos(quebrado, "u1", "t1")).not.toThrow();
    expect(() => apagarTodosOsRascunhos(quebrado)).not.toThrow();
    expect(lerRascunho(null, "u1", "t1")).toBeNull();
  });
});
