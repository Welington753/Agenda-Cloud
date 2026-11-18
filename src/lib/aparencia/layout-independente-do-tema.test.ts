// Guarda: o tema escolhido (Claro, Escuro, Seguir aparelho, Azul e branco)
// troca só a paleta. Até 18/11/2026 a Visão geral do portal, os grupos do
// menu do portal e de /conta e algumas bordas só apareciam no "Azul e
// branco" (hook `useTemaAzul`, variante `azul:` e props de arranjo); ao
// escolher outro tema a tela voltava ao arranjo antigo. Esta guarda reprova
// qualquer caminho de volta: nenhum componente lê o tema para decidir
// estrutura, e o CSS não oferece variante de classe por tema.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../..");
/** Únicos lugares que podem ler a preferência: a regra, o hook e o seletor. */
const PODEM_LER_O_TEMA = new Set(
  ["lib/aparencia/tema.ts", "lib/aparencia/use-aparencia.ts", "components/aparencia/aparencia.tsx"].map((p) =>
    path.join(SRC, p),
  ),
);

function arquivos(pasta: string): string[] {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = path.join(pasta, nome);
    if (statSync(caminho).isDirectory()) return nome === "generated" ? [] : arquivos(caminho);
    return /\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

const codigo = arquivos(SRC).map((caminho) => ({
  caminho,
  relativo: path.relative(SRC, caminho).replaceAll("\\", "/"),
  texto: readFileSync(caminho, "utf-8"),
}));

describe("layout independente do tema", () => {
  it("varre os componentes da área real", () => {
    const relativos = codigo.map((c) => c.relativo);
    for (const esperado of [
      "components/conta/shell-conta.tsx",
      "components/administracao/shell-plataforma.tsx",
      "components/administracao/abas-administracao.tsx",
      "app/portal/(area)/visao-geral/page.tsx",
    ]) {
      expect(relativos).toContain(esperado);
    }
  });

  it("nenhuma classe usa variante de tema (`azul:`, `escuro:` ...)", () => {
    const variante = /(?:^|[\s"'`{(])(?:[\w-]+:)*(?:azul|claro|escuro|sistema):[\w[&!-]/m;
    const comVariante = codigo.filter((c) => variante.test(c.texto.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "")));
    expect(comVariante.map((c) => c.relativo)).toEqual([]);
  });

  it("CSS sem variante de classe por tema", () => {
    const css = readFileSync(path.join(SRC, "app/globals.css"), "utf-8");
    expect(css).not.toMatch(/@custom-variant\s+(azul|claro|escuro|sistema)\b/);
  });

  it("só a aparência lê a preferência ou o `data-tema`", () => {
    const leitura = /useAparencia\s*\(|useTemaAzul|getAttribute\(\s*["']data-tema["']\s*\)|lerPreferenciaSalva\s*\(/;
    const fora = codigo.filter((c) => !PODEM_LER_O_TEMA.has(c.caminho) && leitura.test(c.texto));
    expect(fora.map((c) => c.relativo)).toEqual([]);
  });

  it("menus agrupados não dependem do tema", () => {
    const shell = codigo.find((c) => c.relativo === "components/conta/shell-conta.tsx")!.texto;
    expect(shell).toMatch(/const grupos = perfil === "dono" \|\| perfil === "gerente" \? gruposDaNavegacao\(itens\) : null;/);
    const abas = codigo.find((c) => c.relativo === "components/administracao/abas-administracao.tsx")!.texto;
    expect(abas).not.toMatch(/\bhidden\b[^"]*uppercase/);
  });
});
