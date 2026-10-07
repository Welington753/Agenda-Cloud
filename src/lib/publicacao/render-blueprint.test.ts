// Invariantes do Blueprint do piloto (render.yaml), conferidas no texto do
// arquivo: publicação só manual, nenhum segredo versionado, uma instância
// por serviço (rate limit em memória), migrations fora do deploy e o modo
// mesma origem (proxy `/agenda_api` com segredo compartilhado).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(__dirname, "../../..");
const blueprint = readFileSync(path.join(RAIZ, "render.yaml"), "utf8");
const linhas = blueprint.split(/\r?\n/);
const semComentarios = linhas.filter((linha) => !linha.trim().startsWith("#")).join("\n");

const API = "agenda-cloud-piloto-api";
const WEB = "agenda-cloud-piloto-web";

/** Linhas do bloco de um serviço (de `name:` até o próximo serviço). */
function linhasDoServico(nome: string): string[] {
  const inicio = linhas.findIndex((linha) => linha.trim() === `name: ${nome}`);
  expect(inicio, `serviço ${nome} declarado em render.yaml`).toBeGreaterThanOrEqual(0);
  const fim = linhas.findIndex((linha, i) => i > inicio && /^ {2}- type: /.test(linha));
  return linhas.slice(inicio, fim === -1 ? undefined : fim);
}

/** Configuração da variável `chave` no serviço: as linhas abaixo de
 * `- key: NOME` (`value`/`sync`/`generateValue`/`fromService`), sem
 * comentários, até a próxima variável, juntas por espaço. */
function configuracaoDa(chave: string, servico = API): string {
  const bloco = linhasDoServico(servico);
  const indice = bloco.findIndex((linha) => linha.trim() === `- key: ${chave}`);
  expect(indice, `${chave} declarada em ${servico}`).toBeGreaterThanOrEqual(0);
  const resto = bloco.slice(indice + 1);
  const fim = resto.findIndex((linha) => /^\s*- key: /.test(linha));
  return resto
    .slice(0, fim === -1 ? undefined : fim)
    .map((linha) => linha.trim())
    .filter((linha) => linha !== "" && !linha.startsWith("#"))
    .join(" ");
}

function scripts(arquivo: string): Record<string, string> {
  const pacote = JSON.parse(readFileSync(path.join(RAIZ, arquivo), "utf8")) as {
    scripts: Record<string, string>;
  };
  return pacote.scripts;
}

describe("render.yaml (piloto)", () => {
  it("declara exatamente dois web services Node", () => {
    expect(semComentarios.match(/^ {2}- type: web$/gm)).toHaveLength(2);
    expect(semComentarios.match(/^ {4}runtime: node$/gm)).toHaveLength(2);
  });

  it("publicação só manual: auto-deploy desligado nos dois serviços", () => {
    expect(semComentarios.match(/^ {4}autoDeployTrigger: "off"$/gm)).toHaveLength(2);
    expect(semComentarios).not.toMatch(/autoDeployTrigger: "?(commit|checksPass)/);
    expect(semComentarios).not.toMatch(/autoDeploy: true/);
  });

  it("publica a partir da branch de integração, nunca da main", () => {
    expect(semComentarios.match(/^ {4}branch: integration\/nestjs-typeorm-frontend$/gm)).toHaveLength(2);
  });

  it("migrations nunca rodam no deploy", () => {
    expect(semComentarios).not.toMatch(/preDeployCommand/);
    expect(semComentarios).not.toMatch(/migration/i);
  });

  it("uma instância por serviço (rate limit em memória)", () => {
    expect(semComentarios.match(/^ {4}numInstances: 1$/gm)).toHaveLength(2);
    expect(semComentarios).not.toMatch(/scaling:/);
  });

  it("segredos e endereços ainda desconhecidos ficam fora do arquivo (sync: false)", () => {
    for (const chave of ["DATABASE_URL", "DIRECT_URL", "FRONTEND_URL"]) {
      expect(configuracaoDa(chave)).toBe("sync: false");
    }
    expect(configuracaoDa("API_PROXY_TARGET", WEB)).toBe("sync: false");
  });

  it("nenhum valor versionado contém URL ou credencial", () => {
    expect(semComentarios).not.toMatch(/:\/\//);
    // O único valor gerado é o segredo do proxy, criado pelo próprio Render.
    expect(semComentarios.match(/generateValue/g)).toHaveLength(1);
  });

  it("nomes próprios do Agenda Cloud, sem recurso compartilhado com outro sistema da conta", () => {
    const nomes = [...semComentarios.matchAll(/^ {4}name: (.+)$/gm)].map((m) => m[1]);
    expect(nomes).toEqual([API, WEB]);
    expect(semComentarios).not.toMatch(/envVarGroups|fromGroup|^databases:|fromDatabase/m);
    // `fromService` só aponta para a API deste mesmo Blueprint.
    const referencias = [...semComentarios.matchAll(/^ {10}name: (.+)$/gm)].map((m) => m[1]);
    expect(referencias).toEqual([API]);
  });

  it("mesma origem: o navegador chama o proxy, que usa o segredo gerado para a API", () => {
    expect(configuracaoDa("NEXT_PUBLIC_API_URL", WEB)).toBe("value: /agenda_api");
    expect(configuracaoDa("API_PROXY_SECRET")).toBe("generateValue: true");
    expect(configuracaoDa("API_PROXY_SECRET", WEB)).toBe(
      `fromService: type: web name: ${API} envVarKey: API_PROXY_SECRET`,
    );
  });

  it("o serviço web nunca recebe credencial de banco", () => {
    expect(linhasDoServico(WEB).join("\n")).not.toMatch(/DATABASE_URL|DIRECT_URL/);
  });

  it("valores fixos de runtime", () => {
    expect(configuracaoDa("NODE_ENV")).toBe("value: production");
    expect(configuracaoDa("HOST")).toBe("value: 0.0.0.0");
    expect(configuracaoDa("CLIENT_IP_SOURCE")).toBe("value: socket");
    // Pendente até a confirmação do runbook, seção 5: o proxy não repassa IP.
    expect(configuracaoDa("CLIENT_IP_SOURCE", WEB)).toBe("value: socket");
  });

  it("comandos usam os scripts reais do projeto", () => {
    expect(semComentarios).toContain("rootDir: backend");
    expect(semComentarios.match(/buildCommand: npm ci --include=dev && npm run build/g)).toHaveLength(2);
    expect(semComentarios).toContain("startCommand: node dist/main.js");
    expect(semComentarios).toContain("startCommand: npm run start -- -H 0.0.0.0");
    expect(scripts("package.json")).toMatchObject({ build: "next build", start: "next start" });
    expect(scripts("backend/package.json")).toMatchObject({ build: "nest build" });
  });
});
