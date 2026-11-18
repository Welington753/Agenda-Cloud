// Impressão digital de um envio do estoque: a mesma `requestKey` só devolve o
// resultado anterior quando representa a MESMA operação, com os mesmos dados
// normalizados. Mudou produto, quantidade, tipo, motivo, unidade esperada ou
// itens da conferência: é outra operação, e a rota responde 409 sem gravar.
//
// Normalização: textos com `trim` e espaços internos colapsados, vazio vira
// `null`; itens da conferência ordenados por produto; chaves do objeto em
// ordem alfabética. sha256 do JSON canônico, em hexadecimal (64 caracteres).
import { createHash } from 'node:crypto';

type Valor = string | number | boolean | null | Valor[] | { [chave: string]: Valor };

export function textoNormalizado(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const limpo = valor.trim().replace(/\s+/g, ' ');
  return limpo === '' ? null : limpo;
}

function canonico(valor: Valor): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  if (valor !== null && typeof valor === 'object') {
    return `{${Object.keys(valor)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonico(valor[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(valor);
}

function impressao(dados: { [chave: string]: Valor }): string {
  return createHash('sha256').update(canonico(dados)).digest('hex');
}

export function impressaoDaMovimentacao(d: {
  kind: string;
  productId: string;
  quantityMilli: number;
  expectedUnit: string;
  reason?: string | null;
}): string {
  return impressao({
    op: 'movement',
    kind: d.kind,
    productId: d.productId,
    quantityMilli: d.quantityMilli,
    expectedUnit: d.expectedUnit,
    reason: textoNormalizado(d.reason),
  });
}

export function impressaoDoEstorno(d: { movementId: string; reason: string }): string {
  return impressao({ op: 'reversal', movementId: d.movementId, reason: textoNormalizado(d.reason) });
}

export function impressaoDoProduto(d: {
  name: string;
  description?: string | null;
  internalCode?: string | null;
  categoryId: string;
  subcategoryId?: string | null;
  purpose: string;
  unit: string;
  minQuantityMilli: number;
  initialQuantityMilli?: number | null;
}): string {
  return impressao({
    op: 'product',
    name: textoNormalizado(d.name),
    description: textoNormalizado(d.description),
    internalCode: textoNormalizado(d.internalCode),
    categoryId: d.categoryId,
    subcategoryId: d.subcategoryId ?? null,
    purpose: d.purpose,
    unit: d.unit,
    minQuantityMilli: d.minQuantityMilli,
    initialQuantityMilli: d.initialQuantityMilli ?? 0,
  });
}

export function impressaoDaConferencia(d: {
  note?: string | null;
  items: readonly { productId: string; expectedBalanceVersion: number; expectedUnit: string; countedMilli: number }[];
}): string {
  const itens = [...d.items]
    .sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0))
    .map((i) => ({
      productId: i.productId,
      expectedBalanceVersion: i.expectedBalanceVersion,
      expectedUnit: i.expectedUnit,
      countedMilli: i.countedMilli,
    }));
  return impressao({ op: 'count', note: textoNormalizado(d.note), items: itens });
}
