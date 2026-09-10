import { describe, expect, it } from 'vitest';
import { TRIAL_DURATION_DAYS, computeTrialWindow } from './trial-policy.js';

describe('computeTrialWindow', () => {
  it('trial começa exatamente no instante informado', () => {
    const now = new Date('2026-09-10T12:00:00.000Z');
    const { trialStartAt } = computeTrialWindow(now);
    expect(trialStartAt).toEqual(now);
  });

  it('trial termina exatamente 14 dias depois, em UTC', () => {
    const now = new Date('2026-09-10T12:00:00.000Z');
    const { trialEndAt } = computeTrialWindow(now);
    expect(trialEndAt.toISOString()).toBe('2026-09-24T12:00:00.000Z');
  });

  it('TRIAL_DURATION_DAYS é 14', () => {
    expect(TRIAL_DURATION_DAYS).toBe(14);
  });

  it('respeita virada de mês/ano corretamente', () => {
    const now = new Date('2026-12-25T00:00:00.000Z');
    const { trialEndAt } = computeTrialWindow(now);
    expect(trialEndAt.toISOString()).toBe('2027-01-08T00:00:00.000Z');
  });
});
