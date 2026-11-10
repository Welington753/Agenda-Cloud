// Ponto de entrada da conferência de colisões de slug reservado no piloto —
// o único arquivo aqui que toca `process.env`, stdout e exit code (a lógica
// em lib/slugs-reservados-check.ts recebe tudo injetado). Só leitura; nunca
// renomeia. Ver docs/runbooks/publicacao-tenant-teste-slugs.md.
import { checkReservedSlugCollisions } from './lib/slugs-reservados-check.js';
import { createPgClient } from './lib/pg-client.js';

async function main(): Promise<void> {
  const result = await checkReservedSlugCollisions({
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
