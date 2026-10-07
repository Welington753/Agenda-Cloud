// Invariantes do Blueprint do piloto (render.yaml), conferidas no texto do
// arquivo: publicação só manual, nenhum segredo versionado, uma instância
// por serviço (rate limit em memória) e migrations fora do deploy.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(__dirname, "../../..");
const blueprint = readFileSync(path.join(RAIZ, "render.yaml"), "utf8");
const linhas = blueprint.split(/\r?\n/);
const semComentarios = linhas.filter((linha) => !linha.trim().startsWith("#")).join("\n");

/** Linha seguinte à declaração `- key: NOME` (onde fica `value`/`sync`). */
function configuracaoDa(chave: string): string {
  const indice = linhas.findIndex((linha) => linha.trim() === `- key: ${chave}`);
  expect(indice, `${chave} declarada em render.yaml`).toBeGreaterThanOrEqual(0);
  return linhas[indice + 1].trim();
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
    for (const chave of ["DATABASE_URL", "DIRECT_URL", "FRONTEND_URL", "NEXT_PUBLIC_API_URL"]) {
      expect(configuracaoDa(chave)).toBe("sync: false");
    }
  });

  it("nenhum valor versionado contém URL ou credencial", () => {
    expect(semComentarios).not.toMatch(/:\/\//);
    expect(semComentarios).not.toMatch(/generateValue/);
  });

  it("valores fixos de runtime do backend", () => {
    expect(configuracaoDa("NODE_ENV")).toBe("value: production");
    expect(configuracaoDa("HOST")).toBe("value: 0.0.0.0");
    expect(configuracaoDa("CLIENT_IP_SOURCE")).toBe("value: socket");
  });

  it("comandos usam os scripts reais do projeto", () => {
    expect(semComentarios).toContain("rootDir: backend");
    expect(semComentarios.match(/buildCommand: npm ci --include=dev && npm run build/g)).toHaveLength(2);
    expect(semComentarios).toContain("startCommand: node dist/main.js");
    expect(semComentarios).toContain("startCommand: npm run start");
    expect(scripts("package.json")).toMatchObject({ build: "next build", start: "next start" });
    expect(scripts("backend/package.json")).toMatchObject({ build: "nest build" });
  });
});
