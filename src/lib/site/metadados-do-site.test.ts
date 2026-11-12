import { describe, expect, it } from "vitest";
import { codigoDeVerificacaoGoogle, metadadosDaRaiz } from "./metadados-do-site";
import { lerConfiguracaoDoSite } from "./origem-do-site";

const AMBIENTE = { RENDER_EXTERNAL_URL: "https://agenda-exemplo-web.onrender.com" };
const CODIGO_FICTICIO = "codigo-ficticio_ABC123xyz";

describe("metadados da raiz", () => {
  it("origem confiável como base, sem canonical herdável", () => {
    const m = metadadosDaRaiz(lerConfiguracaoDoSite(AMBIENTE), AMBIENTE);
    expect(m.metadataBase?.toString()).toBe("https://agenda-exemplo-web.onrender.com/");
    expect(m.alternates).toBeUndefined();
    expect(m.robots).toBeUndefined();
    expect(m.openGraph).toMatchObject({ siteName: "TimVix", locale: "pt_BR", type: "website" });
  });

  it("imagem de compartilhamento relativa à origem confiável", () => {
    const m = metadadosDaRaiz(lerConfiguracaoDoSite(AMBIENTE), AMBIENTE);
    expect(m.openGraph?.images).toEqual([expect.objectContaining({ url: "/imagem-de-compartilhamento.png", width: 1200, height: 630 })]);
    expect(m.twitter).toMatchObject({ card: "summary_large_image", images: ["/imagem-de-compartilhamento.png"] });
  });

  it("sem origem: sem base e sem imagem (nunca um endereço local)", () => {
    const m = metadadosDaRaiz(lerConfiguracaoDoSite({}), {});
    expect(m.metadataBase).toBeUndefined();
    expect(m.openGraph?.images).toBeUndefined();
    expect(m.twitter).toMatchObject({ images: undefined });
  });

  it("pré-visualização: noindex", () => {
    const ambiente = { ...AMBIENTE, IS_PULL_REQUEST: "true" };
    expect(metadadosDaRaiz(lerConfiguracaoDoSite(ambiente), ambiente).robots).toEqual({ index: false, follow: false });
  });
});

describe("verificação do Search Console", () => {
  it("só com o código no formato do Google, vindo do ambiente", () => {
    expect(codigoDeVerificacaoGoogle({})).toBeUndefined();
    expect(codigoDeVerificacaoGoogle({ GOOGLE_SITE_VERIFICATION: CODIGO_FICTICIO })).toBe(CODIGO_FICTICIO);
    expect(codigoDeVerificacaoGoogle({ GOOGLE_SITE_VERIFICATION: '"><script>' })).toBeUndefined();
    expect(codigoDeVerificacaoGoogle({ GOOGLE_SITE_VERIFICATION: "curto" })).toBeUndefined();
  });

  it("vai para os metadados quando presente", () => {
    const ambiente = { ...AMBIENTE, GOOGLE_SITE_VERIFICATION: CODIGO_FICTICIO };
    expect(metadadosDaRaiz(lerConfiguracaoDoSite(ambiente), ambiente).verification).toEqual({ google: CODIGO_FICTICIO });
  });
});
