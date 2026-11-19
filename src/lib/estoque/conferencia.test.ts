import { describe, expect, it } from "vitest";
import { anotarContagem, confirmarRevisao, itensMarcados, novoRascunho, reconciliar, revisar, erroDoMotivo } from "./conferencia";

const produtos = [
  { id: "a", name: "Pomada", unit: "UN" as const, balanceMilli: 10000, balanceVersion: 3, archived: false },
  { id: "b", name: "Pó", unit: "KG" as const, balanceMilli: 1500, balanceVersion: 1, archived: false },
  { id: "c", name: "Arquivado", unit: "UN" as const, balanceMilli: 0, balanceVersion: 0, archived: true },
];

describe("conferência na tela", () => {
  it("rascunho só com ativos; revisão com diferença e o envio com versão e unidade esperadas", () => {
    let r = novoRascunho("u1", "t1", produtos, new Date("2026-11-18T10:00:00Z"));
    expect(r.itens.map((i) => i.productId)).toEqual(["a", "b"]);
    r = anotarContagem(r, "a", "8");
    r = anotarContagem(r, "b", "1,5");
    const revisao = revisar(r);
    expect(revisao).toMatchObject({
      ok: true,
      linhas: [
        { productId: "a", esperadoMilli: 10000, contadoMilli: 8000, diferencaMilli: -2000 },
        { productId: "b", diferencaMilli: 0 },
      ],
      envio: [
        { productId: "a", expectedBalanceVersion: 3, expectedUnit: "UN", countedMilli: 8000 },
        { productId: "b", expectedBalanceVersion: 1, expectedUnit: "KG", countedMilli: 1500 },
      ],
    });
  });

  it("valor inválido ou nenhum contado impede a revisão", () => {
    const r = novoRascunho("u1", "t1", produtos);
    expect(revisar(r)).toMatchObject({ ok: false, erros: { geral: expect.stringMatching(/./) as unknown } });
    expect(revisar(anotarContagem(r, "a", "1,5"))).toMatchObject({ ok: false, erros: { a: expect.stringMatching(/não aceita casas/) as unknown } });
  });

  it("unidade trocada (UN → CX) ou produto arquivado: recontar, com o valor apagado", () => {
    let r = anotarContagem(anotarContagem(novoRascunho("u1", "t1", produtos), "a", "8"), "b", "1");
    r = reconciliar(r, [
      { productId: "a", balanceMilli: 10000, balanceVersion: 3, unit: "CX", archived: false },
      { productId: "b", balanceMilli: 1500, balanceVersion: 1, unit: "KG", archived: true },
    ]);
    expect(r.itens.map((i) => [i.productId, i.situacao, i.contado, i.unit])).toEqual([
      ["a", "recontar", "", "CX"],
      ["b", "recontar", "", "KG"],
    ]);
    expect(itensMarcados(r)).toBe(2);
    // Contar de novo (agora em CX) libera o item.
    r = anotarContagem(r, "a", "2");
    expect(r.itens[0].situacao).toBe("ok");
  });

  it("só o saldo mudou: revisar (valor fica, diferença sobre o saldo novo) até a pessoa conferir", () => {
    let r = anotarContagem(novoRascunho("u1", "t1", produtos), "a", "8");
    r = reconciliar(r, [{ productId: "a", balanceMilli: 9000, balanceVersion: 4, unit: "UN", archived: false }]);
    expect(r.itens[0]).toMatchObject({ situacao: "revisar", contado: "8", balanceMilli: 9000, balanceVersion: 4 });
    expect(revisar(r).ok).toBe(false);
    r = confirmarRevisao(r, "a");
    expect(revisar(r)).toMatchObject({ ok: true, linhas: [{ diferencaMilli: -1000 }], envio: [{ expectedBalanceVersion: 4 }] });
  });

  it("lista completa: produto que sumiu vira recontar; lista parcial (409) não mexe nos ausentes", () => {
    const r = anotarContagem(novoRascunho("u1", "t1", produtos), "b", "1");
    expect(reconciliar(r, [], false).itens[1].situacao).toBe("ok");
    expect(reconciliar(r, [], true).itens[1]).toMatchObject({ situacao: "recontar", contado: "" });
  });
});

describe("motivo dos ajustes", () => {
  it("com ajuste: ausente, vazio ou curto é recusado; 3 letras bastam", () => {
    expect(erroDoMotivo("", 1)).toBe("Informe o motivo dos ajustes (pelo menos 3 letras).");
    expect(erroDoMotivo("   ", 2)).toBe("Informe o motivo dos ajustes (pelo menos 3 letras).");
    expect(erroDoMotivo(" ab ", 1)).toBe("O motivo precisa ter pelo menos 3 letras.");
    expect(erroDoMotivo("abc", 1)).toBeNull();
    expect(erroDoMotivo("Quebra no transporte", 3)).toBeNull();
  });

  it("sem ajuste: opcional, mas curto continua recusado (a API recusa)", () => {
    expect(erroDoMotivo("", 0)).toBeNull();
    expect(erroDoMotivo("  ", 0)).toBeNull();
    expect(erroDoMotivo("ab", 0)).toBe("O motivo precisa ter pelo menos 3 letras.");
  });
});
