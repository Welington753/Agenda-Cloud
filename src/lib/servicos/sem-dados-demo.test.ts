// Auditoria estática (Lote 6D.1, estendida no 6D.2): a área REAL (`/conta/**`,
// `/portal/**`, as telas de acesso, o agendamento público e as bibliotecas
// que eles usam) nunca pode importar o domínio da demonstração —
// repositórios locais, seeds, o contexto de sessão simulada ou os tipos em
// português da simulação. Varre o código-fonte em vez de montar componentes
// (não há testing-library nesta suíte — ver vitest.config.ts), mesma
// disciplina de `src/lib/site/sem-chamadas-backend.test.ts`.
//
// A única passagem permitida é a dos botões de demonstração do `/login`
// (ver excecoes-demonstracao.ts), por arquivo e por módulo.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXCECOES_DEMONSTRACAO } from "./excecoes-demonstracao";

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

function especificador(linha: string): string | undefined {
  return /["']([^"']+)["']/.exec(linha)?.[1];
}

/** Linhas que importam `modulo` fora da exceção do login. A exceção exige o
 * arquivo E o especificador exatos: outro arquivo, ou um especificador que só
 * começa igual, reprova. */
function importsProibidos(arquivo: string, conteudo: string, modulo: string): string[] {
  return linhasDeImport(conteudo).filter(
    (linha) =>
      linha.includes(modulo) &&
      !EXCECOES_DEMONSTRACAO.some((e) => e.arquivo === arquivo && especificador(linha) === e.modulo),
  );
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
        importsProibidos(arquivo, readFileSync(arquivo, "utf-8"), modulo),
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

describe("exceção do login (controle da guarda)", () => {
  const LOGIN = "src/app/login/page.tsx";

  it("a página de login é varrida e ainda usa os dois imports da exceção", () => {
    expect(ARQUIVOS).toContain(LOGIN);
    const linhas = linhasDeImport(readFileSync(LOGIN, "utf-8"));
    for (const excecao of EXCECOES_DEMONSTRACAO) {
      expect(excecao.arquivo).toBe(LOGIN);
      expect(linhas.map(especificador)).toContain(excecao.modulo);
    }
  });

  it("aceita os imports da exceção na página de login", () => {
    const conteudo = [
      'import { useAuth } from "@/lib/auth/auth-context";',
      'import { autenticar, SENHA_DEMONSTRACAO } from "@/lib/auth/autenticacao";',
    ].join("\n");
    for (const modulo of MODULOS_DEMO) expect(importsProibidos(LOGIN, conteudo, modulo)).toEqual([]);
  });

  it("reprova outro módulo da demonstração na própria página de login", () => {
    const conteudo = 'import { estabelecimentoRepository } from "@/lib/repositories";';
    expect(importsProibidos(LOGIN, conteudo, "@/lib/repositories")).toEqual([conteudo]);
  });

  it("reprova um especificador que só começa igual ao da exceção", () => {
    const conteudo = 'import { x } from "@/lib/auth/autenticacao-extra";';
    expect(importsProibidos(LOGIN, conteudo, "@/lib/auth/autenticacao")).toEqual([conteudo]);
  });

  it.each(["src/components/auth/formulario-login.tsx", "src/app/login/layout.tsx", "src/app/portal/page.tsx"])(
    "reprova o mesmo import em %s",
    (arquivo) => {
      const conteudo = 'import { useAuth } from "@/lib/auth/auth-context";';
      expect(importsProibidos(arquivo, conteudo, "@/lib/auth/auth-context")).toEqual([conteudo]);
    },
  );
});
