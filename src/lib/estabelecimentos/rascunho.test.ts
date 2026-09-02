import { describe, expect, it } from "vitest";
import { aplicarRascunhoNaIdentidade, construirRascunhoPersonalizacao, rascunhosIguais } from "./rascunho";
import type { Estabelecimento } from "@/lib/types";

function estabelecimentoBase(overrides: Partial<Estabelecimento> = {}): Estabelecimento {
  return {
    id: "estab-1",
    tenantId: "tenant-1",
    slug: "estabelecimento-teste",
    categoria: "barbearia",
    identidadeVisual: {
      nome: "Estabelecimento Teste",
      nomeCurto: "Teste",
      logoIniciais: "ET",
      corPrincipal: "#111111",
      corSecundaria: "#FFFFFF",
      corDestaque: "#B5651D",
      estilo: "",
      modelo: "classico",
      endereco: "Rua Teste, 1",
      telefone: "(11) 90000-0000",
      textoApresentacao: "Texto.",
      fotos: [],
    },
    fusoHorario: "America/Sao_Paulo",
    horarioGeral: { diasFuncionamento: [1, 2, 3, 4, 5], abertura: "09:00", fechamento: "18:00" },
    regras: {
      antecedenciaMinimaMinutos: 60,
      limiteDiasFuturos: 30,
      prazoCancelamentoHoras: 3,
      confirmacaoAutomatica: false,
      permitirQualquerProfissional: true,
      permitirRemarcacaoCliente: true,
      exigirTelefoneCliente: true,
      exigirEmailCliente: false,
      exibirPrecoPublico: true,
      intervaloPadraoMinutos: 0,
    },
    plano: "pro",
    featuresDesativadas: [],
    limites: { maxProfissionais: 20, maxUnidades: 5 },
    status: "ativo",
    criadoEm: new Date().toISOString(),
    quantidadeProfissionais: 1,
    ...overrides,
  };
}

describe("construirRascunhoPersonalizacao", () => {
  it("usa a ordem padrão e valores neutros quando não há personalizacaoAvancada salva (dado antigo)", () => {
    const rascunho = construirRascunhoPersonalizacao(estabelecimentoBase());
    expect(rascunho.ordemSecoes).toEqual(["apresentacao", "servicos", "equipe", "fotos"]);
    expect(rascunho.rodapePersonalizado).toBe("");
    expect(rascunho.ocultarMarca).toBe(false);
    expect(rascunho.logoUrl).toBeUndefined();
  });

  it("reflete os valores salvos quando existem", () => {
    const estabelecimento = estabelecimentoBase({
      identidadeVisual: {
        ...estabelecimentoBase().identidadeVisual,
        logoUrl: "data:image/png;base64,AAAA",
        personalizacaoAvancada: { ordemSecoes: ["fotos", "servicos", "equipe", "apresentacao"], rodapePersonalizado: "Rodapé.", ocultarMarcaPlataforma: true },
      },
    });
    const rascunho = construirRascunhoPersonalizacao(estabelecimento);
    expect(rascunho.ordemSecoes).toEqual(["fotos", "servicos", "equipe", "apresentacao"]);
    expect(rascunho.rodapePersonalizado).toBe("Rodapé.");
    expect(rascunho.ocultarMarca).toBe(true);
    expect(rascunho.logoUrl).toBe("data:image/png;base64,AAAA");
  });

  it("cancelar restaura exatamente os valores salvos — construir de novo dá o mesmo rascunho", () => {
    const estabelecimento = estabelecimentoBase({
      identidadeVisual: { ...estabelecimentoBase().identidadeVisual, corDestaque: "#123456" },
    });
    const carregado = construirRascunhoPersonalizacao(estabelecimento);
    const aposCancelar = construirRascunhoPersonalizacao(estabelecimento);
    expect(rascunhosIguais(carregado, aposCancelar)).toBe(true);
  });
});

describe("aplicarRascunhoNaIdentidade (base do preview)", () => {
  it("aplica a aparência do rascunho sem alterar dados reais (endereço, regras)", () => {
    const estabelecimento = estabelecimentoBase();
    const rascunho = construirRascunhoPersonalizacao(estabelecimento);
    const comAlteracao = { ...rascunho, corDestaque: "#00FF00" };
    const preview = aplicarRascunhoNaIdentidade(estabelecimento, comAlteracao);

    expect(preview.identidadeVisual.corDestaque).toBe("#00FF00");
    expect(preview.identidadeVisual.endereco).toBe(estabelecimento.identidadeVisual.endereco);
    expect(preview.regras).toEqual(estabelecimento.regras);
    expect(preview.slug).toBe(estabelecimento.slug);
  });

  it("não muta o estabelecimento original (preview nunca escreve no repository)", () => {
    const estabelecimento = estabelecimentoBase();
    const rascunho = construirRascunhoPersonalizacao(estabelecimento);
    aplicarRascunhoNaIdentidade(estabelecimento, { ...rascunho, corDestaque: "#00FF00" });
    expect(estabelecimento.identidadeVisual.corDestaque).toBe("#B5651D");
  });
});
