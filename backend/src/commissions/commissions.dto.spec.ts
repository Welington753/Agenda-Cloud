import { describe, expect, it } from 'vitest';
import { commissionBulkApplySchema, commissionBulkPreviewSchema, commissionSettingsSchema } from './commissions.dto.js';

const REGRA = { kind: 'PERCENTAGE', value: 1000 };
const IMPRESSAO = 'a'.repeat(64);
const ids = (n: number) => Array.from({ length: n }, (_, i) => `prof_${i}`);

describe('commissionBulkPreviewSchema', () => {
  it.each([
    ['todos', { target: 'ALL', defaultRule: REGRA, mode: 'PRESERVE' }],
    ['escolhidos', { target: 'SELECTED', professionalIds: ['p1', 'p2'], defaultRule: { kind: 'FIXED', value: 1500 }, mode: 'REPLACE' }],
    ['200 escolhidos', { target: 'SELECTED', professionalIds: ids(200), defaultRule: REGRA, mode: 'PRESERVE' }],
    ['substituir mantendo exceções', { target: 'ALL', defaultRule: REGRA, mode: 'REPLACE', exceptions: 'KEEP' }],
    ['substituir removendo exceções', { target: 'ALL', defaultRule: REGRA, mode: 'REPLACE', exceptions: 'REMOVE' }],
    ['preservar mantendo exceções', { target: 'ALL', defaultRule: REGRA, mode: 'PRESERVE', exceptions: 'KEEP' }],
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
    ['preservar removendo exceções', { target: 'ALL', defaultRule: REGRA, mode: 'PRESERVE', exceptions: 'REMOVE' }],
    ['escolha de exceções desconhecida', { target: 'ALL', defaultRule: REGRA, mode: 'REPLACE', exceptions: 'MERGE' }],
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

  it('substituir removendo exceções com as duas confirmações', () => {
    const corpo = { ...base, mode: 'REPLACE', confirmReplace: true, exceptions: 'REMOVE', confirmRemoveExceptions: true };
    expect(commissionBulkApplySchema.safeParse(corpo).success).toBe(true);
  });

  it.each([
    ['substituir sem confirmação', { ...base, mode: 'REPLACE' }],
    ['substituir com confirmação falsa', { ...base, mode: 'REPLACE', confirmReplace: false }],
    ['preservar com confirmação', { ...base, mode: 'PRESERVE', confirmReplace: true }],
    ['sem impressão', { target: 'ALL', defaultRule: REGRA, mode: 'PRESERVE' }],
    ['impressão malformada', { ...base, fingerprint: 'XYZ', mode: 'PRESERVE' }],
    ['escolher sem lista', { ...base, target: 'SELECTED', mode: 'PRESERVE' }],
    ['remover sem confirmar a remoção', { ...base, mode: 'REPLACE', confirmReplace: true, exceptions: 'REMOVE' }],
    ['remover com confirmação falsa', { ...base, mode: 'REPLACE', confirmReplace: true, exceptions: 'REMOVE', confirmRemoveExceptions: false }],
    ['remover sem confirmar a substituição', { ...base, mode: 'REPLACE', exceptions: 'REMOVE', confirmRemoveExceptions: true }],
    ['confirmar remoção mantendo exceções', { ...base, mode: 'REPLACE', confirmReplace: true, exceptions: 'KEEP', confirmRemoveExceptions: true }],
    ['confirmar remoção sem escolha', { ...base, mode: 'REPLACE', confirmReplace: true, confirmRemoveExceptions: true }],
    ['preservar removendo', { ...base, mode: 'PRESERVE', exceptions: 'REMOVE', confirmRemoveExceptions: true }],
  ])('recusa %s', (_nome, corpo) => {
    expect(commissionBulkApplySchema.safeParse(corpo).success).toBe(false);
  });
});

describe('commissionSettingsSchema: exceções por serviço', () => {
  const base = { receivesCommission: true, defaultRule: { kind: 'PERCENTAGE', value: 2000 } };
  const remover = { ...base, exceptions: 'REMOVE', exceptionsFingerprint: IMPRESSAO, confirmRemoveExceptions: true };

  it.each([
    ['sem escolha (mantém)', base],
    ['manter explícito', { ...base, exceptions: 'KEEP' }],
    ['remover com regra geral, impressão e confirmação', remover],
    ['remover com "Recebe comissão" desligado', { ...remover, receivesCommission: false }],
    ['valor fixo removendo', { ...remover, defaultRule: { kind: 'FIXED', value: 1500 } }],
  ])('aceita %s', (_nome, corpo) => {
    expect(commissionSettingsSchema.safeParse(corpo).success).toBe(true);
  });

  it.each([
    ['remover sem regra geral', { ...remover, defaultRule: null }],
    ['remover sem confirmação', { ...remover, confirmRemoveExceptions: undefined }],
    ['remover com confirmação falsa', { ...remover, confirmRemoveExceptions: false }],
    ['remover sem impressão', { ...remover, exceptionsFingerprint: undefined }],
    ['remover com impressão malformada', { ...remover, exceptionsFingerprint: 'abc' }],
    ['manter com confirmação', { ...base, exceptions: 'KEEP', confirmRemoveExceptions: true }],
    ['manter com impressão', { ...base, exceptionsFingerprint: IMPRESSAO }],
    ['escolha desconhecida', { ...base, exceptions: 'APAGAR' }],
  ])('recusa %s', (_nome, corpo) => {
    expect(commissionSettingsSchema.safeParse(corpo).success).toBe(false);
  });
});
