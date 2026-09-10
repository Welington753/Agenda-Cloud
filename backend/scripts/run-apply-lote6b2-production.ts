// Ponto de entrada de linha de comando — o único arquivo aqui que toca
// `process.env`/stdout/exit code de verdade. `apply-lote6b2-production.ts`
// (a lógica em si) nunca lê `process.env` diretamente nem chama
// `process.exit` — só recebe tudo injetado, o que é o que a torna testável
// sem processo/rede reais (ver apply-lote6b2-production.spec.ts). Nunca
// chamado a partir de teste algum.
import { applyLote6b2Production } from './apply-lote6b2-production.js';
import { createPgClient } from './lib/pg-client.js';
import { createChildProcessRunner } from './lib/process-runner.js';

async function main(): Promise<void> {
  const result = await applyLote6b2Production({
    env: process.env,
    confirmation: process.env.CONFIRMATION,
    currentBranch: process.env.GITHUB_REF_NAME,
    createClient: createPgClient,
    processRunner: createChildProcessRunner(),
    // Único ponto de saída real — sempre uma linha `CODIGO: valor`, nunca
    // JSON.stringify de um objeto que possa carregar segredo por engano.
    log: (line: string) => {
      console.log(line);
    },
  });

  console.log(`RESULT: ${result.success ? 'SUCCESS' : 'FAILURE'}`);
  if (result.code) {
    console.log(`CODE: ${result.code}`);
  }
  process.exit(result.success ? 0 : 1);
}

await main();
