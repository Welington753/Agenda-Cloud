// Testa o conteúdo REAL de .github/workflows/test-migration-lote6b2.yml —
// nunca dispara nenhum workflow (isso só acontece pela UI/Actions do
// GitHub). Confirma que o workflow de teste (Lote 6B.10) nunca toca no
// Environment `production`, nunca usa secret nenhum do projeto, e só sobe
// um PostgreSQL descartável com credenciais fictícias fixas no próprio
// arquivo.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkYamlSanity } from './lib/yaml-sanity-check.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = path.join(moduleDir, '../../.github/workflows/test-migration-lote6b2.yml');
const PRODUCTION_WORKFLOW_PATH = path.join(moduleDir, '../../.github/workflows/apply-lote6b2-production.yml');
const content = readFileSync(WORKFLOW_PATH, 'utf-8');
const productionWorkflowContent = readFileSync(PRODUCTION_WORKFLOW_PATH, 'utf-8');

function extractPinnedAction(workflowContent: string, actionName: string): string | undefined {
  const match = new RegExp(`uses:\\s*${actionName}@([0-9a-f]{40})`).exec(workflowContent);
  return match?.[1];
}

describe('.github/workflows/test-migration-lote6b2.yml', () => {
  it('passa na checagem sintática leve de YAML', () => {
    const result = checkYamlSanity(content);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('dispara em pull_request para a integration (e workflow_dispatch manual, sem input sensível) — nunca em push', () => {
    expect(content).toMatch(/^\s*pull_request:/m);
    expect(content).toContain('integration/nestjs-typeorm-frontend');
    expect(content).not.toMatch(/^\s*push:/m);
  });

  it('nunca referencia o Environment production nem confirmation de production', () => {
    expect(content).not.toMatch(/environment:\s*production/);
    expect(content).not.toContain('APLICAR_LOTE_6B2_PRODUCTION');
  });

  it('nunca lê nenhum secret do projeto (sem "secrets." em lugar nenhum)', () => {
    expect(content).not.toMatch(/secrets\./);
  });

  it('nunca referencia as variáveis L6B2_* (produção real)', () => {
    expect(content).not.toMatch(/L6B2_[A-Z_]*DIRECT_URL/);
    expect(content).not.toMatch(/L6B2_[A-Z_]*ENDPOINT_ID/);
  });

  it('nunca menciona Neon — só PostgreSQL descartável local ao job', () => {
    expect(content.toLowerCase()).not.toContain('neon.tech');
  });

  it('runner Ubuntu hospedado pelo GitHub', () => {
    expect(content).toMatch(/runs-on:\s*ubuntu-latest/);
  });

  it('reutiliza os mesmos actions/checkout e actions/setup-node já fixados por SHA no workflow de production', () => {
    const checkoutShaHere = extractPinnedAction(content, 'actions/checkout');
    const checkoutShaProduction = extractPinnedAction(productionWorkflowContent, 'actions/checkout');
    expect(checkoutShaHere).toBeDefined();
    expect(checkoutShaHere).toBe(checkoutShaProduction);

    const setupNodeShaHere = extractPinnedAction(content, 'actions/setup-node');
    const setupNodeShaProduction = extractPinnedAction(productionWorkflowContent, 'actions/setup-node');
    expect(setupNodeShaHere).toBeDefined();
    expect(setupNodeShaHere).toBe(setupNodeShaProduction);
  });

  it('permissions mínimas: contents: read', () => {
    const match = /permissions:\s*\n\s*contents:\s*read\s*$/m.exec(content);
    expect(match).not.toBeNull();
  });

  it('concorrência configurada e timeout definido', () => {
    expect(content).toMatch(/concurrency:/);
    expect(content).toMatch(/timeout-minutes:\s*\d+/);
  });

  it('remove o container PostgreSQL descartável ao final, sempre (if: always())', () => {
    expect(content).toMatch(/docker rm -f migration-e2e-postgres/);
    expect(content).toMatch(/if:\s*always\(\)/);
  });

  it('mantém rejectUnauthorized:true do lado do driver — confia no certificado só via NODE_EXTRA_CA_CERTS, nunca via flag do driver', () => {
    expect(content).toContain('NODE_EXTRA_CA_CERTS');
    expect(content).not.toMatch(/rejectUnauthorized['":\s]*false/i);
    expect(content).not.toContain('sslmode=disable');
  });

  it('nunca dispara nem faz referência ao workflow_dispatch de production', () => {
    expect(content).not.toContain('apply-lote6b2-production');
  });
});
