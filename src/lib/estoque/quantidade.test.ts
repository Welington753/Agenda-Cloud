import { describe, expect, it } from "vitest";
import { formatarDiferenca, formatarQuantidade, lerQuantidade, quantidadeParaCampo } from "./quantidade";

describe("quantidades do estoque na tela", () => {
  it("lê inteiros e decimais pt-BR em milésimos, sem arredondar", () => {
    expect(lerQuantidade("12", "UN")).toEqual({ ok: true, milli: 12000 });
    expect(lerQuantidade("1,5", "KG")).toEqual({ ok: true, milli: 1500 });
    expect(lerQuantidade("0,001", "L")).toEqual({ ok: true, milli: 1 });
    expect(lerQuantidade("1.250,75", "KG")).toEqual({ ok: true, milli: 1250750 });
    expect(lerQuantidade(" 3 ", "CX")).toEqual({ ok: true, milli: 3000 });
  });

  it("recusa casas a mais, negativo, letras, vazio e zero (quando não permitido)", () => {
    expect(lerQuantidade("1,5", "UN").ok).toBe(false);
    expect(lerQuantidade("1,0005", "KG").ok).toBe(false);
    expect(lerQuantidade("-1", "UN").ok).toBe(false);
    expect(lerQuantidade("abc", "UN").ok).toBe(false);
    expect(lerQuantidade("1.5", "KG").ok).toBe(false);
    expect(lerQuantidade("", "UN").ok).toBe(false);
    expect(lerQuantidade("0", "UN").ok).toBe(false);
    expect(lerQuantidade("0", "UN", { permitirZero: true })).toEqual({ ok: true, milli: 0 });
    expect(lerQuantidade("1000001", "UN").ok).toBe(false);
  });

  it("formata pela unidade, só com as casas necessárias", () => {
    expect(formatarQuantidade(1500, "KG")).toBe("1,5 KG");
    expect(formatarQuantidade(12000, "UN")).toBe("12 UN");
    expect(formatarQuantidade(1250750, "KG")).toBe("1.250,75 KG");
    expect(formatarQuantidade(-500, "L")).toBe("-0,5 L");
    expect(quantidadeParaCampo(1250750)).toBe("1250,75");
    expect(formatarDiferenca(2000, "UN")).toBe("+2 UN");
    expect(formatarDiferenca(-250, "KG")).toBe("-0,25 KG");
    expect(formatarDiferenca(0, "UN")).toBe("0 UN");
  });
});
