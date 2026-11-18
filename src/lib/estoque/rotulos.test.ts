import { describe, expect, it } from "vitest";
import { motivoObrigatorio, podeEstornar, tiposPermitidos } from "./rotulos";
import { falhaDeAcesso, mensagemDaFalha, MENSAGEM_NAO_CONTRATADO } from "./mensagens";

describe("regras de tela do estoque", () => {
  it("tipos de saída pela finalidade (espelha a API)", () => {
    expect(tiposPermitidos("VENDA")).toEqual(["ENTRADA_COMPRA", "SAIDA_VENDA", "SAIDA_PERDA"]);
    expect(tiposPermitidos("CONSUMO_INTERNO")).toEqual(["ENTRADA_COMPRA", "SAIDA_CONSUMO", "SAIDA_PERDA"]);
    expect(tiposPermitidos("AMBOS")).toEqual(["ENTRADA_COMPRA", "SAIDA_VENDA", "SAIDA_CONSUMO", "SAIDA_PERDA"]);
  });

  it("motivo obrigatório e o que pode ser estornado", () => {
    expect(motivoObrigatorio("SAIDA_PERDA")).toBe(true);
    expect(motivoObrigatorio("SAIDA_VENDA")).toBe(false);
    expect(podeEstornar({ kind: "SAIDA_VENDA", reversedByMovementId: null })).toBe(true);
    expect(podeEstornar({ kind: "SAIDA_VENDA", reversedByMovementId: "x" })).toBe(false);
    expect(podeEstornar({ kind: "AJUSTE_CONFERENCIA", reversedByMovementId: null })).toBe(false);
    expect(podeEstornar({ kind: "ESTORNO", reversedByMovementId: null })).toBe(false);
  });

  it("mensagens: sem adicional tem texto próprio; conflito usa o texto da API", () => {
    expect(mensagemDaFalha({ tipo: "nao_contratado" })).toBe(MENSAGEM_NAO_CONTRATADO);
    expect(mensagemDaFalha({ tipo: "conflito", code: "SALDO_INSUFICIENTE", mensagem: "Saldo insuficiente.", dados: {} })).toBe("Saldo insuficiente.");
    expect(falhaDeAcesso({ tipo: "nao_contratado" })).toBe(true);
    expect(falhaDeAcesso({ tipo: "falha_comunicacao" })).toBe(false);
  });
});
