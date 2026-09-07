// Tenant-owned. Espelha `Servico` em src/lib/types.ts. `priceCents` nullable
// = "sob consulta" (sem preço público definido).
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
import { ServiceModality } from './enums/service-modality.enum.js';
import type { AppointmentItem } from './appointment-item.entity.js';
import type { CommissionEntry } from './commission-entry.entity.js';
import type { CommissionRule } from './commission-rule.entity.js';
import type { ProfessionalService } from './professional-service.entity.js';
import type { Tenant } from './tenant.entity.js';

@Entity('services')
export class Service {
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
  shortDescription!: string;

  // Ausente = sem preço definido ("sob consulta"). Sempre inteiro/centavos.
  @Column({ type: 'int', nullable: true })
  priceCents?: number;

  @Column({ type: 'boolean', default: true })
  priceVisible!: boolean;

  @Column({ type: 'int' })
  durationMinutes!: number;

  @Column({ type: 'int', default: 0 })
  bufferAfterMinutes!: number;

  @Column({
    type: 'enum',
    enum: ServiceModality,
    enumName: 'service_modality',
    default: ServiceModality.IN_PERSON,
  })
  modality!: ServiceModality;

  @Column({ type: 'boolean', default: true })
  activeInPublicBooking!: boolean;

  @Column({ type: 'boolean', default: false })
  requiresManualConfirmation!: boolean;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @ManyToOne('Tenant', (tenant: Tenant) => tenant.services, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @OneToMany(
    'ProfessionalService',
    (professionalService: ProfessionalService) => professionalService.service,
  )
  professionals!: ProfessionalService[];

  @OneToMany('AppointmentItem', (item: AppointmentItem) => item.service)
  appointmentItems!: AppointmentItem[];

  @OneToMany('CommissionRule', (rule: CommissionRule) => rule.service)
  commissionRules!: CommissionRule[];

  @OneToMany('CommissionEntry', (entry: CommissionEntry) => entry.service)
  commissionEntries!: CommissionEntry[];
}
