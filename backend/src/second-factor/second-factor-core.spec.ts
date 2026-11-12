// Núcleo do segundo fator, sem banco: chaves, cifra, TOTP (pela biblioteca),
// códigos de recuperação, estados da sessão e política de tentativas. Dados e
// chaves fictícios.
import { describe, expect, it } from 'vitest';
import { parseTotpKeyring } from './second-factor-keys.js';
import { openSecret, sealSecret, SecretUnavailableError } from './secret-cipher.js';
import { manualKey, matchTotpCounter, newTotpSecret, normalizeTotpCode, otpauthUri, totpCodeAt } from './totp.js';
import { generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode, RECOVERY_CODE_COUNT } from './recovery-codes.js';
import {
  afterFailure,
  LOCK_MS,
  lockedUntil,
  MAX_FAILED_ATTEMPTS,
  recentlyVerified,
  SECOND_FACTOR_VALIDITY_MS,
  secondFactorStatus,
  type SecondFactorFacts,
} from './second-factor-state.js';

const CHAVE_1 = Buffer.alloc(32, 7).toString('base64');
const CHAVE_2 = Buffer.alloc(32, 9).toString('base64');
const anel = (atual = '1') => {
  const r = parseTotpKeyring(`1:${CHAVE_1},2:${CHAVE_2}`, atual);
  if (!r || r === 'INVALID') throw new Error('anel fictício inválido');
  return r;
};

describe('chaves do segundo fator', () => {
  it('ausentes, válidas ou inválidas (sem nunca devolver o valor)', () => {
    expect(parseTotpKeyring(undefined, undefined)).toBeNull();
    expect(parseTotpKeyring(`1:${CHAVE_1}`, undefined)).toBe('INVALID');
    expect(parseTotpKeyring(`1:${CHAVE_1}`, '2')).toBe('INVALID');
    expect(parseTotpKeyring(`1:${Buffer.alloc(31).toString('base64')}`, '1')).toBe('INVALID');
    expect(parseTotpKeyring(`0:${CHAVE_1}`, '0')).toBe('INVALID');
    const r = anel('2');
    expect(r).toMatchObject({ current: 2 });
  });
});

describe('cifra do segredo', () => {
  it('cifra com a chave atual e decifra pela versão gravada (rotação)', () => {
    const segredo = newTotpSecret();
    const lacrado = sealSecret(segredo, 'conta-a', anel('1'));
    expect(lacrado.keyVersion).toBe(1);
    expect(lacrado.ciphertext.equals(segredo)).toBe(false);
    // Depois da rotação (atual = 2), a versão 1 ainda decifra.
    expect(openSecret(lacrado, 'conta-a', anel('2')).equals(segredo)).toBe(true);
    expect(sealSecret(segredo, 'conta-a', anel('2')).keyVersion).toBe(2);
  });

  it('nonce novo a cada gravação', () => {
    const segredo = newTotpSecret();
    expect(sealSecret(segredo, 'a', anel()).nonce.equals(sealSecret(segredo, 'a', anel()).nonce)).toBe(false);
  });

  it('outra conta, chave ausente, outra chave ou dado adulterado: indisponível, nunca acerto', () => {
    const lacrado = sealSecret(newTotpSecret(), 'conta-a', anel());
    expect(() => openSecret(lacrado, 'conta-b', anel())).toThrow(SecretUnavailableError);
    expect(() => openSecret(lacrado, 'conta-a', null)).toThrow(SecretUnavailableError);
    const outraChave = parseTotpKeyring(`1:${CHAVE_2}`, '1') as Exclude<ReturnType<typeof parseTotpKeyring>, null | 'INVALID'>;
    expect(() => openSecret(lacrado, 'conta-a', outraChave)).toThrow(SecretUnavailableError);
    const adulterado = { ...lacrado, ciphertext: Buffer.from(lacrado.ciphertext) };
    adulterado.ciphertext[0] ^= 1;
    expect(() => openSecret(adulterado, 'conta-a', anel())).toThrow(SecretUnavailableError);
  });
});

