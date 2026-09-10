import { describe, expect, it } from 'vitest';
import { TenantStatus } from '../entities/enums/tenant-status.enum.js';
import { isTenantUsableForSession } from './tenant-access.js';

describe('isTenantUsableForSession', () => {
  it('permite TRIAL', () => {
    expect(isTenantUsableForSession(TenantStatus.TRIAL)).toBe(true);
  });

  it('permite ACTIVE', () => {
    expect(isTenantUsableForSession(TenantStatus.ACTIVE)).toBe(true);
  });

  it('bloqueia SUSPENDED', () => {
    expect(isTenantUsableForSession(TenantStatus.SUSPENDED)).toBe(false);
  });

  it('bloqueia PAST_DUE', () => {
    expect(isTenantUsableForSession(TenantStatus.PAST_DUE)).toBe(false);
  });

  it('bloqueia CANCELED', () => {
    expect(isTenantUsableForSession(TenantStatus.CANCELED)).toBe(false);
  });
});
