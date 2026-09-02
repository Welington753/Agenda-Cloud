import { beforeEach, describe, expect, it, vi } from "vitest";
import { estabelecimentoRepository } from "./index";
import { obterAntesDaVisita, resolverLogo } from "@/components/publico/secoes";

function criarLocalStorageFake() {
  const dados = new Map<string, string>();
  return {
    getItem: (chave: string) => (dados.has(chave) ? (dados.get(chave) as string) : null),
    setItem: (chave: string, valor: string) => {
      dados.set(chave, valor);
    },
    removeItem: (chave: string) => {
      dados.delete(chave);
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: criarLocalStorageFake() });
});

describe("isolamento de personalização entre tenants", () => {
  it("atualizar a identidade visual de um tenant não altera outro", () => {
    const domNavalha = estabelecimentoRepository.obterPorSlug("dom-navalha")!;
    const sorrisoLeve = estabelecimentoRepository.obterPorSlug("clinica-sorriso-leve")!;
    const corOriginalSorrisoLeve = sorrisoLeve.identidadeVisual.corDestaque;

    estabelecimentoRepository.atualizar(domNavalha.tenantId, {
      identidadeVisual: { ...domNavalha.identidadeVisual, corDestaque: "#000000" },
    });

    const domNavalhaDepois = estabelecimentoRepository.obterPorTenantId(domNavalha.tenantId)!;
    const sorrisoLeveDepois = estabelecimentoRepository.obterPorTenantId(sorrisoLeve.tenantId)!;
    expect(domNavalhaDepois.identidadeVisual.corDestaque).toBe("#000000");
    expect(sorrisoLeveDepois.identidadeVisual.corDestaque).toBe(corOriginalSorrisoLeve);
  });

  it("salvar persiste somente no tenant informado (nunca em todos)", () => {
    const antes = estabelecimentoRepository.listarTodos();
    const alvo = antes[0];
    estabelecimentoRepository.atualizar(alvo.tenantId, {
      identidadeVisual: { ...alvo.identidadeVisual, textoApresentacao: "Alterado só aqui." },
    });
    const depois = estabelecimentoRepository.listarTodos();
    const outros = depois.filter((e) => e.tenantId !== alvo.tenantId);
    for (const outro of outros) {
      const original = antes.find((e) => e.tenantId === outro.tenantId)!;
      expect(outro.identidadeVisual.textoApresentacao).toBe(original.identidadeVisual.textoApresentacao);
    }
  });
});

describe("barreira do repository (a função de salvar rejeita, não só a tela)", () => {
  it("rejeita slug reservado mesmo se alguém contornar a validação da UI", () => {
    const dom = estabelecimentoRepository.obterPorSlug("dom-navalha")!;
    expect(() => estabelecimentoRepository.atualizar(dom.tenantId, { slug: "master" })).toThrow(/reservado/);
  });

  it("rejeita cor fora do formato #RRGGBB", () => {
    const dom = estabelecimentoRepository.obterPorSlug("dom-navalha")!;
    expect(() =>
      estabelecimentoRepository.atualizar(dom.tenantId, { identidadeVisual: { ...dom.identidadeVisual, corDestaque: "laranja" } })
    ).toThrow(/Cor inválida/);
  });

  it("rejeita foto com URL insegura", () => {
    const dom = estabelecimentoRepository.obterPorSlug("dom-navalha")!;
    expect(() =>
      estabelecimentoRepository.atualizar(dom.tenantId, {
        identidadeVisual: { ...dom.identidadeVisual, fotos: ["http://exemplo.com/a.jpg"] },
      })
    ).toThrow(/URL de foto inválida/);
  });

  it("rejeita personalização avançada em plano sem a feature (esconder o formulário não basta)", () => {
    // Corte Certo é seedado no plano "essencial", sem personalizacaoAvancada.
    const corteCerto = estabelecimentoRepository.obterPorSlug("corte-certo")!;
    expect(() =>
      estabelecimentoRepository.atualizar(corteCerto.tenantId, {
        identidadeVisual: {
          ...corteCerto.identidadeVisual,
          personalizacaoAvancada: { ordemSecoes: ["servicos", "equipe", "apresentacao", "fotos"], ocultarMarcaPlataforma: true },
        },
      })
    ).toThrow(/Personalização avançada/);
  });

  it("permite personalização avançada no plano Pro", () => {
    // Dom Navalha é seedado no plano "pro", que inclui personalizacaoAvancada.
    const dom = estabelecimentoRepository.obterPorSlug("dom-navalha")!;
    const atualizado = estabelecimentoRepository.atualizar(dom.tenantId, {
      identidadeVisual: {
        ...dom.identidadeVisual,
        personalizacaoAvancada: { ordemSecoes: ["servicos", "equipe", "apresentacao", "fotos"], ocultarMarcaPlataforma: true },
      },
    });
    expect(atualizado?.identidadeVisual.personalizacaoAvancada?.ocultarMarcaPlataforma).toBe(true);
  });
});

describe("compatibilidade com dados antigos (campos novos são opcionais)", () => {
  it("estabelecimento seedado sem logoUrl continua funcionando (fallback iniciais)", () => {
    const dom = estabelecimentoRepository.obterPorSlug("dom-navalha")!;
    expect(dom.identidadeVisual.logoUrl).toBeUndefined();
    expect(resolverLogo(dom.identidadeVisual)).toEqual({ tipo: "iniciais", texto: dom.identidadeVisual.logoIniciais });
  });

  it("estabelecimento seedado sem orientacoesAntesVisita não quebra o bloco 'antes da visita'", () => {
    const dom = estabelecimentoRepository.obterPorSlug("dom-navalha")!;
    expect(dom.regras.orientacoesAntesVisita).toBeUndefined();
    expect(() => obterAntesDaVisita(dom)).not.toThrow();
  });
});
