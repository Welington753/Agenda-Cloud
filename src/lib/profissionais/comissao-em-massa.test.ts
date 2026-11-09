import { describe, expect, it } from "vitest";
import {
  MAXIMO_EM_MASSA,
  corpoDaAplicacao,
  mensagemDoConflito,
  montarPedido,
  rotuloDaConfiguracao,
  rotuloDoBotaoAplicar,
  type FormularioEmMassa,
} from "./comissao-em-massa";

const base: FormularioEmMassa = { alcance: "ALL", selecionados: [], tipo: "PERCENTAGE", valor: "10", modo: "PRESERVE" };

describe("montarPedido", () => {
  it("todos: sem lista, percentual em pontos-base", () => {
    expect(montarPedido(base)).toEqual({
      ok: true,
      pedido: { target: "ALL", defaultRule: { kind: "PERCENTAGE", value: 1000 }, mode: "PRESERVE" },
    });
  });

  it("escolhidos: lista sem repetição; fixo em centavos", () => {
    expect(montarPedido({ ...base, alcance: "SELECTED", selecionados: ["a", "b", "a"], tipo: "FIXED", valor: "15,50", modo: "REPLACE" })).toEqual({
      ok: true,
      pedido: { target: "SELECTED", professionalIds: ["a", "b"], defaultRule: { kind: "FIXED", value: 1550 }, mode: "REPLACE" },
    });
  });

  it("todos ignora a seleção guardada", () => {
    const r = montarPedido({ ...base, selecionados: ["a"] });
    expect(r.ok && "professionalIds" in r.pedido).toBe(false);
  });

  it.each([
    ["escolher sem ninguém", { alcance: "SELECTED" as const, selecionados: [] }, "Escolha ao menos um profissional."],
    [
      "escolher acima do teto",
      { alcance: "SELECTED" as const, selecionados: Array.from({ length: MAXIMO_EM_MASSA + 1 }, (_, i) => `p${i}`) },
      "Escolha no máximo 200 profissionais por vez.",
    ],
    ["valor vazio", { valor: "" }, "Informe o percentual."],
    ["zero", { valor: "0" }, "Para não pagar comissão, desligue “Recebe comissão” no profissional."],
    ["acima de 100%", { valor: "100,01" }, "O percentual vai até 100%."],
    ["fixo vazio", { tipo: "FIXED" as const, valor: "" }, "Informe o valor."],
  ])("recusa %s", (_nome, mudanca, erro) => {
    expect(montarPedido({ ...base, ...mudanca })).toEqual({ ok: false, erro });
  });
});

describe("corpoDaAplicacao", () => {
  const pedido = { target: "ALL" as const, defaultRule: { kind: "PERCENTAGE" as const, value: 1000 } };

  it("preservar: impressão, sem confirmação", () => {
    expect(corpoDaAplicacao({ ...pedido, mode: "PRESERVE" }, { fingerprint: "abc" })).toEqual({ ...pedido, mode: "PRESERVE", fingerprint: "abc" });
  });

  it("substituir: impressão e confirmação explícita", () => {
    expect(corpoDaAplicacao({ ...pedido, mode: "REPLACE" }, { fingerprint: "abc" })).toEqual({
      ...pedido,
      mode: "REPLACE",
      fingerprint: "abc",
      confirmReplace: true,
    });
  });
});

describe("rótulos", () => {
  it.each([
    [{ receivesCommission: false, defaultRule: { kind: "PERCENTAGE" as const, value: 1000 } }, "Não recebe comissão"],
    [{ receivesCommission: true, defaultRule: null }, "Recebe · sem regra geral"],
    [{ receivesCommission: true, defaultRule: { kind: "PERCENTAGE" as const, value: 1250 } }, "Recebe · 12,5%"],
  ])("configuração %o", (c, rotulo) => {
    expect(rotuloDaConfiguracao(c)).toBe(rotulo);
  });

  it("valor fixo usa a moeda", () => {
    expect(rotuloDaConfiguracao({ receivesCommission: true, defaultRule: { kind: "FIXED", value: 1500 } })).toMatch(/^Recebe · R\$\s15,00 fixo$/);
  });

  it("botão conforme quantos mudam", () => {
    expect([0, 1, 7].map(rotuloDoBotaoAplicar)).toEqual(["Nada a aplicar", "Aplicar a 1 profissional", "Aplicar a 7 profissionais"]);
  });

  it("conflito: prévia desatualizada tem texto próprio; o resto usa a mensagem do servidor", () => {
    expect(mensagemDoConflito("PREVIA_DESATUALIZADA", "x")).toMatch(/prévia abaixo foi atualizada/);
    expect(mensagemDoConflito("PROFISSIONAL_INATIVO", "Tire os inativos.")).toBe("Tire os inativos.");
  });
});
