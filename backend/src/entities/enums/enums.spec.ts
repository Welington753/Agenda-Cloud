// Metadata puro — nenhuma rede, nenhum DataSource, só valores de enum
// TypeScript comparados contra o mapeamento acordado no plano (ver
// docs/plans/migracao-nestjs-typeorm-neon.md, seção 3.1) e contra o Prisma
// original (prisma/schema.prisma).
import { describe, expect, it } from 'vitest';
import { AppointmentStatus } from './appointment-status.enum.js';
import { AuditAction } from './audit-action.enum.js';
import { BusinessCategory } from './business-category.enum.js';
import { CommissionEntryStatus } from './commission-entry-status.enum.js';
import { CommissionType } from './commission-type.enum.js';
import { EstablishmentRole } from './establishment-role.enum.js';
import { FeatureKey } from './feature-key.enum.js';
import { InviteStatus } from './invite-status.enum.js';
import { InviteType } from './invite-type.enum.js';
import { PageTemplate } from './page-template.enum.js';
import { Permission } from './permission.enum.js';
import { PermissionMode } from './permission-mode.enum.js';
import { PlatformPermission } from './platform-permission.enum.js';
import { PlatformRole } from './platform-role.enum.js';
import { ResourceType } from './resource-type.enum.js';
import { ServiceModality } from './service-modality.enum.js';
import { TenantStatus } from './tenant-status.enum.js';
import { UserStatus } from './user-status.enum.js';

const ALL_ENUMS: Record<string, Record<string, string>> = {
  PlatformRole,
  PlatformPermission,
  UserStatus,
  TenantStatus,
  BusinessCategory,
  PageTemplate,
  FeatureKey,
  EstablishmentRole,
  Permission,
  PermissionMode,
  InviteType,
  InviteStatus,
  AuditAction,
  ResourceType,
  ServiceModality,
  AppointmentStatus,
  CommissionType,
  CommissionEntryStatus,
};

describe('enums do domínio', () => {
  it('registra exatamente 18 enums (16 herdados do schema.prisma original + 2 novos: CommissionType, CommissionEntryStatus)', () => {
    // Divergência registrada em relação ao texto da seção 3.1 do plano, que
    // fala em "5 enums novos" / "21 no total": o próprio corpo da seção só
    // define 2 enums genuinamente novos (CommissionType,
    // CommissionEntryStatus) — as outras 3 funcionalidades citadas ali
    // (credencial, sessão, suporte) usam tipos primitivos, sem enum, como o
    // próprio texto da seção também afirma. 16 + 2 = 18, não 21.
    expect(Object.keys(ALL_ENUMS)).toHaveLength(18);
  });

  it('Permission tem os 17 valores originais mais os 2 novos de comissão (19 no total)', () => {
    const valores = Object.values(Permission);
    expect(valores).toHaveLength(19);
    expect(valores).toContain('COMISSOES_VISUALIZAR');
    expect(valores).toContain('COMISSOES_GERENCIAR');
  });

  it('AuditAction tem os 11 valores originais mais os 2 novos de modo de suporte (13 no total)', () => {
    const valores = Object.values(AuditAction);
    expect(valores).toHaveLength(13);
    expect(valores).toContain('TENANT_SUPPORT_ENTERED');
    expect(valores).toContain('TENANT_SUPPORT_EXITED');
  });

  it('CommissionType tem exatamente PERCENTAGE e FIXED', () => {
    expect(Object.values(CommissionType).sort()).toEqual(['FIXED', 'PERCENTAGE']);
  });

  it('CommissionEntryStatus tem exatamente CONFIRMED e REVERSED', () => {
    expect(Object.values(CommissionEntryStatus).sort()).toEqual([
      'CONFIRMED',
      'REVERSED',
    ]);
  });

  it('FeatureKey tem as 13 features já existentes no schema.prisma original', () => {
    expect(Object.values(FeatureKey)).toHaveLength(13);
  });

  it('PlatformRole inclui MASTER_OWNER — papel de plataforma, nunca amarrado a um tenant', () => {
    expect(Object.values(PlatformRole)).toContain('MASTER_OWNER');
  });

  it('nenhum enum tem valor duplicado dentro de si mesmo', () => {
    for (const [nome, enumObjeto] of Object.entries(ALL_ENUMS)) {
      const valores = Object.values(enumObjeto);
      expect(new Set(valores).size, `${nome} tem valores duplicados`).toBe(
        valores.length,
      );
    }
  });
});
