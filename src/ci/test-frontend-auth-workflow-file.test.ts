// Rede de segurança sobre o workflow de teste (Lote 6C.1) — checagem textual
// simples (sem parser de YAML, para não introduzir dependência nova só por
// isto), mesma disciplina de cautela do Lote 6B.10: garante que o workflow
// nunca ganhe, por acidente numa edição futura, acesso a secret nenhum, ao
// Environment `production` nem a um gatilho de production.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = path.resolve(__dirname, "../../.github/workflows/test-frontend-auth.yml");
const conteudo = readFileSync(WORKFLOW_PATH, "utf-8");

describe("workflow de teste do Lote 6C.1 (test-frontend-auth.yml)", () => {
  it("nunca referencia nenhum GitHub secret", () => {
    expect(conteudo).not.toMatch(/secrets\./);
  });

  it("nunca usa o Environment production nem qualquer environment do GitHub Actions", () => {
    expect(conteudo).not.toMatch(/^\s*environment:/m);
  });

  it("dispara só em PR para a integration (nunca em push/workflow direto para main)", () => {
    expect(conteudo).toMatch(/branches:\s*\n\s*-\s*integration\/nestjs-typeorm-frontend/);
    expect(conteudo).not.toMatch(/-\s*main\s*$/m);
    expect(conteudo).not.toMatch(/^\s*push:/m);
  });

  it("nunca referencia um host Neon", () => {
    expect(conteudo.toLowerCase()).not.toContain("neon.tech");
  });

  it("usa credenciais fixas e fictícias de Postgres descartável, nunca uma variável de segredo", () => {
    expect(conteudo).toContain("disposable_user");
    expect(conteudo).toContain("disposable_pass");
  });

  it("remove o container descartável ao final, mesmo em falha (if: always())", () => {
    expect(conteudo).toMatch(/docker rm -f frontend-auth-e2e-postgres[\s\S]*?\n\s*if: always\(\)|if: always\(\)[\s\S]*?docker rm -f frontend-auth-e2e-postgres/);
  });
});
