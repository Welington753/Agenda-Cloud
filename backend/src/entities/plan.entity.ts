// Global — catálogo de planos, nunca pertence a um tenant específico (é o
// tenant que referencia um plano, não o contrário). Espelha `DefinicaoPlano`
// em src/lib/planos.ts.
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import type { PlanFeature } from './plan-feature.entity.js';
import type { Tenant } from './tenant.entity.js';

@Entity('plans')
export class Plan {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  // Chave de negócio estável (ex.: "essencial", "equipe", "pro") — espelha
  // `CodigoPlano` de src/lib/types.ts.
  @Index('uq_plans_code', { unique: true })
  @Column({ type: 'varchar' })
  code!: string;

  @Column({ type: 'varchar' })
  name!: string;

  // Sempre inteiro/centavos — nunca float. `null` = preço ainda não aprovado
  // comercialmente ("não definido"); nunca usar 0 para representar isso.
  @Column({ type: 'int', nullable: true })
  priceCents!: number | null;

  @Column({ type: 'varchar' })
  shortDescription!: string;

  @Column({ type: 'int' })
  maxProfessionals!: number;

  @Column({ type: 'int' })
  maxUnits!: number;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', precision: 3 })
  updatedAt!: Date;

  @OneToMany('PlanFeature', (planFeature: PlanFeature) => planFeature.plan)
  planFeatures!: PlanFeature[];

  @OneToMany('Tenant', (tenant: Tenant) => tenant.plan)
  tenants!: Tenant[];
}
