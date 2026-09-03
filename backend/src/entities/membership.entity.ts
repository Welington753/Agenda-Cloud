// Tenant-owned. Vínculo de um `User` de tenant com um tenant — é aqui, não na
// pessoa, que vivem o papel e os ajustes individuais de permissão (espelha
// `Membership` em src/lib/types.ts). Usuário de tenant nunca ganha papel
// Master por este relacionamento — `User.platformRole` é inteiramente
// independente (ver docs/plans/migracao-nestjs-typeorm-neon.md, seção 4.3).
//
// Proteção contra mistura de tenant (seção 5): quando `professionalId` está
// presente, `Professional.tenantId` precisa ser igual a `Membership.tenantId`
// — não expressável com segurança por decorators simples do TypeORM (FK
// composta exigiria UNIQUE(tenant_id, id) em `professionals` e um
// `@JoinColumn` de duas colunas); registrado para SQL manual no Lote 5, não
// implementado agora.
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { generateId } from './common/generate-id.js';
import { EstablishmentRole } from './enums/establishment-role.enum.js';
import type { MembershipPermissionOverride } from './membership-permission-override.entity.js';
import type { Professional } from './professional.entity.js';
import type { Tenant } from './tenant.entity.js';
import type { User } from './user.entity.js';

@Entity('memberships')
@Unique(['userId', 'tenantId'])
export class Membership {
  @PrimaryColumn({ type: 'varchar', length: 30 })
  id!: string;

  @BeforeInsert()
  assignId(): void {
    this.id ??= generateId();
  }

  @Column({ type: 'varchar', length: 30 })
  userId!: string;

  @Index()
  @Column({ type: 'varchar', length: 30 })
  tenantId!: string;

  @Column({ type: 'enum', enum: EstablishmentRole })
  role!: EstablishmentRole;

  // Presente quando `role = PROFISSIONAL`, aponta para o registro
  // `Professional` que representa essa pessoa na agenda.
  @Index({ unique: true, where: '"professional_id" IS NOT NULL' })
  @Column({ type: 'varchar', length: 30, nullable: true })
  professionalId?: string;

  @CreateDateColumn({ type: 'timestamptz', precision: 3 })
  createdAt!: Date;

  @ManyToOne('User', (user: User) => user.memberships, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @ManyToOne('Tenant', (tenant: Tenant) => tenant.memberships, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @ManyToOne('Professional', (professional: Professional) => professional.membership, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'professional_id' })
  professional?: Professional;

  @OneToMany(
    'MembershipPermissionOverride',
    (override: MembershipPermissionOverride) => override.membership,
  )
  permissionOverrides!: MembershipPermissionOverride[];
}
