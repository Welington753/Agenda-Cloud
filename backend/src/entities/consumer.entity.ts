// Tenant-owned. Espelha `Consumidor` em src/lib/types.ts. Mesmo telefone pode
// existir em tenants diferentes — isolamento é por tenant + telefone
// normalizado, nunca telefone sozinho.
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
  Unique,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import type { Appointment } from './appointment.entity.js';
import type { Tenant } from './tenant.entity.js';

@Entity('consumers')
@Unique(['tenantId', 'whatsappNormalized'])
export class Consumer {
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
  whatsapp!: string;

  @Index()
  @Column({ type: 'varchar' })
  whatsappNormalized!: string;

  @Column({ type: 'varchar', nullable: true })
  email?: string;

  @Column({ type: 'int', default: 0 })
  totalVisits!: number;

  @Column({ type: 'int', default: 0 })
  totalNoShows!: number;

  @Column({ type: 'timestamptz', precision: 3, nullable: true })
  lastServedAt?: Date;

  @Column({ type: 'timestamptz', precision: 3, nullable: true })
  nextAppointmentAt?: Date;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @ManyToOne('Tenant', (tenant: Tenant) => tenant.consumers, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @OneToMany('Appointment', (appointment: Appointment) => appointment.consumer)
  appointments!: Appointment[];
}
