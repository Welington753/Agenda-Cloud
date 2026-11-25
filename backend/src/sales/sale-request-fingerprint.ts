// Impressão digital de um pedido de venda (`sales.request_fingerprint`): a
// mesma `requestKey` só devolve a venda gravada quando representa a MESMA
// venda. Cliente, produto, quantidade, unidade esperada, preço sugerido visto
// ou preço aplicado diferentes: é outra venda, 409 `CHAVE_REUTILIZADA` sem
// gravar. Itens ordenados por produto (a ordem na tela não muda a venda);
// sha256 do JSON canônico, como no estoque.
//
// O recebimento não tem coluna de impressão: o reenvio compara os próprios
// campos gravados (venda, forma, data e observação), ver
// `mesmoRecebimento`.
import { impressao, textoNormalizado } from '../stock/stock-request-fingerprint.js';
import type { CreateSaleDto } from './sales.dto.js';

export function impressaoDaVenda(d: Pick<CreateSaleDto, 'consumerId' | 'items'>): string {
  const itens = [...d.items]
    .sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0))
    .map((i) => ({
      productId: i.productId,
      quantityMilli: i.quantityMilli,
      expectedUnit: i.expectedUnit,
      expectedSuggestedPriceCents: i.expectedSuggestedPriceCents,
      unitPriceCents: i.unitPriceCents,
    }));
  return impressao({ op: 'sale', consumerId: d.consumerId ?? null, items: itens });
}

/** Reenvio do recebimento: mesmo pedido quando venda, forma, data e
 * observação coincidem. */
export function mesmoRecebimento(
  gravado: { saleId: string; method: string; receivedOn: string; notes: string | null },
  pedido: { saleId: string; method: string; receivedOn: string; notes: string | null },
): boolean {
  return (
    gravado.saleId === pedido.saleId &&
    gravado.method === pedido.method &&
    gravado.receivedOn === pedido.receivedOn &&
    textoNormalizado(gravado.notes) === textoNormalizado(pedido.notes)
  );
}

/** Repetição de cancelamento ou estorno (idempotentes pelo estado): o mesmo
 * motivo devolve o que já está gravado; outro motivo é outro pedido. */
export function mesmoMotivo(gravado: string | null, pedido: string): boolean {
  return textoNormalizado(gravado) === textoNormalizado(pedido);
}
