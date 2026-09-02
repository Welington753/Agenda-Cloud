import { describe, expect, it } from "vitest";
import {
  calcularComissao,
  calcularComissaoPreview,
  calcularTotaisRelatorio,
  converterValorDigitado,
  validarRegraComissao,
} from "./engine";
import type { LancamentoComissao, Profissional, Servico } from "@/lib/types";

function profissional(overrides: Partial<Profissional> = {}): Profissional {
  return {
    id: "prof-1",
    tenantId: "t1",
    nome: "João",
    avatarIniciais: "JO",
    corAvatar: "#000",
    servicosIds: ["serv-1"],
    horarios: [],
    agendamentoOnlineAtivo: true,
    ativo: true,
    ...overrides,
  };
}

function servico(overrides: Partial<Servico> = {}): Servico {
  return {
    id: "serv-1",
    tenantId: "t1",
    nome: "Corte",
    descricaoCurta: "",
    precoCentavos: 10000,
    precoVisivel: true,
    duracaoMinutos: 30,
    intervaloPosteriorMinutos: 0,
    modalidade: "presencial",
    profissionaisIds: ["prof-1"],
    ativoNoAgendamentoPublico: true,
    exigeConfirmacaoManual: false,
    ativo: true,
    ...overrides,
  };
}

describe("calcularComissao", () => {
  it("40% de R$100 dá R$40 para o profissional e R$60 para o estabelecimento", () => {
    const resultado = calcularComissao(10000, { tipo: "percentual", valor: 40 });
    expect(resultado.valorProfissionalCentavos).toBe(4000);
    expect(resultado.valorEstabelecimentoCentavos).toBe(6000);
  });

  it("comissão fixa de R$40 em serviço de R$100 dá R$40 para o profissional e R$60 para o estabelecimento", () => {
    const resultado = calcularComissao(10000, { tipo: "fixo", valor: 4000 });
    expect(resultado.valorProfissionalCentavos).toBe(4000);
    expect(resultado.valorEstabelecimentoCentavos).toBe(6000);
  });

  it("arredonda de forma determinística para o centavo mais próximo (,5 arredonda para cima)", () => {
    // R$10,01 (1001 centavos) × 50% = 500,5 centavos exatos.
    const resultado = calcularComissao(1001, { tipo: "percentual", valor: 50 });
    expect(resultado.valorProfissionalCentavos).toBe(501);
    expect(resultado.valorEstabelecimentoCentavos).toBe(500);
    expect(resultado.valorProfissionalCentavos + resultado.valorEstabelecimentoCentavos).toBe(1001);
  });

  it("sem regra (0%) deixa o profissional com R$0 e o estabelecimento com 100%", () => {
    const resultado = calcularComissao(10000, { tipo: "percentual", valor: 0 });
    expect(resultado.valorProfissionalCentavos).toBe(0);
    expect(resultado.valorEstabelecimentoCentavos).toBe(10000);
  });

  it("nunca deixa o valor do profissional exceder o preço do agendamento, mesmo com regra fixa desatualizada", () => {
    // Regra fixa de R$40 validada contra um preço de serviço que depois caiu para
    // R$30 no agendamento — o cálculo protege o resultado sem precisar confiar
    // que a regra ainda é compatível com este agendamento específico.
    const resultado = calcularComissao(3000, { tipo: "fixo", valor: 4000 });
    expect(resultado.valorProfissionalCentavos).toBe(3000);
    expect(resultado.valorEstabelecimentoCentavos).toBe(0);
  });
});

describe("validarRegraComissao", () => {
  it("rejeita percentual menor que 0", () => {
    const resultado = validarRegraComissao({ tipo: "percentual", valor: -1, profissional: profissional(), servico: servico() });
    expect(resultado.valido).toBe(false);
  });

  it("rejeita percentual maior que 100", () => {
    const resultado = validarRegraComissao({ tipo: "percentual", valor: 101, profissional: profissional(), servico: servico() });
    expect(resultado.valido).toBe(false);
  });

  it("aceita percentual nas bordas 0 e 100", () => {
    expect(validarRegraComissao({ tipo: "percentual", valor: 0, profissional: profissional(), servico: servico() }).valido).toBe(true);
    expect(validarRegraComissao({ tipo: "percentual", valor: 100, profissional: profissional(), servico: servico() }).valido).toBe(true);
  });

  it("rejeita valor fixo negativo", () => {
    const resultado = validarRegraComissao({ tipo: "fixo", valor: -100, profissional: profissional(), servico: servico() });
    expect(resultado.valido).toBe(false);
  });

  it("rejeita valor fixo maior que o preço do serviço", () => {
    const resultado = validarRegraComissao({
      tipo: "fixo",
      valor: 10001,
      profissional: profissional(),
      servico: servico({ precoCentavos: 10000 }),
    });
    expect(resultado.valido).toBe(false);
  });

  it("rejeita profissional e serviço de tenants diferentes", () => {
    const resultado = validarRegraComissao({
      tipo: "percentual",
      valor: 10,
      profissional: profissional({ tenantId: "t1" }),
      servico: servico({ tenantId: "t2" }),
    });
    expect(resultado.valido).toBe(false);
  });

  it("rejeita serviço não vinculado ao profissional", () => {
    const resultado = validarRegraComissao({
      tipo: "percentual",
      valor: 10,
      profissional: profissional({ servicosIds: ["outro-servico"] }),
      servico: servico({ id: "serv-1" }),
    });
    expect(resultado.valido).toBe(false);
  });

  it("aceita combinação válida", () => {
    const resultado = validarRegraComissao({ tipo: "percentual", valor: 40, profissional: profissional(), servico: servico() });
    expect(resultado.valido).toBe(true);
  });
});

