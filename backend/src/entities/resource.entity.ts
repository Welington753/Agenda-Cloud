// Tenant-owned. Espelha `Recurso` em src/lib/types.ts — o motor de
// disponibilidade ainda não verifica conflito de recursos (funcionalidade
// futura), mesma ressalva já registrada no domínio do frontend.
import {
  BeforeInsert,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import { ResourceType } from './enums/resource-type.enum.js';
import type { AppointmentResource } from './appointment-resource.entity.js';
import type { Tenant } from './tenant.entity.js';

@Entity('resources')
export class Resource {
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

  @Column({ type: 'enum', enum: ResourceType, enumName: 'resource_type' })
  type!: ResourceType;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @ManyToOne('Tenant', (tenant: Tenant) => tenant.resources, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @OneToMany(
    'AppointmentResource',
    (appointmentResource: AppointmentResource) => appointmentResource.resource,
  )
  appointmentResources!: AppointmentResource[];
}
