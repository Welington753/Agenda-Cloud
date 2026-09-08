// Auditoria estática: o site comercial e o onboarding precisam funcionar
// isolados, sem depender do backend NestJS (porta 3001) nem de qualquer
// chamada de rede. Varre o código-fonte do site/onboarding em vez de montar
// componentes (não há testing-library nesta suíte — ver vitest.config.ts).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIRETORIOS_ALVO = ["src/app/onboarding", "src/components/site", "src/lib/site", "src/lib/onboarding"];

function listarArquivos(diretorio: string): string[] {
  const entradas = readdirSync(diretorio);
  return entradas.flatMap((entrada) => {
    const caminho = join(diretorio, entrada);
    const info = statSync(caminho);
    if (info.isDirectory()) return listarArquivos(caminho);
    return caminho.endsWith(".ts") || caminho.endsWith(".tsx") ? [caminho] : [];
  });
}

// Exclui este próprio arquivo: ele cita "localhost:3001" e o padrão de fetch
// nos textos da asserção, o que geraria falso positivo ao escanear a si mesmo.
const ARQUIVOS = DIRETORIOS_ALVO.flatMap((dir) => listarArquivos(dir)).filter(
  (arquivo) => !arquivo.endsWith("sem-chamadas-backend.test.ts")
);

describe("site comercial e onboarding não acessam o backend", () => {
  it("varreu pelo menos um arquivo (a lista de diretórios não está vazia/errada)", () => {
    expect(ARQUIVOS.length).toBeGreaterThan(10);
  });

  it("nenhum arquivo referencia localhost:3001", () => {
    for (const arquivo of ARQUIVOS) {
      const conteudo = readFileSync(arquivo, "utf-8");
      expect(conteudo, `${arquivo} não deveria referenciar o backend`).not.toContain("localhost:3001");
    }
  });

  it("nenhum arquivo usa fetch, axios ou XMLHttpRequest", () => {
    for (const arquivo of ARQUIVOS) {
      const conteudo = readFileSync(arquivo, "utf-8");
      expect(conteudo, `${arquivo} não deveria fazer chamadas de rede`).not.toMatch(/\bfetch\(|axios|XMLHttpRequest/);
    }
  });
});
