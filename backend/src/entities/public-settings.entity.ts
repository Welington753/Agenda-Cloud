// Tenant-owned (1:1 com Tenant). `isPublished` controla a visibilidade da
// página pública independente do status de cobrança do tenant (campo
// preparado sem equivalente ainda na UI atual — ver
// docs/plans/fundacao-postgresql.md).
import {
  BeforeInsert,
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import type { Tenant } from './tenant.entity.js';

@Entity('public_settings')
export class PublicSettings {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 30 })
  tenantId!: string;

  @Column({ type: 'boolean', default: true })
  isPublished!: boolean;

  // Dias da semana em funcionamento (0 = domingo, ver DiaSemana em
  // src/lib/types.ts).
  @Column({ type: 'int', array: true })
  operatingDays!: number[];

  @Column({ type: 'varchar' })
  openTime!: string;

  @Column({ type: 'varchar' })
  closeTime!: string;

  @OneToOne('Tenant', (tenant: Tenant) => tenant.publicSettings, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;
}
