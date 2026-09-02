import { describe, expect, it } from "vitest";
import {
  construirLinkAgendamento,
  exibirMarcaPlataforma,
  obterAntesDaVisita,
  obterRodapePersonalizado,
  obterSecoesVisiveis,
  resolverLogo,
} from "./secoes";
import type { Estabelecimento, Profissional, Servico } from "@/lib/types";

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
      textoApresentacao: "Texto de apresentação.",
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

const servico: Servico = {
  id: "serv-1",
  tenantId: "tenant-1",
  nome: "Corte",
  descricaoCurta: "",
  precoCentavos: 5000,
  precoVisivel: true,
  duracaoMinutos: 30,
  intervaloPosteriorMinutos: 0,
  modalidade: "presencial",
  profissionaisIds: [],
  ativoNoAgendamentoPublico: true,
  exigeConfirmacaoManual: false,
  ativo: true,
};

const profissional: Profissional = {
  id: "prof-1",
  tenantId: "tenant-1",
  nome: "Fulano",
  avatarIniciais: "FU",
  corAvatar: "#000000",
  servicosIds: [],
  horarios: [],
  agendamentoOnlineAtivo: true,
  ativo: true,
};

describe("obterSecoesVisiveis", () => {
  it("respeita a ordem configurada em personalizacaoAvancada", () => {
    const estabelecimento = estabelecimentoBase({
      identidadeVisual: {
        ...estabelecimentoBase().identidadeVisual,
        fotos: ["https://exemplo.com/a.jpg"],
        personalizacaoAvancada: { ordemSecoes: ["fotos", "apresentacao", "servicos", "equipe"], ocultarMarcaPlataforma: false },
      },
    });
    const visiveis = obterSecoesVisiveis({ estabelecimento, servicos: [servico], profissionais: [profissional] });
    expect(visiveis).toEqual(["fotos", "apresentacao", "servicos", "equipe"]);
  });

  it("usa a ordem padrão quando não há personalizacaoAvancada", () => {
    const estabelecimento = estabelecimentoBase();
    const visiveis = obterSecoesVisiveis({ estabelecimento, servicos: [servico], profissionais: [profissional] });
    expect(visiveis).toEqual(["apresentacao", "servicos", "equipe"]);
  });

  it("nunca inclui seção sem dado — nem apresentação vazia, nem fotos ausentes", () => {
    const estabelecimento = estabelecimentoBase({
      identidadeVisual: { ...estabelecimentoBase().identidadeVisual, textoApresentacao: "  ", fotos: [] },
    });
    const visiveis = obterSecoesVisiveis({ estabelecimento, servicos: [], profissionais: [] });
    expect(visiveis).toEqual([]);
  });
});

describe("exibirMarcaPlataforma", () => {
  it("mostra por padrão quando não há personalizacaoAvancada", () => {
    expect(exibirMarcaPlataforma(estabelecimentoBase())).toBe(true);
  });

  it("oculta somente quando ocultarMarcaPlataforma está true", () => {
    const estabelecimento = estabelecimentoBase({
      identidadeVisual: {
        ...estabelecimentoBase().identidadeVisual,
        personalizacaoAvancada: { ordemSecoes: [], ocultarMarcaPlataforma: true },
      },
    });
    expect(exibirMarcaPlataforma(estabelecimento)).toBe(false);
  });
});

describe("obterRodapePersonalizado", () => {
  it("retorna undefined quando não configurado", () => {
    expect(obterRodapePersonalizado(estabelecimentoBase())).toBeUndefined();
  });

  it("retorna o texto configurado", () => {
    const estabelecimento = estabelecimentoBase({
      identidadeVisual: {
        ...estabelecimentoBase().identidadeVisual,
        personalizacaoAvancada: { ordemSecoes: [], ocultarMarcaPlataforma: false, rodapePersonalizado: "Feito à mão." },
      },
    });
    expect(obterRodapePersonalizado(estabelecimento)).toBe("Feito à mão.");
  });
});

describe("obterAntesDaVisita", () => {
  it("null quando não há prazo de cancelamento nem orientação", () => {
    const estabelecimento = estabelecimentoBase({
      regras: { ...estabelecimentoBase().regras, prazoCancelamentoHoras: 0 },
    });
    expect(obterAntesDaVisita(estabelecimento)).toBeNull();
  });

  it("inclui política de cancelamento derivada da regra existente", () => {
    const resultado = obterAntesDaVisita(estabelecimentoBase());
    expect(resultado?.politicaCancelamento).toBe("Cancelamentos até 3 horas antes do horário marcado.");
  });

  it("inclui orientações quando presentes", () => {
    const estabelecimento = estabelecimentoBase({
      regras: { ...estabelecimentoBase().regras, prazoCancelamentoHoras: 0, orientacoesAntesVisita: "Chegue 5 min antes." },
    });
    expect(obterAntesDaVisita(estabelecimento)).toEqual({ politicaCancelamento: undefined, orientacoes: "Chegue 5 min antes." });
  });
});

describe("resolverLogo", () => {
  it("usa logoUrl quando presente", () => {
    const resultado = resolverLogo({ ...estabelecimentoBase().identidadeVisual, logoUrl: "data:image/png;base64,AAAA" });
    expect(resultado).toEqual({ tipo: "imagem", url: "data:image/png;base64,AAAA", alt: "Logo de Estabelecimento Teste" });
  });

  it("usa iniciais quando não há logoUrl (dado antigo continua funcionando)", () => {
    const resultado = resolverLogo(estabelecimentoBase().identidadeVisual);
    expect(resultado).toEqual({ tipo: "iniciais", texto: "ET" });
  });
});

describe("construirLinkAgendamento", () => {
  it("mantém o slug no link de agendamento", () => {
    expect(construirLinkAgendamento("barbearia-do-joao")).toBe("/barbearia-do-joao/agendar");
  });
});