describe('TOTP pela biblioteca', () => {
  const segredo = newTotpSecret();
  const t0 = Date.UTC(2031, 0, 15, 12, 0, 10);

  it('aceita o código do período e um período de folga; recusa fora da janela', () => {
    const contador = matchTotpCounter(segredo, totpCodeAt(segredo, t0), t0);
    expect(contador).toBe(Math.floor(t0 / 30_000));
    expect(matchTotpCounter(segredo, totpCodeAt(segredo, t0 - 30_000), t0)).toBe(contador! - 1);
    expect(matchTotpCounter(segredo, totpCodeAt(segredo, t0 + 30_000), t0)).toBe(contador! + 1);
    expect(matchTotpCounter(segredo, totpCodeAt(segredo, t0 - 90_000), t0)).toBeNull();
    expect(matchTotpCounter(newTotpSecret(), totpCodeAt(segredo, t0), t0)).toBeNull();
  });

  it('o contador devolvido permite à aplicação recusar a reutilização', () => {
    const codigo = totpCodeAt(segredo, t0);
    const primeiro = matchTotpCounter(segredo, codigo, t0)!;
    // Mesmo código 20 s depois: a biblioteca ainda o acha na janela...
    const depois = matchTotpCounter(segredo, codigo, t0 + 20_000)!;
    expect(depois).toBe(primeiro);
    // ...e a regra da aplicação (contador > último aceito) o recusa.
    expect(depois > primeiro).toBe(false);
  });

  it('código colado com espaço ou hífen; formato errado nunca casa', () => {
    const codigo = totpCodeAt(segredo, t0);
    expect(matchTotpCounter(segredo, `${codigo.slice(0, 3)} ${codigo.slice(3)}`, t0)).not.toBeNull();
    expect(normalizeTotpCode('12-34 56')).toBe('123456');
    for (const ruim of ['12345', '1234567', 'abcdef', '']) expect(normalizeTotpCode(ruim)).toBeNull();
  });

  it('URI e chave manual para os aplicativos', () => {
    const uri = otpauthUri(segredo, 'pessoa@example.test');
    expect(uri).toMatch(/^otpauth:\/\/totp\/Agenda%20Cloud:pessoa%40example\.test\?/);
    expect(uri).toContain('issuer=Agenda%20Cloud');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
    expect(manualKey(segredo)).toMatch(/^[A-Z2-7]{4}( [A-Z2-7]{1,4})+$/);
    expect(manualKey(segredo).replace(/ /g, '')).toHaveLength(32);
  });
});

describe('códigos de recuperação', () => {
  it('dez códigos distintos, exibidos em grupos, guardados só como hash', () => {
    const { codes, hashes } = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    expect(hashes).toEqual(codes.map((c) => hashRecoveryCode(normalizeRecoveryCode(c)!)));
    expect(hashes.every((h) => /^[0-9a-f]{64}$/.test(h) && !codes.some((c) => h.includes(c.replace(/-/g, ''))))).toBe(true);
  });

  it('aceita colar em minúsculas, com espaços ou sem hífen', () => {
    const { codes } = generateRecoveryCodes();
    const c = codes[0];
    expect(normalizeRecoveryCode(c.toLowerCase())).toBe(c.replace(/-/g, ''));
    expect(normalizeRecoveryCode(` ${c.replace(/-/g, ' ')} `)).toBe(c.replace(/-/g, ''));
    expect(normalizeRecoveryCode('curto')).toBeNull();
    expect(normalizeRecoveryCode('0000-1111-8888-9999')).toBeNull();
  });
});

