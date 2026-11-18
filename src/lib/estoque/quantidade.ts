// Quantidades do estoque na tela. A API guarda e recebe inteiros em
// milésimos da unidade do produto (1 UN = 1000; 1,5 KG = 1500). A conversão
// do texto digitado é feita só com texto e inteiros, nunca com número com
// vírgula, para não haver arredondamento. Sem conversão entre unidades.

export type UnidadeEstoque = "UN" | "CX" | "PCT" | "FR" | "G" | "ML" | "KG" | "L";

export const UNIDADES: readonly { valor: UnidadeEstoque; rotulo: string; casas: number }[] = [
  { valor: "UN", rotulo: "Unidade (UN)", casas: 0 },
  { valor: "CX", rotulo: "Caixa (CX)", casas: 0 },
  { valor: "PCT", rotulo: "Pacote (PCT)", casas: 0 },
  { valor: "FR", rotulo: "Frasco (FR)", casas: 0 },
  { valor: "G", rotulo: "Grama (G)", casas: 0 },
  { valor: "ML", rotulo: "Mililitro (ML)", casas: 0 },
  { valor: "KG", rotulo: "Quilograma (KG)", casas: 3 },
  { valor: "L", rotulo: "Litro (L)", casas: 3 },
];

export const MILLI = 1000;
/** Teto de uma movimentação (o mesmo da API): 1.000.000 unidades. */
export const MAIOR_MOVIMENTACAO_MILLI = 1_000_000 * MILLI;
/** Teto do saldo e do mínimo: 1.000.000.000 unidades. */
export const MAIOR_SALDO_MILLI = 1_000_000_000 * MILLI;

export function casasDaUnidade(unidade: UnidadeEstoque): number {
  return UNIDADES.find((u) => u.valor === unidade)?.casas ?? 0;
}

export type LeituraDeQuantidade = { ok: true; milli: number } | { ok: false; erro: string };

/**
 * Lê "12", "1,5" ou "1.250,750" (pt-BR) na unidade dada. Recusa vazio,
 * negativo, letras, casas a mais que a unidade aceita e valores acima do
 * teto. `permitirZero` para estoque mínimo e quantidade contada.
 */
export function lerQuantidade(
  texto: string,
  unidade: UnidadeEstoque,
  opcoes: { permitirZero?: boolean; maximoMilli?: number } = {},
): LeituraDeQuantidade {
  const limpo = texto.trim().replace(/\s/g, "");
  if (limpo === "") return { ok: false, erro: "Informe a quantidade." };
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(limpo)) {
    return { ok: false, erro: "Use só números, com vírgula para as casas (ex.: 1,5)." };
  }
  const [inteiraComPontos, fracao = ""] = limpo.split(",");
  const inteira = inteiraComPontos.replace(/\./g, "");
  const casas = casasDaUnidade(unidade);
  if (fracao.length > casas) {
    return {
      ok: false,
      erro: casas === 0 ? `A unidade ${unidade} não aceita casas decimais.` : `A unidade ${unidade} aceita até ${casas} casas decimais.`,
    };
  }
  if (inteira.length > 13) return { ok: false, erro: "Quantidade grande demais." };
  const milli = Number(inteira) * MILLI + Number(fracao.padEnd(3, "0") || "0");
  if (!Number.isSafeInteger(milli)) return { ok: false, erro: "Quantidade grande demais." };
  if (milli === 0 && !opcoes.permitirZero) return { ok: false, erro: "A quantidade precisa ser maior que zero." };
  const maximo = opcoes.maximoMilli ?? MAIOR_MOVIMENTACAO_MILLI;
  if (milli > maximo) return { ok: false, erro: "Quantidade acima do limite permitido." };
  return { ok: true, milli };
}

/** "1.250,5 KG", "12 UN". Mostra só as casas necessárias da unidade. */
export function formatarQuantidade(milli: number, unidade: UnidadeEstoque, comUnidade = true): string {
  const negativo = milli < 0;
  const absoluto = Math.abs(milli);
  const inteira = Math.floor(absoluto / MILLI);
  const fracao = String(absoluto % MILLI).padStart(3, "0").replace(/0+$/, "");
  const texto = `${negativo ? "-" : ""}${inteira.toLocaleString("pt-BR")}${fracao ? `,${fracao}` : ""}`;
  return comUnidade ? `${texto} ${unidade}` : texto;
}

/** Valor para o campo de edição (sem separador de milhar). */
export function quantidadeParaCampo(milli: number): string {
  const inteira = Math.floor(milli / MILLI);
  const fracao = String(milli % MILLI).padStart(3, "0").replace(/0+$/, "");
  return fracao ? `${inteira},${fracao}` : String(inteira);
}

/** Diferença com sinal, para a revisão da conferência ("+2 UN", "-0,5 KG"). */
export function formatarDiferenca(milli: number, unidade: UnidadeEstoque): string {
  if (milli === 0) return `0 ${unidade}`;
  return `${milli > 0 ? "+" : ""}${formatarQuantidade(milli, unidade)}`;
}
