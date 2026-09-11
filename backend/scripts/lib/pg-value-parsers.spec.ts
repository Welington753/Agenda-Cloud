import { describe, expect, it } from 'vitest';
import { parseNonNegativeInteger } from './pg-value-parsers.js';
import { GuardedMigrationError } from './sanitize.js';

describe('parseNonNegativeInteger', () => {
  it('aceita string decimal canônica — exatamente o que COUNT(*)::text/BIGINT do pg devolve', () => {
    expect(parseNonNegativeInteger('0', 'campo')).toBe(0);
    expect(parseNonNegativeInteger('1', 'campo')).toBe(1);
    expect(parseNonNegativeInteger('31', 'campo')).toBe(31);
    expect(parseNonNegativeInteger('1788782400000', 'campo')).toBe(1788782400000);
  });

  it('aceita number inteiro seguro e não negativo', () => {
    expect(parseNonNegativeInteger(0, 'campo')).toBe(0);
    expect(parseNonNegativeInteger(31, 'campo')).toBe(31);
  });

  it('rejeita string vazia', () => {
    expect(() => parseNonNegativeInteger('', 'campo')).toThrow(GuardedMigrationError);
  });

  it('rejeita espaços inesperados', () => {
    expect(() => parseNonNegativeInteger(' 31', 'campo')).toThrow(GuardedMigrationError);
    expect(() => parseNonNegativeInteger('31 ', 'campo')).toThrow(GuardedMigrationError);
    expect(() => parseNonNegativeInteger('3 1', 'campo')).toThrow(GuardedMigrationError);
  });

  it('rejeita negativos', () => {
    expect(() => parseNonNegativeInteger('-1', 'campo')).toThrow(GuardedMigrationError);
    expect(() => parseNonNegativeInteger(-1, 'campo')).toThrow(GuardedMigrationError);
  });

  it('rejeita decimais', () => {
    expect(() => parseNonNegativeInteger('1.5', 'campo')).toThrow(GuardedMigrationError);
    expect(() => parseNonNegativeInteger(1.5, 'campo')).toThrow(GuardedMigrationError);
  });

  it('rejeita notação científica', () => {
    expect(() => parseNonNegativeInteger('1e2', 'campo')).toThrow(GuardedMigrationError);
    expect(() => parseNonNegativeInteger('1E2', 'campo')).toThrow(GuardedMigrationError);
  });

  it('rejeita zero à esquerda (não é a forma canônica do pg)', () => {
    expect(() => parseNonNegativeInteger('01', 'campo')).toThrow(GuardedMigrationError);
    expect(() => parseNonNegativeInteger('00', 'campo')).toThrow(GuardedMigrationError);
  });

  it('rejeita NaN e Infinity', () => {
    expect(() => parseNonNegativeInteger(NaN, 'campo')).toThrow(GuardedMigrationError);
    expect(() => parseNonNegativeInteger(Infinity, 'campo')).toThrow(GuardedMigrationError);
    expect(() => parseNonNegativeInteger('NaN', 'campo')).toThrow(GuardedMigrationError);
    expect(() => parseNonNegativeInteger('Infinity', 'campo')).toThrow(GuardedMigrationError);
  });

  it('rejeita número acima de Number.MAX_SAFE_INTEGER', () => {
    expect(() => parseNonNegativeInteger(String(Number.MAX_SAFE_INTEGER + 2), 'campo')).toThrow(
      GuardedMigrationError,
    );
  });

  it('aceita exatamente Number.MAX_SAFE_INTEGER', () => {
    expect(parseNonNegativeInteger(String(Number.MAX_SAFE_INTEGER), 'campo')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejeita null, undefined, objeto e boolean — nunca coerção frouxa', () => {
    expect(() => parseNonNegativeInteger(null, 'campo')).toThrow(GuardedMigrationError);
    expect(() => parseNonNegativeInteger(undefined, 'campo')).toThrow(GuardedMigrationError);
    expect(() => parseNonNegativeInteger({}, 'campo')).toThrow(GuardedMigrationError);
    expect(() => parseNonNegativeInteger(true, 'campo')).toThrow(GuardedMigrationError);
    expect(() => parseNonNegativeInteger(false, 'campo')).toThrow(GuardedMigrationError);
  });

  it('mensagem de erro nunca contém o valor recebido — só o nome do campo, sanitizado', () => {
    try {
      parseNonNegativeInteger('não-é-um-número-mas-poderia-vazar-um-segredo', 'campo_sensivel');
      throw new Error('deveria ter lançado');
    } catch (error) {
      expect(error).toBeInstanceOf(GuardedMigrationError);
      const guardedError = error as GuardedMigrationError;
      expect(guardedError.code).toBe('ERR_BASELINE_VALUE_MALFORMED');
      expect(guardedError.message).not.toContain('não-é-um-número-mas-poderia-vazar-um-segredo');
      expect(guardedError.message).toContain('campo_sensivel');
    }
  });
});
