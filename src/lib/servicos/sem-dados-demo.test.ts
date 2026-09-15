// Auditoria estática (Lote 6D.1): a área REAL (`/conta/**` e
// `src/lib/servicos/**`) nunca pode importar o domínio da demonstração —
// repositórios locais, seeds, o contexto de sessão simulada ou os tipos em
// português da simulação. Varre o código-fonte em vez de montar componentes
// (não há testing-library nesta suíte — ver vitest.config.ts), mesma
// disciplina de `src/lib/site/sem-chamadas-backend.test.ts`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIRETORIOS_ALVO = ["src/app/conta", "src/lib/servicos"];

function listarArquivos(diretorio: string): string[] {
  return readdirSync(diretorio).flatMap((entrada) => {
    const caminho = join(diretorio, entrada);
    if (statSync(caminho).isDirectory()) return listarArquivos(caminho);
    return caminho.endsWith(".ts") || caminho.endsWith(".tsx") ? [caminho] : [];
  });
}

// Exclui os próprios testes: eles citam os caminhos proibidos nas asserções,
// o que geraria falso positivo ao escanear a si mesmos.
const ARQUIVOS = DIRETORIOS_ALVO.flatMap(listarArquivos).filter((a) => !a.endsWith(".test.ts"));

/** Só as linhas de `import` — um comentário que MENCIONA a demonstração para
 * explicar que não a usa nunca deve reprovar. */
function importsDe(caminho: string): string {
  return readFileSync(caminho, "utf-8")
    .split("\n")
    .filter((linha) => /^\s*import\b/.test(linha) || /\bfrom\s+["']/.test(linha))
    .join("\n");
}

const MODULOS_DEMO = [
  "@/lib/repositories",
  "@/lib/seed",
  "@/lib/seed-data",
  "@/lib/auth/auth-context",
  "@/lib/auth/autenticacao",
  "@/lib/db/prisma",
  "@/lib/access/access-control",
];

describe("a área real da conta nunca importa a demonstração", () => {
  it("varreu os dois diretórios alvo", () => {
    expect(ARQUIVOS.length).toBeGreaterThanOrEqual(6);
  });

  it.each(MODULOS_DEMO)("nenhum arquivo importa %s", (modulo) => {
    for (const arquivo of ARQUIVOS) {
      expect(importsDe(arquivo), `${arquivo} não deveria importar ${modulo}`).not.toContain(modulo);
    }
  });

  it("nenhum arquivo importa o Prisma gerado", () => {
    for (const arquivo of ARQUIVOS) {
      expect(importsDe(arquivo), `${arquivo} não deveria usar Prisma`).not.toMatch(
        /@\/generated\/prisma|@prisma\/client/,
      );
    }
  });

  it("nenhum arquivo monta a URL do backend na mão — sempre via http-client", () => {
    for (const arquivo of ARQUIVOS) {
      const conteudo = readFileSync(arquivo, "utf-8");
      expect(conteudo, `${arquivo} deveria usar apiRequest`).not.toContain("localhost:3001");
    }
  });
});
