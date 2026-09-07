// Contrato estrutural da migration inicial — sem banco real. Toda asserção
// lê os arrays de SQL exportados por 1788782400000-InitialSchema.ts como
// string, nunca executa uma query nem abre conexão (ver
// initial-schema-lifecycle.spec.ts para a prova disso).
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ENUM_STATEMENTS,
  EXTENSION_STATEMENTS,
  TABLE_STATEMENTS,
} from './1788782400000-InitialSchema.js';

const entitiesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../entities',
);

function tableNameOf(createTableStatement: string): string {
  const match = /^CREATE TABLE (\w+) \(/.exec(createTableStatement);
  if (!match) throw new Error(`Não achou nome de tabela em: ${createTableStatement.slice(0, 40)}`);
  return match[1];
}

function enumTypeNameOf(createTypeStatement: string): string {
  const match = /^CREATE TYPE (\w+) AS ENUM/.exec(createTypeStatement);
  if (!match) throw new Error(`Não achou nome de enum em: ${createTypeStatement.slice(0, 40)}`);
  return match[1];
}

// Extrai o primeiro identificador de cada linha "de coluna" dentro de um
// CREATE TABLE (ignora a linha de abertura e a de PRIMARY KEY/CONSTRAINT).
function columnIdentifiersOf(createTableStatement: string): string[] {
  const lines = createTableStatement.split('\n').slice(1, -1);
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('CONSTRAINT'))
    .map((line) => /^(\w+)/.exec(line)?.[1])
    .filter((id): id is string => Boolean(id));
}

describe('migration inicial — extensões', () => {
  it('instala citext e btree_gist, e só essas duas', () => {
    expect(EXTENSION_STATEMENTS).toHaveLength(2);
    expect(EXTENSION_STATEMENTS).toContain('CREATE EXTENSION IF NOT EXISTS citext');
    expect(EXTENSION_STATEMENTS).toContain('CREATE EXTENSION IF NOT EXISTS btree_gist');
  });

  it('usa sempre IF NOT EXISTS (nunca falha se a extensão já existir)', () => {
    for (const statement of EXTENSION_STATEMENTS) {
      expect(statement).toContain('IF NOT EXISTS');
    }
  });
});

describe('migration inicial — 30 tabelas', () => {
  it('cria exatamente 30 tabelas', () => {
    expect(TABLE_STATEMENTS).toHaveLength(30);
  });

  it('nenhum nome de tabela duplicado', () => {
    const names = TABLE_STATEMENTS.map(tableNameOf);
    expect(new Set(names).size).toBe(names.length);
  });

  it('todo nome de tabela é snake_case (minúsculo, nunca camelCase)', () => {
    for (const statement of TABLE_STATEMENTS) {
      const name = tableNameOf(statement);
      expect(name).toBe(name.toLowerCase());
      expect(name).not.toMatch(/[A-Z]/);
    }
  });

  it('toda coluna declarada é snake_case (minúscula, nunca camelCase)', () => {
    for (const statement of TABLE_STATEMENTS) {
      const columns = columnIdentifiersOf(statement);
      expect(columns.length).toBeGreaterThan(0);
      for (const column of columns) {
        expect(column).toBe(column.toLowerCase());
      }
    }
  });

  it('toda tabela declara PRIMARY KEY (id)', () => {
    for (const statement of TABLE_STATEMENTS) {
      const name = tableNameOf(statement);
      expect(statement).toContain(`CONSTRAINT pk_${name} PRIMARY KEY (id)`);
    }
  });

  it('as 30 tabelas do mapeamento da issue estão todas presentes', () => {
    const expected = [
      'plans', 'features', 'users', 'plan_features', 'tenants', 'credentials',
      'sessions', 'brand_identities', 'booking_policies', 'public_settings',
      'tenant_feature_overrides', 'units', 'professionals', 'services',
      'consumers', 'resources', 'memberships', 'membership_permission_overrides',
      'invites', 'support_sessions', 'audit_logs', 'professional_schedules',
      'professional_services', 'time_blocks', 'appointments', 'appointment_items',
      'appointment_resources', 'appointment_status_changes', 'commission_rules',
      'commission_entries',
    ];
    const actual = TABLE_STATEMENTS.map(tableNameOf);
    expect(actual.sort()).toEqual(expected.sort());
  });
});

