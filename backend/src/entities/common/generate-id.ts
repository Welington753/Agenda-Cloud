// Gerador de identificador compartilhado por toda entidade — mesmo formato de
// string curta já adotado pelo projeto (Prisma usa `@default(cuid())`; aqui a
// geração é do lado da aplicação via `@BeforeInsert()` em cada entidade,
// porque `cuid()` não é uma função nativa do Postgres). Não é um arquivo
// `*.entity.ts` — não conta na contagem de entidades do Lote 3.

import { createId } from '@paralleldrive/cuid2';

export function generateId(): string {
  return createId();
}
