import { describe, expect, it } from "vitest";
import { ROTAS_SEM_INDEXACAO, cabecalhosDeSeguranca, politicaDeConteudo, regrasDeCabecalhos } from "./cabecalhos";

const PILOTO = {
  apiBaseUrl: "/agenda_api",
  destinoProxy: "https://agenda-exemplo-api.onrender.com",
  desenvolvimento: false,
};

function diretivas(politica: string): Map<string, string> {
  return new Map(
    politica.split("; ").map((d) => {
      const [nome, ...resto] = d.split(" ");
      return [nome, resto.join(" ")];
    }),
  );
}

describe("CSP", () => {
  it("piloto (mesma origem): conexões só com a própria origem e a da API (partida da API hibernada)", () => {
    const d = diretivas(politicaDeConteudo(PILOTO));
    expect(d.get("connect-src")).toBe("'self' https://agenda-exemplo-api.onrender.com");
    expect(d.get("frame-ancestors")).toBe("'none'");
    expect(d.get("object-src")).toBe("'none'");
    expect(d.get("base-uri")).toBe("'self'");
    expect(d.get("form-action")).toBe("'self'");
    expect(d.get("worker-src")).toBe("'self'");
    expect(d.get("script-src")).toBe("'self' 'unsafe-inline'");
  });

  it("chamada direta (CI): a origem da API entra no connect-src, sem caminho", () => {
    const d = diretivas(
      politicaDeConteudo({ apiBaseUrl: "http://127.0.0.1:3001", destinoProxy: undefined, desenvolvimento: false }),
    );
    expect(d.get("connect-src")).toBe("'self' http://127.0.0.1:3001");
  });

  it("valores estranhos não abrem conexão nenhuma", () => {
    const d = diretivas(
      politicaDeConteudo({ apiBaseUrl: "javascript:alert(1)", destinoProxy: "não é url", desenvolvimento: false }),
    );
    expect(d.get("connect-src")).toBe("'self'");
  });

  it("só o desenvolvimento libera eval", () => {
    expect(politicaDeConteudo(PILOTO)).not.toContain("unsafe-eval");
    expect(diretivas(politicaDeConteudo({ ...PILOTO, desenvolvimento: true })).get("script-src")).toBe(
      "'self' 'unsafe-inline' 'unsafe-eval'",
    );
  });
});

describe("cabeçalhos de segurança", () => {
  it("enquadramento, nosniff, referrer, permissões e HSTS sem preload", () => {
    const mapa = new Map(cabecalhosDeSeguranca(PILOTO).map((c) => [c.key, c.value]));
    expect(mapa.get("X-Frame-Options")).toBe("DENY");
    expect(mapa.get("X-Content-Type-Options")).toBe("nosniff");
    expect(mapa.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(mapa.get("Permissions-Policy")).toContain("camera=()");
    expect(mapa.get("Strict-Transport-Security")).toBe("max-age=31536000");
  });
});

describe("regras do next.config", () => {
  const regras = regrasDeCabecalhos(PILOTO);

  it("regra geral primeiro e service worker por último (a última chave vence)", () => {
    expect(regras[0].source).toBe("/:path*");
    const sw = regras.at(-1);
    expect(sw?.source).toBe("/sw.js");
    expect(sw?.headers).toContainEqual({ key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" });
    expect(sw?.headers).toContainEqual({ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" });
  });

  it("noindex nas áreas privadas, de convite, de senha e da demonstração", () => {
    const areas = [
      "/conta",
      "/portal",
      "/login",
      "/cadastro",
      "/convite",
      "/redefinir-senha",
      "/painel",
      "/master",
      "/profissional",
      "/onboarding",
    ];
    for (const area of areas) expect(ROTAS_SEM_INDEXACAO).toContain(`${area}/:path*`);
    const comNoindex = regras.filter((r) => r.headers.some((h) => h.key === "X-Robots-Tag"));
    expect(comNoindex.map((r) => r.source)).toEqual([...ROTAS_SEM_INDEXACAO]);
  });

  it("a página inicial e a de agendamento público não levam noindex", () => {
    for (const fonte of ROTAS_SEM_INDEXACAO) {
      expect(fonte.startsWith("/agendar")).toBe(false);
      expect(fonte).not.toBe("/:path*");
    }
  });
});
