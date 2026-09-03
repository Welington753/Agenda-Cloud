// Tenant-owned. Exceção do master por tenant (equivalente a
// Estabelecimento.featuresDesativadas em src/lib/types.ts). `enabled: false`
// é o único caso usado hoje (desativar algo que o plano incluiria); a coluna
// já suporta o inverso sem migração futura.
import {
  BeforeInsert,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import type { Feature } from './feature.entity.js';
import type { Tenant } from './tenant.entity.js';

@Entity('tenant_feature_overrides')
@Unique(['tenantId', 'featureId'])
export class TenantFeatureOverride {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @Index()
  @Column({ type: 'varchar', length: 30 })
  tenantId!: string;

  @Column({ type: 'varchar', length: 30 })
  featureId!: string;

  @Column({ type: 'boolean' })
  enabled!: boolean;

  @ManyToOne('Tenant', (tenant: Tenant) => tenant.featureOverrides, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @ManyToOne('Feature', (feature: Feature) => feature.tenantOverrides, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'feature_id' })
  feature!: Feature;
}
