// Contratos da inscrição de push: exatamente o que `PushSubscription.toJSON()`
// do navegador entrega. `.strict()` recusa campo desconhecido; o pipe nunca
// ecoa o valor recebido (o endpoint é credencial de entrega).
import { z } from 'zod';
import { TAMANHO_MAXIMO_DO_ENDPOINT } from './push-endpoint.js';

const endpoint = z.string().min(1).max(TAMANHO_MAXIMO_DO_ENDPOINT);

export const pushSubscriptionSchema = z
  .object({
    endpoint,
    expirationTime: z.number().nullable().optional(),
    keys: z
      .object({
        p256dh: z.string().min(1).max(200),
        auth: z.string().min(1).max(100),
      })
      .strict(),
  })
  .strict();

export type PushSubscriptionDto = z.infer<typeof pushSubscriptionSchema>;

export const pushEndpointSchema = z.object({ endpoint }).strict();

export type PushEndpointDto = z.infer<typeof pushEndpointSchema>;
