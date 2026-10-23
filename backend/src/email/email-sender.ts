// Envio de e-mail transacional por API HTTPS (convites e redefinição de
// senha). O plano gratuito do Render bloqueia SMTP (portas 25, 465 e 587),
// então só há adaptadores HTTP: Brevo e Resend. Sem provedor configurado, o
// envio NÃO é simulado: o resultado é `NOT_CONFIGURED` e a tela diz isso.
//
// "SENT" significa só que o PROVEDOR aceitou a mensagem (HTTP 2xx). Não é
// prova de entrega nem de leitura.
//
// O conteúdo da mensagem (que leva o link secreto) nunca vai para log. Em
// falha, o log tem só o provedor e o status HTTP.
import { Logger } from '@nestjs/common';

export type EmailProvider = 'brevo' | 'resend';

export interface EmailConfig {
  provider: EmailProvider;
  apiKey: string;
  fromEmail: string;
  fromName: string;
  /** Só fora de production (testes apontam para uma caixa local). */
  baseUrl?: string;
}

export interface EmailMessage {
  to: { email: string; name: string };
  subject: string;
  text: string;
  html: string;
}

export type EmailFailure = 'HTTP_4XX' | 'HTTP_5XX' | 'SEM_RESPOSTA';

export type EmailSendResult =
  | { status: 'SENT' }
  | { status: 'FAILED'; failure: EmailFailure }
  | { status: 'NOT_CONFIGURED' };

export const EMAIL_SEND_TIMEOUT_MS = 10_000;

const BASE_URL_PADRAO: Record<EmailProvider, string> = {
  brevo: 'https://api.brevo.com',
  resend: 'https://api.resend.com',
};

function requisicao(config: EmailConfig, message: EmailMessage): { url: string; init: RequestInit } {
  const base = (config.baseUrl ?? BASE_URL_PADRAO[config.provider]).replace(/\/+$/, '');
  if (config.provider === 'brevo') {
    return {
      url: `${base}/v3/smtp/email`,
      init: {
        method: 'POST',
        headers: { 'api-key': config.apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { email: config.fromEmail, name: config.fromName },
          to: [{ email: message.to.email, name: message.to.name }],
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
        }),
      },
    };
  }
  return {
    url: `${base}/emails`,
    init: {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: `${config.fromName} <${config.fromEmail}>`,
        to: [message.to.email],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    },
  };
}

export class EmailSender {
  private readonly logger = new Logger('EmailSender');

  constructor(
    private readonly config: EmailConfig | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get configured(): boolean {
    return this.config !== null;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (!this.config) return { status: 'NOT_CONFIGURED' };
    const { url, init } = requisicao(this.config, message);
    let resposta: Response;
    try {
      resposta = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(EMAIL_SEND_TIMEOUT_MS) });
    } catch {
      this.logger.warn(`Envio por ${this.config.provider} sem resposta.`);
      return { status: 'FAILED', failure: 'SEM_RESPOSTA' };
    }
    // O corpo não interessa (e pode ecoar o conteúdo): só é descartado.
    await resposta.body?.cancel().catch(() => undefined);
    if (resposta.status >= 200 && resposta.status < 300) return { status: 'SENT' };
    this.logger.warn(`Envio por ${this.config.provider} recusado: HTTP ${resposta.status}.`);
    return { status: 'FAILED', failure: resposta.status >= 500 ? 'HTTP_5XX' : 'HTTP_4XX' };
  }
}
