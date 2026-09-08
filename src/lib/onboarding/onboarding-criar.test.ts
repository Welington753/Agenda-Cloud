import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarEstabelecimentoDemonstracao } from "./onboarding-criar";
import { RESPOSTAS_ONBOARDING_INICIAIS, type RespostasOnboarding } from "./onboarding";
import { checklistPrimeirosPassosVisivel } from "./checklist-persistencia";
import { estabelecimentoRepository } from "@/lib/repositories";

/** Mesmo fake mínimo usado em tenant-isolation.test.ts — só o que os
 * repositórios consomem (getItem/setItem/removeItem). */
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

const RESPOSTAS_VALIDAS: RespostasOnboarding = {
  nomeNegocio: "Estúdio Bem Viver",
  segmento: "pilates_yoga",
  estrutura: "unico",
  quantidadeProfissionais: "1",
  objetivo: "organizar-agenda",
};

describe("criarEstabelecimentoDemonstracao", () => {
  it("recusa quando falta nome do negócio ou segmento", () => {
    expect(criarEstabelecimentoDemonstracao(RESPOSTAS_ONBOARDING_INICIAIS).sucesso).toBe(false);
    expect(criarEstabelecimentoDemonstracao({ ...RESPOSTAS_VALIDAS, segmento: null }).sucesso).toBe(false);
  });

  it("cria o estabelecimento e devolve uma sessão pronta para entrar no painel", () => {
    const resultado = criarEstabelecimentoDemonstracao(RESPOSTAS_VALIDAS);
    expect(resultado.sucesso).toBe(true);
    if (!resultado.sucesso) return;

    expect(resultado.slug).toBe("estudio-bem-viver");
    expect(resultado.sessao.escopo).toBe("estabelecimento");
    expect(resultado.sessao.papel).toBe("dono");
    expect(resultado.sessao.tenantId).toBeTruthy();

    const criado = estabelecimentoRepository.obterPorTenantId(resultado.sessao.tenantId as string);
    expect(criado?.categoria).toBe("pilates_yoga");
    expect(criado?.slug).toBe("estudio-bem-viver");
    expect(checklistPrimeirosPassosVisivel(resultado.sessao.tenantId as string)).toBe(true);
  });

  it("nunca gera o mesmo slug para dois negócios com o mesmo nome", () => {
    const primeiro = criarEstabelecimentoDemonstracao(RESPOSTAS_VALIDAS);
    const segundo = criarEstabelecimentoDemonstracao(RESPOSTAS_VALIDAS);
    expect(primeiro.sucesso && segundo.sucesso).toBe(true);
    if (primeiro.sucesso && segundo.sucesso) {
      expect(primeiro.slug).not.toBe(segundo.slug);
    }
  });

  it("escolhe o plano Rede (pro) quando a estrutura é rede, mesmo com um profissional só", () => {
    const resultado = criarEstabelecimentoDemonstracao({ ...RESPOSTAS_VALIDAS, estrutura: "rede" });
    expect(resultado.sucesso).toBe(true);
    if (!resultado.sucesso) return;
    const criado = estabelecimentoRepository.obterPorTenantId(resultado.sessao.tenantId as string);
    expect(criado?.plano).toBe("pro");
  });
});
