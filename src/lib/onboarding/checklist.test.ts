import { describe, expect, it } from "vitest";
import { CHECKLIST_PRIMEIROS_PASSOS } from "./checklist";

describe("CHECKLIST_PRIMEIROS_PASSOS", () => {
  it("tem 6 itens com ids únicos", () => {
    expect(CHECKLIST_PRIMEIROS_PASSOS).toHaveLength(6);
    const ids = CHECKLIST_PRIMEIROS_PASSOS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("todo item do tipo 'rota' tem uma rota de destino real do painel", () => {
    for (const item of CHECKLIST_PRIMEIROS_PASSOS.filter((i) => i.tipo === "rota")) {
      expect(item.rotaDestino).toMatch(/^\/painel\//);
    }
  });

  it("nenhum item fica sem comportamento definido (rota, cópia de link ou link público)", () => {
    for (const item of CHECKLIST_PRIMEIROS_PASSOS) {
      expect(["rota", "copiar-link", "rota-publica"]).toContain(item.tipo);
    }
  });
});
