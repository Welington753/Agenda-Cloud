// Lote 5B.3 — `relationConstraintName` precisa produzir nome estável e
// legível (`uq_<tabela>_<colunas>`), não o `UQ_<hash>` do
// DefaultNamingStrategy, para que a UNIQUE CONSTRAINT que o TypeORM gera
// sozinho no lado dono de um `@OneToOne` bata com o nome já usado na
// migration (1788782400000-InitialSchema.ts). Teste puro, sem DataSource.
import { describe, expect, it } from 'vitest';
import { SnakeNamingStrategy } from './snake-naming-strategy.js';

describe('SnakeNamingStrategy.relationConstraintName', () => {
  const strategy = new SnakeNamingStrategy();

  it('produz uq_<tabela>_<coluna> para as 4 relações OneToOne dono deste schema', () => {
    expect(strategy.relationConstraintName('credentials', ['userId'])).toBe(
      'uq_credentials_user_id',
    );
    expect(strategy.relationConstraintName('brand_identities', ['tenantId'])).toBe(
      'uq_brand_identities_tenant_id',
    );
    expect(strategy.relationConstraintName('booking_policies', ['tenantId'])).toBe(
      'uq_booking_policies_tenant_id',
    );
    expect(strategy.relationConstraintName('public_settings', ['tenantId'])).toBe(
      'uq_public_settings_tenant_id',
    );
  });

  it('é determinístico (mesma entrada produz sempre o mesmo nome)', () => {
    const first = strategy.relationConstraintName('booking_policies', ['tenantId']);
    const second = strategy.relationConstraintName('booking_policies', ['tenantId']);
    expect(first).toBe(second);
  });

  it('nunca excede o limite de identificador do Postgres (63 caracteres)', () => {
    const name = strategy.relationConstraintName('a_very_long_table_name_used_only_in_this_test', [
      'anExtremelyLongColumnNameThatWouldNeverReallyExistButMustBeSafe',
    ]);
    expect(name.length).toBeLessThanOrEqual(63);
  });

  it('nomes truncados por excesso de tamanho continuam determinísticos e distintos entre si', () => {
    const nameA = strategy.relationConstraintName('a_very_long_table_name_used_only_in_this_test', [
      'columnOne',
    ]);
    const nameB = strategy.relationConstraintName('a_very_long_table_name_used_only_in_this_test', [
      'columnTwo',
    ]);
    expect(nameA.length).toBeLessThanOrEqual(63);
    expect(nameB.length).toBeLessThanOrEqual(63);
    expect(nameA).not.toBe(nameB);
  });
});