describe('migration inicial — 18 enums', () => {
  it('cria exatamente 18 tipos enum', () => {
    expect(ENUM_STATEMENTS).toHaveLength(18);
  });

  it('nenhum enum duplicado', () => {
    const names = ENUM_STATEMENTS.map(enumTypeNameOf);
    expect(new Set(names).size).toBe(names.length);
  });

  it('todo nome de enum é snake_case, nunca camelCase/PascalCase', () => {
    for (const statement of ENUM_STATEMENTS) {
      const name = enumTypeNameOf(statement);
      expect(name).toBe(name.toLowerCase());
    }
  });

  it('os 18 enums esperados pelo mapeamento da issue estão todos presentes', () => {
    const expected = [
      'platform_role', 'platform_permission', 'user_status', 'tenant_status',
      'business_category', 'page_template', 'feature_key', 'establishment_role',
      'permission', 'permission_mode', 'invite_type', 'invite_status',
      'audit_action', 'resource_type', 'service_modality', 'appointment_status',
      'commission_type', 'commission_entry_status',
    ];
    const actual = ENUM_STATEMENTS.map(enumTypeNameOf);
    expect(actual.sort()).toEqual(expected.sort());
  });

  it('valores de enum são sempre SCREAMING_SNAKE_CASE entre aspas simples', () => {
    for (const statement of ENUM_STATEMENTS) {
      const valuesMatch = /AS ENUM \(([^)]+)\)/.exec(statement);
      expect(valuesMatch).not.toBeNull();
      const values = valuesMatch![1].split(',').map((v) => v.trim());
      for (const value of values) {
        expect(value).toMatch(/^'[A-Z][A-Z0-9_]*'$/);
      }
    }
  });
});

// `enumName` explícito nas entidades (contra-diff da seção 1 desta rodada) —
// sem esse campo, o TypeORM derivaria um nome de tipo por coluna
// (`<tabela>_<coluna>_enum`) e um `migration:generate` futuro detectaria "tipo
// renomeado" para cada coluna que reaproveita um enum entre tabelas. Leitura
// de arquivo puro (regex), nunca instancia entidade — mesmo estilo de
// entity-discovery.spec.ts, sem exigir DataSource nem reflect-metadata.
describe('enumName das entidades — idêntico ao CREATE TYPE da migration', () => {
  const entityFiles = globSync(path.join(entitiesDir, '**/*.entity.ts'));
  const enumColumnPattern = /enum:\s*(\w+)[\s\S]{0,120}?enumName:\s*'([a-z_]+)'/g;

  function enumUsagesOf(source: string): Array<{ tsName: string; enumName: string }> {
    const usages: Array<{ tsName: string; enumName: string }> = [];
    for (const match of source.matchAll(enumColumnPattern)) {
      usages.push({ tsName: match[1], enumName: match[2] });
    }
    return usages;
  }

  it('toda declaração `enum:` nas entidades tem `enumName` explícito na mesma opção de coluna', () => {
    for (const file of entityFiles) {
      const source = readFileSync(file, 'utf8');
      const enumDeclarations = source.match(/enum:\s*\w+/g) ?? [];
      const enumNameDeclarations = source.match(/enumName:\s*'[a-z_]+'/g) ?? [];
      expect(enumNameDeclarations, `${path.basename(file)} tem enum: sem enumName`).toHaveLength(
        enumDeclarations.length,
      );
    }
  });

  it('cada tipo TypeScript de enum sempre usa o mesmo enumName em toda entidade (nunca dois nomes para o mesmo tipo)', () => {
    const tsNameToEnumNames = new Map<string, Set<string>>();
    for (const file of entityFiles) {
      for (const { tsName, enumName } of enumUsagesOf(readFileSync(file, 'utf8'))) {
        const set = tsNameToEnumNames.get(tsName) ?? new Set<string>();
        set.add(enumName);
        tsNameToEnumNames.set(tsName, set);
      }
    }
    for (const [tsName, names] of tsNameToEnumNames) {
      expect(names.size, `${tsName} usa mais de um enumName: ${[...names].join(', ')}`).toBe(1);
    }
  });

  it('o conjunto de enumName das entidades é exatamente o conjunto de CREATE TYPE da migration', () => {
    const enumTypeNameOf = (statement: string): string =>
      /^CREATE TYPE (\w+) AS ENUM/.exec(statement)![1];
    const migrationTypeNames = new Set(ENUM_STATEMENTS.map(enumTypeNameOf));

    const entityEnumNames = new Set<string>();
    for (const file of entityFiles) {
      for (const { enumName } of enumUsagesOf(readFileSync(file, 'utf8'))) {
        entityEnumNames.add(enumName);
      }
    }
    expect(entityEnumNames).toEqual(migrationTypeNames);
  });
});
