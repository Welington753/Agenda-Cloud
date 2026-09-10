// Interface mínima de cliente Postgres usada pelos scripts de migration
// guardada — só o subconjunto de `pg.Client` que `baseline-checks.ts`
// precisa. Injetável: testes usam um fake que nunca abre socket nenhum (ver
// baseline-checks.spec.ts); só `createPgClient` (não coberta por teste
// unitário — abriria conexão real) constrói um cliente de verdade.
export interface PgQueryResult<T> {
  rows: T[];
}

export interface PgClientLike {
  connect(): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<PgQueryResult<T>>;
  end(): Promise<void>;
}

/** Cria um cliente Postgres real (`pg`) para a URL direta dada — nunca
 * chamado em teste (abriria conexão de verdade). `ssl: { rejectUnauthorized:
 * true }` mesma configuração de `runtime-data-source.ts`/
 * `migrations-data-source.ts` — nunca desabilitar verificação de
 * certificado, nem aqui nem lá. */
export async function createPgClient(connectionString: string): Promise<PgClientLike> {
  const { Client } = await import('pg');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: true },
  });
  return client as unknown as PgClientLike;
}
