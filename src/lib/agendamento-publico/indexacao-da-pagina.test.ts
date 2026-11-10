import { describe, expect, it } from "vitest";
import { paginaDoCorpo, type PaginaPublica } from "@/lib/api/public-booking-api";
import { paginaIndexavel } from "./metadados-publicos";
import {
  VALOR_SEM_INDEXACAO,
  classificacaoDoCabecalho,
  decidirIndexacao,
  paginaPodeSerIndexada,
  respostaIndisponivel,
  robotsDaClassificacao,
  slugDoCaminhoAgendar,
} from "./indexacao-da-pagina";
import type { PaginaNoServidor } from "./pagina-no-servidor";

function pagina(extra: Partial<PaginaPublica> = {}): PaginaPublica {
  return {
    establishment: { name: "Studio Exemplo", slug: "studio-exemplo", timezone: "America/Sao_Paulo" },
    services: [],
    professionals: [],
    ...extra,
  };
}

const encontrada = (indexable?: boolean, slug = "studio-exemplo"): PaginaNoServidor => ({
  tipo: "encontrada",
  slug,
  pagina: pagina(indexable === undefined ? {} : { indexable }),
});
const DESCONHECIDA: PaginaNoServidor = { tipo: "desconhecida" };
const INEXISTENTE: PaginaNoServidor = { tipo: "inexistente" };

describe("estabelecimento de teste fora da busca", () => {
  it("só indexable false tira da busca; ausente (API anterior) continua indexável", () => {
    expect(paginaIndexavel(pagina({ indexable: false }))).toBe(false);
    expect(paginaIndexavel(pagina({ indexable: true }))).toBe(true);
    expect(paginaIndexavel(pagina())).toBe(true);
  });

  it("X-Robots-Tag só para a classificação de teste", () => {
    expect(robotsDaClassificacao("teste")).toBe(VALOR_SEM_INDEXACAO);
    expect(robotsDaClassificacao("indexavel")).toBeNull();
  });

  it("a resposta da API com indexable de outro tipo é recusada como ilegível", () => {
    const corpo = (indexable: unknown) => ({ profile: { ...pagina(), indexable } });
    expect(paginaDoCorpo(corpo(false))?.indexable).toBe(false);
    expect(paginaDoCorpo({ profile: pagina() })?.indexable).toBeUndefined();
    expect(paginaDoCorpo(corpo("false"))).toBeNull();
    expect(paginaDoCorpo(corpo(0))).toBeNull();
  });
});

describe("decisão única por requisição", () => {
  it("só a leitura da própria requisição classifica", () => {
    expect(decidirIndexacao(encontrada(false))).toEqual({ tipo: "classificada", classificacao: "teste" });
    expect(decidirIndexacao(encontrada(true))).toEqual({ tipo: "classificada", classificacao: "indexavel" });
    expect(decidirIndexacao(encontrada())).toEqual({ tipo: "classificada", classificacao: "indexavel" });
    expect(decidirIndexacao(INEXISTENTE)).toEqual({ tipo: "inexistente" });
  });

  it("dúvida é indisponível (503): nem indexável nem noindex, mesmo depois de leituras boas", () => {
    decidirIndexacao(encontrada(true));
    decidirIndexacao(encontrada(false));
    expect(decidirIndexacao(DESCONHECIDA)).toEqual({ tipo: "indisponivel" });
  });
});

describe("HTML segue a decisão do proxy", () => {
  it("com decisão do proxy, o HTML obedece mesmo que a leitura do layout divirja", () => {
    expect(paginaPodeSerIndexada("teste", encontrada(true))).toBe(false);
    expect(paginaPodeSerIndexada("indexavel", encontrada(false))).toBe(true);
    expect(paginaPodeSerIndexada("teste", DESCONHECIDA)).toBe(false);
    expect(paginaPodeSerIndexada("indexavel", DESCONHECIDA)).toBe(true);
  });

  it("sem decisão do proxy, só página lida e não marcada é indexável; dúvida não é", () => {
    expect(paginaPodeSerIndexada(null, encontrada(true))).toBe(true);
    expect(paginaPodeSerIndexada(null, encontrada())).toBe(true);
    expect(paginaPodeSerIndexada(null, encontrada(false))).toBe(false);
    expect(paginaPodeSerIndexada(null, DESCONHECIDA)).toBe(false);
  });

  it("cabeçalho interno só aceita os dois valores", () => {
    expect(classificacaoDoCabecalho("teste")).toBe("teste");
    expect(classificacaoDoCabecalho("indexavel")).toBe("indexavel");
    expect(classificacaoDoCabecalho("INDEXAVEL")).toBeNull();
    expect(classificacaoDoCabecalho("")).toBeNull();
    expect(classificacaoDoCabecalho(null)).toBeNull();
  });
});

describe("resposta temporária sem classificação", () => {
  it("503 sem cache, com Retry-After, nova tentativa e sem noindex", () => {
    const r = respostaIndisponivel("/agendar/studio-exemplo");
    expect(r.status).toBe(503);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
    expect(r.headers).not.toHaveProperty("x-robots-tag");
    expect(r.corpo).toContain('<meta http-equiv="refresh"');
    expect(r.corpo).toContain('href="/agendar/studio-exemplo"');
    expect(r.corpo).not.toMatch(/noindex/);
  });

  it("o caminho no link não injeta HTML", () => {
    expect(respostaIndisponivel('/agendar/a"><script>').corpo).not.toContain("<script>");
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
