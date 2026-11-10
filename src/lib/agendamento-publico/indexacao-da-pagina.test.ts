import { describe, expect, it } from "vitest";
import { paginaDoCorpo, type PaginaPublica } from "@/lib/api/public-booking-api";
import { paginaIndexavel } from "./metadados-publicos";
import { robotsDaPaginaPublica, slugDoCaminhoAgendar, VALOR_SEM_INDEXACAO } from "./indexacao-da-pagina";

function pagina(extra: Partial<PaginaPublica> = {}): PaginaPublica {
  return {
    establishment: { name: "Studio Exemplo", slug: "studio-exemplo", timezone: "America/Sao_Paulo" },
    services: [],
    professionals: [],
    ...extra,
  };
}

describe("estabelecimento de teste fora da busca", () => {
  it("só indexable false tira da busca; ausente (API anterior) continua indexável", () => {
    expect(paginaIndexavel(pagina({ indexable: false }))).toBe(false);
    expect(paginaIndexavel(pagina({ indexable: true }))).toBe(true);
    expect(paginaIndexavel(pagina())).toBe(true);
  });

  it("X-Robots-Tag só para a página encontrada e de teste", () => {
    expect(robotsDaPaginaPublica({ tipo: "encontrada", slug: "a", pagina: pagina({ indexable: false }) })).toBe(VALOR_SEM_INDEXACAO);
    expect(robotsDaPaginaPublica({ tipo: "encontrada", slug: "a", pagina: pagina({ indexable: true }) })).toBeNull();
    expect(robotsDaPaginaPublica({ tipo: "encontrada", slug: "a", pagina: pagina() })).toBeNull();
    // 404 já leva noindex no HTML; na dúvida, nada muda (real nunca sai da busca).
    expect(robotsDaPaginaPublica({ tipo: "inexistente" })).toBeNull();
    expect(robotsDaPaginaPublica({ tipo: "desconhecida" })).toBeNull();
  });

  it("a resposta da API com indexable de outro tipo é recusada como ilegível", () => {
    const corpo = (indexable: unknown) => ({ profile: { ...pagina(), indexable } });
    expect(paginaDoCorpo(corpo(false))?.indexable).toBe(false);
    expect(paginaDoCorpo({ profile: pagina() })?.indexable).toBeUndefined();
    expect(paginaDoCorpo(corpo("false"))).toBeNull();
    expect(paginaDoCorpo(corpo(0))).toBeNull();
  });
});

describe("caminho atendido pelo proxy", () => {
  it("só /agendar/<slug>, um segmento", () => {
    expect(slugDoCaminhoAgendar("/agendar/studio-exemplo")).toBe("studio-exemplo");
    expect(slugDoCaminhoAgendar("/agendar/studio-exemplo/")).toBe("studio-exemplo");
    expect(slugDoCaminhoAgendar("/agendar")).toBeNull();
    expect(slugDoCaminhoAgendar("/agendar/a/b")).toBeNull();
    expect(slugDoCaminhoAgendar("/studio-exemplo")).toBeNull();
    expect(slugDoCaminhoAgendar("/conta/agendar/x")).toBeNull();
  });
});
