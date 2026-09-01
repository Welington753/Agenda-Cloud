import { describe, expect, it } from "vitest";
import { formatarPrecoPublico } from "./format";

describe("formatarPrecoPublico", () => {
  it("mostra o valor formatado quando o preço existe, é visível e a política do estabelecimento permite", () => {
    expect(formatarPrecoPublico({ precoCentavos: 18000, precoVisivel: true }, true)).toBe(
      (18000 / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    );
  });

  it("mostra 'Sob consulta' quando o serviço não tem preço definido", () => {
    expect(formatarPrecoPublico({ precoCentavos: undefined, precoVisivel: true }, true)).toBe("Sob consulta");
  });

  it("mostra 'Sob consulta' quando o serviço tem preço mas está marcado como oculto", () => {
    expect(formatarPrecoPublico({ precoCentavos: 5000, precoVisivel: false }, true)).toBe("Sob consulta");
  });

  it("mostra 'Sob consulta' quando a política do estabelecimento desativa a exibição pública de preços", () => {
    expect(formatarPrecoPublico({ precoCentavos: 5000, precoVisivel: true }, false)).toBe("Sob consulta");
  });
});
