// Forma dos dados estruturados frente ao vocabulário schema.org: cada objeto
// usa só propriedades que existem no tipo, com o tipo de valor esperado, e
// nada que a página não mostre (endereço, telefone, horário, avaliação).
// Dados fictícios.
import { describe, expect, it } from "vitest";
import type { PaginaPublica } from "@/lib/api/public-booking-api";
import { jsonLdDaPaginaPublica } from "@/lib/agendamento-publico/metadados-publicos";
import { jsonLdDaPlataforma, serializarJsonLd } from "./dados-estruturados";

type Validador = (valor: unknown, caminho: string) => void;

const texto: Validador = (v, c) => {
  expect(typeof v, c).toBe("string");
  expect((v as string).trim(), c).not.toBe("");
};
const urlHttps: Validador = (v, c) => {
  texto(v, c);
  expect(new URL(v as string).protocol, c).toBe("https:");
};
const preco: Validador = (v, c) => expect(v, c).toMatch(/^\d+\.\d{2}$/);
const moeda: Validador = (v, c) => expect(v, c).toBe("BRL");

/** Subconjunto usado do schema.org (Organization, Offer, Service), com as
 * propriedades que cada tipo realmente define ou herda de Thing. */
const VOCABULARIO: Record<string, Record<string, Validador>> = {
  Organization: {
    name: texto,
    url: urlHttps,
    logo: urlHttps,
    description: texto,
    makesOffer: (v, c) => {
      expect(Array.isArray(v), c).toBe(true);
      (v as unknown[]).forEach((o, i) => validarNo(o, `${c}[${i}]`, "Offer"));
    },
  },
  Offer: {
    itemOffered: (v, c) => validarNo(v, c, "Service"),
    price: preco,
    priceCurrency: moeda,
  },
  Service: { name: texto, description: texto },
};

function validarNo(no: unknown, caminho: string, tipoEsperado: string) {
  expect(typeof no === "object" && no !== null && !Array.isArray(no), caminho).toBe(true);
  const objeto = no as Record<string, unknown>;
  expect(objeto["@type"], caminho).toBe(tipoEsperado);
  const propriedades = VOCABULARIO[tipoEsperado];
  for (const [chave, valor] of Object.entries(objeto)) {
    if (chave === "@type" || chave === "@context") continue;
    expect(Object.keys(propriedades), `${caminho}.${chave} não existe em ${tipoEsperado}`).toContain(chave);
    propriedades[chave](valor, `${caminho}.${chave}`);
  }
  if (tipoEsperado === "Offer") {
    // Moeda e preço andam juntos: um sem o outro é dado inválido.
    expect("price" in objeto, caminho).toBe("priceCurrency" in objeto);
  }
}

function validarRaiz(dados: Record<string, unknown>) {
  expect(dados["@context"]).toBe("https://schema.org");
  validarNo(dados, "$", "Organization");
  // Sintaxe: o texto que vai para a página volta a ser o mesmo objeto.
  const serializado = serializarJsonLd(dados);
  expect(serializado).not.toMatch(/[<>]/);
  expect(JSON.parse(serializado)).toEqual(dados);
}

const PAGINA: PaginaPublica = {
  establishment: { name: 'Studio "Fictício" </script><b>', slug: "studio-ficticio", timezone: "America/Sao_Paulo" },
  services: [
    { id: "s1", name: "Corte & barba", description: "Com <lavagem>", durationMinutes: 45, priceCents: 7550, priceVisible: true },
    { id: "s2", name: "Avaliação", description: "", durationMinutes: 30, priceCents: null, priceVisible: true },
    { id: "s3", name: "Pacote", description: "  ", durationMinutes: 60, priceCents: 9900, priceVisible: false },
  ],
  professionals: [],
};

describe("JSON-LD no vocabulário schema.org", () => {
  it("plataforma (página inicial)", () => {
    validarRaiz(jsonLdDaPlataforma("https://agenda.exemplo.test"));
  });

  it("estabelecimento: propriedades e tipos válidos, preço só quando a tela mostra", () => {
    const dados = jsonLdDaPaginaPublica(PAGINA, "https://agenda.exemplo.test/agendar/studio-ficticio");
    validarRaiz(dados);
    const ofertas = dados.makesOffer as Record<string, unknown>[];
    expect(ofertas.map((o) => o.price)).toEqual(["75.50", undefined, undefined]);
  });

  it("dados de um estabelecimento não aparecem no de outro", () => {
    const outro: PaginaPublica = {
      establishment: { name: "Clínica Exemplo", slug: "clinica-exemplo", timezone: "America/Sao_Paulo" },
      services: [{ id: "x", name: "Consulta", description: "", durationMinutes: 30, priceCents: 1000, priceVisible: true }],
      professionals: [],
    };
    const texto = JSON.stringify(jsonLdDaPaginaPublica(outro, "https://agenda.exemplo.test/agendar/clinica-exemplo"));
    expect(texto).not.toContain("Studio");
    expect(texto).not.toContain("Corte");
    expect(texto).not.toContain("studio-ficticio");
  });
});
