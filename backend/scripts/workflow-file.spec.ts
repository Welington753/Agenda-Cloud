// Testa o conteúdo REAL de .github/workflows/apply-lote6b2-production.yml —
// nunca dispara o workflow (isso só acontece pela UI do GitHub); só lê o
// arquivo do disco e confere propriedades estruturais e ausência de
// segredo/hardcode. Ver checkYamlSanity para os limites da checagem
// sintática (não é um parser YAML completo).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkYamlSanity } from './lib/yaml-sanity-check.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = path.join(
  moduleDir,
  '../../.github/workflows/apply-lote6b2-production.yml',
);
const content = readFileSync(WORKFLOW_PATH, 'utf-8');

describe('.github/workflows/apply-lote6b2-production.yml', () => {
  it('passa na checagem sintática leve de YAML', () => {
    const result = checkYamlSanity(content);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('só dispara manualmente — workflow_dispatch, nunca push nem pull_request', () => {
    expect(content).toMatch(/^\s*workflow_dispatch:/m);
    expect(content).not.toMatch(/^\s*push:/m);
    expect(content).not.toMatch(/^\s*pull_request:/m);
  });

  it('exige o input confirmation', () => {
    expect(content).toMatch(/confirmation:/);
    expect(content).toContain('APLICAR_LOTE_6B2_PRODUCTION');
  });

  it('usa o GitHub Environment production', () => {
    expect(content).toMatch(/environment:\s*production/);
  });

  it('permissions mínimas: contents: read, nada além disso no bloco permissions', () => {
    const match = /permissions:\s*\n\s*contents:\s*read\s*$/m.exec(content);
    expect(match).not.toBeNull();
  });

  it('concorrência exclusiva configurada', () => {
    expect(content).toMatch(/concurrency:/);
    expect(content).toMatch(/cancel-in-progress:\s*false/);
  });

  it('timeout definido', () => {
    expect(content).toMatch(/timeout-minutes:\s*\d+/);
  });

  it('confere a branch antes de qualquer coisa sensível', () => {
    expect(content).toContain('integration/nestjs-typeorm-frontend');
  });

  it('nunca lê/usa backend/.env como fonte de configuração (comentário explicando que não usa é permitido)', () => {
    expect(content).not.toMatch(/env-file:/);
    expect(content).not.toMatch(/(cat|source|\.)\s+.*backend\/\.env\b/);
    expect(content).not.toMatch(/dotenv/i);
  });

  it('nenhum secret hardcoded — só via ${{ secrets.* }} ou ${{ vars.* }}, nunca um valor literal parecido com connection string', () => {
    expect(content).not.toMatch(/postgres(?:ql)?:\/\//i);
    expect(content).not.toMatch(/ep-[a-z0-9-]+\.[a-z0-9.-]*neon\.tech/i);
  });

  it('cada um dos cinco secrets é referenciado via ${{ secrets.* }}', () => {
    for (const name of [
      'L6B2_PRODUCTION_DIRECT_URL',
      'L6B2_BACKUP_DIRECT_URL',
      'L6B2_PRODUCTION_ENDPOINT_ID',
      'L6B2_BACKUP_ENDPOINT_ID',
      'L6B2_VALIDATION_ENDPOINT_ID',
    ]) {
      expect(content).toContain(`secrets.${name}`);
    }
  });

  it('nunca usa --force ou --legacy-peer-deps no npm ci', () => {
    expect(content).not.toMatch(/npm ci.*(--force|--legacy-peer-deps)/);
  });

  it('nunca habilita set -x nem eco de env/secrets', () => {
    expect(content).not.toMatch(/set -x/);
    expect(content).not.toMatch(/\benv\s*$/m);
    expect(content).not.toMatch(/printenv/);
  });

  it('nunca publica artifact', () => {
    expect(content).not.toMatch(/upload-artifact/);
  });

  it('roda npm ci dentro de backend/', () => {
    expect(content).toMatch(/working-directory:\s*backend/);
    expect(content).toContain('npm ci');
  });

  it('actions/checkout e actions/setup-node fixadas por SHA completo de 40 caracteres, nunca por tag móvel', () => {
    const usesLines = content.match(/uses:\s*\S+/g) ?? [];
    expect(usesLines.length).toBeGreaterThan(0);
    for (const line of usesLines) {
      expect(line).toMatch(/uses:\s*actions\/(checkout|setup-node)@[0-9a-f]{40}/);
      expect(line).not.toMatch(/@v\d/);
      expect(line).not.toMatch(/@main\b/);
    }
  });

  it('nenhuma Action de terceiro — só actions/checkout e actions/setup-node', () => {
    const usesLines = content.match(/uses:\s*(\S+)/g) ?? [];
    for (const line of usesLines) {
      expect(line).toMatch(/^uses:\s*actions\/(checkout|setup-node)@/);
    }
  });

  it('runner é GitHub-hosted (ubuntu-latest), nunca self-hosted', () => {
    expect(content).toMatch(/runs-on:\s*ubuntu-latest/);
    expect(content).not.toMatch(/self-hosted/);
  });

  it('nenhum cache configurado no setup-node nem via actions/cache', () => {
    expect(content).not.toMatch(/actions\/cache/);
    expect(content).not.toMatch(/cache:\s*['"]?npm['"]?/);
  });

  it('checkout usa o SHA exato do disparo (github.sha), nunca ref por input arbitrário', () => {
    expect(content).toMatch(/ref:\s*\$\{\{\s*github\.sha\s*\}\}/);
    expect(content).not.toMatch(/inputs\.ref/);
  });

  it('confirmation e ref_name nunca interpolados direto dentro de um bloco run — sempre via env intermediária', () => {
    const runBlocks = content.match(/run:\s*\|[\s\S]*?(?=\n\s{6}-\s|\n\s{4}-\s(?!\s)|$)/g) ?? [];
    for (const block of runBlocks) {
      expect(block).not.toMatch(/\$\{\{\s*inputs\.confirmation\s*\}\}/);
      expect(block).not.toMatch(/\$\{\{\s*github\.ref_name\s*\}\}/);
    }
    expect(content).toContain('CONFIRMATION_INPUT: ${{ inputs.confirmation }}');
    expect(content).toContain('CURRENT_REF_NAME: ${{ github.ref_name }}');
  });
});
