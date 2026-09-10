import { describe, expect, it } from 'vitest';
import {
  CREDENTIAL_ALGORITHM,
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from './password-hasher.js';

describe('hashPassword', () => {
  it('gera um hash Argon2id verificável', async () => {
    const hash = await hashPassword('senha-do-usuario-123');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(verifyPassword(hash, 'senha-do-usuario-123')).resolves.toBe(true);
  });

  it('rejeita a senha errada na verificação', async () => {
    const hash = await hashPassword('senha-correta-123');
    await expect(verifyPassword(hash, 'senha-errada-456')).resolves.toBe(false);
  });

  it('nunca inclui a senha em texto puro no hash resultante', async () => {
    const senha = 'minha-senha-secreta-789';
    const hash = await hashPassword(senha);
    expect(hash).not.toContain(senha);
  });

  it('CREDENTIAL_ALGORITHM identifica argon2id, nunca outro algoritmo silencioso', () => {
    expect(CREDENTIAL_ALGORITHM).toBe('argon2id');
  });

  it('gera hashes diferentes para a mesma senha (salt aleatório)', async () => {
    const hash1 = await hashPassword('mesma-senha-123');
    const hash2 = await hashPassword('mesma-senha-123');
    expect(hash1).not.toBe(hash2);
  });
});

describe('DUMMY_PASSWORD_HASH', () => {
  it('é um hash Argon2id fixo e válido (usado para mitigar timing em login)', () => {
    expect(DUMMY_PASSWORD_HASH.startsWith('$argon2id$')).toBe(true);
  });

  it('é verificável (custo Argon2id real, não um atalho) e nunca bate com senha nenhuma plausível', async () => {
    await expect(verifyPassword(DUMMY_PASSWORD_HASH, 'qualquer-senha-de-usuario')).resolves.toBe(
      false,
    );
  });
});
