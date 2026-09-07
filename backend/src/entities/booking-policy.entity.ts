// Tenant-owned (1:1 com Tenant). Espelha `RegrasAgendamento` em
// src/lib/types.ts. `visitGuidance` (novo, seção 3.2/6.2) é texto livre
// opcional, sempre renderizado como texto simples — nunca HTML.
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
// `uq_booking_policies_tenant_id` via `SnakeNamingStrategy.relationConstraintName`
// (ver database/snake-naming-strategy.ts); um índice único explícito aqui
// duplicaria a constraint (Lote 5B.3).
@Entity('booking_policies')
export class BookingPolicy {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @Column({ type: 'varchar', length: 30 })
  tenantId!: string;

  @Column({ type: 'int' })
  minLeadMinutes!: number;

  @Column({ type: 'int' })
  maxFutureDays!: number;

  @Column({ type: 'int' })
  cancellationHours!: number;

  @Column({ type: 'boolean' })
  autoConfirm!: boolean;

  @Column({ type: 'boolean' })
  allowAnyProfessional!: boolean;

  @Column({ type: 'boolean' })
  allowClientReschedule!: boolean;

  @Column({ type: 'boolean' })
  requireClientPhone!: boolean;

  @Column({ type: 'boolean' })
  requireClientEmail!: boolean;

  @Column({ type: 'boolean' })
  showPublicPrice!: boolean;

  @Column({ type: 'int' })
  defaultBufferMinutes!: number;

  // Novo (seção 3.2/6.2) — espelha `orientacoesAntesVisita` de
  // src/lib/types.ts.
  @Column({ type: 'varchar', nullable: true })
  visitGuidance?: string;

  @OneToOne('Tenant', (tenant: Tenant) => tenant.bookingPolicy, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'tenant_id', foreignKeyConstraintName: 'fk_booking_policies_tenant' })
  tenant!: Tenant;
}
