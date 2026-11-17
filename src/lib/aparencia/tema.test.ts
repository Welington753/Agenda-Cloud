import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import {
  APARENCIA_PADRAO,
  CHAVE_APARENCIA,
  OPCOES_APARENCIA,
  SCRIPT_APARENCIA,
  lerPreferenciaSalva,
  opcoesAparencia,
} from "./tema";

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

  it("'Azul e branco' é opcional: aceito quando salvo, oferecido só onde existe ou já escolhido", () => {
    expect(lerPreferenciaSalva("azul")).toBe("azul");
    expect(rodarScript("azul")).toBe("azul");
    // Quem nunca escolheu nada continua seguindo o aparelho.
    expect(rodarScript(null)).toBe("sistema");
    const rotulos = (disponivel: boolean, atual: Parameters<typeof opcoesAparencia>[1]) =>
      opcoesAparencia(disponivel, atual).map((o) => o.rotulo);
    expect(rotulos(true, "sistema")).toEqual(["Claro", "Escuro", "Seguir aparelho", "Azul e branco"]);
    expect(rotulos(false, "escuro")).toEqual(["Claro", "Escuro", "Seguir aparelho"]);
    expect(rotulos(false, "azul")).toEqual(["Claro", "Escuro", "Seguir aparelho", "Azul e branco"]);
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

  it("o agendamento público segue só o aparelho: nunca entra no bloco da escolha 'escuro'", () => {
    const inicioMedia = css.indexOf("@media (prefers-color-scheme: dark)");
    expect(css.slice(inicioMedia)).toMatch(/html:has\(\[data-aparencia-aparelho\]\)\s*\{/);
    expect(css.slice(0, inicioMedia)).not.toMatch(/html:has\(\[data-aparencia-aparelho\]\)/);
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

describe("tokens do tema 'Azul e branco' (globals.css)", () => {
  const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf-8");
  const seletor = 'html[data-tema="azul"]:has([data-tema-azul-disponivel])';

  it("só valem com a escolha 'azul' em página que desenha o tema", () => {
    expect(css).toContain(`${seletor} {`);
    expect(css).not.toMatch(/^\s*html\[data-tema="azul"\]\s*\{/m);
    // Nunca dentro da media query do aparelho: não é aplicado sozinho.
    const inicioMedia = css.indexOf("@media (prefers-color-scheme: dark)");
    const fimMedia = css.indexOf('/* Tema opcional "Azul e branco"');
    expect(fimMedia).toBeGreaterThan(inicioMedia);
    expect(css.slice(inicioMedia, fimMedia)).not.toContain("azul");
    // A variante `azul:` usa a mesma condição do bloco.
    expect(css).toContain(`@custom-variant azul (&:where(${seletor} *));`);
  });

  it("define os mesmos tokens de cor do tema escuro", () => {
    const tokens = (inicio: string) => {
      const i = css.indexOf(inicio);
      return [...css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i)).matchAll(/(--[\w-]+):/g)].map((m) => m[1]).sort();
    };
    expect(tokens(seletor)).toEqual(tokens('html[data-tema="escuro"]:has([data-aparencia-adaptavel])'));
  });
});
