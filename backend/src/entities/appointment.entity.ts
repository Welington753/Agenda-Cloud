// Tenant-owned. Núcleo da agenda — espelha `Agendamento` em src/lib/types.ts.
// `consumerNameSnapshot`/`consumerWhatsappSnapshot` são histórico imutável
// proposital (preservam o que era verdade no momento do agendamento, mesmo
// que o cadastro do consumidor mude depois) — não denormalização acidental.
//
// `CHECK ("end_at" > "start_at")` e `EXCLUDE USING gist` (anti-sobreposição)
// são declarados abaixo via `@Check`/`@Exclusion` (Lote 5B.2) — o pacote
// TypeORM instalado (1.1.1) suporta os dois via decorator de classe,
// diferente do TypeORM 0.3.x comum e do Prisma (nenhum dos dois tinha DSL
// pra isso). Nomes e expressões idênticos aos de
// `1788782400000-InitialSchema.ts`, conferido por
// `initial-schema-appointments.spec.ts`.
//
// Índices (correção pós-Lote 3): as duas consultas reais da agenda são
// sempre por tenant primeiro — "horários de um profissional" e "lista por
// status" — por isso os dois índices compostos abaixo lideram com
// `tenant_id`. Não existe índice avulso em `tenantId`/`status`/`startAt`
// sozinhos: qualquer um desses três, sozinho, seria redundante (o prefixo
// esquerdo de um índice composto já serve `WHERE tenant_id = $1`) e uma
// consulta sem `tenant_id` nunca é um caso de uso real neste domínio
// (vazaria dado entre estabelecimentos).
import {
  BeforeInsert,
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Exclusion,
  ForeignKey,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import { AppointmentStatus } from './enums/appointment-status.enum.js';
import type { AppointmentItem } from './appointment-item.entity.js';
import type { AppointmentResource } from './appointment-resource.entity.js';
import type { AppointmentStatusChange } from './appointment-status-change.entity.js';
import type { CommissionEntry } from './commission-entry.entity.js';
import type { Consumer } from './consumer.entity.js';
import type { Professional } from './professional.entity.js';
import type { Tenant } from './tenant.entity.js';
import type { Unit } from './unit.entity.js';

@Entity('appointments')
@Index('idx_appointments_tenant_id_professional_id_start_at_end_at', [
  'tenantId',
  'professionalId',
  'startAt',
  'endAt',
])
@Index('idx_appointments_tenant_id_status_start_at', ['tenantId', 'status', 'startAt'])
@Unique('uq_appointments_tenant_id', ['tenantId', 'id'])
@Check('ck_appointments_end_after_start', 'end_at > start_at')
@Exclusion(
  'appointments_no_overlap_excl',
  `USING gist (tenant_id WITH =, professional_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE (status <> 'CANCELED')`,
)
@ForeignKey('Professional', ['tenantId', 'professionalId'], ['tenantId', 'id'], {
  name: 'fk_appointments_tenant_professional',
  onDelete: 'RESTRICT',
})
@ForeignKey('Consumer', ['tenantId', 'consumerId'], ['tenantId', 'id'], {
  name: 'fk_appointments_tenant_consumer',
  onDelete: 'RESTRICT',
})
export class Appointment {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @Column({ type: 'varchar', length: 30 })
  tenantId!: string;

  @Column({ type: 'varchar', length: 30 })
  unitId!: string;

  @Column({ type: 'varchar', length: 30 })
  consumerId!: string;

  @Column({ type: 'varchar' })
  consumerNameSnapshot!: string;

  @Column({ type: 'varchar' })
  consumerWhatsappSnapshot!: string;

  @Column({ type: 'varchar', length: 30 })
  professionalId!: string;

  @Column({ type: 'timestamptz', precision: 3 })
  startAt!: Date;

  @Column({ type: 'timestamptz', precision: 3 })
  endAt!: Date;

  @Column({
    type: 'enum',
    enum: AppointmentStatus,
    enumName: 'appointment_status',
    default: AppointmentStatus.PENDING,
  })
  status!: AppointmentStatus;

  @Column({ type: 'varchar', nullable: true })
  notes?: string;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @ManyToOne('Tenant', (tenant: Tenant) => tenant.appointments, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'fk_appointments_tenant' })
  tenant!: Tenant;

  @ManyToOne('Unit', (unit: Unit) => unit.appointments, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'unit_id', foreignKeyConstraintName: 'fk_appointments_unit' })
  unit!: Unit;

  // FK real é a composta de classe (fk_appointments_tenant_consumer) acima —
  // createForeignKeyConstraints:false evita uma segunda FK simples duplicada
  // na mesma coluna consumer_id.
  @ManyToOne('Consumer', (consumer: Consumer) => consumer.appointments, {
    onDelete: 'RESTRICT',
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'consumer_id' })
  consumer!: Consumer;

  // FK real é a composta de classe (fk_appointments_tenant_professional)
  // acima — mesma razão do `consumer` logo abaixo.
  @ManyToOne('Professional', (professional: Professional) => professional.appointments, {
    onDelete: 'RESTRICT',
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'professional_id' })
  professional!: Professional;

  @OneToMany('AppointmentItem', (item: AppointmentItem) => item.appointment)
  items!: AppointmentItem[];

  @OneToMany(
    'AppointmentResource',
    (appointmentResource: AppointmentResource) => appointmentResource.appointment,
  )
  resources!: AppointmentResource[];

  @OneToMany(
    'AppointmentStatusChange',
    (statusChange: AppointmentStatusChange) => statusChange.appointment,
  )
  statusChanges!: AppointmentStatusChange[];

  @OneToOne('CommissionEntry', (entry: CommissionEntry) => entry.appointment)
  commissionEntry?: CommissionEntry;
}