describe('estado do segundo fator da sessão', () => {
  const agora = new Date('2031-01-15T12:00:00Z');
  const base: SecondFactorFacts = {
    hasPlatformRole: true,
    factorActive: false,
    enrollmentRequired: false,
    enforcement: 'optional',
    verifiedAt: null,
    sessionExpiresAt: new Date('2031-02-01T00:00:00Z'),
    enrollmentAllowedUntil: null,
    grantPending: false,
    now: agora,
  };
  const st = (f: Partial<SecondFactorFacts>) => secondFactorStatus({ ...base, ...f });

  it('conta comum: nada exigido', () => {
    expect(st({ hasPlatformRole: false })).toMatchObject({ state: 'NOT_REQUIRED', portalAllowed: true });
  });

  it('sem fator: opcional libera; fase required ou master novo exige cadastro', () => {
    expect(st({})).toMatchObject({ state: 'ENROLLMENT_OPTIONAL', portalAllowed: true });
    expect(st({ enforcement: 'required' })).toMatchObject({ state: 'ENROLLMENT_REQUIRED', portalAllowed: false });
    expect(st({ enrollmentRequired: true })).toMatchObject({ state: 'ENROLLMENT_REQUIRED', portalAllowed: false });
  });

  it('com fator, a fase optional NÃO libera sem o código', () => {
    for (const enforcement of ['optional', 'required'] as const) {
      expect(st({ factorActive: true, enforcement })).toMatchObject({ state: 'VERIFICATION_REQUIRED', portalAllowed: false });
    }
  });

  it('verificação vale 12 horas, não passa da sessão e não renova sozinha', () => {
    const verificada = new Date(agora.getTime() - SECOND_FACTOR_VALIDITY_MS + 1000);
    expect(st({ factorActive: true, verifiedAt: verificada })).toMatchObject({ state: 'VERIFIED', portalAllowed: true });
    expect(st({ factorActive: true, verifiedAt: new Date(agora.getTime() - SECOND_FACTOR_VALIDITY_MS) }).state).toBe(
      'VERIFICATION_REQUIRED',
    );
    // A sessão termina antes das 12 horas: a verificação termina com ela.
    const fim = new Date(agora.getTime() + 60_000);
    expect(st({ factorActive: true, verifiedAt: agora, sessionExpiresAt: fim }).verifiedUntil).toEqual(fim);
    // Verificação "do futuro" (relógio adulterado) não vale.
    expect(st({ factorActive: true, verifiedAt: new Date(agora.getTime() + 1000) }).state).toBe('VERIFICATION_REQUIRED');
  });

  it('recuperação pendente com fator ativo continua exigindo o código; liberação só permite cadastrar', () => {
    const r = st({ factorActive: true, grantPending: true });
    expect(r).toMatchObject({ state: 'VERIFICATION_REQUIRED', portalAllowed: false, recoveryPending: true, enrollmentPermitted: false });
    const usada = st({ factorActive: true, enrollmentAllowedUntil: new Date(agora.getTime() + 60_000) });
    expect(usada).toMatchObject({ portalAllowed: false, recoveryPending: true, enrollmentPermitted: true });
    expect(st({ factorActive: true, enrollmentAllowedUntil: new Date(agora.getTime() - 1) }).enrollmentPermitted).toBe(false);
  });

  it('segundo fator "recente" para ações sobre outra conta: até 10 minutos', () => {
    expect(recentlyVerified(new Date(agora.getTime() - 9 * 60_000), agora)).toBe(true);
    expect(recentlyVerified(new Date(agora.getTime() - 11 * 60_000), agora)).toBe(false);
    expect(recentlyVerified(null, agora)).toBe(false);
  });
});

describe('tentativas de segundo fator', () => {
  const t = (min: number) => new Date(Date.UTC(2031, 0, 15, 12, min));

  it('cinco falhas em 15 minutos travam por 15 minutos e zeram a contagem', () => {
    let linha = null as ReturnType<typeof afterFailure> | null;
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i += 1) {
      linha = afterFailure(linha, t(i));
      expect(linha.lockedNow).toBe(false);
      expect(linha.failedCount).toBe(i);
    }
    linha = afterFailure(linha, t(5));
    expect(linha).toMatchObject({ lockedNow: true, failedCount: 0 });
    expect(linha.lockedUntil!.getTime()).toBe(t(5).getTime() + LOCK_MS);
  });

  it('falhas espalhadas por mais de 15 minutos não somam', () => {
    let linha = afterFailure(null, t(0));
    for (const m of [1, 2, 3]) linha = afterFailure(linha, t(m));
    linha = afterFailure(linha, t(16));
    expect(linha).toMatchObject({ failedCount: 1, lockedNow: false });
  });

  it('durante a trava, a linha não muda (insistir não prolonga) e a trava termina no horário', () => {
    const travada = { failedCount: 0, windowStartedAt: null, lockedUntil: t(20) };
    expect(lockedUntil(travada, t(10))).toEqual(t(20));
    expect(lockedUntil(travada, t(20))).toBeNull();
    expect(lockedUntil(null, t(10))).toBeNull();
  });
});
