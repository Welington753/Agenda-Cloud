// Provedor de e-mail do ambiente (já validado em config/env.validation.ts).
// `EMAIL_PROVIDER=none` (o padrão) desliga o envio: convites e redefinições
// ficam registrados como "envio não configurado", nunca como enviados. A
// chave da API nunca sai daqui para resposta, log ou banco.
import type { ConfigService } from '@nestjs/config';
import type { EmailConfig, EmailProvider } from './email-sender.js';
import { MARCA } from './marca.js';

export const NOME_REMETENTE_PADRAO = MARCA.nome;

export function lerConfiguracaoDeEmail(config: ConfigService): EmailConfig | null {
  const provider = config.get<string>('EMAIL_PROVIDER') ?? 'none';
  const apiKey = config.get<string>('EMAIL_API_KEY');
  const fromEmail = config.get<string>('EMAIL_FROM');
  if (provider === 'none' || !apiKey || !fromEmail) return null;
  return {
    provider: provider as EmailProvider,
    apiKey,
    fromEmail,
    fromName: config.get<string>('EMAIL_FROM_NAME') ?? NOME_REMETENTE_PADRAO,
    baseUrl: config.get<string>('EMAIL_API_BASE_URL') || undefined,
  };
}
