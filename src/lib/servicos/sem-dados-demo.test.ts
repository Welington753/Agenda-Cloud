// Auditoria estática (Lote 6D.1, estendida no 6D.2): a área REAL (`/conta/**`,
// `/portal/**`, as telas de acesso, o agendamento público e as bibliotecas
// que eles usam) nunca pode importar o domínio da demonstração —
// repositórios locais, seeds, o contexto de sessão simulada ou os tipos em
// português da simulação. Varre o código-fonte em vez de montar componentes
// (não há testing-library nesta suíte — ver vitest.config.ts), mesma
// disciplina de `src/lib/site/sem-chamadas-backend.test.ts`.
//
// Não há exceção: o `/login` também é área real e não importa nada da
// demonstração (ela entra pela página inicial, em `/onboarding`).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIRETORIOS_ALVO = [
  "src/app/conta",
  "src/app/portal",
  "src/app/login",
  "src/app/cadastro",
  "src/app/convite",
  "src/app/redefinir-senha",
  "src/app/agendar",
  "src/components/conta",
  "src/components/auth",
  "src/components/administracao",
  "src/lib/api",
  "src/lib/conta",
  "src/lib/equipe",
  "src/lib/push",
  "src/lib/servicos",
  "src/lib/profissionais",
  "src/lib/clientes",
  "src/lib/agendamento-publico",
  "src/lib/administracao",
];

function listarArquivos(diretorio: string): string[] {
  return readdirSync(diretorio).flatMap((entrada) => {
    const caminho = join(diretorio, entrada);
    if (statSync(caminho).isDirectory()) return listarArquivos(caminho);
    return caminho.endsWith(".ts") || caminho.endsWith(".tsx") ? [caminho] : [];
  });
}

// Exclui os próprios testes: eles citam os caminhos proibidos nas asserções,
// o que geraria falso positivo ao escanear a si mesmos.
const ARQUIVOS = DIRETORIOS_ALVO.flatMap(listarArquivos)
  .filter((a) => !a.endsWith(".test.ts"))
  .map((a) => a.replaceAll("\\", "/"));

/** Só as linhas de `import` — um comentário que MENCIONA a demonstração para
 * explicar que não a usa nunca deve reprovar. */
function linhasDeImport(conteudo: string): string[] {
  return conteudo.split("\n").filter((linha) => /^\s*import\b/.test(linha) || /\bfrom\s+["']/.test(linha));
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

/** Linhas que importam `modulo`. */
function importsProibidos(conteudo: string, modulo: string): string[] {
  return linhasDeImport(conteudo).filter((linha) => linha.includes(modulo));
}

describe("a área real da conta nunca importa a demonstração", () => {
  it("varreu todos os diretórios alvo", () => {
    for (const diretorio of DIRETORIOS_ALVO) {
      expect(ARQUIVOS.some((a) => a.startsWith(`${diretorio}/`)), diretorio).toBe(true);
    }
  });

  it.each(MODULOS_DEMO)("nenhum arquivo importa %s", (modulo) => {
    for (const arquivo of ARQUIVOS) {
      expect(
        importsProibidos(readFileSync(arquivo, "utf-8"), modulo),
        `${arquivo} não deveria importar ${modulo}`,
      ).toEqual([]);
    }
  });

  it("nenhum arquivo importa o Prisma gerado", () => {
    for (const arquivo of ARQUIVOS) {
      expect(linhasDeImport(readFileSync(arquivo, "utf-8")).join("\n"), `${arquivo} não deveria usar Prisma`).not.toMatch(
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

describe("página de login (controle da guarda)", () => {
  const LOGIN = "src/app/login/page.tsx";

  it("é varrida e não importa nenhum módulo da demonstração", () => {
    expect(ARQUIVOS).toContain(LOGIN);
    const conteudo = readFileSync(LOGIN, "utf-8");
    for (const modulo of MODULOS_DEMO) expect(importsProibidos(conteudo, modulo), modulo).toEqual([]);
  });

  it("o detector reprova os imports que os antigos botões de demonstração usavam", () => {
    for (const linha of [
      'import { useAuth } from "@/lib/auth/auth-context";',
      'import { autenticar, SENHA_DEMONSTRACAO } from "@/lib/auth/autenticacao";',
    ]) {
      expect(MODULOS_DEMO.flatMap((modulo) => importsProibidos(linha, modulo))).toContain(linha);
    }
  });
});
