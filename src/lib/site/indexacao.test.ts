import { describe, expect, it } from "vitest";
import { entradasDoSitemap, regrasDoRobots } from "./indexacao";
import { lerConfiguracaoDoSite } from "./origem-do-site";

const PRODUCAO = lerConfiguracaoDoSite({ RENDER: "true", RENDER_EXTERNAL_URL: "https://agenda-exemplo-web.onrender.com" });
const PREVIA = lerConfiguracaoDoSite({
  RENDER_EXTERNAL_URL: "https://agenda-exemplo-pr-7.onrender.com",
  IS_PULL_REQUEST: "true",
});
const SEM_ORIGEM = lerConfiguracaoDoSite({});

describe("sitemap", () => {
  it("só a página inicial, absoluta e sem data inventada", () => {
    expect(entradasDoSitemap(PRODUCAO)).toEqual([{ url: "https://agenda-exemplo-web.onrender.com/" }]);
  });

  it("vazio sem origem confiável ou na pré-visualização", () => {
    expect(entradasDoSitemap(SEM_ORIGEM)).toEqual([]);
    expect(entradasDoSitemap(PREVIA)).toEqual([]);
  });
});

describe("robots.txt", () => {
  it("rastreamento livre (o noindex das áreas privadas precisa ser lido), menos o proxy da API", () => {
    expect(regrasDoRobots(PRODUCAO)).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: "/agenda_api/" },
      sitemap: "https://agenda-exemplo-web.onrender.com/sitemap.xml",
    });
  });

  it("sem origem: sem linha de sitemap (nunca um endereço local)", () => {
    expect(regrasDoRobots(SEM_ORIGEM)).toEqual({ rules: { userAgent: "*", allow: "/", disallow: "/agenda_api/" } });
  });

  it("pré-visualização: sem bloqueio nem sitemap (o noindex de cada resposta precisa ser lido)", () => {
    expect(regrasDoRobots(PREVIA)).toEqual({ rules: { userAgent: "*", allow: "/" } });
  });
});
