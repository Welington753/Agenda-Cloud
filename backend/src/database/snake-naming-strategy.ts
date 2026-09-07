// Estratégia de nomenclatura: propriedades TypeScript em camelCase (ex.:
// `tenantId`), colunas físicas em snake_case (ex.: `tenant_id`) — convenção
// exigida no Lote 3 (ver docs/plans/migracao-nestjs-typeorm-neon.md, seção
// "Regras de índices e identificadores"). `typeorm-naming-strategies` (pacote
// de terceiros mais usado para isto) só declara suporte a TypeORM 0.2/0.3
// como peer dependency — incompatível com o `typeorm@^1` já instalado (Lote
// 2) — por isso esta implementação própria, mínima, em vez de forçar uma
// dependência não mantida para essa versão.

import { createHash } from 'node:crypto';
import { DefaultNamingStrategy, type NamingStrategyInterface, type Table } from 'typeorm';

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

// Limite real do Postgres é 63 bytes (NAMEDATALEN - 1); usamos 63 caracteres
// como proxy (nomes gerados aqui são sempre ASCII).
const POSTGRES_IDENTIFIER_MAX_LENGTH = 63;

// `uq_<tabela>_<colunas>` — mesmo padrão legível usado nos nomes explícitos
// da migration (ver 1788782400000-InitialSchema.ts) para a UNIQUE CONSTRAINT
// que o TypeORM gera automaticamente no lado dono de um `@OneToOne` (ver
// RelationJoinColumnBuilder.build em node_modules/typeorm). Sem este
// override, o nome seria `UQ_<hash>` (DefaultNamingStrategy.relationConstraintName),
// divergindo do nome estável já usado no resto do schema. Faz fallback para
// hash só se o nome montado estourar o limite de identificador do Postgres —
// nenhuma das 4 relações atuais (booking_policies/brand_identities/credentials/
// public_settings, todas de coluna única `tenant_id`/`user_id`) chega perto disso.
function stableUniqueConstraintName(tableName: string, columnNames: string[]): string {
  const name = `uq_${tableName}_${columnNames.map(toSnakeCase).join('_')}`;
  if (name.length <= POSTGRES_IDENTIFIER_MAX_LENGTH) return name;
  const digest = createHash('sha1').update(name).digest('hex').slice(0, 8);
  return `${name.slice(0, POSTGRES_IDENTIFIER_MAX_LENGTH - digest.length - 1)}_${digest}`;
}

export class SnakeNamingStrategy
  extends DefaultNamingStrategy
  implements NamingStrategyInterface
{
  // Não delega a `super.columnName` — a assinatura concreta de
  // `DefaultNamingStrategy` exige `customName: string` (não opcional), mas o
  // TypeORM chama esta estratégia com `customName` possivelmente `undefined`
  // (quando nenhum `{ name: '...' }` foi passado no decorator), conforme a
  // própria `NamingStrategyInterface`.
  override columnName(
    propertyName: string,
    customName: string | undefined,
    embeddedPrefixes: string[],
  ): string {
    if (customName) return customName;
    const prefixed = embeddedPrefixes.length
      ? `${embeddedPrefixes.join('_')}_${propertyName}`
      : propertyName;
    return toSnakeCase(prefixed);
  }

  override relationName(propertyName: string): string {
    return toSnakeCase(propertyName);
  }

  override joinColumnName(
    relationName: string,
    referencedColumnName: string,
  ): string {
    return toSnakeCase(`${relationName}_${referencedColumnName}`);
  }

  override relationConstraintName(
    tableOrName: Table | string,
    columnNames: string[],
  ): string {
    const tableName = typeof tableOrName === 'string' ? tableOrName : tableOrName.name;
    return stableUniqueConstraintName(tableName, columnNames);
  }
}
