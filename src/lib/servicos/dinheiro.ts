// Conversão entre o que o usuário digita ("85,50") e a unidade do backend
// (centavos inteiros, coluna `price_cents`). Módulo puro, sem React.
//
// NUNCA usa ponto flutuante no caminho: `parseFloat("85,50".replace(",", ".")) * 100`
// devolve 8549.999999999998 para vários valores comuns, e um `Math.round` em
// cima disso só esconde o problema. Aqui a conta é feita sobre os DÍGITOS —
// parte inteira e centavos são inteiros separados, então o resultado é exato
// por construção.
const SEPARADOR_DECIMAL = ",";

/** Quanto o backend aceita em `priceCents` (limite de INTEGER do Postgres). */
export const PRECO_CENTAVOS_MAX = 2_147_483_647;

export type ResultadoPreco =
  | { ok: true; centavos: number | null }
  | { ok: false; erro: string };

/**
 * Converte o texto do campo de preço em centavos inteiros.
 *
 * Campo vazio devolve `null` — que é o valor de domínio "sob consulta"
 * (coluna nullable), nunca zero. Zero é um preço legítimo e distinto.
 */
export function precoParaCentavos(texto: string): ResultadoPreco {
  const limpo = texto.trim().replace(/\s/g, "");
  if (limpo === "") return { ok: true, centavos: null };

  // Aceita "85", "85,5", "85,50" e também "85.50" (o usuário pode digitar o
  // separador do teclado numérico); separador de milhar é rejeitado de
  // propósito, porque "1.500" é ambíguo entre mil e quinhentos e um e meio.
  const normalizado = limpo.replace(".", SEPARADOR_DECIMAL);
  const partes = normalizado.split(SEPARADOR_DECIMAL);
  if (partes.length > 2) return { ok: false, erro: "Informe um valor válido, como 85,50." };

  const [inteiraBruta, centavosBrutos = ""] = partes;
  const inteira = inteiraBruta === "" ? "0" : inteiraBruta;
  if (!/^\d+$/.test(inteira)) return { ok: false, erro: "Informe um valor válido, como 85,50." };
  if (centavosBrutos !== "" && !/^\d{1,2}$/.test(centavosBrutos)) {
    return { ok: false, erro: "Use no máximo duas casas decimais." };
  }

  // `padEnd` trata "85,5" como 85,50 — nunca como 85,05.
  const centavos = Number(inteira) * 100 + Number(centavosBrutos.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(centavos) || centavos > PRECO_CENTAVOS_MAX) {
    return { ok: false, erro: "Valor acima do máximo aceito." };
  }
  return { ok: true, centavos };
}

/** Centavos inteiros para o texto editável do formulário (sempre com duas
 * casas). `null` vira campo vazio — "sob consulta". */
export function centavosParaCampo(centavos: number | null): string {
  if (centavos === null) return "";
  const inteira = Math.floor(centavos / 100);
  const resto = centavos % 100;
  return `${inteira}${SEPARADOR_DECIMAL}${String(resto).padStart(2, "0")}`;
}

/** Exibição em lista. `null` nunca vira "R$ 0,00". */
export function formatarPrecoServico(centavos: number | null): string {
  if (centavos === null) return "Sob consulta";
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
