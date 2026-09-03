// Tenant-owned. Núcleo da agenda — espelha `Agendamento` em src/lib/types.ts.
// `consumerNameSnapshot`/`consumerWhatsappSnapshot` são histórico imutável
// proposital (preservam o que era verdade no momento do agendamento, mesmo
// que o cadastro do consumidor mude depois) — não denormalização acidental.
//
// `CHECK ("end_at" > "start_at")` e `EXCLUDE USING gist` (anti-sobreposição)
// NÃO são criados aqui — são SQL bruto de migration (Lote 5, seção 3.3 do
// plano), porque o TypeORM não representa nenhum dos dois via decorator de
// entidade, assim como o Prisma também não tinha DSL para isso. Colunas e
// relações já ficam prontas para quando a migration os adicionar.
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
@Index(['tenantId', 'professionalId', 'startAt', 'endAt'])
@Index(['tenantId', 'status', 'startAt'])
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
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @ManyToOne('Unit', (unit: Unit) => unit.appointments, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'unit_id' })
  unit!: Unit;

  @ManyToOne('Consumer', (consumer: Consumer) => consumer.appointments, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'consumer_id' })
  consumer!: Consumer;

  @ManyToOne('Professional', (professional: Professional) => professional.appointments, {
    onDelete: 'RESTRICT',
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
