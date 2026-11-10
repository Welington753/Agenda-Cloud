// A lista de slugs reservados do backend (backend/src/common/reserved-slugs.ts)
// cobre as rotas fixas da raiz do web e a semente da demonstração. Lida como
// texto: o web não importa código do backend. Pasta nova em `src/app` sem
// entrada na lista faz este teste falhar.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gerarEstabelecimentosSeed } from "@/lib/seed/estabelecimentos";

const RAIZ = path.resolve(__dirname, "../../..");
const FONTE = readFileSync(path.join(RAIZ, "backend/src/common/reserved-slugs.ts"), "utf8");
const lista = FONTE.slice(FONTE.indexOf("RESERVED_SLUGS"), FONTE.indexOf("];"));
const RESERVADOS = new Set([...lista.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]));

/** Mesmo alfabeto de `slugify` (backend/src/auth/slug.ts). */
const PODE_SER_SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

describe("slugs reservados do backend", () => {
  it("a leitura da lista achou valores", () => {
    expect(RESERVADOS.size).toBeGreaterThan(10);
  });

  it("toda pasta fixa da raiz de src/app que poderia ser um slug está reservada", () => {
    const pastas = readdirSync(path.join(RAIZ, "src/app"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      // Dinâmicas (`[slug]`) e grupos (`(area)`) não são endereços.
      .filter((nome) => !nome.startsWith("[") && !nome.startsWith("("))
      // `icone-192.png` e afins são rotas com ponto: nunca um slug.
      .filter((nome) => PODE_SER_SLUG.test(nome));
    expect(pastas.length).toBeGreaterThan(5);
    expect(pastas.filter((p) => !RESERVADOS.has(p))).toEqual([]);
  });

  it("nenhuma pasta dinâmica ou grupo de rotas entra literalmente", () => {
    expect([...RESERVADOS].some((s) => s === "slug" || s === "area" || s.includes("["))).toBe(false);
  });

  it("todo slug da semente da demonstração está reservado", () => {
    const semente = gerarEstabelecimentosSeed().map((e) => e.slug);
    expect(semente.length).toBe(6);
    expect(semente.filter((s) => !RESERVADOS.has(s))).toEqual([]);
  });
});
