// Tenant-owned. Regra de disponibilidade semanal — uma linha por dia da
// semana em uso, em vez do array embutido em `Profissional.horarios`
// (src/lib/types.ts, `HorarioDia`). `weekday` é inteiro puro (0 = domingo),
// não enum.
//
// `tenantId` é uma adição desta execução do Lote 3 além do mapeamento
// original da seção 3.2 (lá a tabela só tinha `professionalId`, herdando o
// tenant transitivamente) — mesma decisão e mesma ressalva de
// `membership-permission-override.entity.ts`: denormalizado a partir de
// `Professional.tenantId`, sem constraint de banco garantindo consistência
// ainda (SQL manual no Lote 5).
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
import type { Professional } from './professional.entity.js';

@Entity('professional_schedules')
@Unique('uq_professional_schedules_tenant_professional_weekday', [
  'tenantId',
  'professionalId',
  'weekday',
])
@ForeignKey('Professional', ['tenantId', 'professionalId'], ['tenantId', 'id'], {
  name: 'fk_professional_schedules_tenant_professional',
  onDelete: 'CASCADE',
})
export class ProfessionalSchedule {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @Index('idx_professional_schedules_tenant_id')
  @Column({ type: 'varchar', length: 30 })
  tenantId!: string;

  @Column({ type: 'varchar', length: 30 })
  professionalId!: string;

  @Column({ type: 'int' })
  weekday!: number;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'varchar' })
  startTime!: string;

  @Column({ type: 'varchar' })
  endTime!: string;

  @Column({ type: 'varchar', nullable: true })
  lunchStart?: string;

  @Column({ type: 'varchar', nullable: true })
  lunchEnd?: string;

  // FK real é a composta de classe (fk_professional_schedules_tenant_professional) acima.
  @ManyToOne('Professional', (professional: Professional) => professional.schedules, {
    onDelete: 'CASCADE',
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'professional_id' })
  professional!: Professional;
}
