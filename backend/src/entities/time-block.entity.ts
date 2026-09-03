// Tenant-owned. Espelha `Bloqueio` em src/lib/types.ts. Índice
// (professionalId, startAt, endAt) cobre a consulta mais comum do motor de
// disponibilidade (bloqueiosParaOcupados, src/lib/availability/engine.ts).
import {
  BeforeInsert,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import type { Professional } from './professional.entity.js';
import type { Tenant } from './tenant.entity.js';

@Entity('time_blocks')
@Index(['professionalId', 'startAt', 'endAt'])
export class TimeBlock {
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
  professionalId!: string;

  @Column({ type: 'timestamptz', precision: 3 })
  startAt!: Date;

  @Column({ type: 'timestamptz', precision: 3 })
  endAt!: Date;

  @Column({ type: 'varchar' })
  reason!: string;

  @ManyToOne('Tenant', (tenant: Tenant) => tenant.timeBlocks, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @ManyToOne('Professional', (professional: Professional) => professional.timeBlocks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'professional_id' })
  professional!: Professional;
}
