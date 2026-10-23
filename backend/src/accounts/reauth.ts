// Confirmação recente da senha na MESMA sessão, exigida pelas mudanças
// sensíveis (papéis da plataforma, bloqueio, reativação, desvínculo e
// restrições de permissão). Vale por 10 minutos; outra sessão da mesma
// pessoa não herda a confirmação.
import { ForbiddenException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

export const REAUTH_WINDOW_MS = 10 * 60 * 1000;
export const REAUTH_REQUIRED_CODE = 'REAUTENTICACAO_NECESSARIA';

export function reauthStillValid(reauthenticatedAt: Date | null, now: Date): boolean {
  if (!reauthenticatedAt) return false;
  const idade = now.getTime() - reauthenticatedAt.getTime();
  return idade >= 0 && idade <= REAUTH_WINDOW_MS;
}

export async function requireRecentReauth(manager: EntityManager, sessionId: string, now: Date): Promise<void> {
  const [linha] = await manager.query<{ reauthenticated_at: Date | null }[]>(
    `SELECT reauthenticated_at FROM sessions WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId],
  );
  if (!linha || !reauthStillValid(linha.reauthenticated_at, now)) {
    throw new ForbiddenException({
      code: REAUTH_REQUIRED_CODE,
      message: 'Confirme sua senha para continuar.',
    });
  }
}
