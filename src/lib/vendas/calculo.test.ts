// O web confere a MESMA tabela de vetores da API (lida como texto: o web não
// importa código do backend).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAIOR_PRECO_UNITARIO_CENTAVOS,
  MAIOR_QUANTIDADE_MILLI,
  MAIOR_TOTAL_CENTAVOS,
  MAXIMO_DE_ITENS,
  totalAceito,
  totalDaLinha,
  totalDaVenda,
} from "./calculo";

interface Vetores {
  lines: { unitPriceCents: number; quantityMilli: number; lineTotalCents: number; case: string }[];
  sales: { items: { unitPriceCents: number; quantityMilli: number }[]; totalCents: number; case: string }[];
  outOfRange: { unitPriceCents: number; quantityMilli: number }[];
}

const RAIZ = path.resolve(__dirname, "../../..");
const VETORES = JSON.parse(readFileSync(path.join(RAIZ, "backend/src/sales/sale-math-vectors.json"), "utf8")) as Vetores;

describe("cálculo da venda com os vetores da API", () => {
  it.each(VETORES.lines.map((v) => [v.unitPriceCents, v.quantityMilli, v.lineTotalCents, v.case] as const))(
    "%i centavos × %i milésimos = %i (%s)",
    (preco, quantidade, linha) => {
      expect(totalDaLinha(preco, quantidade)).toBe(linha);
    },
  );

  it.each(VETORES.outOfRange.map((v) => [v.unitPriceCents, v.quantityMilli] as const))(
    "fora do limite (preço %s, quantidade %s) não inventa valor",
    (preco, quantidade) => {
      expect(totalDaLinha(preco, quantidade)).toBeNull();
    },
  );

  it.each(VETORES.sales.map((v) => [v.case, v.items, v.totalCents] as const))("%s", (_caso, itens, total) => {
    expect(totalDaVenda(itens.map((i) => ({ precoCentavos: i.unitPriceCents, quantidadeMilli: i.quantityMilli })))).toBe(total);
  });

  it("uma linha inválida invalida o total", () => {
    expect(totalDaVenda([{ precoCentavos: 100, quantidadeMilli: 1000 }, { precoCentavos: 0, quantidadeMilli: 1000 }])).toBeNull();
  });

  it("os tetos são os mesmos da API", () => {
    const fonte = readFileSync(path.join(RAIZ, "backend/src/migrations/1794614400000-SalesModule.ts"), "utf8");
    expect(fonte).toMatch(/MAX_UNIT_PRICE_CENTS = 100_000_000;/);
    expect(fonte).toMatch(/MAX_SALE_TOTAL_CENTS = 10_000_000_000;/);
    expect(MAIOR_PRECO_UNITARIO_CENTAVOS).toBe(100_000_000);
    expect(MAIOR_TOTAL_CENTAVOS).toBe(10_000_000_000);
    expect(MAIOR_QUANTIDADE_MILLI).toBe(1_000_000_000);
    const matematica = readFileSync(path.join(RAIZ, "backend/src/sales/sale-math.ts"), "utf8");
    expect(matematica).toMatch(new RegExp(`MAX_SALE_ITEMS = ${MAXIMO_DE_ITENS};`));
  });

  it("total aceito: pelo menos 1 centavo e no máximo o teto", () => {
    expect(totalAceito(0)).toBe(false);
    expect(totalAceito(1)).toBe(true);
    expect(totalAceito(MAIOR_TOTAL_CENTAVOS)).toBe(true);
    expect(totalAceito(MAIOR_TOTAL_CENTAVOS + 1)).toBe(false);
  });
});
