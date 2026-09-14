// Auditoria estática do cadastro REAL (Lote 6C.2): a senha e o token de
// sessão nunca podem ser persistidos no cliente nem vazar para o estado da
// demonstração. Varre o código-fonte em vez de montar componentes (não há
// testing-library nesta suíte — ver vitest.config.ts), mesma disciplina de
// `src/lib/site/sem-chamadas-backend.test.ts`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ARQUIVOS_ALVO = [
  ...listarArquivos("src/app/cadastro"),
  "src/lib/auth/cadastro-validacao.ts",
  "src/lib/auth/cadastro-fluxo.ts",
];

function listarArquivos(diretorio: string): string[] {
  return readdirSync(diretorio).flatMap((entrada) => {
    const caminho = join(diretorio, entrada);
    if (statSync(caminho).isDirectory()) return listarArquivos(caminho);
    return caminho.endsWith(".ts") || caminho.endsWith(".tsx") ? [caminho] : [];
  });
}

/** Os comentários destes arquivos CITAM `localStorage`/`sessionStorage`
 * justamente para documentar que nada é guardado lá — escanear o texto cru
 * daria falso positivo. A varredura olha só o código. */
function codigoSemComentarios(caminho: string): string {
  return readFileSync(caminho, "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("cadastro real nunca persiste credencial no cliente", () => {
  it("varreu a tela de cadastro e seus módulos (a lista de alvos não está errada)", () => {
    expect(ARQUIVOS_ALVO.length).toBeGreaterThanOrEqual(4);
  });

  it("nenhum arquivo usa localStorage, sessionStorage, document.cookie ou IndexedDB", () => {
    for (const arquivo of ARQUIVOS_ALVO) {
      const conteudo = codigoSemComentarios(arquivo);
      expect(conteudo, `${arquivo} não deveria persistir nada no navegador`).not.toMatch(
        /localStorage|sessionStorage|document\.cookie|indexedDB/,
      );
    }
  });

  it("nenhum arquivo registra log de nada (senha/e-mail jamais em console)", () => {
    for (const arquivo of ARQUIVOS_ALVO) {
      const conteudo = codigoSemComentarios(arquivo);
      expect(conteudo, `${arquivo} não deveria escrever em console`).not.toMatch(/console\./);
    }
  });

  it("a tela de cadastro nunca importa o contexto ou os dados da demonstração", () => {
    for (const arquivo of ARQUIVOS_ALVO) {
      const conteudo = codigoSemComentarios(arquivo);
      expect(conteudo, `${arquivo} não deveria tocar na simulação`).not.toMatch(
        /@\/lib\/auth\/auth-context|@\/lib\/seed|@\/lib\/repositories|@\/lib\/auth\/autenticacao/,
      );
    }
  });
});
