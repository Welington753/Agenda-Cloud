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

/** Hash Argon2id fixo, gerado uma única vez (nunca em runtime, nunca por
 * request) — usado só para pagar o mesmo custo de CPU do Argon2id real
 * quando o login não tem um hash de verdade para comparar (e-mail
 * inexistente, credencial ausente, algoritmo desconhecido). Mitiga a
 * enumeração de e-mail por tempo de resposta sem gerar um hash caro a cada
 * tentativa (ver auth.service.ts, `login`). Nunca bate com senha nenhuma
 * plausível de usuário real — não precisa, só precisa custar o mesmo tempo. */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$3rIJRrJotRf1PdK+XTMyug$0HuL1ALc3OHPpC79NJLtbktcydblZf+oUzcbOcItSGc';
