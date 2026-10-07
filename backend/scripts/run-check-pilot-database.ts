// Ponto de entrada da conferência do banco do piloto — o único arquivo aqui
// que toca `process.env`, stdout e exit code (a lógica em
// lib/pilot-database-check.ts recebe tudo injetado). Só leitura. Ver
// docs/runbooks/publicacao-piloto-render.md, seção 4.
import { checkPilotDatabase } from './lib/pilot-database-check.js';
import { createPgClient } from './lib/pg-client.js';

async function main(): Promise<void> {
  const result = await checkPilotDatabase({
    env: process.env,
    createClient: createPgClient,
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
