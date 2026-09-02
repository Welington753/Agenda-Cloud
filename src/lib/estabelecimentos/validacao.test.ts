import { describe, expect, it } from "vitest";
import {
  normalizarSlug,
  validarArquivoLogo,
  validarCorHex,
  validarFormatoSlug,
  validarIdentidadeVisual,
  validarSlugEstabelecimento,
  validarUrlFoto,
} from "./validacao";
import type { IdentidadeVisual } from "@/lib/types";

function identidadeBase(overrides: Partial<IdentidadeVisual> = {}): IdentidadeVisual {
  return {
    nome: "Estabelecimento Teste",
    nomeCurto: "Teste",
    logoIniciais: "ET",
    corPrincipal: "#111111",
    corSecundaria: "#FFFFFF",
    corDestaque: "#B5651D",
    estilo: "",
    modelo: "classico",
    endereco: "Rua Teste, 1",
    telefone: "(11) 90000-0000",
    textoApresentacao: "",
    fotos: [],
    ...overrides,
  };
}

describe("normalizarSlug", () => {
  it("minúsculas, remove acentos, troca espaço/símbolo por hífen único, sem hífen nas pontas", () => {
    expect(normalizarSlug("Barbearia Ábc  Def!")).toBe("barbearia-abc-def");
  });

  it("não deixa hífen duplicado nem inicial/final", () => {
    expect(normalizarSlug("--Olá---Mundo--")).toBe("ola-mundo");
  });
});

describe("validarFormatoSlug", () => {
  it("rejeita vazio", () => {
    expect(validarFormatoSlug("").valido).toBe(false);
    expect(validarFormatoSlug("   ").valido).toBe(false);
  });

  it("rejeita maiúscula, espaço, acento e hífen duplicado/nas pontas", () => {
    expect(validarFormatoSlug("Barbearia").valido).toBe(false);
    expect(validarFormatoSlug("bar bearia").valido).toBe(false);
    expect(validarFormatoSlug("barbearia-ábc").valido).toBe(false);
    expect(validarFormatoSlug("bar--earia").valido).toBe(false);
    expect(validarFormatoSlug("-barbearia").valido).toBe(false);
    expect(validarFormatoSlug("barbearia-").valido).toBe(false);
  });

  it("aceita slug já normalizado", () => {
    expect(validarFormatoSlug("barbearia-do-joao").valido).toBe(true);
  });

  it("rejeita slug reservado do sistema", () => {
    const resultado = validarFormatoSlug("master");
    expect(resultado.valido).toBe(false);
    expect(resultado.motivo).toMatch(/reservado/);
  });
});

describe("validarSlugEstabelecimento", () => {
  const existentes = [
    { slug: "dom-navalha", tenantId: "tenant-a" },
    { slug: "clinica-sorriso-leve", tenantId: "tenant-b" },
  ];

  it("rejeita slug já usado por outro estabelecimento", () => {
    const resultado = validarSlugEstabelecimento("dom-navalha", existentes);
    expect(resultado.valido).toBe(false);
    expect(resultado.motivo).toMatch(/já está em uso/);
  });

  it("aceita o próprio slug do tenant ao ignorá-lo (salvar de novo sem mudar)", () => {
    const resultado = validarSlugEstabelecimento("dom-navalha", existentes, "tenant-a");
    expect(resultado.valido).toBe(true);
  });

  it("aceita slug novo e livre", () => {
    expect(validarSlugEstabelecimento("barbearia-nova", existentes).valido).toBe(true);
  });
});

describe("validarArquivoLogo", () => {
  it("aceita PNG dentro do limite", () => {
    expect(validarArquivoLogo({ type: "image/png", size: 100 * 1024 }).valido).toBe(true);
  });

  it("aceita JPEG e WEBP dentro do limite", () => {
    expect(validarArquivoLogo({ type: "image/jpeg", size: 1024 }).valido).toBe(true);
    expect(validarArquivoLogo({ type: "image/webp", size: 1024 }).valido).toBe(true);
  });

  it("rejeita arquivo acima de 500 KB", () => {
    const resultado = validarArquivoLogo({ type: "image/png", size: 501 * 1024 });
    expect(resultado.valido).toBe(false);
    expect(resultado.motivo).toMatch(/500 KB/);
  });

  it("rejeita SVG", () => {
    const resultado = validarArquivoLogo({ type: "image/svg+xml", size: 1024 });
    expect(resultado.valido).toBe(false);
  });

  it("rejeita outros tipos (ex.: PDF)", () => {
    expect(validarArquivoLogo({ type: "application/pdf", size: 1024 }).valido).toBe(false);
  });
});

describe("validarCorHex", () => {
  it("aceita #RRGGBB", () => {
    expect(validarCorHex("#B5651D").valido).toBe(true);
  });

  it("rejeita formato fora de #RRGGBB", () => {
    expect(validarCorHex("B5651D").valido).toBe(false);
    expect(validarCorHex("#FFF").valido).toBe(false);
    expect(validarCorHex("red").valido).toBe(false);
  });
});

describe("validarUrlFoto", () => {
  it("aceita https", () => {
    expect(validarUrlFoto("https://exemplo.com/foto.jpg").valido).toBe(true);
  });

  it("aceita Data URL de imagem", () => {
    expect(validarUrlFoto("data:image/png;base64,AAAA").valido).toBe(true);
  });

  it("rejeita http (inseguro)", () => {
    expect(validarUrlFoto("http://exemplo.com/foto.jpg").valido).toBe(false);
  });

  it("rejeita URL arbitrária", () => {
    expect(validarUrlFoto("javascript:alert(1)").valido).toBe(false);
  });
});

describe("validarIdentidadeVisual", () => {
  it("aceita identidade com cores válidas e sem fotos/logo", () => {
    expect(validarIdentidadeVisual(identidadeBase()).valido).toBe(true);
  });

  it("rejeita cor inválida", () => {
    expect(validarIdentidadeVisual(identidadeBase({ corDestaque: "orange" })).valido).toBe(false);
  });

  it("rejeita foto com URL insegura", () => {
    const resultado = validarIdentidadeVisual(identidadeBase({ fotos: ["http://exemplo.com/a.jpg"] }));
    expect(resultado.valido).toBe(false);
  });

  it("aceita logo em Data URL válida", () => {
    expect(validarIdentidadeVisual(identidadeBase({ logoUrl: "data:image/png;base64,AAAA" })).valido).toBe(true);
  });
});
