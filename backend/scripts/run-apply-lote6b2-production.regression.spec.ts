// Regressão do runner REAL do workflow (Lote 6B.9) — motivada por uma
// execução real que falhou antes de emitir qualquer `CODE: ERR_...`
// (`node --loader ts-node/esm` crashou com `[Object: null prototype]` no
// runner Ubuntu do GitHub Actions, mesmo funcionando localmente: o loader
// experimental do ts-node não acompanha as mudanças nos module customization
// hooks do Node, e o workflow usava `node-version: 24` sem pin de patch).
//
// Este teste executa o comando NPM de verdade (`migrate:production:guarded`,
// lido do próprio `package.json` — nunca hardcoded aqui, pra nunca divergir
// silenciosamente do que o workflow chama) como subprocesso real, com um
// ambiente explicitamente sanitizado: nenhum `DIRECT_URL`, `DATABASE_URL`,
// `L6B2_*` ou `.env` — só o mínimo de variáveis de sistema (`PATH`,
// `SystemRoot`, etc.) necessário pro Node/npm rodarem. Nunca herda
// `process.env` inteiro.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.join(moduleDir, '..');
const workflowPath = path.join(backendDir, '../.github/workflows/apply-lote6b2-production.yml');

const packageJson = JSON.parse(readFileSync(path.join(backendDir, 'package.json'), 'utf-8')) as {
  scripts: Record<string, string>;
};

// Só variáveis de sistema indispensáveis pro Node/npm iniciarem em Windows e
// Linux — nunca `DIRECT_URL`/`DATABASE_URL`/`CONFIRMATION`/`L6B2_*`, mesmo
// que alguma delas por acaso batesse com este allow-list (não bate).
const ALLOWED_SYSTEM_ENV_KEYS = new Set([
  'PATH',
  'SYSTEMROOT',
  'WINDIR',
  'TEMP',
  'TMP',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'COMSPEC',
  'PATHEXT',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'HOME',
  'TMPDIR',
  'LANG',
  'USER',
  'SHELL',
]);

function buildSanitizedChildEnv(): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    if (upper.startsWith('L6B2_')) continue;
    if (upper === 'DIRECT_URL' || upper === 'DATABASE_URL' || upper === 'CONFIRMATION') continue;
    if (ALLOWED_SYSTEM_ENV_KEYS.has(upper)) sanitized[key] = value;
  }
  return sanitized;
}

// No Windows `npm` é um `.cmd`, que o Node não consegue executar direto
// (`shell: false` dá `spawn EINVAL`) — precisa de `shell: true`. O aviso
// DEP0190 do Node é sobre combinar `shell: true` com um array de `args` não
// escapado; aqui não há array de args nenhum — `scriptName` é um literal
// fixo do próprio código-fonte (nunca dado externo), interpolado numa única
// string de comando, então não há string pra escapar nem superfície de
// injeção.
function runNpmScript(scriptName: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(`npm run ${scriptName}`, {
      cwd: backendDir,
      env: buildSanitizedChildEnv(),
      shell: true,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('runner real de migrate:production:guarded (regressão)', () => {
  it('@types/pg declarado direto no backend — nunca depender de node_modules herdado da raiz', () => {
    // `pg` (usado em `scripts/lib/pg-client.ts`) não vem com tipos próprios;
    // sem `@types/pg` como devDependency DIRETA do backend, `tsc
    // -p tsconfig.scripts.json` só passa por acidente quando roda de dentro
    // do monorepo completo (a resolução de módulo sobe a árvore e acha
    // `@types/pg` no node_modules da raiz) — um checkout isolado do backend
    // (like o runner do CI antes de rodar `npm ci` na raiz) falha com
    // TS7016. Ver commit que introduziu este teste para o incidente real.
    const dependenciesHavePg = Boolean(
      (packageJson as unknown as { dependencies?: Record<string, string> }).dependencies?.pg,
    );
    expect(dependenciesHavePg).toBe(true);
    const devDependencies = (packageJson as unknown as { devDependencies?: Record<string, string> })
      .devDependencies;
    expect(devDependencies?.['@types/pg']).toBeDefined();
  });

  it('workflow e package.json usam exatamente o mesmo comando — sem runner divergente', () => {
    const workflowContent = readFileSync(workflowPath, 'utf-8');
    expect(workflowContent).toContain('run: npm run migrate:production:guarded');
    expect(packageJson.scripts['migrate:production:guarded']).toBeDefined();
    // Nunca mais o loader experimental que causou o crash.
    expect(packageJson.scripts['migrate:production:guarded']).not.toContain('--loader');
    expect(packageJson.scripts['migrate:production:guarded']).not.toContain('ts-node/esm');
  });

  it(
    'entrypoint real carrega, nunca crasha com objeto opaco, e falha de forma controlada sem secrets/.env',
    async () => {
      const { code, stdout, stderr } = await runNpmScript('migrate:production:guarded');
      const combined = `${stdout}\n${stderr}`;

      // Nunca mais o crash relatado: Node imprime "[Object: null prototype]"
      // quando algo rejeita/lança um valor que não é um Error de verdade —
      // era exatamente isso que o loader experimental produzia.
      expect(combined).not.toContain('Object: null prototype');
      expect(combined).not.toContain('triggerUncaughtException');
      expect(combined).not.toContain('ExperimentalWarning');

      // Chegou ao orquestrador protegido e produziu um código sanitizado —
      // sem CONFIRMATION no ambiente, para exatamente na primeira guarda,
      // antes de qualquer secret, cliente Postgres ou subprocesso TypeORM.
      expect(stdout).toMatch(/^CODE: ERR_CONFIRMATION_MISMATCH$/m);
      expect(stdout).toMatch(/^RESULT: FAILURE$/m);
      expect(code).toBe(1);

      // Nenhum subprocesso de migration chegou a rodar (a guarda de
      // confirmação para antes disso) — nem rastro de log de baseline ou
      // dos comandos do TypeORM CLI na saída.
      expect(combined).not.toContain('BASELINE_');
      expect(combined).not.toContain('MIGRATION_RUN');
      expect(combined).not.toContain('migration:show');
      expect(combined).not.toContain('migration:run');

      // Nenhuma informação sensível — mesmo não havendo secret nenhum no
      // ambiente, confirma que nada parecido com connection string vaza.
      expect(combined).not.toMatch(/postgres(?:ql)?:\/\//i);
      expect(combined).not.toMatch(/\.neon\.tech/i);
      expect(combined).not.toMatch(/\bep-[a-z0-9-]+\b/i);
    },
    60_000,
  );
});
