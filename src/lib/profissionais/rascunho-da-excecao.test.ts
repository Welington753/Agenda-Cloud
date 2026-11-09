import { describe, expect, it } from "vitest";
import { camposDaRegra, editar, estadoDoEditor, mesmosCampos } from "./rascunho-da-excecao";

const QUINZE = { kind: "PERCENTAGE" as const, value: 1500 };
const DEZOITO = { kind: "PERCENTAGE" as const, value: 1800 };
const FIXO = { kind: "FIXED" as const, value: 500 };
const SEM = { kind: "NONE" as const, value: null };

describe("rascunho da exceção por serviço", () => {
  it("campos a partir da regra gravada", () => {
    expect(camposDaRegra(null)).toEqual({ escolha: "USAR_GERAL", valor: "" });
    expect(camposDaRegra(QUINZE)).toEqual({ escolha: "PERCENTAGE", valor: "15" });
    expect(camposDaRegra(SEM)).toEqual({ escolha: "NONE", valor: "" });
    expect(camposDaRegra(FIXO).escolha).toBe("FIXED");
  });

  it("o valor só conta nas escolhas com valor", () => {
    expect(mesmosCampos({ escolha: "NONE", valor: "9" }, { escolha: "NONE", valor: "" })).toBe(true);
    expect(mesmosCampos({ escolha: "PERCENTAGE", valor: " 15 " }, { escolha: "PERCENTAGE", valor: "15" })).toBe(true);
    expect(mesmosCampos({ escolha: "PERCENTAGE", valor: "18" }, { escolha: "PERCENTAGE", valor: "15" })).toBe(false);
  });

  it("sem alteração, mostra sempre o valor gravado (atualiza depois de uma operação concluída)", () => {
    expect(estadoDoEditor(QUINZE, null)).toEqual({ campos: camposDaRegra(QUINZE), alterado: false, mudouPorFora: false });
    // Exceção removida pela regra geral: o editor passa a "Usar regra geral".
    expect(estadoDoEditor(null, null).campos).toEqual({ escolha: "USAR_GERAL", valor: "" });
    // Editou e voltou ao valor original: não há rascunho pendente.
    const voltou = editar(QUINZE, null, { escolha: "PERCENTAGE", valor: "15" });
    expect(estadoDoEditor(null, voltou)).toEqual({ campos: camposDaRegra(null), alterado: false, mudouPorFora: false });
  });

  it("alteração não salva sobrevive a uma releitura que muda o valor gravado, com aviso", () => {
    const rascunho = editar(QUINZE, null, { escolha: "PERCENTAGE", valor: "18" });
    expect(estadoDoEditor(QUINZE, rascunho)).toEqual({ campos: rascunho.campos, alterado: true, mudouPorFora: false });
    // A exceção foi removida (ou mudou) por fora: o rascunho continua, com aviso.
    expect(estadoDoEditor(null, rascunho)).toEqual({ campos: rascunho.campos, alterado: true, mudouPorFora: true });
    expect(estadoDoEditor(FIXO, rascunho).mudouPorFora).toBe(true);
    // Gravado por fora igual ao rascunho: nada a avisar.
    expect(estadoDoEditor(DEZOITO, rascunho).mudouPorFora).toBe(false);
  });

  it("a base é a do começo da edição, não a de cada tecla", () => {
    const primeiro = editar(QUINZE, null, { escolha: "PERCENTAGE", valor: "1" });
    const segundo = editar(null, primeiro, { escolha: "PERCENTAGE", valor: "18" });
    expect(segundo.base).toEqual(QUINZE);
    // Sem rascunho pendente, a próxima edição começa do valor gravado atual.
    expect(editar(null, editar(QUINZE, null, camposDaRegra(QUINZE)), { escolha: "NONE", valor: "" }).base).toBeNull();
  });
});
