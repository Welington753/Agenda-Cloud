// Política comercial do trial gratuito (Lote 6B.3) — 14 dias a partir do
// instante de criação do tenant, sempre em UTC. `Tenant` não tem coluna
// dedicada de trial (ver auditoria de schema): `trialStartAt` é o próprio
// `Tenant.createdAt` e `trialEndAt` é derivado aqui, nunca persistido — ambos
// recalculáveis a qualquer momento a partir de `createdAt` + esta constante.
export const TRIAL_DURATION_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function computeTrialWindow(now: Date): {
  trialStartAt: Date;
  trialEndAt: Date;
} {
  return {
    trialStartAt: now,
    trialEndAt: new Date(now.getTime() + TRIAL_DURATION_DAYS * MS_PER_DAY),
  };
}
