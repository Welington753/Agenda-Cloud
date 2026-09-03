// Global — catálogo de funcionalidades contratáveis. Espelha `Feature` (union
// de 13 strings) em src/lib/types.ts, aqui como chave estável `FeatureKey`.
import {
  BeforeInsert,
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import { FeatureKey } from './enums/feature-key.enum.js';
import type { PlanFeature } from './plan-feature.entity.js';
import type { TenantFeatureOverride } from './tenant-feature-override.entity.js';

@Entity('features')
export class Feature {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @Index({ unique: true })
  @Column({ type: 'enum', enum: FeatureKey })
  key!: FeatureKey;

  @Column({ type: 'varchar' })
  label!: string;

  @OneToMany('PlanFeature', (planFeature: PlanFeature) => planFeature.feature)
  planFeatures!: PlanFeature[];

  @OneToMany(
    'TenantFeatureOverride',
    (override: TenantFeatureOverride) => override.feature,
  )
  tenantOverrides!: TenantFeatureOverride[];
}
