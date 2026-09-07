// Tenant-owned. Substitui `Agendamento.historico` (array embutido em
// src/lib/types.ts, `HistoricoAlteracao`) por uma linha por transição de
// status. `changedBy` é um rótulo livre (ex.: "consumidor", "recepcionista")
// — vira FK de `User` quando a autenticação real existir (Lote 6+).
//
// `tenantId` é uma adição desta execução do Lote 3 além do mapeamento
// original da seção 3.2 — mesma decisão/ressalva das demais tabelas filhas
// de `Appointment` nesta lista, denormalizado a partir de
// `Appointment.tenantId`.
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import { AppointmentStatus } from './enums/appointment-status.enum.js';
import type { Appointment } from './appointment.entity.js';

@Entity('appointment_status_changes')
export class AppointmentStatusChange {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @Index()
  @Column({ type: 'varchar', length: 30 })
  tenantId!: string;

  @Index()
  @Column({ type: 'varchar', length: 30 })
  appointmentId!: string;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  occurredAt!: Date;

  // Ausente na primeira transição (criação do agendamento).
  @Column({ type: 'enum', enum: AppointmentStatus, enumName: 'appointment_status', nullable: true })
  fromStatus?: AppointmentStatus;

  @Column({ type: 'enum', enum: AppointmentStatus, enumName: 'appointment_status' })
  toStatus!: AppointmentStatus;

  @Column({ type: 'varchar' })
  changedBy!: string;

  @ManyToOne('Appointment', (appointment: Appointment) => appointment.statusChanges, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'appointment_id' })
  appointment!: Appointment;
}
