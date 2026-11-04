// Auditoria TRANSITIVA da área real: a de sem-dados-demo.test.ts olha só as
// importações diretas de cada arquivo; esta segue a cadeia inteira. Um
// componente "genérico" que importasse a sessão simulada ou um repositório
// local levaria a demonstração para dentro da conta real sem que nenhum
// arquivo de `/conta` a importasse diretamente — é esse caminho que fica
// fechado aqui.
//
// Só importações de VALOR contam: `import type` some na compilação e não
// carrega dado, sessão nem repositório nenhum.
//
// A única aresta permitida é a dos botões de demonstração do `/login` (ver
// excecoes-demonstracao.ts): o grafo não a segue, e qualquer outro caminho da
// página de login até a demonstração continua reprovado.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXCECOES_DEMONSTRACAO, type ExcecaoDemonstracao } from "./excecoes-demonstracao";

const RAIZ = resolve(__dirname, "../../..");
const SRC = join(RAIZ, "src");

const PONTOS_DE_ENTRADA = [
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
  "src/lib/clientes",
  "src/lib/conta",
  "src/lib/equipe",
  "src/lib/push",
  "src/lib/profissionais",
  "src/lib/servicos",
  "src/lib/agendamento-publico",
  "src/lib/administracao",
];

/** Domínio da demonstração: sessão simulada, dados locais e o acesso deles. */
const PROIBIDOS = [
  "src/lib/repositories",
  "src/lib/seed",
  "src/lib/seed-data.ts",
  "src/lib/auth/auth-context.tsx",
  "src/lib/auth/autenticacao.ts",
  "src/lib/db",
  "src/lib/access",
  "src/lib/tenant",
  "src/lib/storage",
  "src/lib/hooks/use-client-data.ts",
  "src/components/layout",
  "src/generated",
].map((p) => join(RAIZ, p));

function listar(diretorio: string): string[] {
  return readdirSync(diretorio).flatMap((entrada) => {
    const caminho = join(diretorio, entrada);
    if (statSync(caminho).isDirectory()) return listar(caminho);
    return /\.tsx?$/.test(caminho) && !/\.test\.tsx?$/.test(caminho) ? [caminho] : [];
  });
}

const IMPORTACAO =
  /^\s*(?:import|export)\s+(type\s+)?(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']/gm;

/** Especificadores de VALOR importados por um arquivo. */
function especificadoresDeValor(arquivo: string): string[] {
  const conteudo = readFileSync(arquivo, "utf-8");
  const encontrados: string[] = [];
  for (const casamento of conteudo.matchAll(IMPORTACAO)) {
    if (casamento[1]) continue; // `import type ... from` / `export type ... from`
    encontrados.push(casamento[2]);
  }
  return encontrados;
}

function resolverArquivo(base: string): string | null {
  for (const candidato of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidato) && statSync(candidato).isFile()) return candidato;
  }
  return null;
}

function resolver(especificador: string, de: string): string | null {
  if (especificador.startsWith("@/")) return resolverArquivo(join(SRC, especificador.slice(2)));
  if (especificador.startsWith(".")) return resolverArquivo(resolve(dirname(de), especificador));
  return null; // pacote do node_modules
}

function ehDaDemonstracao(arquivo: string): boolean {
  return PROIBIDOS.some((p) => arquivo === p || arquivo.startsWith(`${p}\\`) || arquivo.startsWith(`${p}/`));
}

function ehExcecao(de: string, para: string, excecoes: readonly ExcecaoDemonstracao[]): boolean {
  return excecoes.some((e) => de === join(RAIZ, e.arquivo) && para === join(RAIZ, e.destino));
}

/** Mapa arquivo -> quem o trouxe, para a mensagem mostrar a cadeia. */
function grafoAPartirDe(
  entradas: string[],
  excecoes: readonly ExcecaoDemonstracao[] = EXCECOES_DEMONSTRACAO,
): Map<string, string | null> {
  const origem = new Map<string, string | null>(entradas.map((e) => [e, null]));
  const fila = [...entradas];
  while (fila.length > 0) {
    const atual = fila.shift()!;
    for (const especificador of especificadoresDeValor(atual)) {
      const destino = resolver(especificador, atual);
      if (destino && !origem.has(destino) && !ehExcecao(atual, destino, excecoes)) {
        origem.set(destino, atual);
        fila.push(destino);
      }
    }
  }
  return origem;
}

function cadeia(arquivo: string, origem: Map<string, string | null>): string {
  const passos: string[] = [];
  for (let atual: string | null = arquivo; atual; atual = origem.get(atual) ?? null) {
    passos.unshift(relative(RAIZ, atual));
  }
  return passos.join(" -> ");
}

describe("a área real nunca alcança a demonstração, nem indiretamente", () => {
  const entradas = PONTOS_DE_ENTRADA.flatMap((d) => listar(join(RAIZ, d)));
  const origem = grafoAPartirDe(entradas);

  it("varreu a área real e seguiu as importações", () => {
    expect(entradas.length).toBeGreaterThanOrEqual(30);
    expect(origem.size).toBeGreaterThan(entradas.length);
  });

  it("nenhum arquivo alcançado pertence ao domínio da demonstração", () => {
    const violacoes = [...origem.keys()].filter(ehDaDemonstracao).map((arquivo) => cadeia(arquivo, origem));
    expect(violacoes).toEqual([]);
  });

  it("a página de login é ponto de entrada e só a aresta da exceção fica de fora (controle)", () => {
    const login = join(RAIZ, "src/app/login/page.tsx");
    expect(entradas).toContain(login);
    const semExcecao = [...grafoAPartirDe([login], []).keys()];
    for (const excecao of EXCECOES_DEMONSTRACAO) expect(semExcecao).toContain(join(RAIZ, excecao.destino));
    expect(semExcecao).toContain(join(RAIZ, "src/lib/repositories/index.ts"));
    expect([...grafoAPartirDe([login]).keys()].filter(ehDaDemonstracao)).toEqual([]);
  });

  it("o próprio detector acusa uma importação proibida, com a exceção do login ativa (controle)", () => {
    const shellDemo = join(RAIZ, "src/components/layout/admin-shell.tsx");
    const alcancados = grafoAPartirDe([shellDemo]);
    expect([...alcancados.keys()]).toContain(join(RAIZ, "src/lib/auth/auth-context.tsx"));
  });
});
