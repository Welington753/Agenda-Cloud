// Decide se o backend deve IGNORAR completamente o `.env` do diretório de
// trabalho, nunca lendo-o do disco — em vez de confiar só em variáveis já
// presentes em `process.env` no momento em que o processo foi iniciado.
//
// POR QUE ISTO EXISTE: `ConfigModule.forRoot` (ver config.module.ts) por
// padrão resolve `.env` a partir de `process.cwd()` e o lê incondicionalmente
// (ver node_modules/@nestjs/config/dist/config.module.js, `loadEnvFile`).
// Quando `backend/.env` aponta para infraestrutura real (não descartável),
// isso torna arriscado até mesmo LIGAR o backend localmente sem querer
// carregar esse arquivo — não há como "ler só uma parte" dele.
//
// Padrão é `false`: comportamento IDÊNTICO a antes desta função existir,
// carrega `.env` do cwd como sempre. Só vira `true` com o opt-in EXPLÍCITO
// abaixo, nunca por dedução de `NODE_ENV` ou de qualquer variável já usada
// para outra finalidade — `NODE_ENV=development` sozinho nunca ativa isto,
// porque é exatamente o valor padrão que a aplicação já assume hoje.
//
// Pura e testável sem Nest: recebe o objeto de ambiente em vez de ler
// `process.env` diretamente (mesma disciplina de env.validation.ts).
const OPT_IN_VALUE = 'true';

export function shouldIgnoreEnvFile(env: NodeJS.ProcessEnv): boolean {
  return env.IGNORE_DOTENV_FILE === OPT_IN_VALUE;
}
