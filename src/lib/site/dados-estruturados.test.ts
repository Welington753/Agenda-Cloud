import { describe, expect, it } from "vitest";
import { jsonLdDaPlataforma, serializarJsonLd } from "./dados-estruturados";

const SEPARADOR_DE_LINHA = String.fromCharCode(0x2028);
const SEPARADOR_DE_PARAGRAFO = String.fromCharCode(0x2029);

describe("serialização do JSON-LD", () => {
  it("um nome com </script> não fecha o elemento e o JSON continua igual", () => {
    const dados = { name: "Studio </script><script>alert(1)</script> & Cia" };
    const texto = serializarJsonLd(dados);
    expect(texto).not.toContain("<");
    expect(texto).not.toContain(">");
    expect(texto).not.toContain("&");
    expect(JSON.parse(texto)).toEqual(dados);
  });

  it("separadores de linha Unicode escapados", () => {
    const texto = serializarJsonLd({ a: `x${SEPARADOR_DE_LINHA}y${SEPARADOR_DE_PARAGRAFO}z` });
    expect(texto).toContain("\\u2028");
    expect(texto).toContain("\\u2029");
    expect(JSON.parse(texto)).toEqual({ a: `x${SEPARADOR_DE_LINHA}y${SEPARADOR_DE_PARAGRAFO}z` });
  });
});

describe("JSON-LD da página inicial", () => {
  it("organização com endereço e logotipo da origem confiável", () => {
    expect(jsonLdDaPlataforma("https://agenda.exemplo.test")).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Agenda Cloud",
      url: "https://agenda.exemplo.test/",
      logo: "https://agenda.exemplo.test/icone-512.png",
    });
  });
});
