// Tenant-owned. "Itens do agendamento" — extraído de
// `Agendamento.servicoId`/`precoCentavos` (src/lib/types.ts) para tabela
// filha. Hoje sempre 1 linha por agendamento (preserva o comportamento
// atual), mas já prepara suporte a múltiplos serviços por agendamento sem
// exigir nova migration. `priceCentsSnapshot` é o preço congelado no momento
// do agendamento — nunca relido de `Service.priceCents` atual.
//
// `tenantId` é uma adição desta execução do Lote 3 além do mapeamento
// original da seção 3.2 (mesma decisão e ressalva de
// `professional-service.entity.ts`) — denormalizado a partir de
// `Appointment.tenantId`.
import {
  BeforeInsert,
  Check,
  Column,
  Entity,
  ForeignKey,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import type { Appointment } from './appointment.entity.js';
import type { Service } from './service.entity.js';

@Entity('appointment_items')
@Check(
  'ck_appointment_items_price_cents_snapshot_non_negative',
  'price_cents_snapshot IS NULL OR price_cents_snapshot >= 0',
)
@ForeignKey('Appointment', ['tenantId', 'appointmentId'], ['tenantId', 'id'], {
  name: 'fk_appointment_items_tenant_appointment',
  onDelete: 'CASCADE',
})
export class AppointmentItem {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @Index('idx_appointment_items_tenant_id')
  @Column({ type: 'varchar', length: 30 })
  tenantId!: string;

  @Index('idx_appointment_items_appointment_id')
  @Column({ type: 'varchar', length: 30 })
  appointmentId!: string;

  @Column({ type: 'varchar', length: 30 })
  serviceId!: string;

  // Preço congelado no momento do agendamento — ausente quando o serviço não
  // tinha preço definido ("sob consulta").
  @Column({ type: 'int', nullable: true })
  priceCentsSnapshot?: number;

  @Column({ type: 'int' })
  durationMinutesSnapshot!: number;

  @Column({ type: 'int', default: 0 })
  position!: number;

  // FK real é a composta de classe (fk_appointment_items_tenant_appointment)
  // acima.
  @ManyToOne('Appointment', (appointment: Appointment) => appointment.items, {
    onDelete: 'CASCADE',
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'appointment_id' })
  appointment!: Appointment;

  @ManyToOne('Service', (service: Service) => service.appointmentItems, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'service_id', foreignKeyConstraintName: 'fk_appointment_items_service' })
  service!: Service;
}
