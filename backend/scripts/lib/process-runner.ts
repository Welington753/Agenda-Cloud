// Executor de processo injetável — usado para chamar `npm run migration:run`
// / `migration:show` / `schema:log` como subprocesso. `shell: false` sempre
// (nunca interpreta a string como shell — evita injeção via variável de
// ambiente/argumento, e é o motivo de não haver `set -x` nem eco de shell
// em lugar nenhum). Injetável: `apply-lote6b2-production.ts` recebe um
// `ProcessRunner` no construtor/args, nunca chama `child_process` direto —
// testes usam um fake que nunca inicia processo nenhum (ver
// apply-lote6b2-production.spec.ts).
import { spawn } from 'node:child_process';

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface ProcessRunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ProcessRunner {
  run(command: string, args: string[], options?: ProcessRunOptions): Promise<ProcessResult>;
}

/** Implementação real, baseada em `child_process.spawn` — nunca coberta por
 * teste unitário (iniciaria um processo de verdade); só o comportamento de
 * `apply-lote6b2-production.ts` em torno de um `ProcessRunner` injetado é
 * testado. */
export function createChildProcessRunner(): ProcessRunner {
  return {
    run(command, args, options) {
      return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
          cwd: options?.cwd,
          env: options?.env,
          shell: false,
        });

        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, stdout, stderr }));
      });
    },
  };
}
