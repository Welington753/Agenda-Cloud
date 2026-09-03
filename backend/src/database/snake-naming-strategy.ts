// Estratégia de nomenclatura: propriedades TypeScript em camelCase (ex.:
// `tenantId`), colunas físicas em snake_case (ex.: `tenant_id`) — convenção
// exigida no Lote 3 (ver docs/plans/migracao-nestjs-typeorm-neon.md, seção
// "Regras de índices e identificadores"). `typeorm-naming-strategies` (pacote
// de terceiros mais usado para isto) só declara suporte a TypeORM 0.2/0.3
// como peer dependency — incompatível com o `typeorm@^1` já instalado (Lote
// 2) — por isso esta implementação própria, mínima, em vez de forçar uma
// dependência não mantida para essa versão.

import { DefaultNamingStrategy, type NamingStrategyInterface } from 'typeorm';

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
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
}
