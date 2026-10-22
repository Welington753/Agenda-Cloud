// Proteção CSRF das rotas que gravam inscrição de push.
//
// O cookie de sessão já é `SameSite=Lax` (não vai em POST/PUT/DELETE vindo
// de outro site) e o CORS só libera FRONTEND_URL. Esta guarda fecha o resto,
// sem depender só do navegador:
// - `Sec-Fetch-Site: cross-site` → recusa;
// - `Origin` presente e diferente da origem de FRONTEND_URL → recusa. No
//   modo mesma origem, o proxy do frontend já exige `Origin` igual à origem
//   pública em escritas e não repassa o cabeçalho (ver src/lib/api/proxy.ts);
// - corpo só em `application/json`: formulário HTML de outro site não
//   consegue montar esse tipo sem uma pré-verificação CORS, que é negada.
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

export const ORIGEM_RECUSADA_MESSAGE = 'Origem da requisição não autorizada.';

export function origemPermitida(
  headers: { origin?: string; 'sec-fetch-site'?: string; 'content-type'?: string },
  frontendUrl: string,
): 'ok' | 'origem' | 'tipo' {
  const site = headers['sec-fetch-site'];
  if (site && site.toLowerCase() === 'cross-site') return 'origem';
  if (headers.origin !== undefined) {
    let esperada: string;
    try {
      esperada = new URL(frontendUrl).origin;
    } catch {
      return 'origem';
    }
    if (headers.origin !== esperada) return 'origem';
  }
  const tipo = (headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (tipo !== 'application/json') return 'tipo';
  return 'ok';
}

@Injectable()
export class TrustedOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const veredito = origemPermitida(
      request.headers as Record<string, string | undefined>,
      this.config.getOrThrow<string>('FRONTEND_URL'),
    );
    if (veredito === 'origem') throw new ForbiddenException(ORIGEM_RECUSADA_MESSAGE);
    if (veredito === 'tipo') throw new UnsupportedMediaTypeException('Envie JSON.');
    return true;
  }
}
