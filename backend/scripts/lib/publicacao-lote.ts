// Contrato comum de um lote de migrations publicado no piloto pelos scripts
// aplicar-equipe-piloto.mjs e conferir-restauracao-equipe.mjs (escolhido por
// `--lote`). Cada lote implementa só o que é dele: a conferência do schema
// ANTES e DEPOIS, um levantamento só-leitura que precisa ser igual antes e
// depois da migration numa cópia, a conferência de que as colunas e tabelas
// novas nasceram vazias e o que um `migration:revert` afetaria.
//
// Tudo só leitura: cada função abre `BEGIN TRANSACTION READ ONLY` e termina em
// `ROLLBACK` (ou chama funções que fazem isso).
import type { PgClientLike } from './pg-client.js';

export interface LevantamentoDoLote {
  /** Linhas para o operador: só contagens e identificadores, nunca nomes. */
  linhas: string[];
  /** Comparado como JSON entre a cópia antes e depois da migration. */
  comparavel: unknown;
}

export interface PublicacaoDoLote {
  /** Histórico exato que o banco precisa ter antes. */
  migrationsAntes: readonly string[];
  /** Migrations aplicadas pelo lote, na ordem, numa única transação. */
  pendentes: readonly string[];
  falhasAntes(client: PgClientLike): Promise<string[]>;
  falhasDepois(client: PgClientLike): Promise<string[]>;
  levantamento(client: PgClientLike): Promise<LevantamentoDoLote>;
  /** Logo depois da migration numa cópia: nenhum dado novo nasceu sozinho. */
  novosVazios(client: PgClientLike): Promise<{ linhas: string[]; ok: boolean }>;
  /** Em `after`: o que `migration:revert` apagaria ou deixaria de valer. */
  reversao(client: PgClientLike): Promise<string[]>;
}

/** Roda `ler` numa transação só-leitura, sempre com ROLLBACK no fim. */
export async function somenteLeitura<T>(client: PgClientLike, ler: () => Promise<T>): Promise<T> {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    return await ler();
  } finally {
    await client.query('ROLLBACK');
  }
}
