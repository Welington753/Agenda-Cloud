// Nova (seção 5.2). Espelha `LancamentoComissao` em src/lib/types.ts —
// snapshot financeiro imutável do momento do cálculo, nunca recalculado a
// partir da `CommissionRule` atual. `@Unique` em `appointmentId`: no máximo
// um lançamento por agendamento, para sempre, mesmo depois de estornado e
// reativado (mesmo registro, nunca uma segunda linha — mesma garantia de
// `lancamentoComissaoRepository.obterPorAgendamentoId`).
//
// Todas as FKs em RESTRICT: registro financeiro histórico, nunca apagado em
// cascata por remoção de profissional/serviço/agendamento (agendamento em si
// também nunca é apagado, só muda de status).
//
// Conclusão idempotente, cancelamento/falta nunca geram lançamento,
// reativação sem recalcular a regra: regras de serviço (lote posterior),
// já garantidas estruturalmente aqui pela unicidade de `appointmentId` e
// pelos campos de snapshot serem simples colunas (nunca derivadas por
// trigger/generated column).
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryColumn,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import { CommissionEntryStatus } from './enums/commission-entry-status.enum.js';
import { CommissionType } from './enums/commission-type.enum.js';
import type { Appointment } from './appointment.entity.js';
import type { Professional } from './professional.entity.js';
import type { Service } from './service.entity.js';
import type { Tenant } from './tenant.entity.js';

@Entity('commission_entries')
@Index(['professionalId', 'serviceDate'])
export class CommissionEntry {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @Index()
  @Column({ type: 'varchar', length: 30 })
  tenantId!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 30 })
  appointmentId!: string;

  @Column({ type: 'varchar', length: 30 })
  professionalId!: string;

  @Column({ type: 'varchar', length: 30 })
  serviceId!: string;

  // Preço do agendamento congelado no momento do cálculo — nunca relido de
  // `Service.priceCents` atual.
  @Column({ type: 'int' })
  priceCentsSnapshot!: number;

  @Column({ type: 'enum', enum: CommissionType })
  appliedType!: CommissionType;

  @Column({ type: 'int' })
  appliedValue!: number;

  @Column({ type: 'int' })
  professionalCents!: number;

  @Column({ type: 'int' })
  establishmentCents!: number;

  // = Appointment.startAt no momento do cálculo.
  @Column({ type: 'timestamptz', precision: 3 })
  serviceDate!: Date;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  calculatedAt!: Date;

  @Column({
    type: 'enum',
    enum: CommissionEntryStatus,
    default: CommissionEntryStatus.CONFIRMED,
  })
  status!: CommissionEntryStatus;

  @Column({ type: 'timestamptz', precision: 3, nullable: true })
  reversedAt?: Date;

  @Column({ type: 'timestamptz', precision: 3, nullable: true })
  reactivatedAt?: Date;

  @ManyToOne('Tenant', (tenant: Tenant) => tenant.commissionEntries, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @OneToOne('Appointment', (appointment: Appointment) => appointment.commissionEntry, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'appointment_id' })
  appointment!: Appointment;

  @ManyToOne('Professional', (professional: Professional) => professional.commissionEntries, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'professional_id' })
  professional!: Professional;

  @ManyToOne('Service', (service: Service) => service.commissionEntries, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'service_id' })
  service!: Service;
}
