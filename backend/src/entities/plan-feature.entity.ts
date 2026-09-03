// Global — junção M:N explícita "o que cada plano inclui por padrão". Hoje
// hardcoded em src/lib/planos.ts (DEFINICOES_PLANO), vira dado real no banco.
import { BeforeInsert, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, Unique } from 'typeorm';
import { generateId } from './common/generate-id.js';
import type { Feature } from './feature.entity.js';
import type { Plan } from './plan.entity.js';

@Entity('plan_features')
@Unique(['planId', 'featureId'])
export class PlanFeature {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @Column({ type: 'varchar', length: 30 })
  planId!: string;

  @Column({ type: 'varchar', length: 30 })
  featureId!: string;

  @ManyToOne('Plan', (plan: Plan) => plan.planFeatures, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_id' })
  plan!: Plan;

  @ManyToOne('Feature', (feature: Feature) => feature.planFeatures, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'feature_id' })
  feature!: Feature;
}
