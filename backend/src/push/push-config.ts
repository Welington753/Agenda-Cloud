// Chaves VAPID do ambiente (já validadas em config/env.validation.ts). Sem
// as três variáveis, o push fica DESLIGADO: nada é enviado e a área real diz
// que o servidor não envia notificações. A chave privada nunca sai daqui
// para resposta, log ou banco.
import type { ConfigService } from '@nestjs/config';
import type { ChavesVapid } from './web-push-crypto.js';

export function lerChavesVapid(config: ConfigService): ChavesVapid | null {
  const publicKey = config.get<string>('WEB_PUSH_VAPID_PUBLIC_KEY');
  const privateKey = config.get<string>('WEB_PUSH_VAPID_PRIVATE_KEY');
  const subject = config.get<string>('WEB_PUSH_SUBJECT');
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}
