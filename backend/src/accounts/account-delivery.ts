// Envio dos e-mails de conta DEPOIS do commit. A transação que cria o
// convite (ou a redefinição) já terminou quando esta classe é chamada: se o
// provedor recusar ou não responder, o convite continua existindo, com o
// estado do envio registrado, e a administração pode reenviar (o reenvio
// emite outro link e invalida o anterior).
//
// O estado só é gravado se o token ainda for o atual (`token_hash`): um envio
// lento de um link já substituído nunca sobrescreve o estado do link novo.
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { EmailSender, type EmailMessage, type EmailSendResult } from '../email/email-sender.js';
import { lerConfiguracaoDeEmail } from '../email/email-config.js';

export type DeliveryTable = 'invites' | 'password_resets';

@Injectable()
export class AccountDelivery {
  private readonly logger = new Logger('AccountDelivery');
  readonly sender: EmailSender;
  readonly frontendUrl: string;

  constructor(
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.sender = new EmailSender(lerConfiguracaoDeEmail(config));
    this.frontendUrl = config.getOrThrow<string>('FRONTEND_URL');
  }

  async deliver(
    table: DeliveryTable,
    record: { id: string; tokenHash: string },
    message: EmailMessage,
  ): Promise<EmailSendResult> {
    const result = await this.sender.send(message);
    const status = result.status;
    const failure = result.status === 'FAILED' ? result.failure : null;
    const tentou = status !== 'NOT_CONFIGURED';
    try {
      await this.dataSource.query(
        `UPDATE ${table}
            SET delivery_status = $3,
                delivery_failure = $4,
                delivery_attempts = delivery_attempts + $5,
                last_delivery_at = CASE WHEN $5 = 1 THEN now() ELSE last_delivery_at END
                ${table === 'invites' ? ', updated_at = now()' : ''}
          WHERE id = $1 AND token_hash = $2`,
        [record.id, record.tokenHash, status, failure, tentou ? 1 : 0],
      );
    } catch {
      // O e-mail pode ter saído; o registro fica "pendente" e a tela diz que
      // o envio não foi confirmado.
      this.logger.warn(`Não foi possível registrar o estado do envio (${table} ${record.id}).`);
    }
    return result;
  }
}
