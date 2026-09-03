// Tenant-owned. Espelha `Profissional` em src/lib/types.ts.
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryColumn,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import type { Appointment } from './appointment.entity.js';
import type { CommissionEntry } from './commission-entry.entity.js';
import type { CommissionRule } from './commission-rule.entity.js';
import type { Membership } from './membership.entity.js';
import type { ProfessionalSchedule } from './professional-schedule.entity.js';
import type { ProfessionalService } from './professional-service.entity.js';
import type { Tenant } from './tenant.entity.js';
import type { TimeBlock } from './time-block.entity.js';
import type { Unit } from './unit.entity.js';

@Entity('professionals')
export class Professional {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @Index()
  @Column({ type: 'varchar', length: 30 })
  tenantId!: string;

  // Opcional e não filtrado nesta fase — preparação para múltiplas unidades.
  @Column({ type: 'varchar', length: 30, nullable: true })
  unitId?: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar' })
  avatarInitials!: string;

  @Column({ type: 'varchar' })
  avatarColor!: string;

  @Column({ type: 'boolean', default: true })
  onlineBookingActive!: boolean;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @ManyToOne('Tenant', (tenant: Tenant) => tenant.professionals, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @ManyToOne('Unit', (unit: Unit) => unit.professionals, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'unit_id' })
  unit?: Unit;

  @OneToMany(
    'ProfessionalSchedule',
    (schedule: ProfessionalSchedule) => schedule.professional,
  )
  schedules!: ProfessionalSchedule[];

  @OneToMany(
    'ProfessionalService',
    (professionalService: ProfessionalService) => professionalService.professional,
  )
  services!: ProfessionalService[];

  @OneToOne('Membership', (membership: Membership) => membership.professional)
  membership?: Membership;

  @OneToMany('TimeBlock', (timeBlock: TimeBlock) => timeBlock.professional)
  timeBlocks!: TimeBlock[];

  @OneToMany('Appointment', (appointment: Appointment) => appointment.professional)
  appointments!: Appointment[];

  @OneToMany('CommissionRule', (rule: CommissionRule) => rule.professional)
  commissionRules!: CommissionRule[];

  @OneToMany('CommissionEntry', (entry: CommissionEntry) => entry.professional)
  commissionEntries!: CommissionEntry[];
}
