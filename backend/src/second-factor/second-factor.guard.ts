// Guard do segundo fator das rotas de plataforma. Aplicado NA CLASSE de todo
// controller `@Controller('platform')`, sempre depois do `SessionGuard` (que
// prova a identidade). Relê a cada requisição: papel, fator ativo, marca de
// cadastro obrigatório, fase e a verificação DESTA sessão.
//
// - Conta sem papel de plataforma: passa (o serviço recusa pelo papel, como
//   antes; isso preserva rotas compartilhadas como `POST /platform/reauth`).
// - Conta de plataforma: só passa com o estado que libera o portal
//   (second-factor-state.ts). Senão, 403 com `code` que a tela distingue:
//   `SEGUNDO_FATOR_NECESSARIO` ou `SEGUNDO_FATOR_CADASTRO_NECESSARIO`.
//
// Exceções por `@SemSegundoFator()`, só em rotas que não concedem nada:
// `GET /platform/access` (diz à tela o estado, sem capacidades enquanto não
// verificado) e `POST /platform/reauth` (confirmação de senha, compartilhada
// com o dono de estabelecimento). O teste de arquitetura lista as exceções.
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { AUTH_CONTEXT_REQUEST_KEY, type IdentityContext } from '../auth/session-context.js';
import { SecondFactorConfig } from './second-factor-config.js';
import { loadSessionSecondFactor } from './second-factor-facts.js';
import type { SecondFactorStatus } from './second-factor-state.js';

export const SEGUNDO_FATOR_NECESSARIO = 'SEGUNDO_FATOR_NECESSARIO';
export const SEGUNDO_FATOR_CADASTRO_NECESSARIO = 'SEGUNDO_FATOR_CADASTRO_NECESSARIO';

const SEM_SEGUNDO_FATOR = 'semSegundoFator';

/** As únicas rotas de plataforma que dispensam o guard (não concedem nada).
 * Conferidas pelo teste de arquitetura e pelo e2e que percorre as rotas. */
export const ROTAS_SEM_SEGUNDO_FATOR: readonly string[] = ['GET /platform/access', 'POST /platform/reauth'];
/** Rota de plataforma que não exige o segundo fator (não concede nada). */
export const SemSegundoFator = () => SetMetadata(SEM_SEGUNDO_FATOR, true);

/** Recusa padrão para quem ainda não pode usar o portal. */
export function recusaDoSegundoFator(status: SecondFactorStatus): ForbiddenException {
  return status.state === 'ENROLLMENT_REQUIRED'
    ? new ForbiddenException({
        code: SEGUNDO_FATOR_CADASTRO_NECESSARIO,
        message: 'Cadastre a verificação em duas etapas antes de usar o portal.',
      })
    : new ForbiddenException({
        code: SEGUNDO_FATOR_NECESSARIO,
        message: 'Confirme o código do aplicativo autenticador para continuar.',
      });
}

@Injectable()
export class PlatformSecondFactorGuard implements CanActivate {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: SecondFactorConfig,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(SEM_SEGUNDO_FATOR, [context.getHandler(), context.getClass()]) === true) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    const identity = (request as unknown as Record<string, unknown>)[AUTH_CONTEXT_REQUEST_KEY] as IdentityContext | undefined;
    // Sem identidade o SessionGuard não rodou antes: nunca libera.
    if (!identity) throw new UnauthorizedException('Não autenticado.');
    const sessao = await loadSessionSecondFactor(
      this.dataSource.manager,
      identity.userId,
      identity.sessionId,
      this.config.enforcement,
      new Date(),
    );
    if (!sessao) throw new UnauthorizedException('Não autenticado.');
    if (!sessao.status.portalAllowed) throw recusaDoSegundoFator(sessao.status);
    return true;
  }
}
