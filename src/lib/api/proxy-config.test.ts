import { describe, expect, it } from "vitest";

import { lerConfiguracaoProxy } from "./proxy-config";

const SEGREDO = "x".repeat(32);

const LOCAL = {
  API_PROXY_TARGET: "http://localhost:3001",
  APP_PUBLIC_ORIGIN: "http://localhost:3000",
};

const RENDER = {
  RENDER: "true",
  API_PROXY_TARGET: "https://agenda-cloud-piloto-api.onrender.com",
  RENDER_EXTERNAL_URL: "https://agenda-cloud-piloto-web.onrender.com",
  API_PROXY_SECRET: SEGREDO,
};

function campos(ambiente: Record<string, string | undefined>): string[] {
  const resultado = lerConfiguracaoProxy(ambiente);
  return resultado.ok ? [] : resultado.campos;
}

describe("lerConfiguracaoProxy", () => {
  it("local: HTTP aceito, segredo opcional, IP do cliente desligado por padrão", () => {
    const resultado = lerConfiguracaoProxy(LOCAL);
    expect(resultado).toMatchObject({
      ok: true,
      configuracao: { origemPublica: "http://localhost:3000", segredo: undefined, fonteIpCliente: "socket" },
    });
  });

  it("Render: origem pública vem de RENDER_EXTERNAL_URL; APP_PUBLIC_ORIGIN tem precedência", () => {
    const render = lerConfiguracaoProxy(RENDER);
    expect(render.ok && render.configuracao.origemPublica).toBe("https://agenda-cloud-piloto-web.onrender.com");
    const proprio = lerConfiguracaoProxy({ ...RENDER, APP_PUBLIC_ORIGIN: "https://app.exemplo.test" });
    expect(proprio.ok && proprio.configuracao.origemPublica).toBe("https://app.exemplo.test");
  });

  it("Render: exige HTTPS e segredo", () => {
    expect(campos({ ...RENDER, API_PROXY_TARGET: "http://agenda-cloud-piloto-api.onrender.com" })).toEqual(["API_PROXY_TARGET"]);
    expect(campos({ ...RENDER, RENDER_EXTERNAL_URL: "http://x.onrender.com" })).toEqual(["APP_PUBLIC_ORIGIN"]);
    expect(campos({ ...RENDER, API_PROXY_SECRET: undefined })).toEqual(["API_PROXY_SECRET"]);
  });

  it("destino e origem precisam ser origens exatas", () => {
    for (const valor of [undefined, "", "localhost:3001", "http://localhost:3001/", "http://localhost:3001/api", "ftp://x.test"]) {
      expect(campos({ ...LOCAL, API_PROXY_TARGET: valor })).toEqual(["API_PROXY_TARGET"]);
      expect(campos({ ...LOCAL, APP_PUBLIC_ORIGIN: valor })).toEqual(["APP_PUBLIC_ORIGIN"]);
    }
  });

  it("segredo curto e fonte de IP desconhecida são recusados, sem ecoar valores", () => {
    expect(campos({ ...LOCAL, API_PROXY_SECRET: "curto" })).toEqual(["API_PROXY_SECRET"]);
    for (const fonte of ["x-forwarded-for", "true", "CF-Connecting-IP"]) {
      expect(campos({ ...LOCAL, CLIENT_IP_SOURCE: fonte })).toEqual(["CLIENT_IP_SOURCE"]);
    }
    expect(JSON.stringify(lerConfiguracaoProxy({ ...LOCAL, API_PROXY_SECRET: "curto-secreto" }))).not.toContain(
      "curto-secreto",
    );
  });
});
