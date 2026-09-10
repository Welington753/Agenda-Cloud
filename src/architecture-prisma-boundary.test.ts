// Fronteira Prisma/TypeORM (Lote 6B.2 — freeze do Prisma legado, ver
// docs/plans/fundacao-postgresql.md). Decisão: TypeORM (`backend/src/`) é a
// única fonte oficial do backend novo; Prisma (`prisma/`, `src/generated/prisma`,
// `src/lib/db/prisma.ts`) fica só para testes/compatibilidade legada, sem
// sincronizar de volta e sem uso por nenhum código runtime novo. Este teste
// varre o TEXTO dos arquivos-fonte (nunca importa TypeORM/Prisma de verdade,
// nunca abre conexão) e falha se qualquer código runtime novo importar Prisma.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(srcDir, "..");

const PRISMA_IMPORT_PATTERN = /from\s+["'](@prisma\/client|[^"']*\/generated\/prisma[^"']*)["']/;

// Único arquivo de runtime autorizado a falar com Prisma: o client singleton
// legado, ainda não consumido por nenhuma tela (ver comentário no próprio
// arquivo) — existe para os testes de banco (`*.db.test.ts`) e para uma fase
// futura de repositórios, não para código de produção atual.
const ARQUIVO_PERMITIDO = path.resolve(srcDir, "lib/db/prisma.ts");

/** Caminhamento recursivo manual (sem depender de `fs.globSync`, indisponível
 * nos tipos de `@types/node` v20 usados pelo frontend) — lista todo .ts/.tsx
 * sob `dir`, ignorando `node_modules`. */
function arquivosTsSob(dir: string): string[] {
  const resultado: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (entrada.name === "node_modules") continue;
    const caminhoCompleto = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      resultado.push(...arquivosTsSob(caminhoCompleto));
    } else if (/\.tsx?$/.test(entrada.name)) {
      resultado.push(caminhoCompleto);
    }
  }
  return resultado;
}

function importaPrisma(caminhoArquivo: string): boolean {
  return PRISMA_IMPORT_PATTERN.test(readFileSync(caminhoArquivo, "utf-8"));
}

describe("fronteira Prisma/TypeORM — nenhum código runtime novo importa Prisma", () => {
  it("nenhum arquivo em src/ (fora do client legado e do client gerado) importa Prisma", () => {
    const ofensores = arquivosTsSob(srcDir)
      .filter((arquivo) => !arquivo.includes(`${path.sep}generated${path.sep}prisma${path.sep}`))
      .filter((arquivo) => path.resolve(arquivo) !== ARQUIVO_PERMITIDO)
      .filter(importaPrisma);

    expect(ofensores).toEqual([]);
  });

  it("backend/src/ (TypeORM, fonte oficial do backend novo) nunca importa Prisma", () => {
    const backendSrcDir = path.join(repoRoot, "backend", "src");
    const ofensores = arquivosTsSob(backendSrcDir).filter(importaPrisma);

    expect(ofensores).toEqual([]);
  });

  it("o client legado (src/lib/db/prisma.ts) de fato importa Prisma — allowlist não está obsoleta", () => {
    expect(importaPrisma(ARQUIVO_PERMITIDO)).toBe(true);
  });
});
