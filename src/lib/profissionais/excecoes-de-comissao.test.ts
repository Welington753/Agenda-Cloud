import { describe, expect, it } from "vitest";
import {
  AVISO_SUBSTITUIR_NAO_REMOVE,
  ROTULO_ESCOLHA_EXCECOES,
  descreverExcecoes,
  excecoesDoProfissional,
  quantasExcecoes,
  remocoesDaPrevia,
  rotuloDasExcecoesNaPrevia,
  textoConfirmacaoRemocaoEmMassa,
  textoConfirmacaoRemocaoIndividual,
} from "./excecoes-de-comissao";

const servico = <R extends { kind: "NONE" | "PERCENTAGE" | "FIXED"; value: number | null } | null>(id: string, name: string, rule: R) => ({
  service: { id, name },
  rule,
});
const BARBA = servico("s1", "Barba", { kind: "PERCENTAGE", value: 1500 });
const CORTE = servico("s2", "Corte", { kind: "NONE", value: null });

describe("exceções do profissional", () => {
  it("lista só os serviços com exceção, inclusive “Sem comissão”", () => {
    const lista = excecoesDoProfissional({ services: [BARBA, servico("s3", "Avaliação", null), CORTE] as never });
    expect(lista).toEqual([
      { serviceId: "s1", nome: "Barba", regra: "15%" },
      { serviceId: "s2", nome: "Corte", regra: "Sem comissão" },
    ]);
    expect(descreverExcecoes(lista)).toBe("Barba (15%), Corte (Sem comissão)");
  });

  it("quantidades e confirmações no singular e no plural", () => {
    expect([1, 3].map(quantasExcecoes)).toEqual(["1 exceção", "3 exceções"]);
    expect(textoConfirmacaoRemocaoIndividual("Ana Luiza", 1)).toBe(
      "Entendo que a exceção por serviço de Ana Luiza será removida e que a regra geral passará a valer em todos os serviços.",
    );
    expect(textoConfirmacaoRemocaoIndividual("Ana Luiza", 2)).toMatch(/^Entendo que as 2 exceções por serviço de Ana Luiza serão removidas/);
    expect(textoConfirmacaoRemocaoEmMassa(1, 1)).toMatch(/^Entendo que 1 exceção por serviço de 1 profissional será removida/);
    expect(textoConfirmacaoRemocaoEmMassa(4, 2)).toMatch(/^Entendo que 4 exceções por serviço de 2 profissionais serão removidas/);
  });

  it("manter é o padrão e o aviso deixa claro que substituir não remove", () => {
    expect(ROTULO_ESCOLHA_EXCECOES.KEEP.titulo).toBe("Manter exceções por serviço");
    expect(ROTULO_ESCOLHA_EXCECOES.REMOVE.descricao).toMatch(/regra geral valha em todos os serviços/);
    expect(AVISO_SUBSTITUIR_NAO_REMOVE).toMatch(/não remove exceções/);
  });
});

describe("exceções na prévia em massa", () => {
  const profissional = (id: string, services: (typeof BARBA | typeof CORTE)[], removed: boolean) => ({
    professional: { id, name: `P ${id}` },
    current: { receivesCommission: true, defaultRule: null },
    next: { receivesCommission: true, defaultRule: null },
    exceptions: { services, removed },
    outcome: "CHANGE" as const,
  });

  it("rótulo por profissional: mantidas, serão removidas, removidas; vazio sem exceções", () => {
    expect(rotuloDasExcecoesNaPrevia({ services: [BARBA], removed: false }, false)).toBe("1 exceção mantida: Barba (15%)");
    expect(rotuloDasExcecoesNaPrevia({ services: [BARBA, CORTE], removed: true }, false)).toBe(
      "2 exceções serão removidas: Barba (15%), Corte (Sem comissão)",
    );
    expect(rotuloDasExcecoesNaPrevia({ services: [BARBA], removed: true }, true)).toBe("1 exceção removida: Barba (15%)");
    expect(rotuloDasExcecoesNaPrevia({ services: [], removed: true }, false)).toBe("");
  });

  it("remoções: só quem perde exceções", () => {
    const previa = { professionals: [profissional("a", [BARBA], true), profissional("b", [], true), profissional("c", [CORTE], false)] };
    expect(remocoesDaPrevia(previa as never)).toEqual([{ id: "a", nome: "P a", excecoes: [{ serviceId: "s1", nome: "Barba", regra: "15%" }] }]);
  });
});
