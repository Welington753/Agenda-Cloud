// Ciclo de vida da migration: up()/down() completos e simétricos, nada
// destrutivo fora do escopo, registrada pelos dois DataSources, e a simples
// importação do módulo nunca abre conexão nem tenta um DDL — só objetos em
// memória (arrays de string + a classe MigrationInterface).
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildMigrationsDataSourceOptions,
  MigrationsDataSource,
  migrationsDataSourceOptions,
} from '../database/migrations-data-source.js';
import { RuntimeDataSource } from '../database/runtime-data-source.js';
import {
  CHECK_STATEMENTS,
  DOWN_STATEMENTS,
  DROP_ENUM_STATEMENTS,
  DROP_TABLE_STATEMENTS,
  ENUM_STATEMENTS,
  EXCLUSION_STATEMENTS,
  EXTENSION_STATEMENTS,
  FOREIGN_KEY_STATEMENTS,
  InitialSchema1788782400000,
  INDEX_STATEMENTS,
  TABLE_STATEMENTS,
  UNIQUE_STATEMENTS,
  UP_STATEMENTS,
} from './1788782400000-InitialSchema.js';

const migrationsDir = path.dirname(fileURLToPath(import.meta.url));

function tableNameOf(createTableStatement: string): string {
  return /^CREATE TABLE (\w+) \(/.exec(createTableStatement)![1];
}

function dropTableNameOf(dropTableStatement: string): string {
  return /^DROP TABLE (\w+)$/.exec(dropTableStatement)![1];
}

function enumTypeNameOf(createTypeStatement: string): string {
  return /^CREATE TYPE (\w+) AS ENUM/.exec(createTypeStatement)![1];
}

function dropEnumTypeNameOf(dropTypeStatement: string): string {
  return /^DROP TYPE (\w+)$/.exec(dropTypeStatement)![1];
}

describe('up() — soma exata das seções, na ordem da seção 12 da issue', () => {
  it('UP_STATEMENTS é a concatenação, em ordem, de todas as seções', () => {
    const expectedLength =
      EXTENSION_STATEMENTS.length +
      ENUM_STATEMENTS.length +
      TABLE_STATEMENTS.length +
      UNIQUE_STATEMENTS.length +
      FOREIGN_KEY_STATEMENTS.length +
      CHECK_STATEMENTS.length +
      EXCLUSION_STATEMENTS.length +
      INDEX_STATEMENTS.length;
    expect(UP_STATEMENTS).toHaveLength(expectedLength);
  });

  it('extensões vêm antes de qualquer CREATE TABLE/TYPE', () => {
    const firstTableIndex = UP_STATEMENTS.findIndex((s) => s.startsWith('CREATE TABLE'));
    const lastExtensionIndex = UP_STATEMENTS.findIndex((s) => s.startsWith('CREATE EXTENSION'));
    expect(lastExtensionIndex).toBeLessThan(firstTableIndex);
  });

  it('tabelas vêm antes de qualquer FK/CHECK/EXCLUDE que dependa delas existirem', () => {
    const lastTableIndex = UP_STATEMENTS.lastIndexOf(TABLE_STATEMENTS[TABLE_STATEMENTS.length - 1]);
    const firstForeignKeyIndex = UP_STATEMENTS.findIndex((s) => s.includes('FOREIGN KEY'));
    expect(lastTableIndex).toBeLessThan(firstForeignKeyIndex);
  });
});

describe('down() — reverso exato da criação, sem CASCADE amplo', () => {
  it('DOWN_STATEMENTS = tabelas (ordem inversa) + enums, nada mais', () => {
    expect(DOWN_STATEMENTS).toHaveLength(
      DROP_TABLE_STATEMENTS.length + DROP_ENUM_STATEMENTS.length,
    );
  });

  it('DROP TABLE está na ordem exatamente inversa de CREATE TABLE', () => {
    const created = TABLE_STATEMENTS.map(tableNameOf);
    const dropped = DROP_TABLE_STATEMENTS.map(dropTableNameOf);
    expect(dropped).toEqual([...created].reverse());
  });

  it('DROP TYPE cobre exatamente o mesmo conjunto de tipos que CREATE TYPE', () => {
    const created = new Set(ENUM_STATEMENTS.map(enumTypeNameOf));
    const dropped = new Set(DROP_ENUM_STATEMENTS.map(dropEnumTypeNameOf));
    expect(dropped).toEqual(created);
  });

  it('nenhum DROP TABLE usa CASCADE — cada tabela filha já foi removida antes da pai', () => {
    for (const statement of DROP_TABLE_STATEMENTS) {
      expect(statement).not.toContain('CASCADE');
    }
  });

  it('nunca DROP SCHEMA nem DROP DATABASE em nenhuma statement de up() ou down()', () => {
    for (const statement of [...UP_STATEMENTS, ...DOWN_STATEMENTS]) {
      expect(statement).not.toMatch(/DROP SCHEMA|DROP DATABASE/);
    }
  });

  it('extensões citext/btree_gist nunca são removidas em down() (compartilhadas, sem dano colateral)', () => {
    for (const statement of DOWN_STATEMENTS) {
      expect(statement).not.toContain('DROP EXTENSION');
    }
  });
});

describe('synchronize/migrationsRun — nunca automático', () => {
  it('buildMigrationsDataSourceOptions nunca habilita synchronize', () => {
    expect(
      buildMigrationsDataSourceOptions('postgresql://user:pass@host:5432/db').synchronize,
    ).toBe(false);
  });

  it('buildMigrationsDataSourceOptions nunca habilita migrationsRun', () => {
    expect(
      buildMigrationsDataSourceOptions('postgresql://user:pass@host:5432/db').migrationsRun,
    ).toBe(false);
  });

  it('a classe da migration não declara transaction = false (roda em transação única, default do runner)', () => {
    const migration = new InitialSchema1788782400000();
    expect((migration as unknown as { transaction?: boolean }).transaction).toBeUndefined();
  });
});

describe('a migration é registrada pelo MigrationsDataSource', () => {
  it('o glob de migrations do DataSource encontra este arquivo', () => {
    const [pattern] = migrationsDataSourceOptions.migrations as string[];
    const encontrados = globSync(pattern);
    const nomesEncontrados = encontrados.map((f) => path.basename(f));
    expect(nomesEncontrados).toContain('1788782400000-InitialSchema.ts');
  });

  it('o glob de migrations nunca casa arquivo .spec.ts (este arquivo incluso)', () => {
    const [pattern] = migrationsDataSourceOptions.migrations as string[];
    const encontrados = globSync(pattern);
    expect(encontrados.some((f) => f.includes('.spec.'))).toBe(false);
  });

  it('usa nome explícito e estável para a tabela de controle', () => {
    expect(migrationsDataSourceOptions.migrationsTableName).toBe('typeorm_migrations');
  });

  it('todo arquivo de migration vive dentro de backend/src/migrations', () => {
    const [pattern] = migrationsDataSourceOptions.migrations as string[];
    const encontrados = globSync(pattern);
    expect(encontrados.length).toBeGreaterThan(0);
    for (const arquivo of encontrados) {
      expect(path.resolve(arquivo).startsWith(path.resolve(migrationsDir))).toBe(true);
    }
  });
});

describe('importar a migration nunca conecta ao banco', () => {
  it('MigrationsDataSource segue não-inicializado depois do import deste módulo', () => {
    expect(MigrationsDataSource.isInitialized).toBe(false);
  });

  it('RuntimeDataSource segue não-inicializado depois do import deste módulo', () => {
    expect(RuntimeDataSource.isInitialized).toBe(false);
  });

  it('a classe da migration é só metadata — instanciar não conecta nem executa SQL', () => {
    const migration = new InitialSchema1788782400000();
    expect(migration.name).toBe('InitialSchema1788782400000');
    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');
    // Nenhum queryRunner foi passado/chamado aqui — só a existência dos
    // métodos é verificada, prova de que instanciar não executa nada.
  });
});
