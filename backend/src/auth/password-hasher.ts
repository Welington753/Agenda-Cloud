// Único ponto de hash/verificação de senha — Argon2id, nunca outro algoritmo
// silencioso. `Credential.algorithm` guarda `CREDENTIAL_ALGORITHM` (ver
// entities/credential.entity.ts), permitindo rotação futura de custo/algoritmo
// sem quebrar hashes antigos, mas nenhuma rotação acontece aqui ainda.
import argon2 from 'argon2';

export const CREDENTIAL_ALGORITHM = 'argon2id';

export async function hashPassword(plainPassword: string): Promise<string> {
  return argon2.hash(plainPassword, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plainPassword: string): Promise<boolean> {
  return argon2.verify(hash, plainPassword);
}
