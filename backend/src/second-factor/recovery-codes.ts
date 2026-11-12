// Códigos de recuperação: 10 por conta, 16 caracteres base32 (80 bits),
// mostrados como `XXXX-XXXX-XXXX-XXXX` uma única vez. O banco guarda só o
// SHA-256 do código normalizado; a entropia alta dispensa um hash lento (que
// custaria 10 verificações lentas por tentativa). Cada código vale uma vez:
// o consumo é um UPDATE condicional (`used_at IS NULL`), atômico no banco.
import { createHash, randomInt } from 'node:crypto';

export const RECOVERY_CODE_COUNT = 10;
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TAMANHO = 16;

export function normalizeRecoveryCode(code: string): string | null {
  const limpo = code.replace(/[\s-]/g, '').toUpperCase();
  return limpo.length === TAMANHO && [...limpo].every((c) => ALFABETO.includes(c)) ? limpo : null;
}

export function hashRecoveryCode(normalized: string): string {
  return createHash('sha256').update(`agenda-cloud:recovery:v1:${normalized}`).digest('hex');
}

export function generateRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes: string[] = [];
  const hashes = new Set<string>();
  while (codes.length < RECOVERY_CODE_COUNT) {
    let bruto = '';
    for (let i = 0; i < TAMANHO; i += 1) bruto += ALFABETO[randomInt(ALFABETO.length)];
    const hash = hashRecoveryCode(bruto);
    if (hashes.has(hash)) continue;
    hashes.add(hash);
    codes.push(bruto.match(/.{4}/g)!.join('-'));
  }
  return { codes, hashes: [...hashes] };
}
