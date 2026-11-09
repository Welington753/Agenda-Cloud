import { describe, expect, it } from 'vitest';
import { commissionBulkApplySchema, commissionBulkPreviewSchema } from './commissions.dto.js';

const REGRA = { kind: 'PERCENTAGE', value: 1000 };
const IMPRESSAO = 'a'.repeat(64);
const ids = (n: number) => Array.from({ length: n }, (_, i) => `prof_${i}`);

describe('commissionBulkPreviewSchema', () => {
  it.each([
    ['todos', { target: 'ALL', defaultRule: REGRA, mode: 'PRESERVE' }],
    ['escolhidos', { target: 'SELECTED', professionalIds: ['p1', 'p2'], defaultRule: { kind: 'FIXED', value: 1500 }, mode: 'REPLACE' }],
    ['200 escolhidos', { target: 'SELECTED', professionalIds: ids(200), defaultRule: REGRA, mode: 'PRESERVE' }],
  ])('aceita %s', (_nome, corpo) => {
    expect(commissionBulkPreviewSchema.safeParse(corpo).success).toBe(true);
  });

  it.each([
    ['escolher sem lista', { target: 'SELECTED', defaultRule: REGRA, mode: 'PRESERVE' }],
    ['escolher com lista vazia', { target: 'SELECTED', professionalIds: [], defaultRule: REGRA, mode: 'PRESERVE' }],
    ['201 escolhidos', { target: 'SELECTED', professionalIds: ids(201), defaultRule: REGRA, mode: 'PRESERVE' }],
    ['repetido', { target: 'SELECTED', professionalIds: ['p1', 'p1'], defaultRule: REGRA, mode: 'PRESERVE' }],
    ['todos com lista', { target: 'ALL', professionalIds: ['p1'], defaultRule: REGRA, mode: 'PRESERVE' }],
    ['id inválido', { target: 'SELECTED', professionalIds: ['não é id'], defaultRule: REGRA, mode: 'PRESERVE' }],
    ['sem regra', { target: 'ALL', defaultRule: null, mode: 'PRESERVE' }],
    ['"sem comissão"', { target: 'ALL', defaultRule: { kind: 'NONE' }, mode: 'PRESERVE' }],
    ['percentual zero', { target: 'ALL', defaultRule: { kind: 'PERCENTAGE', value: 0 }, mode: 'PRESERVE' }],
    ['percentual acima de 100%', { target: 'ALL', defaultRule: { kind: 'PERCENTAGE', value: 10001 }, mode: 'PRESERVE' }],
    ['percentual com vírgula', { target: 'ALL', defaultRule: { kind: 'PERCENTAGE', value: 12.5 }, mode: 'PRESERVE' }],
    ['fixo acima do teto', { target: 'ALL', defaultRule: { kind: 'FIXED', value: 100_000_001 }, mode: 'PRESERVE' }],
    ['modo desconhecido', { target: 'ALL', defaultRule: REGRA, mode: 'MERGE' }],
    ['campo extra', { target: 'ALL', defaultRule: REGRA, mode: 'PRESERVE', tenantId: 'outro' }],
    ['impressão na prévia', { target: 'ALL', defaultRule: REGRA, mode: 'PRESERVE', fingerprint: IMPRESSAO }],
  ])('recusa %s', (_nome, corpo) => {
    expect(commissionBulkPreviewSchema.safeParse(corpo).success).toBe(false);
  });
});

describe('commissionBulkApplySchema', () => {
  const base = { target: 'ALL', defaultRule: REGRA, fingerprint: IMPRESSAO };

  it('preservar sem confirmação', () => {
    expect(commissionBulkApplySchema.safeParse({ ...base, mode: 'PRESERVE' }).success).toBe(true);
  });

  it('substituir com confirmação explícita', () => {
    expect(commissionBulkApplySchema.safeParse({ ...base, mode: 'REPLACE', confirmReplace: true }).success).toBe(true);
  });

  it.each([
    ['substituir sem confirmação', { ...base, mode: 'REPLACE' }],
    ['substituir com confirmação falsa', { ...base, mode: 'REPLACE', confirmReplace: false }],
    ['preservar com confirmação', { ...base, mode: 'PRESERVE', confirmReplace: true }],
    ['sem impressão', { target: 'ALL', defaultRule: REGRA, mode: 'PRESERVE' }],
    ['impressão malformada', { ...base, fingerprint: 'XYZ', mode: 'PRESERVE' }],
    ['escolher sem lista', { ...base, target: 'SELECTED', mode: 'PRESERVE' }],
  ])('recusa %s', (_nome, corpo) => {
    expect(commissionBulkApplySchema.safeParse(corpo).success).toBe(false);
  });
});
