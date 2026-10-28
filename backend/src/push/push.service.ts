// Inscrições de push da área real: ativar, conferir e desativar neste
// aparelho. Toda rota prova no servidor o vínculo com o estabelecimento (a
// mesma política da lista de solicitações: quem não pode ver a agenda não
// recebe aviso dela). A inscrição fica presa ao USUÁRIO, ao
// ESTABELECIMENTO e à SESSÃO que ativou (ver migration 1792713600000).
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Optional,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { canReceiveBookingAlerts } from '../appointments/appointment-access.js';
import type { IdentityContext } from '../auth/session-context.js';
import { resolveAuthorizedTenant } from '../common/tenant-authorization.js';
import { DisparadorDePush } from './push-dispatcher.js';
import { endpointAceito, hashDoEndpoint } from './push-endpoint.js';
import { gravarInscricao, inscricaoAtiva, revogarInscricao } from './push-subscriptions.repository.js';
import type { PushSubscriptionDto } from './push.dto.js';
import { chavesDoAparelhoValidas } from './web-push-crypto.js';

export const PUSH_FORBIDDEN_MESSAGE =
  'Você não tem permissão para receber avisos das solicitações deste estabelecimento.';
export const PUSH_DISABLED_MESSAGE = 'O servidor ainda não está configurado para enviar notificações.';
export const PUSH_UNSUPPORTED_SERVICE_MESSAGE =
  'Este navegador usa um serviço de notificações que não é aceito. Tente pelo Chrome, Firefox, Edge ou Safari.';
export const PUSH_INVALID_KEYS_MESSAGE = 'A inscrição deste navegador veio incompleta. Tente ativar de novo.';

const politicaDeAviso = {
  permitido: canReceiveBookingAlerts,
  mensagemProibido: PUSH_FORBIDDEN_MESSAGE,
};

@Injectable()
export class PushService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly disparador: DisparadorDePush,
    @Optional()
    private readonly agora: () => Date = () => new Date(),
  ) {}

  /** Chave PÚBLICA para o navegador se inscrever. A privada nunca sai. */
  configuracao(): { enabled: boolean; publicKey: string | null } {
    return { enabled: this.disparador.habilitado, publicKey: this.disparador.chavePublica };
  }

  async ativar(identidade: IdentityContext, tenantId: string, dto: PushSubscriptionDto): Promise<{ active: true }> {
    const manager = this.dataSource.manager;
    const autorizado = await resolveAuthorizedTenant(manager, identidade.userId, tenantId, politicaDeAviso);
    if (!this.disparador.habilitado) {
      throw new HttpException(PUSH_DISABLED_MESSAGE, HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (!endpointAceito(dto.endpoint)) throw new BadRequestException(PUSH_UNSUPPORTED_SERVICE_MESSAGE);
    if (!chavesDoAparelhoValidas(dto.keys)) throw new BadRequestException(PUSH_INVALID_KEYS_MESSAGE);

    await this.dataSource.transaction((tx) =>
      gravarInscricao(
        tx,
        {
          userId: identidade.userId,
          tenantId: autorizado.tenantId,
          sessionId: identidade.sessionId,
          endpoint: dto.endpoint,
          endpointHash: hashDoEndpoint(dto.endpoint),
          p256dh: dto.keys.p256dh,
          auth: dto.keys.auth,
        },
        this.agora(),
      ),
    );
    return { active: true };
  }

  /** Este aparelho recebe avisos deste estabelecimento, nesta sessão? */
  async estado(identidade: IdentityContext, tenantId: string, endpoint: string): Promise<{ active: boolean }> {
    const manager = this.dataSource.manager;
    const autorizado = await resolveAuthorizedTenant(manager, identidade.userId, tenantId, politicaDeAviso);
    const active = await inscricaoAtiva(manager, {
      tenantId: autorizado.tenantId,
      userId: identidade.userId,
      sessionId: identidade.sessionId,
      endpointHash: hashDoEndpoint(endpoint),
    });
    return { active };
  }

  /** Desativar vale mesmo sem a permissão de ver a agenda (quem perdeu a
   * permissão ainda pode desligar); exige só o vínculo. */
  async desativar(identidade: IdentityContext, tenantId: string, endpoint: string): Promise<{ active: false }> {
    const manager = this.dataSource.manager;
    const autorizado = await resolveAuthorizedTenant(manager, identidade.userId, tenantId, {
      permitido: () => true,
      mensagemProibido: PUSH_FORBIDDEN_MESSAGE,
    });
    await revogarInscricao(
      manager,
      { tenantId: autorizado.tenantId, userId: identidade.userId, endpointHash: hashDoEndpoint(endpoint) },
      'DESATIVADO_PELO_USUARIO',
      this.agora(),
    );
    return { active: false };
  }
}
