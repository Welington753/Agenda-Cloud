// Tenant-owned. Unidade física do estabelecimento — hoje cada tenant tem uma
// única unidade principal semeada (espelha `Unidade` em src/lib/types.ts).
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import type { Appointment } from './appointment.entity.js';
import type { Professional } from './professional.entity.js';
import type { Tenant } from './tenant.entity.js';

@Entity('units')
export class Unit {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @Index()
  @Column({ type: 'varchar', length: 30 })
  tenantId!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar' })
  address!: string;

  @Column({ type: 'varchar' })
  timezone!: string;

  @Column({ type: 'boolean', default: false })
  isPrimary!: boolean;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @ManyToOne('Tenant', (tenant: Tenant) => tenant.units, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @OneToMany('Professional', (professional: Professional) => professional.unit)
  professionals!: Professional[];

  @OneToMany('Appointment', (appointment: Appointment) => appointment.unit)
  appointments!: Appointment[];
}
