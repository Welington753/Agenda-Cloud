// Tenant-owned. "Recursos utilizados pelo agendamento" — sem dado de
// demonstração ainda no frontend (recurso não entra no motor de
// disponibilidade, ver src/lib/seed-data.ts).
//
// `tenantId` é uma adição desta execução do Lote 3 além do mapeamento
// original da seção 3.2 — mesma decisão/ressalva das demais tabelas de
// junção desta lista, denormalizado a partir de `Appointment.tenantId`.
import {
  BeforeInsert,
  Column,
  Entity,
  ForeignKey,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import type { Appointment } from './appointment.entity.js';
import type { Resource } from './resource.entity.js';

@Entity('appointment_resources')
@Unique('uq_appointment_resources_tenant_appointment_resource', [
  'tenantId',
  'appointmentId',
  'resourceId',
])
@ForeignKey('Appointment', ['tenantId', 'appointmentId'], ['tenantId', 'id'], {
  name: 'fk_appointment_resources_tenant_appointment',
  onDelete: 'CASCADE',
})
export class AppointmentResource {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @Index('idx_appointment_resources_tenant_id')
  @Column({ type: 'varchar', length: 30 })
  tenantId!: string;

  @Column({ type: 'varchar', length: 30 })
  appointmentId!: string;

  @Column({ type: 'varchar', length: 30 })
  resourceId!: string;

  // FK real é a composta de classe (fk_appointment_resources_tenant_appointment)
  // acima.
  @ManyToOne('Appointment', (appointment: Appointment) => appointment.resources, {
    onDelete: 'CASCADE',
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'appointment_id' })
  appointment!: Appointment;

  @ManyToOne('Resource', (resource: Resource) => resource.appointmentResources, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'resource_id', foreignKeyConstraintName: 'fk_appointment_resources_resource' })
  resource!: Resource;
}
