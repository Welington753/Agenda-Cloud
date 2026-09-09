import { describe, expect, it } from "vitest";
import {
  FLUXO_DEMONSTRACAO,
  FUNCIONALIDADES_DISPONIVEIS,
  FUNCIONALIDADES_EM_DESENVOLVIMENTO,
  HREF_TESTAR_GRATIS,
  NAV_SITE,
  PERGUNTAS_FREQUENTES,
  PLANOS_COMERCIAIS,
  PROBLEMAS,
  SEGMENTOS,
} from "./conteudo-comercial";

describe("SEGMENTOS", () => {
  it("cobre uma diversidade de públicos, não só barbearia", () => {
    expect(SEGMENTOS.length).toBeGreaterThanOrEqual(8);
    const rotulos = SEGMENTOS.map((s) => s.rotulo.toLowerCase()).join(" | ");
    for (const termo of ["clínica", "pet shop", "terapeuta", "pilates", "consultor", "tatuagem"]) {
      expect(rotulos).toContain(termo);
    }
  });

  it("tem ids únicos", () => {
    const ids = SEGMENTOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("ausência de linguagem exclusiva de barbearia", () => {
  it("nenhum problema, funcionalidade, plano ou FAQ menciona 'barbearia' fora da lista de segmentos", () => {
    const textos = [
      ...PROBLEMAS.flatMap((p) => [p.titulo, p.descricao]),
      ...FUNCIONALIDADES_DISPONIVEIS.flatMap((f) => [f.rotulo, f.descricao]),
      ...FUNCIONALIDADES_EM_DESENVOLVIMENTO.flatMap((f) => [f.rotulo, f.descricao]),
      ...PLANOS_COMERCIAIS.flatMap((p) => [p.nome, p.descricaoCurta, p.precoTexto, ...p.destaques]),
      ...PERGUNTAS_FREQUENTES.flatMap((p) => [p.pergunta, p.resposta]),
      ...FLUXO_DEMONSTRACAO.flatMap((e) => [e.titulo, e.descricao]),
    ].join(" ");
    expect(textos.toLowerCase()).not.toContain("barbearia");
    expect(textos.toLowerCase()).not.toContain("barbeiro");
  });
});

describe("disponível vs em desenvolvimento", () => {
  it("são conjuntos disjuntos", () => {
    const idsDisponiveis = new Set(FUNCIONALIDADES_DISPONIVEIS.map((f) => f.id));
    const sobreposicao = FUNCIONALIDADES_EM_DESENVOLVIMENTO.filter((f) => idsDisponiveis.has(f.id));
    expect(sobreposicao).toHaveLength(0);
  });

  it("toda funcionalidade disponível está marcada como 'disponivel'", () => {
    expect(FUNCIONALIDADES_DISPONIVEIS.every((f) => f.status === "disponivel")).toBe(true);
  });

  it("toda funcionalidade em desenvolvimento está marcada como 'em-desenvolvimento'", () => {
    expect(FUNCIONALIDADES_EM_DESENVOLVIMENTO.every((f) => f.status === "em-desenvolvimento")).toBe(true);
  });

  it("não anuncia WhatsApp, SMS, cobrança ou IA como funcionando", () => {
    const textoDisponivel = FUNCIONALIDADES_DISPONIVEIS.flatMap((f) => [f.rotulo, f.descricao]).join(" ").toLowerCase();
    for (const termo of ["whatsapp", "sms", "cobrança", "inteligência artificial"]) {
      expect(textoDisponivel).not.toContain(termo);
    }
  });
});

describe("planos comerciais", () => {
  it("não inventa valores — nenhum preço numérico fixo", () => {
    for (const plano of PLANOS_COMERCIAIS) {
      expect(plano.precoTexto).not.toMatch(/\d/);
    }
  });

  it("todos os CTAs levam ao onboarding demonstrável", () => {
    for (const plano of PLANOS_COMERCIAIS) {
      expect(plano.ctaHref).toBe(HREF_TESTAR_GRATIS);
    }
  });

  it("usa os códigos internos do domínio (essencial/equipe/pro) com nomes comerciais Essencial/Gestão/Rede", () => {
    expect(PLANOS_COMERCIAIS.map((p) => p.codigo)).toEqual(["essencial", "equipe", "pro"]);
    expect(PLANOS_COMERCIAIS.map((p) => p.nome)).toEqual(["Essencial", "Gestão", "Rede"]);
  });
});

describe("navegação", () => {
  it("inclui Produto, Funcionalidades, Para quem e Planos", () => {
    const rotulos = NAV_SITE.map((i) => i.rotulo);
    expect(rotulos).toEqual(["Produto", "Funcionalidades", "Para quem", "Planos"]);
  });

  it("todo item de navegação usa âncora interna", () => {
    expect(NAV_SITE.every((i) => i.href.startsWith("#"))).toBe(true);
  });

  it("os CTAs 'Entrar' e 'Testar grátis' levam a rotas distintas e reais", () => {
    expect(HREF_TESTAR_GRATIS).toBe("/onboarding");
  });
});