describe("calcularTotaisRelatorio", () => {
  function lancamento(overrides: Partial<LancamentoComissao> = {}): LancamentoComissao {
    return {
      id: "lanc-1",
      tenantId: "t1",
      agendamentoId: "ag-1",
      profissionalId: "prof-1",
      servicoId: "serv-1",
      precoAgendamentoCentavos: 10000,
      tipoComissao: "percentual",
      valorRegraAplicada: 40,
      valorProfissionalCentavos: 4000,
      valorEstabelecimentoCentavos: 6000,
      dataAtendimento: "2026-01-10T10:00:00.000Z",
      calculadoEm: "2026-01-10T11:00:00.000Z",
      status: "confirmado",
      ...overrides,
    };
  }

  it("soma serviços, profissional e estabelecimento de todos os lançamentos passados", () => {
    const totais = calcularTotaisRelatorio([
      lancamento({ id: "lanc-1" }),
      lancamento({ id: "lanc-2", precoAgendamentoCentavos: 5000, valorProfissionalCentavos: 2000, valorEstabelecimentoCentavos: 3000 }),
    ]);
    expect(totais.totalServicosCentavos).toBe(15000);
    expect(totais.totalProfissionalCentavos).toBe(6000);
    expect(totais.totalEstabelecimentoCentavos).toBe(9000);
  });

  it("lista vazia retorna totais zerados", () => {
    const totais = calcularTotaisRelatorio([]);
    expect(totais).toEqual({ totalServicosCentavos: 0, totalProfissionalCentavos: 0, totalEstabelecimentoCentavos: 0 });
  });
});

describe("converterValorDigitado", () => {
  it("converte percentual digitado normalmente", () => {
    expect(converterValorDigitado("percentual", "40")).toBe(40);
  });

  it("converte valor fixo em reais (vírgula) para centavos inteiros", () => {
    expect(converterValorDigitado("fixo", "30,50")).toBe(3050);
  });

  it("texto vazio vira 0, nunca NaN", () => {
    expect(converterValorDigitado("percentual", "")).toBe(0);
    expect(converterValorDigitado("fixo", "")).toBe(0);
  });

  it("texto não numérico vira 0, nunca NaN", () => {
    expect(converterValorDigitado("percentual", "abc")).toBe(0);
  });

  it("texto negativo vira 0, nunca um número negativo", () => {
    expect(converterValorDigitado("percentual", "-5")).toBe(0);
    expect(converterValorDigitado("fixo", "-10")).toBe(0);
  });

  it("texto representando infinito vira 0, nunca Infinity", () => {
    expect(converterValorDigitado("percentual", "Infinity")).toBe(0);
  });
});

describe("calcularComissaoPreview", () => {
  it("retorna null quando o serviço não tem preço definido (sob consulta)", () => {
    expect(calcularComissaoPreview(undefined, "percentual", "40")).toBeNull();
  });

  it("usa o texto digitado agora, não um valor persistido — 40% de R$100 dá R$40/R$60", () => {
    const preview = calcularComissaoPreview(10000, "percentual", "40");
    expect(preview).toEqual({ valorProfissionalCentavos: 4000, valorEstabelecimentoCentavos: 6000 });
  });

  it("reflete a troca de percentual para fixo imediatamente", () => {
    const percentual = calcularComissaoPreview(10000, "percentual", "40");
    const fixo = calcularComissaoPreview(10000, "fixo", "30,00");
    expect(percentual).toEqual({ valorProfissionalCentavos: 4000, valorEstabelecimentoCentavos: 6000 });
    expect(fixo).toEqual({ valorProfissionalCentavos: 3000, valorEstabelecimentoCentavos: 7000 });
  });

  it("texto inválido não gera NaN nem negativo no preview — cai para comissão 0", () => {
    const preview = calcularComissaoPreview(10000, "percentual", "abc");
    expect(preview).toEqual({ valorProfissionalCentavos: 0, valorEstabelecimentoCentavos: 10000 });
  });
});
