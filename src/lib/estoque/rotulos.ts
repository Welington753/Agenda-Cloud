// Rótulos e regras de tela do estoque, espelhando a API (backend/src/stock).
// A tela só usa isto para mostrar e esconder: quem recusa é o servidor.

export type FinalidadeEstoque = "VENDA" | "CONSUMO_INTERNO" | "AMBOS";
export type TipoMovimentacao =
  | "SALDO_INICIAL"
  | "ENTRADA_COMPRA"
  | "SAIDA_VENDA"
  | "SAIDA_CONSUMO"
  | "SAIDA_PERDA"
  | "AJUSTE_CONFERENCIA"
  | "ESTORNO";
export type TipoManual = "ENTRADA_COMPRA" | "SAIDA_VENDA" | "SAIDA_CONSUMO" | "SAIDA_PERDA";

export const FINALIDADES: readonly { valor: FinalidadeEstoque; rotulo: string }[] = [
  { valor: "VENDA", rotulo: "Venda" },
  { valor: "CONSUMO_INTERNO", rotulo: "Consumo interno" },
  { valor: "AMBOS", rotulo: "Venda e consumo interno" },
];

export const ROTULO_FINALIDADE: Record<FinalidadeEstoque, string> = {
  VENDA: "Venda",
  CONSUMO_INTERNO: "Consumo interno",
  AMBOS: "Venda e consumo",
};

export const ROTULO_TIPO: Record<TipoMovimentacao, string> = {
  SALDO_INICIAL: "Saldo inicial",
  ENTRADA_COMPRA: "Entrada por compra ou reposição",
  SAIDA_VENDA: "Saída por venda",
  SAIDA_CONSUMO: "Saída por consumo interno",
  SAIDA_PERDA: "Saída por perda",
  AJUSTE_CONFERENCIA: "Ajuste de conferência",
  ESTORNO: "Estorno",
};

export const TIPOS_MANUAIS: readonly TipoManual[] = ["ENTRADA_COMPRA", "SAIDA_VENDA", "SAIDA_CONSUMO", "SAIDA_PERDA"];

/** Tipos que a tela oferece para o produto (saída por venda só para venda;
 * por consumo, só para consumo interno). */
export function tiposPermitidos(finalidade: FinalidadeEstoque): TipoManual[] {
  return TIPOS_MANUAIS.filter((tipo) => {
    if (tipo === "SAIDA_VENDA") return finalidade !== "CONSUMO_INTERNO";
    if (tipo === "SAIDA_CONSUMO") return finalidade !== "VENDA";
    return true;
  });
}

export function motivoObrigatorio(tipo: TipoMovimentacao): boolean {
  return tipo === "SAIDA_PERDA" || tipo === "AJUSTE_CONFERENCIA" || tipo === "ESTORNO";
}

/** Movimentação que ainda pode ser estornada pela tela. */
export function podeEstornar(m: { kind: TipoMovimentacao; reversedByMovementId: string | null }): boolean {
  return m.reversedByMovementId === null && m.kind !== "AJUSTE_CONFERENCIA" && m.kind !== "ESTORNO";
}
