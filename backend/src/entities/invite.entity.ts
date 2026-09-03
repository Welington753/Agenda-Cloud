// Duplo propósito por design (ver `InviteType`): convite de estabelecimento
// (`tenantId` presente, `establishmentRole` preenchido) ou convite de
// administrador de plataforma (`tenantId` nulo, `platformRole` preenchido) —
// espelha `Convite`/`conviteRepository` em src/lib/types.ts e
// src/components/master/modal-convite-plataforma.tsx. `tenantId` fica
// nullable de propósito (não é uma entidade tenant-owned pura); nunca guarda
// o token em texto puro, só `tokenHash`.
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
import { EstablishmentRole } from './enums/establishment-role.enum.js';
import { InviteStatus } from './enums/invite-status.enum.js';
import { InviteType } from './enums/invite-type.enum.js';
import { PlatformRole } from './enums/platform-role.enum.js';
import type { Tenant } from './tenant.entity.js';
import type { User } from './user.entity.js';

@Entity('invites')
@Index(['tenantId', 'status'])
export class Invite {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @Column({ type: 'enum', enum: InviteType })
  type!: InviteType;

  @Column({ type: 'varchar' })
  targetName!: string;

  @Index()
  @Column({ type: 'citext' })
  targetEmail!: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  tenantId?: string;

  @Column({ type: 'enum', enum: EstablishmentRole, nullable: true })
  establishmentRole?: EstablishmentRole;

  @Column({ type: 'enum', enum: PlatformRole, nullable: true })
  platformRole?: PlatformRole;

  @Column({ type: 'enum', enum: InviteStatus, default: InviteStatus.PENDING })
  status!: InviteStatus;

  @Index({ unique: true })
  @Column({ type: 'varchar' })
  tokenHash!: string;

  @Column({ type: 'varchar', length: 30 })
  createdByUserId!: string;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @Column({ type: 'timestamptz', precision: 3 })
  expiresAt!: Date;

  @Column({ type: 'timestamptz', precision: 3, nullable: true })
  acceptedAt?: Date;

  @Column({ type: 'timestamptz', precision: 3, nullable: true })
  revokedAt?: Date;

  @Column({ type: 'varchar', length: 30, nullable: true })
  generatedUserId?: string;

  @ManyToOne('Tenant', (tenant: Tenant) => tenant.invites, {
    onDelete: 'RESTRICT',
    nullable: true,
  })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant;

  @ManyToOne('User', (user: User) => user.createdInvites, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser!: User;
}
