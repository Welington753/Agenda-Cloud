import { describe, expect, it } from "vitest";
import {
  caminhoBuscaDeClientes,
  caminhoCatalogo,
  caminhoComprasDoCliente,
  caminhoEstornarRecebimento,
  caminhoListaDeVendas,
  caminhoReceberVenda,
  caminhoRecebimentosDeVendas,
  ehBuscaDeClientes,
  ehCatalogoDeVenda,
  ehListaDeRecebimentosDeVendas,
  ehListaDeVendas,
  ehRecebimentoGravado,
  ehVenda,
  ehVendaGravada,
} from "./vendas-api";

const pessoa = { id: "u1", name: "Ana" };
const recebimento = {
  id: "r1",
  saleId: "s1",
  amountCents: 1999,
  method: "PIX",
  receivedOn: "2026-11-25",
  recordedAt: "2026-11-25T12:00:00.000Z",
  recordedBy: pessoa,
  notes: null,
  refund: null,
};
const venda = {
  id: "s1",
  status: "ATIVA",
  totalCents: 1999,
  recordedAt: "2026-11-25T12:00:00.000Z",
  localDate: "2026-11-25",
  recordedBy: pessoa,
  consumer: null,
  items: [
    { position: 1, productId: "p1", productName: "Xampu", unit: "UN", quantityMilli: 1000, unitPriceCents: 1999, suggestedPriceCents: 1999, lineTotalCents: 1999 },
  ],
  payments: [recebimento],
  activePaymentId: "r1",
  cancellation: null,
};

describe("forma das respostas de vendas", () => {
  it("catálogo: saldo numérico é opcional (só para quem vê o estoque)", () => {
    const base = { id: "p1", name: "Xampu", unit: "UN", salePriceCents: null, available: false };
    expect(ehCatalogoDeVenda({ products: [base], showsBalance: false, nextCursor: null })).toBe(true);
    expect(ehCatalogoDeVenda({ products: [{ ...base, balanceMilli: 2000 }], showsBalance: true, nextCursor: "c" })).toBe(true);
    expect(ehCatalogoDeVenda({ products: [{ ...base, salePriceCents: "10" }], showsBalance: false, nextCursor: null })).toBe(false);
  });

  it("busca de clientes: só id, nome e final do telefone de 4 dígitos", () => {
    expect(ehBuscaDeClientes({ consumers: [{ id: "c1", name: "Ana", phoneLast4: "1234" }, { id: "c2", name: "Bia", phoneLast4: null }] })).toBe(true);
    expect(ehBuscaDeClientes({ consumers: [{ id: "c1", name: "Ana", phoneLast4: "11987651234" }] })).toBe(false);
  });

  it("venda e recebimento gravados", () => {
    expect(ehVenda(venda)).toBe(true);
    expect(ehVendaGravada({ created: false, sale: venda })).toBe(true);
    expect(ehVenda({ ...venda, status: "OUTRA" })).toBe(false);
    expect(ehRecebimentoGravado({ created: true, payment: recebimento })).toBe(true);
    expect(ehRecebimentoGravado({ created: true, payment: { ...recebimento, method: "CHEQUE" } })).toBe(false);
  });

  it("listas com os totais do período", () => {
    expect(
      ehListaDeVendas({
        scope: "mine",
        timezone: "America/Sao_Paulo",
        period: { from: "2026-11-01", to: "2026-11-30" },
        summary: { activeSales: 1, soldCents: 1999, cancelledSales: 0 },
        sales: [{ ...venda, items: [{ productName: "Xampu", quantityMilli: 1000, unit: "UN" }], payment: { id: "r1", amountCents: 1999, method: "PIX", receivedOn: "2026-11-25", refunded: false } }],
        nextCursor: null,
      }),
    ).toBe(true);
    expect(
      ehListaDeRecebimentosDeVendas({
        scope: "all",
        timezone: "America/Sao_Paulo",
        period: { from: "2026-11-01", to: "2026-11-30" },
        summary: { receivedCents: 1999, refundedCents: 0, netCents: 1999 },
        payments: [recebimento],
        complete: true,
      }),
    ).toBe(true);
  });
});

describe("caminhos", () => {
  it("escapam ids e só mandam o que foi informado", () => {
    expect(caminhoCatalogo("t/1", "  ")).toBe("/tenants/t%2F1/sales/catalog");
    expect(caminhoCatalogo("t", "xam pu")).toBe("/tenants/t/sales/catalog?q=xam+pu");
    expect(caminhoBuscaDeClientes("t", " 1234 ")).toBe("/tenants/t/sales/consumers?q=1234");
    expect(caminhoListaDeVendas("t", { scope: "all", periodo: { from: "2026-11-01", to: "2026-11-30" } })).toBe(
      "/tenants/t/sales?scope=all&from=2026-11-01&to=2026-11-30",
    );
    expect(caminhoListaDeVendas("t", { scope: "mine" })).toBe("/tenants/t/sales?scope=mine");
    expect(caminhoRecebimentosDeVendas("t", { scope: "mine" })).toBe("/tenants/t/sales/payments?scope=mine");
    expect(caminhoReceberVenda("t", "s 1")).toBe("/tenants/t/sales/s%201/payments");
    expect(caminhoEstornarRecebimento("t", "r1")).toBe("/tenants/t/sales/payments/r1/refund");
    expect(caminhoComprasDoCliente("t", "c1", "abc")).toBe("/tenants/t/consumers/c1/purchases?cursor=abc");
  });
});
