import { describe, expect, it } from "vitest";
import type { AreaDoEstabelecimento } from "@/lib/conta/papel";
import {
  abaInicial,
  abasDisponiveis,
  acoesDaVenda,
  buscaDeClientePronta,
  clienteTocado,
  hojeParaRecebimento,
  idsComNomeRepetido,
  mensagemDaRecusa,
  rotuloDoCliente,
  situacaoDoRecebimento,
  situacaoDoRecebimentoNoDetalhe,
} from "./apresentacao";

const com = (...areas: AreaDoEstabelecimento[]) => (a: AreaDoEstabelecimento) => areas.includes(a);
const venda = (o: Partial<{ status: "ATIVA" | "CANCELADA"; activePaymentId: string | null; quem: string }> = {}) => ({
  status: o.status ?? ("ATIVA" as const),
  activePaymentId: o.activePaymentId ?? null,
  recordedBy: { id: o.quem ?? "eu", name: "Eu" },
});

describe("situação do recebimento, separada da venda", () => {
  it("lista", () => {
    const pagamento = { id: "r", amountCents: 100, method: "PIX" as const, receivedOn: "2026-11-25", refunded: false };
    expect(situacaoDoRecebimento({ status: "ATIVA", payment: null })).toBe("a-receber");
    expect(situacaoDoRecebimento({ status: "ATIVA", payment: pagamento })).toBe("recebida");
    expect(situacaoDoRecebimento({ status: "ATIVA", payment: { ...pagamento, refunded: true } })).toBe("estornado");
    expect(situacaoDoRecebimento({ status: "CANCELADA", payment: null })).toBe("sem-recebimento");
    expect(situacaoDoRecebimento({ status: "CANCELADA", payment: { ...pagamento, refunded: true } })).toBe("estornado");
  });

  it("detalhe", () => {
    expect(situacaoDoRecebimentoNoDetalhe({ status: "ATIVA", payments: [], activePaymentId: null })).toBe("a-receber");
    expect(situacaoDoRecebimentoNoDetalhe({ status: "ATIVA", payments: [{} as never], activePaymentId: "r" })).toBe("recebida");
    expect(situacaoDoRecebimentoNoDetalhe({ status: "CANCELADA", payments: [{} as never], activePaymentId: null })).toBe("estornado");
  });
});

describe("ações da venda pelas áreas da sessão", () => {
  it("recepcionista recebe só a própria venda", () => {
    const tem = com("VENDAS_NOVA", "VENDAS_HISTORICO", "VENDAS_RECEBER");
    expect(acoesDaVenda(venda(), "eu", tem)).toEqual({ receber: true, estornar: false, cancelar: false, cancelarDependeDeEstorno: false });
    expect(acoesDaVenda(venda({ quem: "outra" }), "eu", tem).receber).toBe(false);
  });

  it("venda de outra pessoa: receber exige também a consulta geral", () => {
    expect(acoesDaVenda(venda({ quem: "outra" }), "eu", com("VENDAS_RECEBER", "VENDAS_VER_TODAS")).receber).toBe(true);
  });

  it("estorno antes do cancelamento", () => {
    const dono = com("VENDAS_RECEBER", "VENDAS_VER_TODAS", "VENDAS_CANCELAR", "VENDAS_ESTORNAR_RECEBIMENTO");
    expect(acoesDaVenda(venda({ activePaymentId: "r" }), "eu", dono)).toEqual({
      receber: false,
      estornar: true,
      cancelar: false,
      cancelarDependeDeEstorno: true,
    });
    expect(acoesDaVenda(venda(), "eu", dono)).toMatchObject({ receber: true, cancelar: true, estornar: false });
  });

  it("venda cancelada não recebe nem cancela de novo", () => {
    const dono = com("VENDAS_RECEBER", "VENDAS_VER_TODAS", "VENDAS_CANCELAR", "VENDAS_ESTORNAR_RECEBIMENTO");
    expect(acoesDaVenda(venda({ status: "CANCELADA" }), "eu", dono)).toEqual({
      receber: false,
      estornar: false,
      cancelar: false,
      cancelarDependeDeEstorno: false,
    });
  });
});

describe("abas de /conta/vendas", () => {
  it("cada área abre a sua aba", () => {
    expect(abasDisponiveis(com("VENDAS_NOVA", "VENDAS_HISTORICO"))).toEqual(["nova", "minhas"]);
    expect(abasDisponiveis(com("VENDAS_HISTORICO", "VENDAS_VER_TODAS"))).toEqual(["minhas", "todas", "recebimentos"]);
    expect(abasDisponiveis(com())).toEqual([]);
  });

  it("aba do endereço só se a sessão a vê", () => {
    expect(abaInicial("todas", ["nova", "minhas"])).toBe("nova");
    expect(abaInicial("minhas", ["nova", "minhas"])).toBe("minhas");
    expect(abaInicial(null, [])).toBeNull();
  });
});

describe("cliente da venda", () => {
  const resultados = [
    { id: "c1", name: "Ana Souza", phoneLast4: "1234" },
    { id: "c2", name: "ana souza ", phoneLast4: "9876" },
    { id: "c3", name: "Bruno", phoneLast4: null },
  ];

  it("busca de 2 a 80 caracteres", () => {
    expect(buscaDeClientePronta("a")).toBe(false);
    expect(buscaDeClientePronta(" an ")).toBe(true);
    expect(buscaDeClientePronta("x".repeat(81))).toBe(false);
  });

  it("rótulo com o final do telefone, nunca o telefone inteiro", () => {
    expect(rotuloDoCliente(resultados[0])).toBe("Ana Souza · final 1234");
    expect(rotuloDoCliente(resultados[2])).toBe("Bruno · sem telefone");
  });

  it("nomes iguais são marcados para conferência, sem pré-seleção", () => {
    expect([...idsComNomeRepetido(resultados)].sort()).toEqual(["c1", "c2"]);
  });

  it("só o resultado tocado, pelo ID, vira o cliente", () => {
    expect(clienteTocado(resultados, "c2")?.phoneLast4).toBe("9876");
    expect(clienteTocado(resultados, "Ana Souza")).toBeNull();
    expect(clienteTocado([resultados[0]], "c9")).toBeNull();
  });
});

describe("mensagens das recusas", () => {
  it("adicional desligado explica que a manutenção continua", () => {
    expect(mensagemDaRecusa({ tipo: "proibido", codigo: "RECURSO_NAO_CONTRATADO", mensagem: "x" })).toMatch(/Minhas operações/);
  });

  it("senha não confirmada não altera nada", () => {
    expect(mensagemDaRecusa({ tipo: "reautenticar" })).toMatch(/Nada foi alterado/);
  });

  it("os demais usam o texto do servidor", () => {
    expect(mensagemDaRecusa({ tipo: "conflito", codigo: "JA_RECEBIDA", mensagem: "Esta venda já foi recebida.", dados: {} })).toBe(
      "Esta venda já foi recebida.",
    );
  });
});

describe("data do recebimento", () => {
  it("usa o dia do estabelecimento quando conhecido, nunca antes da venda", () => {
    expect(hojeParaRecebimento("2026-11-20", "2026-11-25", new Date())).toBe("2026-11-25");
    expect(hojeParaRecebimento("2026-11-26", "2026-11-25", new Date())).toBe("2026-11-26");
    expect(hojeParaRecebimento("2026-01-01", null, new Date(2026, 10, 25, 12))).toBe("2026-11-25");
  });
});
