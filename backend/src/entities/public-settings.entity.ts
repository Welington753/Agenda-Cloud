// Tenant-owned (1:1 com Tenant). `isPublished` controla a visibilidade da
// página pública independente do status de cobrança do tenant (campo
// preparado sem equivalente ainda na UI atual — ver
// docs/plans/fundacao-postgresql.md).
import {
  BeforeInsert,
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import type { Tenant } from './tenant.entity.js';

// `tenantId` não leva `@Index({unique:true})` próprio — a relação `@OneToOne`
// dona abaixo já gera automaticamente a UNIQUE CONSTRAINT
// `uq_public_settings_tenant_id` via `SnakeNamingStrategy.relationConstraintName`
// (ver database/snake-naming-strategy.ts); um índice único explícito aqui
// duplicaria a constraint (Lote 5B.3).
@Entity('public_settings')
export class PublicSettings {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

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
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'fk_public_settings_tenant' })
  tenant!: Tenant;
}
