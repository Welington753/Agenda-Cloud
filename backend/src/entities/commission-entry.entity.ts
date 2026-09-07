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
//
// UNIDADE de `appliedValue` (correção pós-Lote 3): mesma representação de
// `CommissionRule.value` — nunca recalculada, é cópia exata do valor da
// regra no momento do cálculo, na mesma unidade que `appliedType` indica.
// `PERCENTAGE`: pontos-base inteiros 0-10000. `FIXED`: centavos inteiros
// >= 0. Nunca float. Mesmo `CHECK` do Lote 5 descrito em
// commission-rule.entity.ts se aplica aqui.
import {
  BeforeInsert,
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
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
@Index('idx_commission_entries_tenant_id_professional_id_service_date', [
  'tenantId',
  'professionalId',
  'serviceDate',
])
@Check(
  'ck_commission_entries_applied_value_range',
  `(applied_type = 'PERCENTAGE' AND applied_value BETWEEN 0 AND 10000) OR (applied_type = 'FIXED' AND applied_value >= 0)`,
)
@Check('ck_commission_entries_professional_cents_non_negative', 'professional_cents >= 0')
@Check('ck_commission_entries_establishment_cents_non_negative', 'establishment_cents >= 0')
@Check('ck_commission_entries_price_cents_snapshot_non_negative', 'price_cents_snapshot >= 0')
@ForeignKey('Appointment', ['tenantId', 'appointmentId'], ['tenantId', 'id'], {
  name: 'fk_commission_entries_tenant_appointment',
  onDelete: 'RESTRICT',
})
@ForeignKey('Professional', ['tenantId', 'professionalId'], ['tenantId', 'id'], {
  name: 'fk_commission_entries_tenant_professional',
  onDelete: 'RESTRICT',
})
@ForeignKey('Service', ['tenantId', 'serviceId'], ['tenantId', 'id'], {
  name: 'fk_commission_entries_tenant_service',
  onDelete: 'RESTRICT',
})
export class CommissionEntry {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  // Sem índice avulso aqui — o índice composto da classe
  // (tenantId, professionalId, serviceDate) já cobre `WHERE tenant_id = $1`
  // sozinho pelo prefixo esquerdo; um índice extra só em tenantId seria
  // redundante.
  @Column({ type: 'varchar', length: 30 })
  tenantId!: string;

  @Index('uq_commission_entries_appointment_id', { unique: true })
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

  @Column({ type: 'enum', enum: CommissionType, enumName: 'commission_type' })
  appliedType!: CommissionType;

  // Mesma unidade de CommissionRule.value: PERCENTAGE em pontos-base
  // 0-10000, FIXED em centavos >= 0. Snapshot — nunca recalculado.
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
    enumName: 'commission_entry_status',
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
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'fk_commission_entries_tenant' })
  tenant!: Tenant;

  // FKs reais são as compostas de classe acima (inclui esta OneToOne — owner
  // side, elegível a `createForeignKeyConstraints` como qualquer many-to-one).
  @OneToOne('Appointment', (appointment: Appointment) => appointment.commissionEntry, {
    onDelete: 'RESTRICT',
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'appointment_id' })
  appointment!: Appointment;

  @ManyToOne('Professional', (professional: Professional) => professional.commissionEntries, {
    onDelete: 'RESTRICT',
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'professional_id' })
  professional!: Professional;

  @ManyToOne('Service', (service: Service) => service.commissionEntries, {
    onDelete: 'RESTRICT',
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'service_id' })
  service!: Service;
}
