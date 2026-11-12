// Cifra do segredo TOTP: AES-256-GCM (node:crypto), nonce aleatório de 12
// bytes a cada gravação e dados associados presos à conta
// (`agenda-cloud:totp:v1:<userId>`): um segredo copiado para a linha de outra
// conta não decifra. A chave fica só no ambiente da API (second-factor-
// config.ts). Nenhuma função daqui escreve log; o erro não carrega dado.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { TotpKeyring } from './second-factor-config.js';

export interface SealedSecret {
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
  keyVersion: number;
}

/** Segredo que não pode ser decifrado (chave ausente, trocada ou dado
 * adulterado). Quem chama trata como "indisponível", nunca como acerto. */
export class SecretUnavailableError extends Error {
  constructor() {
    super('Segredo do segundo fator indisponível.');
    this.name = 'SecretUnavailableError';
  }
}

const aad = (userId: string) => Buffer.from(`agenda-cloud:totp:v1:${userId}`, 'utf8');

export function sealSecret(secret: Buffer, userId: string, keyring: TotpKeyring): SealedSecret {
  const key = keyring.keys.get(keyring.current);
  if (!key) throw new SecretUnavailableError();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad(userId));
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return { ciphertext, nonce, tag: cipher.getAuthTag(), keyVersion: keyring.current };
}

export function openSecret(sealed: SealedSecret, userId: string, keyring: TotpKeyring | null): Buffer {
  const key = keyring?.keys.get(sealed.keyVersion);
  if (!key || sealed.nonce.length !== 12 || sealed.tag.length !== 16) throw new SecretUnavailableError();
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.nonce);
    decipher.setAAD(aad(userId));
    decipher.setAuthTag(sealed.tag);
    return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]);
  } catch {
    throw new SecretUnavailableError();
  }
}
