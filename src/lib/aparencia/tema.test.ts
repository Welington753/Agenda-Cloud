import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { APARENCIA_PADRAO, CHAVE_APARENCIA, OPCOES_APARENCIA, SCRIPT_APARENCIA, lerPreferenciaSalva } from "./tema";

/** Roda o script inline como o navegador rodaria, com storage e <html> falsos. */
function rodarScript(salvo: string | null, storageQuebrado = false) {
  const atributos: Record<string, string> = { "data-tema": APARENCIA_PADRAO };
  const contexto = {
    localStorage: {
      getItem: (chave: string) => {
        if (storageQuebrado) throw new Error("SecurityError");
        return chave === CHAVE_APARENCIA ? salvo : null;
      },
    },
    document: { documentElement: { setAttribute: (nome: string, valor: string) => (atributos[nome] = valor) } },
  };
  runInNewContext(SCRIPT_APARENCIA, contexto);
  return atributos["data-tema"];
}

describe("preferência de aparência", () => {
  it("primeira visita segue o aparelho; só valores conhecidos são aceitos", () => {
    expect(APARENCIA_PADRAO).toBe("sistema");
    expect(lerPreferenciaSalva(null)).toBe("sistema");
    expect(lerPreferenciaSalva("escuro")).toBe("escuro");
    expect(lerPreferenciaSalva("claro")).toBe("claro");
    expect(lerPreferenciaSalva("dark")).toBe("sistema");
    expect(OPCOES_APARENCIA.map((o) => o.rotulo)).toEqual(["Claro", "Escuro", "Seguir aparelho"]);
  });

  it("script do <head> aplica a escolha salva antes da pintura", () => {
    expect(rodarScript("escuro")).toBe("escuro");
    expect(rodarScript("claro")).toBe("claro");
    expect(rodarScript(null)).toBe("sistema");
  });

  it("valor adulterado ou storage bloqueado não quebram a página", () => {
    expect(rodarScript('"><img src=x onerror=alert(1)>')).toBe("sistema");
    expect(() => rodarScript(null, true)).not.toThrow();
    expect(rodarScript(null, true)).toBe("sistema");
  });
});

describe("tokens do tema escuro (globals.css)", () => {
  const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf-8");

  it("só valem em página adaptável, nunca na demonstração", () => {
    expect(css).toContain('html[data-tema="escuro"]:has([data-aparencia-adaptavel])');
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\)\s*\{\s*html\[data-tema="sistema"\]:has\(\[data-aparencia-adaptavel\]\)/,
    );
    expect(css).not.toMatch(/^\s*html\[data-tema="escuro"\]\s*\{/m);
  });

  it("o bloco 'escuro' e o bloco 'seguir aparelho' definem os mesmos valores", () => {
    const bloco = (inicio: string) => {
      const i = css.indexOf(inicio);
      return css
        .slice(css.indexOf("{", i) + 1, css.indexOf("}", i))
        .replace(/\s+/g, " ")
        .trim();
    };
    const escuro = bloco('html[data-tema="escuro"]:has([data-aparencia-adaptavel])');
    const sistema = bloco('  html[data-tema="sistema"]:has([data-aparencia-adaptavel])');
    expect(escuro).toContain("--color-paper:");
    expect(sistema).toBe(escuro);
  });
});
