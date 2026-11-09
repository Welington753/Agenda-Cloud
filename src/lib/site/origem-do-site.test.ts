import { describe, expect, it } from "vitest";
import { enderecoAbsoluto, lerConfiguracaoDoSite } from "./origem-do-site";

const RENDER = { RENDER: "true", RENDER_EXTERNAL_URL: "https://agenda-exemplo-web.onrender.com" };

describe("origem do site: só do ambiente, só HTTPS exata", () => {
  it("usa RENDER_EXTERNAL_URL; APP_PUBLIC_ORIGIN (domínio próprio) tem precedência", () => {
    expect(lerConfiguracaoDoSite(RENDER)).toEqual({ origem: "https://agenda-exemplo-web.onrender.com", indexavel: true });
    expect(lerConfiguracaoDoSite({ ...RENDER, APP_PUBLIC_ORIGIN: "https://agenda.exemplo.test" }).origem).toBe(
      "https://agenda.exemplo.test",
    );
  });

  it.each([
    ["http://agenda.exemplo.test"],
    ["https://agenda.exemplo.test/"],
    ["https://agenda.exemplo.test/caminho"],
    ["https://agenda.exemplo.test?utm_source=x"],
    ["não é url"],
    [""],
  ])("recusa %j: nenhum endereço absoluto é publicado", (valor) => {
    const site = lerConfiguracaoDoSite({ APP_PUBLIC_ORIGIN: valor });
    expect(site.origem).toBeNull();
    expect(enderecoAbsoluto(site, "/")).toBeNull();
  });

  it("sem variável nenhuma (desenvolvimento): sem origem, ainda indexável", () => {
    expect(lerConfiguracaoDoSite({})).toEqual({ origem: null, indexavel: true });
  });

  it("pré-visualização de pull request do Render: não indexável e sem o endereço da prévia", () => {
    expect(lerConfiguracaoDoSite({ ...RENDER, IS_PULL_REQUEST: "true" })).toEqual({ origem: null, indexavel: false });
    expect(
      lerConfiguracaoDoSite({ ...RENDER, IS_PULL_REQUEST: "true", APP_PUBLIC_ORIGIN: "https://agenda.exemplo.test" }).origem,
    ).toBe("https://agenda.exemplo.test");
    expect(lerConfiguracaoDoSite({ ...RENDER, IS_PULL_REQUEST: "false" }).indexavel).toBe(true);
  });

  it("monta o endereço absoluto sobre a origem, sem herdar nada de fora", () => {
    const site = lerConfiguracaoDoSite({ APP_PUBLIC_ORIGIN: "https://agenda.exemplo.test" });
    expect(enderecoAbsoluto(site, "/agendar/studio-exemplo")).toBe("https://agenda.exemplo.test/agendar/studio-exemplo");
    expect(enderecoAbsoluto(site, "//outro.test/x")).toBeNull();
    expect(enderecoAbsoluto(site, "https://outro.test/x")).toBeNull();
  });
});
