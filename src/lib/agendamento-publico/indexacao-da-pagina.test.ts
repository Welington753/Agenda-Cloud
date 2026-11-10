import { describe, expect, it } from "vitest";
import { paginaDoCorpo, type PaginaPublica } from "@/lib/api/public-booking-api";
import { paginaIndexavel } from "./metadados-publicos";
import {
  MemoriaDeClassificacao,
  VALIDADE_DA_CLASSIFICACAO_MS,
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
  it("leitura da API classifica e fica lembrada; falha seguinte usa a lembrança", () => {
    const memoria = new MemoriaDeClassificacao();
    expect(decidirIndexacao(encontrada(false), "studio-exemplo", memoria, 0)).toEqual({
      tipo: "classificada",
      classificacao: "teste",
      origem: "api",
    });
    expect(decidirIndexacao(DESCONHECIDA, "studio-exemplo", memoria, 1_000)).toEqual({
      tipo: "classificada",
      classificacao: "teste",
      origem: "memoria",
    });
  });

  it("sem lembrança, dúvida é indisponível: nem indexável nem noindex", () => {
    const memoria = new MemoriaDeClassificacao();
    expect(decidirIndexacao(DESCONHECIDA, "studio-exemplo", memoria, 0)).toEqual({ tipo: "indisponivel" });
  });

  it("troca da marca vale na primeira leitura boa; a antiga não volta", () => {
    const memoria = new MemoriaDeClassificacao();
    decidirIndexacao(encontrada(false), "studio-exemplo", memoria, 0);
    expect(decidirIndexacao(encontrada(true), "studio-exemplo", memoria, 10)).toMatchObject({ classificacao: "indexavel", origem: "api" });
    expect(decidirIndexacao(DESCONHECIDA, "studio-exemplo", memoria, 20)).toMatchObject({ classificacao: "indexavel", origem: "memoria" });
    decidirIndexacao(encontrada(false), "studio-exemplo", memoria, 30);
    expect(decidirIndexacao(DESCONHECIDA, "studio-exemplo", memoria, 40)).toMatchObject({ classificacao: "teste", origem: "memoria" });
  });

  it("a lembrança expira: depois da validade, a falha volta a ser indisponível", () => {
    const memoria = new MemoriaDeClassificacao();
    decidirIndexacao(encontrada(false), "studio-exemplo", memoria, 0);
    expect(decidirIndexacao(DESCONHECIDA, "studio-exemplo", memoria, VALIDADE_DA_CLASSIFICACAO_MS)).toMatchObject({
      origem: "memoria",
    });
    expect(decidirIndexacao(DESCONHECIDA, "studio-exemplo", memoria, VALIDADE_DA_CLASSIFICACAO_MS + 1)).toEqual({
      tipo: "indisponivel",
    });
    // Relógio voltando também não reaproveita.
    decidirIndexacao(encontrada(false), "studio-exemplo", memoria, 5_000);
    expect(decidirIndexacao(DESCONHECIDA, "studio-exemplo", memoria, 4_000)).toEqual({ tipo: "indisponivel" });
  });

  it("404 confirmado apaga a lembrança daquele slug", () => {
    const memoria = new MemoriaDeClassificacao();
    decidirIndexacao(encontrada(true), "studio-exemplo", memoria, 0);
    expect(decidirIndexacao(INEXISTENTE, "studio-exemplo", memoria, 1)).toEqual({ tipo: "inexistente" });
    expect(decidirIndexacao(DESCONHECIDA, "studio-exemplo", memoria, 2)).toEqual({ tipo: "indisponivel" });
  });

  it("isolamento: a lembrança de um slug nunca serve a outro; maiúsculas e %XX caem no mesmo slug", () => {
    const memoria = new MemoriaDeClassificacao();
    decidirIndexacao(encontrada(false, "teste-a"), "teste-a", memoria, 0);
    decidirIndexacao(encontrada(true, "real-b"), "real-b", memoria, 0);
    expect(decidirIndexacao(DESCONHECIDA, "real-b", memoria, 1)).toMatchObject({ classificacao: "indexavel" });
    expect(decidirIndexacao(DESCONHECIDA, "teste-a", memoria, 1)).toMatchObject({ classificacao: "teste" });
    expect(decidirIndexacao(DESCONHECIDA, "Teste-A", memoria, 1)).toMatchObject({ classificacao: "teste" });
    expect(decidirIndexacao(DESCONHECIDA, "teste-%61", memoria, 1)).toMatchObject({ classificacao: "teste" });
    expect(decidirIndexacao(DESCONHECIDA, "teste-c", memoria, 1)).toEqual({ tipo: "indisponivel" });
  });

  it("memória tem teto: o slug mais antigo sai primeiro", () => {
    const memoria = new MemoriaDeClassificacao(VALIDADE_DA_CLASSIFICACAO_MS, 2);
    memoria.gravar("a", "teste", 0);
    memoria.gravar("b", "teste", 0);
    memoria.gravar("c", "indexavel", 0);
    expect(memoria.tamanho).toBe(2);
    expect(memoria.ler("a", 1)).toBeNull();
    expect(memoria.ler("b", 1)).toBe("teste");
    expect(memoria.ler("c", 1)).toBe("indexavel");
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
