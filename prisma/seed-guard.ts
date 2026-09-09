// Guarda de execução do seed legado do Prisma (Lote 6B.2 — freeze: TypeORM é
// a fonte oficial do backend novo, Prisma fica só para testes/compatibilidade
// legada, ver docs/plans/fundacao-postgresql.md). Precisa rodar ANTES de
// qualquer leitura de DATABASE_URL/DIRECT_URL e antes de criar qualquer
// adapter/client — este módulo, de propósito, não lê nenhuma das duas.
//
// Confirmação exigida via ARGUMENTO DE LINHA DE COMANDO, nunca só uma
// variável de ambiente: uma env var pode ficar esquecida num `.env` local e
// autorizar uma execução acidental meses depois; um argumento explícito em
// `tsx prisma/seed.ts --confirm-legacy-seed` exige que alguém digite o
// comando de propósito, sempre.
export const CONFIRM_LEGACY_SEED_FLAG = "--confirm-legacy-seed";

export class LegacySeedNotConfirmedError extends Error {
  constructor() {
    super(
      `Seed legado do Prisma está congelado — TypeORM é a fonte oficial do backend novo ` +
        `(ver docs/plans/fundacao-postgresql.md). Este seed só continua existindo para a suíte ` +
        `de testes de banco legada (prisma/*.db.test.ts). Para rodar mesmo assim, de propósito, ` +
        `execute: tsx prisma/seed.ts ${CONFIRM_LEGACY_SEED_FLAG}`,
    );
    this.name = "LegacySeedNotConfirmedError";
  }
}

/** Lança antes de qualquer conexão/escrita se a flag de confirmação não veio
 * explicitamente na linha de comando. Nunca lê DATABASE_URL/DIRECT_URL. */
export function assertLegacySeedConfirmed(argv: readonly string[] = process.argv): void {
  if (!argv.includes(CONFIRM_LEGACY_SEED_FLAG)) {
    throw new LegacySeedNotConfirmedError();
  }
}
