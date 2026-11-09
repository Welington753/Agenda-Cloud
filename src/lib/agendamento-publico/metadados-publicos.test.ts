import { describe, expect, it } from "vitest";
import type { PaginaPublica } from "@/lib/api/public-booking-api";
import {
  caminhoDaPaginaPublica,
  descricaoDaPaginaPublica,
  jsonLdDaPaginaPublica,
  tituloDaPaginaPublica,
} from "./metadados-publicos";

function servico(nome: string, extra: Partial<PaginaPublica["services"][number]> = {}) {
  return { id: nome, name: nome, description: "", durationMinutes: 30, priceCents: 5000, priceVisible: true, ...extra };
}

function pagina(nome: string, servicos: PaginaPublica["services"]): PaginaPublica {
  return {
    establishment: { name: nome, slug: "studio-exemplo", timezone: "America/Sao_Paulo" },
    services: servicos,
    professionals: [],
  };
}

describe("título e descrição do estabelecimento", () => {
  it("título e descrição próprios de cada estabelecimento", () => {
    const a = pagina("Studio Exemplo", [servico("Corte"), servico("Barba")]);
    const b = pagina("Clínica Fictícia", [servico("Consulta")]);
    expect(tituloDaPaginaPublica("Studio Exemplo")).toBe("Studio Exemplo · Agendamento online");
    expect(descricaoDaPaginaPublica(a)).toContain("Studio Exemplo");
    expect(descricaoDaPaginaPublica(a)).toContain("Serviços: Corte, Barba.");
    expect(descricaoDaPaginaPublica(a)).not.toBe(descricaoDaPaginaPublica(b));
  });

  it("muitos serviços: quatro primeiros, 'e outros', no máximo 160 caracteres", () => {
    const longa = pagina(
      "Estabelecimento de Nome Bem Comprido Para Teste",
      ["Corte feminino", "Coloração completa", "Escova progressiva", "Hidratação", "Manicure"].map((n) => servico(n)),
    );
    const d = descricaoDaPaginaPublica(longa);
    expect(d.length).toBeLessThanOrEqual(160);
    expect(d).not.toContain("Manicure");
  });

  it("sem serviços: só a frase base", () => {
    expect(descricaoDaPaginaPublica(pagina("Studio Exemplo", []))).not.toContain("Serviços");
  });

  it("caminho canônico codificado", () => {
    expect(caminhoDaPaginaPublica("studio-exemplo")).toBe("/agendar/studio-exemplo");
  });
});

describe("JSON-LD do estabelecimento", () => {
  const url = "https://agenda.exemplo.test/agendar/studio-exemplo";

  it("só o que a página mostra: nome, endereço e serviços; preço só quando visível e definido", () => {
    const dados = jsonLdDaPaginaPublica(
      pagina("Studio Exemplo", [
        servico("Corte", { description: "Com lavagem" }),
        servico("Avaliação", { priceCents: null }),
        servico("Pacote", { priceVisible: false }),
      ]),
      url,
    );
    expect(dados).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Studio Exemplo",
      url,
      makesOffer: [
        {
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: "Corte", description: "Com lavagem" },
          price: "50.00",
          priceCurrency: "BRL",
        },
        { "@type": "Offer", itemOffered: { "@type": "Service", name: "Avaliação" } },
        { "@type": "Offer", itemOffered: { "@type": "Service", name: "Pacote" } },
      ],
    });
    const texto = JSON.stringify(dados);
    for (const inventado of ["address", "aggregateRating", "review", "openingHours", "telephone"]) {
      expect(texto).not.toContain(inventado);
    }
  });

  it("sem serviços: sem makesOffer", () => {
    expect(jsonLdDaPaginaPublica(pagina("Studio Exemplo", []), url)).not.toHaveProperty("makesOffer");
  });
});
