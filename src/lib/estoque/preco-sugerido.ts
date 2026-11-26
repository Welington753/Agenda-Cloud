// Preço sugerido de venda no cadastro de produto (docs/plans/vendas-v1.md,
// seção 4): vazio é "sem preço sugerido" (`null`), nunca zero. Zero e valores
// acima do teto do preço unitário de uma venda são recusados, como na API.
import { MAIOR_PRECO_UNITARIO_CENTAVOS } from "@/lib/vendas/calculo";
import { precoParaCentavos } from "@/lib/servicos/dinheiro";

export type LeituraDoPrecoSugerido = { ok: true; centavos: number | null } | { ok: false; erro: string };

export function lerPrecoSugerido(texto: string): LeituraDoPrecoSugerido {
  const lido = precoParaCentavos(texto);
  if (!lido.ok) return lido;
  if (lido.centavos === null) return { ok: true, centavos: null };
  if (lido.centavos < 1) return { ok: false, erro: "Use um preço maior que zero, ou deixe vazio para ficar sem preço sugerido." };
  if (lido.centavos > MAIOR_PRECO_UNITARIO_CENTAVOS) return { ok: false, erro: "Preço acima do máximo aceito (R$ 1.000.000,00)." };
  return { ok: true, centavos: lido.centavos };
}
