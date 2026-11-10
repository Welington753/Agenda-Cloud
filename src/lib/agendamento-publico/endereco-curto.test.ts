import { describe, expect, it } from "vitest";
import { destinoDoEnderecoCurto, slugPedido } from "./endereco-curto";
import type { PaginaPublica } from "@/lib/api/public-booking-api";

const PAGINA = {} as PaginaPublica;

describe("endereço curto /<slug>", () => {
  it("estabelecimento confirmado: 308 para o endereço canônico, com o slug da API", () => {
    expect(destinoDoEnderecoCurto("Studio-Ficticio", { tipo: "encontrada", pagina: PAGINA, slug: "studio-ficticio" })).toEqual({
      tipo: "redirecionar",
      caminho: "/agendar/studio-ficticio",
      permanente: true,
    });
  });

  it("inexistente ou página desligada (404 da API): 404 aqui, sem encaminhar", () => {
    expect(destinoDoEnderecoCurto("studio-ficticio", { tipo: "inexistente" })).toEqual({ tipo: "inexistente" });
  });

  it("API lenta ou fora: 307 temporário para a página real, nunca 404", () => {
    expect(destinoDoEnderecoCurto("Studio-Ficticio", { tipo: "desconhecida" })).toEqual({
      tipo: "redirecionar",
      caminho: "/agendar/studio-ficticio",
      permanente: false,
    });
  });

  it("dúvida com slug fora do formato: 404 (a API recusaria o mesmo slug)", () => {
    expect(destinoDoEnderecoCurto("com espaço", { tipo: "desconhecida" })).toEqual({ tipo: "inexistente" });
  });
});

describe("slug pedido (comparação da demonstração)", () => {
  it("decodifica sem normalizar e recusa codificação inválida", () => {
    expect(slugPedido("dom-navalha")).toBe("dom-navalha");
    expect(slugPedido("Dom%2DNavalha")).toBe("Dom-Navalha");
    expect(slugPedido("%E0%A4%A")).toBeNull();
  });
});
