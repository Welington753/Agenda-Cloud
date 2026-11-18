// Contexto HTTP comum aos controllers do estoque: sessão obrigatória
// (SessionGuard) e o usuário lido do contexto da autenticação. A autorização
// no estabelecimento é refeita pelo serviço em toda requisição.
import type { Request } from 'express';
import { AUTH_CONTEXT_REQUEST_KEY, type IdentityContext } from '../auth/session-context.js';

export type AuthenticatedRequest = Request & { [AUTH_CONTEXT_REQUEST_KEY]: IdentityContext };
export const usuario = (req: AuthenticatedRequest) => req[AUTH_CONTEXT_REQUEST_KEY].userId;
