// Campos da assinatura modular comuns à criação do estabelecimento
// (accounts/accounts.dto.ts) e à alteração (platform/platform.dto.ts).
import { z } from 'zod';
import { MAX_PRICE_CENTS } from '../migrations/1793318400000-PlatformPortal.js';
import { MAX_TEAM_USER_LIMIT } from '../migrations/1793836800000-ModularSubscription.js';

export const teamUserLimitSchema = z.number().int().min(0).max(MAX_TEAM_USER_LIMIT);
const addonCodeSchema = z.string().trim().regex(/^[A-Z_]{2,40}$/);

export const subscriptionChoiceShape = {
  /** Códigos dos adicionais contratados (só os disponíveis são aceitos). */
  addons: z.array(addonCodeSchema).max(20),
  /** Valor mensal combinado, em centavos; ausente ou `null`: o total do
   * catálogo. Diferente do catálogo exige `reason`. */
  contractedTotalCents: z.number().int().min(1).max(MAX_PRICE_CENTS).nullable().optional(),
  reason: z.string().trim().min(3).max(300).optional(),
  /** Limite de usuários da equipe com login. Zero: nenhuma conta de equipe. */
  teamUserLimit: teamUserLimitSchema,
};
