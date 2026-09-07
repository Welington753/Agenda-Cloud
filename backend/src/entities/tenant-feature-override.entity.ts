// Tenant-owned. Exceção do master por tenant (equivalente a
// Estabelecimento.featuresDesativadas em src/lib/types.ts). `enabled: false`
// é o único caso usado hoje (desativar algo que o plano incluiria); a coluna
// já suporta o inverso sem migração futura.
import {
  BeforeInsert,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import type { Feature } from './feature.entity.js';
import type { Tenant } from './tenant.entity.js';

// `tenantId` não leva `@Index()` próprio: `uq_tenant_feature_overrides_tenant_feature`
// abaixo já é UNIQUE (tenant_id, feature_id) — o índice btree dessa constraint
// cobre filtro só por tenant_id (regra do prefixo mais à esquerda), e não há
// nenhuma consulta real no código hoje que precise de um índice dedicado
// (Lote 5B.3 — gap identificado na auditoria de schema:log, ver
// docs/audits/neon-lote-5-migration-review.md).
@Entity('tenant_feature_overrides')
@Unique('uq_tenant_feature_overrides_tenant_feature', ['tenantId', 'featureId'])
export class TenantFeatureOverride {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @Column({ type: 'varchar', length: 30 })
  tenantId!: string;

  @Column({ type: 'varchar', length: 30 })
  featureId!: string;

  @Column({ type: 'boolean' })
  enabled!: boolean;

  @ManyToOne('Tenant', (tenant: Tenant) => tenant.featureOverrides, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'fk_tenant_feature_overrides_tenant' })
  tenant!: Tenant;

  @ManyToOne('Feature', (feature: Feature) => feature.tenantOverrides, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'feature_id', foreignKeyConstraintName: 'fk_tenant_feature_overrides_feature' })
  feature!: Feature;
}
