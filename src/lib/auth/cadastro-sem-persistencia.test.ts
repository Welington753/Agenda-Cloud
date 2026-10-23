// Auditoria estática das telas que recebem SENHA ou TOKEN de conta (aceite de
// convite, redefinição de senha e a página do antigo cadastro): nada disso
// pode ser persistido no cliente nem vazar para o estado da demonstração. Varre o código-fonte em vez de montar componentes (não há
// testing-library nesta suíte — ver vitest.config.ts), mesma disciplina de
// `src/lib/site/sem-chamadas-backend.test.ts`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ARQUIVOS_ALVO = [
  ...listarArquivos("src/app/cadastro"),
  ...listarArquivos("src/app/convite"),
  ...listarArquivos("src/app/redefinir-senha"),
  "src/lib/auth/senha.ts",
  "src/lib/auth/link-do-email.ts",
  "src/components/administracao/reautenticacao.tsx",
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

describe("telas de senha e convite nunca persistem credencial no cliente", () => {
  it("varreu as telas de convite, redefinição e cadastro (a lista de alvos não está errada)", () => {
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
